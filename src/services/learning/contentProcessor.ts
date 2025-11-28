// Content processing service for uploaded files
import { Queue, Worker, Job } from 'bullmq';
import { createBullConnection } from '../../config/redis.js';
import { prisma } from '../../config/database.js';
import { geminiService } from '../ai/geminiService.js';
import { lessonService } from './lessonService.js';
import { exerciseService } from './exerciseService.js';
import { AgeGroup, SourceType } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { LessonAnalysis } from '../ai/geminiService.js';

import { CurriculumType } from '@prisma/client';

/**
 * Extract exercises from formattedContent HTML when exercises array is empty
 * Parses <span class="interactive-exercise" data-exercise-id="ex-1" data-type="MATH_PROBLEM" data-answer="1/6">...</span>
 */
function extractExercisesFromHTML(html: string): NonNullable<LessonAnalysis['exercises']> {
  const exercises: NonNullable<LessonAnalysis['exercises']> = [];

  // Regex to match interactive exercise spans
  const exerciseRegex = /<span[^>]*class=["'][^"']*interactive-exercise[^"']*["'][^>]*data-exercise-id=["']([^"']+)["'][^>]*data-type=["']([^"']+)["'][^>]*data-answer=["']([^"']+)["'][^>]*>([^<]*)<\/span>/gi;

  // Also try alternative attribute order
  const altRegex = /<span[^>]*data-exercise-id=["']([^"']+)["'][^>]*data-type=["']([^"']+)["'][^>]*data-answer=["']([^"']+)["'][^>]*class=["'][^"']*interactive-exercise[^"']*["'][^>]*>([^<]*)<\/span>/gi;

  let match;

  // Try primary regex
  while ((match = exerciseRegex.exec(html)) !== null) {
    exercises.push({
      id: match[1],
      type: match[2] as any,
      questionText: match[4],
      expectedAnswer: match[3],
      acceptableAnswers: [],
      difficulty: 'MEDIUM' as const,
    });
  }

  // Try alternative regex if no matches
  if (exercises.length === 0) {
    while ((match = altRegex.exec(html)) !== null) {
      exercises.push({
        id: match[1],
        type: match[2] as any,
        questionText: match[4],
        expectedAnswer: match[3],
        acceptableAnswers: [],
        difficulty: 'MEDIUM' as const,
      });
    }
  }

  // If still no matches, try a more lenient approach
  if (exercises.length === 0) {
    const lenientRegex = /data-exercise-id=["']([^"']+)["'][^>]*data-type=["']([^"']+)["'][^>]*data-answer=["']([^"']+)["']/gi;
    let exerciseNum = 1;
    while ((match = lenientRegex.exec(html)) !== null) {
      exercises.push({
        id: match[1],
        type: match[2] as any,
        questionText: `Exercise ${exerciseNum}`, // Fallback text
        expectedAnswer: match[3],
        acceptableAnswers: [],
        difficulty: 'MEDIUM' as const,
      });
      exerciseNum++;
    }
  }

  logger.info(`Extracted ${exercises.length} exercises from HTML using fallback parser`, {
    exerciseIds: exercises.map(e => e.id),
  });

  return exercises;
}

// Job data types
export interface ContentProcessingJobData {
  lessonId: string;
  fileUrl?: string;
  youtubeUrl?: string;
  sourceType: SourceType;
  childId: string;
  ageGroup: AgeGroup;
  curriculumType?: CurriculumType | null;
  gradeLevel?: number | null;
}

// Processing queue
let processingQueue: Queue | null = null;
let processingWorker: Worker | null = null;

/**
 * Initialize the content processing queue
 */
export function initializeContentProcessor(): void {
  const connection = createBullConnection();

  processingQueue = new Queue('content-processing', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    },
  });

  processingWorker = new Worker(
    'content-processing',
    processContentJob,
    { connection }
  );

  processingWorker.on('completed', (job) => {
    logger.info(`Content processing completed for lesson ${job.data.lessonId}`);
  });

  processingWorker.on('failed', (job, err) => {
    logger.error(`Content processing failed for lesson ${job?.data.lessonId}`, { error: err.message });
  });

  logger.info('Content processing queue initialized');
}

