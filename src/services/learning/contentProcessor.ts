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
import { badgeService } from '../gamification/badgeService.js';
import { xpEngine } from '../gamification/xpEngine.js';
import { documentFormatter } from '../formatting/index.js';
import { analyzePPT } from './pptProcessor.js';
import { dashboardCache } from '../cache/dashboardCache.js';

// Note: Formatting is now handled by the deterministic DocumentFormatter
// for 100% reliability. AI only extracts metadata (exercises, vocabulary, etc.)
// The DocumentFormatter uses the extracted metadata to enhance formatting.

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
    {
      connection,
      concurrency: 2, // Limit concurrent processing to prevent CPU bottleneck
      lockDuration: 180000, // 3 minutes - AI operations (Gemini API) can be slow
      lockRenewTime: 60000, // Renew lock every minute
    }
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
      case 'PPT':
        extractedText = await extractTextFromPPT(fileUrl!);
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

    // 4. Format content using deterministic DocumentFormatter (100% reliable)
    // Uses AI-extracted metadata (chapters, vocabulary, exercises) to enhance formatting
    const formattedContent = documentFormatter.format(extractedText, {
      ageGroup,
      chapters: analysis.chapters,
      vocabulary: analysis.vocabulary,
      exercises: analysis.exercises?.map(ex => ({
        id: ex.id,
        type: ex.type,
        questionText: ex.questionText,
        expectedAnswer: ex.expectedAnswer,
        acceptableAnswers: ex.acceptableAnswers,
        hint1: ex.hint1,
        hint2: ex.hint2,
        explanation: ex.explanation,
        difficulty: ex.difficulty,
        locationInContent: ex.locationInContent,
      })),
    });

    logger.info(`Content formatted successfully`, {
      rawLength: extractedText.length,
      formattedLength: formattedContent.length,
      hasChapters: !!analysis.chapters?.length,
      hasVocabulary: !!analysis.vocabulary?.length,
      hasExercises: !!analysis.exercises?.length,
    });

    // 5. Update lesson with analysis metadata and formatted content
    logger.info(`Updating lesson ${lessonId} with analysis results`, {
      exerciseCount: analysis.exercises?.length || 0,
      chapterCount: analysis.chapters?.length || 0,
      vocabularyCount: analysis.vocabulary?.length || 0,
      extractedTextLength: extractedText.length,
    });

    await lessonService.update(lessonId, {
      extractedText, // Raw extracted text (kept for reference and Jeffrey's context)
      formattedContent, // Deterministically formatted HTML (100% reliable)
      title: analysis.title || lesson?.title,
      summary: analysis.summary,
      // Convert gradeLevel to string if it's a number (Prisma expects string)
      gradeLevel: analysis.gradeLevel != null ? String(analysis.gradeLevel) : undefined,
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

    // 6. Increment lesson completion count and check badges
    try {
      // Update UserProgress.lessonsCompleted
      await prisma.userProgress.upsert({
        where: { childId },
        create: {
          childId,
          lessonsCompleted: 1,
        },
        update: {
          lessonsCompleted: { increment: 1 },
        },
      });

      // Get current progress to check badges
      const progress = await xpEngine.getProgress(childId);

      // Check for badge unlocks (lesson completion badges)
      const newBadges = await badgeService.checkAndAwardBadges(childId, {
        xpEarned: 0,
        totalXP: progress.totalXP,
        level: progress.level,
        reason: 'LESSON_COMPLETE',
        leveledUp: false,
      });

      if (newBadges.length > 0) {
        logger.info(`Awarded ${newBadges.length} badges for lesson completion`, {
          lessonId,
          childId,
          badges: newBadges.map(b => b.name),
        });
      }
    } catch (progressError) {
      // Don't fail processing if progress update fails
      logger.error(`Failed to update progress for lesson ${lessonId}`, {
        error: progressError instanceof Error ? progressError.message : 'Unknown error',
      });
    }

    // 7. Create interactive exercises from the analysis
    // Exercises are detected by AI from the raw content and stored separately
    try {
      const exercisesToCreate = analysis.exercises || [];

      if (exercisesToCreate.length > 0) {
        logger.info(`Processing ${exercisesToCreate.length} exercises for lesson ${lessonId}`, {
          exerciseDetails: exercisesToCreate.map(ex => ({
            id: ex.id,
            type: ex.type,
            questionPreview: ex.questionText?.substring(0, 50),
            location: ex.locationInContent,
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
          // Store the exercise ID and location for reference
          originalPosition: ex.locationInContent || ex.id,
        }));

        const createdExercises = await exerciseService.createExercisesForLesson(lessonId, detectedExercises);
        logger.info(`Created ${createdExercises.length} exercises for lesson ${lessonId}`, {
          exerciseIds: createdExercises.map(e => ({ dbId: e.id, location: e.originalPosition })),
        });
      } else {
        logger.info(`No exercises found in content for lesson ${lessonId}`);
      }
    } catch (exerciseError) {
      // Don't fail the whole processing if exercise creation fails
      logger.error(`Failed to create exercises for lesson ${lessonId}`, {
        error: exerciseError instanceof Error ? exerciseError.message : 'Unknown error',
        stack: exerciseError instanceof Error ? exerciseError.stack : undefined,
      });
    }

    // Invalidate dashboard cache for the parent (so they see updated lesson count immediately)
    try {
      const child = await prisma.child.findUnique({
        where: { id: childId },
        select: { parentId: true },
      });
      if (child?.parentId) {
        await dashboardCache.invalidateChildCaches(childId, child.parentId);
        logger.debug(`Invalidated dashboard cache for parent ${child.parentId}`);
      }
    } catch (cacheError) {
      // Don't fail processing if cache invalidation fails
      logger.warn(`Failed to invalidate dashboard cache for child ${childId}`, {
        error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
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
 * Extract text from a PowerPoint file (PPT/PPTX)
 * Downloads from R2, then uses Gemini's native PPT processing for text extraction
 */
async function extractTextFromPPT(fileUrl: string): Promise<string> {
  logger.info(`Extracting text from PPT: ${fileUrl}`);

  try {
    // Download file from R2/CDN
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download PPT file: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pptBuffer = Buffer.from(arrayBuffer);
    const pptBase64 = pptBuffer.toString('base64');

    // Determine MIME type from URL extension
    const isPPTX = fileUrl.toLowerCase().endsWith('.pptx');
    const mimeType = isPPTX
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/vnd.ms-powerpoint';

    // Extract filename from URL
    const urlPath = new URL(fileUrl).pathname;
    const filename = urlPath.split('/').pop() || `presentation.${isPPTX ? 'pptx' : 'ppt'}`;

    // Analyze PPT using Gemini's native document processing
    const result = await analyzePPT(
      pptBase64,
      mimeType as 'application/vnd.ms-powerpoint' | 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename
    );

    logger.info(`PPT text extraction completed`, {
      fileUrl,
      slideCount: result.slideCount,
      textLength: result.extractedText.length,
    });

    return result.extractedText;
  } catch (error) {
    logger.error(`Failed to extract text from PPT`, {
      fileUrl,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
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