/**
 * Add a lesson to the processing queue
 */
export async function queueContentProcessing(
  data: ContentProcessingJobData
): Promise<void> {
  if (!processingQueue) {
    throw new Error('Processing queue not initialized');
  }

  // Update lesson status to processing
  await lessonService.updateProcessingStatus(data.lessonId, 'PROCESSING');

  // Add to queue
  await processingQueue.add('process-content', data, {
    jobId: `process-${data.lessonId}`,
  });
}

/**
 * Process a content job
 */
async function processContentJob(job: Job<ContentProcessingJobData>): Promise<void> {
  const { lessonId, fileUrl, youtubeUrl, sourceType, childId, ageGroup, curriculumType, gradeLevel } = job.data;

  try {
    // 1. Extract text based on source type
    let extractedText: string;

    switch (sourceType) {
      case 'PDF':
        extractedText = await extractTextFromPDF(fileUrl!);
        break;
      case 'IMAGE':
        extractedText = await extractTextFromImage(fileUrl!);
        break;
      case 'YOUTUBE':
        extractedText = await extractYouTubeTranscript(youtubeUrl!);
        break;
      case 'TEXT':
        // Text is already extracted, fetch from lesson
        const lesson = await lessonService.getById(lessonId);
        extractedText = lesson?.extractedText || '';
        break;
      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }

    if (!extractedText || extractedText.trim().length < 50) {
      throw new Error('Could not extract sufficient text from content');
    }

    // 2. Get lesson to check subject
    const lesson = await lessonService.getById(lessonId);

    // 3. Analyze content with AI (curriculum-aware)
    const analysis = await geminiService.analyzeContent(extractedText, {
      ageGroup,
      curriculumType,
      gradeLevel,
      subject: lesson?.subject,
    });

    // 4. Update lesson with processed content (including formattedContent with exercise markers)
    // Log what we're about to save for debugging
    logger.info(`Updating lesson ${lessonId} with analysis results`, {
      hasFormattedContent: !!analysis.formattedContent,
      formattedContentLength: analysis.formattedContent?.length || 0,
      hasInteractiveExerciseMarkers: analysis.formattedContent?.includes('interactive-exercise') || false,
      exerciseCount: analysis.exercises?.length || 0,
      chapterCount: analysis.chapters?.length || 0,
      vocabularyCount: analysis.vocabulary?.length || 0,
    });

    await lessonService.update(lessonId, {
      extractedText,
      title: analysis.title || lesson?.title,
      summary: analysis.summary,
      gradeLevel: analysis.gradeLevel,
      formattedContent: analysis.formattedContent || undefined, // HTML with embedded exercise markers
      // Cast arrays to JSON-compatible format for Prisma
      chapters: analysis.chapters ? JSON.parse(JSON.stringify(analysis.chapters)) : undefined,
      keyConcepts: analysis.keyConcepts,
      vocabulary: analysis.vocabulary ? JSON.parse(JSON.stringify(analysis.vocabulary)) : undefined,
      suggestedQuestions: analysis.suggestedQuestions,
      aiConfidence: analysis.confidence,
      processingStatus: 'COMPLETED',
      safetyReviewed: true,
    });

    logger.info(`Lesson ${lessonId} updated successfully`);

    // 5. Create interactive exercises from the analysis (exercises are now embedded in formattedContent)
    try {
      let exercisesToCreate = analysis.exercises || [];

      // Fallback: If exercises array is empty but formattedContent has exercise markers,
      // try to extract exercises from the HTML
      if (exercisesToCreate.length === 0 && analysis.formattedContent?.includes('interactive-exercise')) {
        logger.info(`Exercises array empty but formattedContent has markers, attempting extraction for lesson ${lessonId}`);
        const extractedExercises = extractExercisesFromHTML(analysis.formattedContent);
        if (extractedExercises.length > 0) {
          exercisesToCreate = extractedExercises;
          logger.info(`Extracted ${extractedExercises.length} exercises from formattedContent HTML`);
        }
      }

      if (exercisesToCreate.length > 0) {
        logger.info(`Processing ${exercisesToCreate.length} exercises for lesson ${lessonId}`, {
          exerciseDetails: exercisesToCreate.map(ex => ({
            id: ex.id,
            type: ex.type,
            questionPreview: ex.questionText?.substring(0, 50),
          })),
        });

        // Convert analysis exercises to DetectedExercise format
        const detectedExercises = exercisesToCreate.map(ex => ({
          type: ex.type as any,
          questionText: ex.questionText,
          expectedAnswer: ex.expectedAnswer,
          acceptableAnswers: ex.acceptableAnswers,
          hint1: ex.hint1,
          hint2: ex.hint2,
          explanation: ex.explanation,
          difficulty: ex.difficulty as any,
          // Store the exercise ID from the HTML markers for frontend matching
          originalPosition: ex.id,
        }));

        const createdExercises = await exerciseService.createExercisesForLesson(lessonId, detectedExercises);
        logger.info(`Created ${createdExercises.length} inline interactive exercises for lesson ${lessonId}`, {
          exerciseIds: createdExercises.map(e => ({ dbId: e.id, markerId: e.originalPosition })),
        });
      } else {
        logger.info(`No interactive exercises found in analysis for lesson ${lessonId}`, {
          analysisHasExercises: 'exercises' in analysis,
          exercisesArrayExists: Array.isArray(analysis.exercises),
          formattedContentHasMarkers: analysis.formattedContent?.includes('interactive-exercise') || false,
        });
      }
    } catch (exerciseError) {
      // Don't fail the whole processing if exercise creation fails
      logger.error(`Failed to create exercises for lesson ${lessonId}`, {
        error: exerciseError instanceof Error ? exerciseError.message : 'Unknown error',
        stack: exerciseError instanceof Error ? exerciseError.stack : undefined,
      });
    }

    logger.info(`Successfully processed lesson ${lessonId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to process lesson ${lessonId}`, { error: errorMessage });

    await lessonService.updateProcessingStatus(lessonId, 'FAILED', errorMessage);
    throw error;
  }
}

/**
 * Extract text from a PDF file
 */
async function extractTextFromPDF(fileUrl: string): Promise<string> {
  // TODO: Download file from R2 and use pdf-parse
  // For now, return placeholder
  logger.info(`Extracting text from PDF: ${fileUrl}`);

  // In production, this would:
  // 1. Download file from R2
  // 2. Use pdf-parse to extract text
  // 3. Return the extracted text

  // Placeholder implementation
  return 'PDF content would be extracted here';
}

/**
 * Extract text from an image using Gemini Vision
 */
async function extractTextFromImage(fileUrl: string): Promise<string> {
  // TODO: Download file from R2 and use Gemini Vision for OCR
  logger.info(`Extracting text from image: ${fileUrl}`);

  // In production, this would:
  // 1. Download image from R2
  // 2. Convert to base64
  // 3. Use Gemini Vision API for OCR
  // 4. Return extracted text

  // Placeholder implementation
  return 'Image text would be extracted here using Gemini Vision';
}

/**
 * Extract transcript from a YouTube video
 */
async function extractYouTubeTranscript(youtubeUrl: string): Promise<string> {
  // TODO: Use youtube-transcript package
  logger.info(`Extracting transcript from YouTube: ${youtubeUrl}`);

  // In production, this would:
  // 1. Extract video ID from URL
  // 2. Fetch transcript using youtube-transcript
  // 3. Return the transcript text

  // Placeholder implementation
  return 'YouTube transcript would be extracted here';
}

/**
 * Get processing status for a lesson
 */
export async function getProcessingStatus(lessonId: string): Promise<{
  status: string;
  progress?: number;
  error?: string;
}> {
  const lesson = await lessonService.getById(lessonId);

  if (!lesson) {
    throw new Error('Lesson not found');
  }

  return {
    status: lesson.processingStatus,
    error: lesson.processingError || undefined,
  };
}

/**
 * Shutdown the content processor
 */
export async function shutdownContentProcessor(): Promise<void> {
  if (processingWorker) {
    await processingWorker.close();
  }
  if (processingQueue) {
    await processingQueue.close();
  }
  logger.info('Content processing queue shut down');
}
