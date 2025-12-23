// Teacher Content Generation Service - AI-powered content creation
import { genAI } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { prisma } from '../../config/database.js';
import { Subject, TeacherContentType, TokenOperation } from '@prisma/client';
import { quotaService } from './quotaService.js';
import { contentService } from './contentService.js';
import { logger } from '../../utils/logger.js';
import { uploadFile } from '../storage/storageService.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// TYPES
// ============================================

export interface GenerateLessonInput {
  topic: string;
  subject?: Subject;
  gradeLevel?: string;
  curriculum?: string; // e.g., COMMON_CORE, UK_NATIONAL, IB_PYP
  objectives?: string[];
  duration?: number; // minutes
  lessonType?: 'guide' | 'full'; // 'guide' = teacher guide, 'full' = comprehensive student-ready lesson
  includeActivities?: boolean;
  includeAssessment?: boolean;
  additionalContext?: string; // Extra notes from teacher
}

export interface GeneratedLesson {
  title: string;
  summary: string;
  objectives: string[];
  sections: Array<{
    title: string;
    content: string;
    duration?: number;
    activities?: string[];
  }>;
  vocabulary?: Array<{
    term: string;
    definition: string;
    example?: string;
  }>;
  assessment?: {
    questions: Array<{
      question: string;
      type: 'multiple_choice' | 'short_answer' | 'true_false';
      options?: string[];
      correctAnswer: string;
      explanation?: string;
    }>;
  };
  teacherNotes?: string;
  tokensUsed: number;
}

export interface GenerateQuizInput {
  content: string;
  title?: string;
  questionCount?: number;
  questionTypes?: Array<'multiple_choice' | 'true_false' | 'fill_blank' | 'short_answer'>;
  difficulty?: 'easy' | 'medium' | 'hard' | 'mixed';
  gradeLevel?: string;
}

export interface GeneratedQuiz {
  title: string;
  questions: Array<{
    id: string;
    question: string;
    type: string;
    options?: string[];
    correctAnswer: string;
    explanation: string;
    difficulty: string;
    points: number;
  }>;
  totalPoints: number;
  estimatedTime: number; // minutes
  tokensUsed: number;
}

export interface GenerateFlashcardsInput {
  content: string;
  title?: string;
  cardCount?: number;
  includeHints?: boolean;
  gradeLevel?: string;
}

export interface GeneratedFlashcards {
  title: string;
  cards: Array<{
    id: string;
    front: string;
    back: string;
    hint?: string;
    category?: string;
  }>;
  tokensUsed: number;
}

export interface GenerateStudyGuideInput {
  content: string;
  title?: string;
  format?: 'outline' | 'detailed' | 'summary';
  includeKeyTerms?: boolean;
  includeReviewQuestions?: boolean;
  gradeLevel?: string;
}

export interface GeneratedStudyGuide {
  title: string;
  summary: string;
  outline: Array<{
    section: string;
    points: string[];
    keyTerms?: Array<{ term: string; definition: string }>;
  }>;
  reviewQuestions?: string[];
  studyTips?: string[];
  tokensUsed: number;
}

export interface GenerateInfographicInput {
  topic: string;
  keyPoints: string[];
  style?: 'educational' | 'colorful' | 'minimalist' | 'professional';
  gradeLevel?: string;
  subject?: string;
}

export interface GeneratedInfographic {
  imageUrl: string;
  title: string;
  tokensUsed: number;
}

// ============================================
// SPLIT GENERATION TYPES
// ============================================

export interface GenerateFullLessonInput extends GenerateLessonInput {
  includeQuiz?: boolean;
  includeFlashcards?: boolean;
  includeInfographic?: boolean;
  quizQuestionCount?: number;
  flashcardCount?: number;
  infographicStyle?: 'educational' | 'colorful' | 'minimalist' | 'professional';
}

export type GenerationStep =
  | 'starting'
  | 'generating_lesson'
  | 'generating_quiz'
  | 'generating_flashcards'
  | 'generating_infographic'
  | 'completed'
  | 'failed';

export interface GenerationProgress {
  step: GenerationStep;
  message: string;
  progress: number; // 0-100
  completedSteps: string[];
  currentData?: Partial<GeneratedFullLesson>;
}

export interface GeneratedFullLesson {
  lesson: Omit<GeneratedLesson, 'tokensUsed'>;
  quiz?: Omit<GeneratedQuiz, 'tokensUsed'>;
  flashcards?: Omit<GeneratedFlashcards, 'tokensUsed'>;
  infographic?: Omit<GeneratedInfographic, 'tokensUsed'>;
  totalTokensUsed: number;
  generationTime: number; // milliseconds
}

// ============================================
// SERVICE
// ============================================

export const contentGenerationService = {
  /**
   * Generate a lesson plan from a topic
   * Uses Gemini 3 Pro for richer, higher-quality content generation
   * lessonType: 'guide' = teacher guide (~2-4K tokens), 'full' = comprehensive lesson (~8-12K tokens)
   */
  async generateLesson(
    teacherId: string,
    input: GenerateLessonInput
  ): Promise<GeneratedLesson> {
    // Check quota - full lessons require more tokens
    const isFullLesson = input.lessonType === 'full';
    const estimatedTokens = isFullLesson ? 10000 : 4000;
    await quotaService.enforceQuota(teacherId, TokenOperation.LESSON_GENERATION, estimatedTokens);

    logger.info('Generating lesson', { teacherId, topic: input.topic, lessonType: input.lessonType || 'guide' });

    const prompt = isFullLesson ? buildFullLessonPrompt(input) : buildLessonPrompt(input);

    // Use Gemini 3 Pro for lesson generation - better reasoning and content quality
    // Full lessons require much higher token limits for comprehensive content
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.pro,
      generationConfig: {
        temperature: isFullLesson ? 0.75 : 0.7, // Slightly higher creativity for full lessons
        maxOutputTokens: isFullLesson ? 65536 : 16000, // Max tokens for full lessons to prevent truncation
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const lesson = JSON.parse(extractJSON(responseText)) as Omit<GeneratedLesson, 'tokensUsed'>;

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.LESSON_GENERATION,
        tokensUsed,
        modelUsed: config.gemini.models.pro,
        resourceType: 'lesson',
      });

      return { ...lesson, tokensUsed };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const responseLength = responseText.length;
      const isTruncated = errorMessage.includes('truncated') || responseText.endsWith('...');

      logger.error('Failed to parse generated lesson', {
        error: errorMessage,
        responseLength,
        tokensUsed,
        isTruncated,
        lessonType: input.lessonType || 'guide',
        topic: input.topic,
        // Log more of the response for debugging truncation issues
        responseStart: responseText.substring(0, 300),
        responseEnd: responseText.substring(Math.max(0, responseLength - 300)),
      });

      // Provide more specific error message
      if (isTruncated || errorMessage.includes('Unexpected end')) {
        throw new Error(
          'The lesson content was too large and got truncated. ' +
          'Try reducing the complexity of your request or generating a simpler lesson first.'
        );
      }
      throw new Error('Failed to generate lesson content');
    }
  },

  /**
   * Generate quiz from content
   */
  async generateQuiz(
    teacherId: string,
    contentId: string,
    input: GenerateQuizInput
  ): Promise<GeneratedQuiz> {
    // Check quota
    const estimatedTokens = 2000;
    await quotaService.enforceQuota(teacherId, TokenOperation.QUIZ_GENERATION, estimatedTokens);

    logger.info('Generating quiz', { teacherId, contentId, questionCount: input.questionCount });

    const prompt = buildQuizPrompt(input);

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const quiz = JSON.parse(extractJSON(responseText)) as Omit<GeneratedQuiz, 'tokensUsed'>;

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.QUIZ_GENERATION,
        tokensUsed,
        modelUsed: config.gemini.models.flash,
        resourceType: 'quiz',
        resourceId: contentId,
      });

      // Update content if contentId provided
      if (contentId) {
        await contentService.recordAIUsage(
          contentId,
          teacherId,
          tokensUsed,
          config.gemini.models.flash,
          TokenOperation.QUIZ_GENERATION
        );
      }

      return { ...quiz, tokensUsed };
    } catch (error) {
      logger.error('Failed to parse generated quiz', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      });
      throw new Error('Failed to generate quiz');
    }
  },

  /**
   * Generate flashcards from content
   * Uses Gemini 3 Pro for higher-quality flashcard content
   */
  async generateFlashcards(
    teacherId: string,
    contentId: string,
    input: GenerateFlashcardsInput
  ): Promise<GeneratedFlashcards> {
    // Check quota
    const estimatedTokens = 1500;
    await quotaService.enforceQuota(teacherId, TokenOperation.FLASHCARD_GENERATION, estimatedTokens);

    logger.info('Generating flashcards', { teacherId, contentId, cardCount: input.cardCount });

    const prompt = buildFlashcardsPrompt(input);

    // Use Gemini 3 Pro for flashcard generation - better content quality
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.pro,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 3000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const flashcards = JSON.parse(extractJSON(responseText)) as Omit<GeneratedFlashcards, 'tokensUsed'>;

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.FLASHCARD_GENERATION,
        tokensUsed,
        modelUsed: config.gemini.models.pro,
        resourceType: 'flashcards',
        resourceId: contentId,
      });

      // Update content if contentId provided
      if (contentId) {
        await contentService.recordAIUsage(
          contentId,
          teacherId,
          tokensUsed,
          config.gemini.models.pro,
          TokenOperation.FLASHCARD_GENERATION
        );
      }

      return { ...flashcards, tokensUsed };
    } catch (error) {
      logger.error('Failed to parse generated flashcards', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      });
      throw new Error('Failed to generate flashcards');
    }
  },

  /**
   * Generate study guide from content
   */
  async generateStudyGuide(
    teacherId: string,
    contentId: string,
    input: GenerateStudyGuideInput
  ): Promise<GeneratedStudyGuide> {
    // Check quota
    const estimatedTokens = 3000;
    await quotaService.enforceQuota(teacherId, TokenOperation.LESSON_GENERATION, estimatedTokens);

    logger.info('Generating study guide', { teacherId, contentId, format: input.format });

    const prompt = buildStudyGuidePrompt(input);

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 5000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const studyGuide = JSON.parse(extractJSON(responseText)) as Omit<GeneratedStudyGuide, 'tokensUsed'>;

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.LESSON_GENERATION,
        tokensUsed,
        modelUsed: config.gemini.models.flash,
        resourceType: 'study_guide',
        resourceId: contentId,
      });

      return { ...studyGuide, tokensUsed };
    } catch (error) {
      logger.error('Failed to parse generated study guide', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      });
      throw new Error('Failed to generate study guide');
    }
  },

  /**
   * Analyze uploaded content and extract text
   */
  async analyzeContent(
    teacherId: string,
    content: string,
    options: {
      detectSubject?: boolean;
      detectGradeLevel?: boolean;
      extractKeyTerms?: boolean;
    } = {}
  ): Promise<{
    subject?: Subject;
    gradeLevel?: string;
    summary: string;
    keyTerms?: Array<{ term: string; definition: string }>;
    suggestedContentTypes: TeacherContentType[];
    tokensUsed: number;
  }> {
    // Check quota
    const estimatedTokens = 2000;
    await quotaService.enforceQuota(teacherId, TokenOperation.CONTENT_ANALYSIS, estimatedTokens);

    logger.info('Analyzing content', { teacherId, contentLength: content.length });

    const prompt = buildAnalysisPrompt(content, options);

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const tokensUsed = result.response.usageMetadata?.totalTokenCount || estimatedTokens;

    try {
      const analysis = JSON.parse(extractJSON(responseText));

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.CONTENT_ANALYSIS,
        tokensUsed,
        modelUsed: config.gemini.models.flash,
        resourceType: 'analysis',
      });

      return { ...analysis, tokensUsed };
    } catch (error) {
      logger.error('Failed to parse content analysis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      });
      throw new Error('Failed to analyze content');
    }
  },

  /**
   * Generate an educational infographic image
   * Uses Gemini image generation model
   */
  async generateInfographic(
    teacherId: string,
    contentId: string,
    input: GenerateInfographicInput
  ): Promise<GeneratedInfographic> {
    // Check quota
    const estimatedTokens = 1000;
    await quotaService.enforceQuota(teacherId, TokenOperation.INFOGRAPHIC_GENERATION, estimatedTokens);

    logger.info('Generating infographic', { teacherId, contentId, topic: input.topic });

    // Build a detailed prompt for the infographic
    const styleDescriptions: Record<string, string> = {
      educational: 'clean, professional educational style with clear sections, icons, and easy-to-read typography',
      colorful: 'vibrant, colorful, and engaging with bold colors and fun illustrations suitable for students',
      minimalist: 'clean, minimal design with lots of white space and simple icons',
      professional: 'corporate, professional look with muted colors and structured layout',
    };

    const style = input.style || 'educational';
    const gradeDescription = input.gradeLevel
      ? `appropriate for grade ${input.gradeLevel} students`
      : 'appropriate for elementary/middle school students';

    const keyPointsFormatted = input.keyPoints.map((point, i) => `${i + 1}. ${point}`).join('\n');

    const prompt = `Create an educational infographic about "${input.topic}".

STYLE: ${styleDescriptions[style]}
AUDIENCE: ${gradeDescription}
${input.subject ? `SUBJECT: ${input.subject}` : ''}

KEY INFORMATION TO INCLUDE:
${keyPointsFormatted}

REQUIREMENTS:
- Create a visually appealing vertical infographic layout
- Include clear section headers and organized content
- Use appropriate icons and illustrations
- Make text large and readable
- Use a cohesive color scheme
- Include the title "${input.topic}" prominently at the top
- Add visual representations of the key concepts
- Make it engaging and educational for students

Do NOT include any inappropriate or scary imagery. Keep it child-friendly and educational.`;

    try {
      // Use Gemini image generation model
      const model = genAI.getGenerativeModel({
        model: config.gemini.models.image,
        generationConfig: {
          // @ts-expect-error - image generation specific config
          responseModalities: ['image', 'text'],
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response;
      const tokensUsed = response.usageMetadata?.totalTokenCount || estimatedTokens;

      // Extract image from response
      let imageData: Buffer | null = null;
      let mimeType = 'image/png';

      for (const candidate of response.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          // inlineData exists on image generation responses
          const inlineData = (part as { inlineData?: { data: string; mimeType?: string } }).inlineData;
          if (inlineData?.data) {
            imageData = Buffer.from(inlineData.data, 'base64');
            mimeType = inlineData.mimeType || 'image/png';
            break;
          }
        }
        if (imageData) break;
      }

      if (!imageData) {
        throw new Error('No image generated in response');
      }

      // Upload to R2
      const filename = `infographic-${uuidv4()}.png`;
      const storagePath = `teacher/${teacherId}/infographics/${filename}`;

      const uploadResult = await uploadFile(
        'aiContent',
        storagePath,
        imageData,
        mimeType,
        {
          teacherId,
          contentId,
          topic: input.topic,
        }
      );

      // Record usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.INFOGRAPHIC_GENERATION,
        tokensUsed,
        modelUsed: config.gemini.models.image,
        resourceType: 'infographic',
        resourceId: contentId,
      });

      // Update content with infographic URL if contentId provided
      if (contentId) {
        await contentService.updateContent(contentId, teacherId, {
          infographicUrl: uploadResult.publicUrl,
        });
        await contentService.recordAIUsage(
          contentId,
          teacherId,
          tokensUsed,
          config.gemini.models.image,
          TokenOperation.INFOGRAPHIC_GENERATION
        );
      }

      return {
        imageUrl: uploadResult.publicUrl,
        title: input.topic,
        tokensUsed,
      };
    } catch (error) {
      logger.error('Failed to generate infographic', {
        error: error instanceof Error ? error.message : 'Unknown error',
        topic: input.topic,
      });
      throw new Error('Failed to generate infographic. Please try again.');
    }
  },

  /**
   * Generate a full lesson with optional quiz, flashcards, and infographic
   * Uses split generation - each component is generated separately for reliability
   * Supports progress callbacks for real-time UI updates
   */
  async generateFullLessonWithProgress(
    teacherId: string,
    input: GenerateFullLessonInput,
    onProgress?: (progress: GenerationProgress) => void
  ): Promise<GeneratedFullLesson> {
    const startTime = Date.now();
    let totalTokensUsed = 0;
    const completedSteps: string[] = [];
    const result: Partial<GeneratedFullLesson> = {};

    // Helper to send progress updates
    const sendProgress = (step: GenerationStep, message: string, progress: number) => {
      if (onProgress) {
        onProgress({
          step,
          message,
          progress,
          completedSteps: [...completedSteps],
          currentData: { ...result } as Partial<GeneratedFullLesson>,
        });
      }
    };

    try {
      // Step 1: Generate the core lesson
      sendProgress('generating_lesson', 'Creating your lesson content...', 10);

      const lessonInput: GenerateLessonInput = {
        topic: input.topic,
        subject: input.subject,
        gradeLevel: input.gradeLevel,
        curriculum: input.curriculum,
        objectives: input.objectives,
        duration: input.duration,
        lessonType: input.lessonType || 'full',
        includeActivities: input.includeActivities,
        includeAssessment: input.includeAssessment,
        additionalContext: input.additionalContext,
      };

      const lessonResult = await this.generateLesson(teacherId, lessonInput);
      totalTokensUsed += lessonResult.tokensUsed;
      const { tokensUsed: _lt, ...lessonWithoutTokens } = lessonResult;
      result.lesson = lessonWithoutTokens;
      completedSteps.push('lesson');

      sendProgress('generating_lesson', 'Lesson created successfully!', 30);

      // Create a summary of the lesson content for generating related content
      const lessonSummary = `
Topic: ${lessonResult.title}
Summary: ${lessonResult.summary}
Objectives: ${lessonResult.objectives.join(', ')}
Key Vocabulary: ${lessonResult.vocabulary?.map(v => v.term).join(', ') || 'N/A'}
Sections: ${lessonResult.sections.map(s => s.title).join(', ')}
      `.trim();

      // Step 2: Generate quiz if requested
      if (input.includeQuiz) {
        sendProgress('generating_quiz', 'Crafting quiz questions...', 40);

        try {
          const quizResult = await this.generateQuiz(teacherId, '', {
            content: lessonSummary + '\n\n' + lessonResult.sections.map(s => s.content).join('\n\n'),
            title: `Quiz: ${lessonResult.title}`,
            questionCount: input.quizQuestionCount || 10,
            questionTypes: ['multiple_choice', 'true_false', 'short_answer'],
            difficulty: 'mixed',
            gradeLevel: input.gradeLevel,
          });
          totalTokensUsed += quizResult.tokensUsed;
          const { tokensUsed: _qt, ...quizWithoutTokens } = quizResult;
          result.quiz = quizWithoutTokens;
          completedSteps.push('quiz');

          sendProgress('generating_quiz', 'Quiz created successfully!', 55);
        } catch (error) {
          logger.warn('Failed to generate quiz, continuing without it', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          sendProgress('generating_quiz', 'Quiz generation skipped (will retry later)', 55);
        }
      }

      // Step 3: Generate flashcards if requested
      if (input.includeFlashcards) {
        sendProgress('generating_flashcards', 'Building flashcard deck...', 60);

        try {
          const flashcardsResult = await this.generateFlashcards(teacherId, '', {
            content: lessonSummary + '\n\n' + lessonResult.sections.map(s => s.content).join('\n\n'),
            title: `Flashcards: ${lessonResult.title}`,
            cardCount: input.flashcardCount || 15,
            includeHints: true,
            gradeLevel: input.gradeLevel,
          });
          totalTokensUsed += flashcardsResult.tokensUsed;
          const { tokensUsed: _ft, ...flashcardsWithoutTokens } = flashcardsResult;
          result.flashcards = flashcardsWithoutTokens;
          completedSteps.push('flashcards');

          sendProgress('generating_flashcards', 'Flashcards created successfully!', 75);
        } catch (error) {
          logger.warn('Failed to generate flashcards, continuing without them', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          sendProgress('generating_flashcards', 'Flashcard generation skipped (will retry later)', 75);
        }
      }

      // Step 4: Generate infographic if requested
      if (input.includeInfographic) {
        sendProgress('generating_infographic', 'Designing visual infographic...', 80);

        try {
          // Extract key points from the lesson for the infographic
          const keyPoints = [
            ...lessonResult.objectives.slice(0, 3),
            ...(lessonResult.vocabulary?.slice(0, 3).map(v => `${v.term}: ${v.definition}`) || []),
            ...(lessonResult.sections.slice(0, 2).map(s => s.title) || []),
          ].slice(0, 6);

          const infographicResult = await this.generateInfographic(teacherId, '', {
            topic: lessonResult.title,
            keyPoints,
            style: input.infographicStyle || 'educational',
            gradeLevel: input.gradeLevel,
            subject: input.subject,
          });
          totalTokensUsed += infographicResult.tokensUsed;
          const { tokensUsed: _it, ...infographicWithoutTokens } = infographicResult;
          result.infographic = infographicWithoutTokens;
          completedSteps.push('infographic');

          sendProgress('generating_infographic', 'Infographic created successfully!', 95);
        } catch (error) {
          logger.warn('Failed to generate infographic, continuing without it', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          sendProgress('generating_infographic', 'Infographic generation skipped (will retry later)', 95);
        }
      }

      // Complete
      const generationTime = Date.now() - startTime;
      result.totalTokensUsed = totalTokensUsed;
      result.generationTime = generationTime;

      sendProgress('completed', 'Your lesson is ready!', 100);

      logger.info('Full lesson generation completed', {
        teacherId,
        topic: input.topic,
        generationTime,
        totalTokensUsed,
        completedSteps,
      });

      return result as GeneratedFullLesson;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      sendProgress('failed', `Generation failed: ${errorMessage}`, 0);

      logger.error('Full lesson generation failed', {
        teacherId,
        topic: input.topic,
        error: errorMessage,
        completedSteps,
      });

      throw error;
    }
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractJSON(text: string): string {
  // Try to parse as-is first
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue to extraction logic
  }

  // Try to extract JSON from markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    const extracted = jsonBlockMatch[1].trim();
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      // Code block content is also invalid, continue
    }
  }

  // Try to find JSON object or array
  const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
  const jsonObjectMatch = text.match(/\{[\s\S]*\}/);

  let candidate = '';
  if (jsonArrayMatch && jsonObjectMatch) {
    candidate = jsonArrayMatch[0].length > jsonObjectMatch[0].length
      ? jsonArrayMatch[0]
      : jsonObjectMatch[0];
  } else {
    candidate = jsonArrayMatch?.[0] || jsonObjectMatch?.[0] || text;
  }

  // Try to parse the candidate
  try {
    JSON.parse(candidate);
    return candidate;
  } catch (error) {
    // Check if the JSON appears to be truncated (common issue with large responses)
    const openBraces = (candidate.match(/\{/g) || []).length;
    const closeBraces = (candidate.match(/\}/g) || []).length;
    const openBrackets = (candidate.match(/\[/g) || []).length;
    const closeBrackets = (candidate.match(/\]/g) || []).length;

    if (openBraces > closeBraces || openBrackets > closeBrackets) {
      // JSON is truncated - try to repair by closing brackets
      logger.warn('Detected truncated JSON response, attempting repair', {
        openBraces,
        closeBraces,
        openBrackets,
        closeBrackets,
        textLength: text.length,
      });

      // Try to repair truncated JSON by closing unclosed brackets/braces
      let repaired = candidate;
      // Remove incomplete key-value pairs at the end
      repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
      repaired = repaired.replace(/,\s*$/, '');

      // Add missing closing brackets
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        repaired += ']';
      }
      for (let i = 0; i < openBraces - closeBraces; i++) {
        repaired += '}';
      }

      try {
        JSON.parse(repaired);
        logger.info('Successfully repaired truncated JSON');
        return repaired;
      } catch {
        // Repair failed, throw descriptive error
        throw new Error(
          `JSON response was truncated (${openBraces} open braces, ${closeBraces} close braces). ` +
          `Response may have hit token limits. Original length: ${text.length} chars.`
        );
      }
    }

    // Check if there are MORE closing braces than opening (AI wrapped response in extra object)
    if (closeBraces > openBraces) {
      logger.warn('Detected extra wrapping in JSON response, attempting to unwrap', {
        openBraces,
        closeBraces,
        textLength: text.length,
      });

      // Try to remove trailing extra braces
      let unwrapped = candidate;
      const extraBraces = closeBraces - openBraces;
      for (let i = 0; i < extraBraces; i++) {
        // Remove the last closing brace
        unwrapped = unwrapped.replace(/\}\s*$/, '');
      }

      try {
        JSON.parse(unwrapped);
        logger.info('Successfully unwrapped JSON with extra braces');
        return unwrapped;
      } catch {
        // Try to find and extract nested JSON object with expected lesson structure
        // Look for "title" field which should be in the lesson object
        const titleMatch = candidate.match(/\{\s*"title"\s*:/);
        if (titleMatch && titleMatch.index !== undefined) {
          // Find the matching closing brace for this object
          let depth = 0;
          let endIndex = -1;
          for (let i = titleMatch.index; i < candidate.length; i++) {
            if (candidate[i] === '{') depth++;
            if (candidate[i] === '}') {
              depth--;
              if (depth === 0) {
                endIndex = i;
                break;
              }
            }
          }
          if (endIndex > titleMatch.index) {
            const extracted = candidate.substring(titleMatch.index, endIndex + 1);
            try {
              JSON.parse(extracted);
              logger.info('Successfully extracted nested lesson JSON');
              return extracted;
            } catch {
              // Extraction failed
            }
          }
        }
      }
    }

    // Not a truncation issue, return original for standard error handling
    return candidate;
  }
}

function buildLessonPrompt(input: GenerateLessonInput): string {
  // Map curriculum codes to human-readable names
  const curriculumMap: Record<string, string> = {
    'COMMON_CORE': 'Common Core State Standards (US)',
    'NGSS': 'Next Generation Science Standards (US)',
    'UK_NATIONAL': 'UK National Curriculum',
    'CAMBRIDGE': 'Cambridge International Curriculum',
    'IB_PYP': 'International Baccalaureate Primary Years Programme',
    'IB_MYP': 'International Baccalaureate Middle Years Programme',
    'AUSTRALIAN': 'Australian Curriculum',
    'SINGAPORE': 'Singapore Ministry of Education Curriculum',
    'ONTARIO': 'Ontario Curriculum (Canada)',
    'CCSS_MATH': 'Common Core Math Standards',
    'CCSS_ELA': 'Common Core English Language Arts Standards',
    'STATE_SPECIFIC': 'State-Specific Standards',
  };

  const curriculumName = input.curriculum ? curriculumMap[input.curriculum] || input.curriculum : null;

  return `You are an expert teacher creating a comprehensive lesson plan.

LESSON REQUIREMENTS:
- Topic: ${input.topic}
- Subject: ${input.subject || 'General'}
- Grade Level: ${input.gradeLevel || 'Elementary'}
- Duration: ${input.duration || 45} minutes
${curriculumName ? `- Curriculum/Standards: ${curriculumName} - Align learning objectives and content to this curriculum framework` : ''}
${input.objectives ? `- Specific Objectives: ${input.objectives.join(', ')}` : ''}
${input.includeActivities ? '- Include hands-on activities' : ''}
${input.includeAssessment ? '- Include assessment questions' : ''}
${input.additionalContext ? `\nADDITIONAL TEACHER NOTES:\n${input.additionalContext}` : ''}

Create a structured lesson plan with:
1. Clear learning objectives
2. Engaging introduction
3. Main content sections with detailed explanations
4. Activities or practice opportunities
5. Key vocabulary with definitions
6. Assessment questions (if requested)
7. Teacher notes for implementation

Return JSON with this structure:
{
  "title": "Lesson title",
  "summary": "Brief overview of the lesson",
  "objectives": ["Objective 1", "Objective 2"],
  "sections": [
    {
      "title": "Section title",
      "content": "Detailed content for this section...",
      "duration": 10,
      "activities": ["Activity description"]
    }
  ],
  "vocabulary": [
    {"term": "Word", "definition": "Definition", "example": "Example sentence"}
  ],
  "assessment": {
    "questions": [
      {
        "question": "Question text",
        "type": "multiple_choice",
        "options": ["A", "B", "C", "D"],
        "correctAnswer": "A",
        "explanation": "Why this is correct"
      }
    ]
  },
  "teacherNotes": "Implementation tips and suggestions"
}`;
}

/**
 * Build prompt for FULL comprehensive lesson (5-10 pages)
 * This creates student-ready content that can be exported as PDF
 */
function buildFullLessonPrompt(input: GenerateLessonInput): string {
  // Map curriculum codes to human-readable names
  const curriculumMap: Record<string, string> = {
    'COMMON_CORE': 'Common Core State Standards (US)',
    'NGSS': 'Next Generation Science Standards (US)',
    'UK_NATIONAL': 'UK National Curriculum',
    'CAMBRIDGE': 'Cambridge International Curriculum',
    'IB_PYP': 'International Baccalaureate Primary Years Programme',
    'IB_MYP': 'International Baccalaureate Middle Years Programme',
    'AUSTRALIAN': 'Australian Curriculum',
    'SINGAPORE': 'Singapore Ministry of Education Curriculum',
    'ONTARIO': 'Ontario Curriculum (Canada)',
    'CCSS_MATH': 'Common Core Math Standards',
    'CCSS_ELA': 'Common Core English Language Arts Standards',
    'STATE_SPECIFIC': 'State-Specific Standards',
  };

  const curriculumName = input.curriculum ? curriculumMap[input.curriculum] || input.curriculum : null;

  return `You are an expert educator creating a COMPREHENSIVE, STUDENT-READY lesson that can be used as a complete teaching resource and exported as a PDF handout. This should be 5-10 pages of rich, detailed content.

LESSON REQUIREMENTS:
- Topic: ${input.topic}
- Subject: ${input.subject || 'General'}
- Grade Level: ${input.gradeLevel || 'Elementary'}
- Duration: ${input.duration || 45} minutes
${curriculumName ? `- Curriculum/Standards: ${curriculumName} - Align all content to this curriculum framework` : ''}
${input.objectives ? `- Specific Objectives: ${input.objectives.join(', ')}` : ''}
${input.includeActivities ? '- Include detailed hands-on activities with step-by-step instructions' : ''}
${input.includeAssessment ? '- Include comprehensive assessment questions with answer key' : ''}
${input.additionalContext ? `\nADDITIONAL TEACHER NOTES:\n${input.additionalContext}` : ''}

Create a COMPREHENSIVE lesson that includes:

1. **DETAILED INTRODUCTION** (1-2 paragraphs)
   - Hook to capture student interest
   - Real-world connection to the topic
   - Clear statement of what students will learn

2. **LEARNING OBJECTIVES** (3-5 specific, measurable objectives)
   - Written in student-friendly language
   - Clear success criteria

3. **MAIN CONTENT SECTIONS** (3-5 detailed sections, each with 2-4 paragraphs)
   - Full explanations written for students (not teacher notes)
   - Step-by-step explanations of concepts
   - Multiple examples for each concept
   - Visual descriptions (diagrams, charts to include)
   - "Did You Know?" interesting facts
   - Connection to prior knowledge

4. **DETAILED ACTIVITIES** (2-3 activities with complete instructions)
   - Materials needed
   - Step-by-step procedures
   - Expected duration
   - Discussion questions
   - Extension ideas for advanced students

5. **KEY VOCABULARY** (8-15 terms)
   - Clear definitions appropriate for grade level
   - Example sentences
   - Word origins or memory aids

6. **PRACTICE EXERCISES** (5-10 problems or questions)
   - Varied difficulty levels
   - Answer key with explanations
   - Common mistakes to watch for

7. **COMPREHENSIVE ASSESSMENT** (if requested)
   - 10-15 questions of varied types
   - Mix of recall, application, and analysis
   - Complete answer key with scoring guide

8. **SUMMARY & REVIEW**
   - Key takeaways in bullet points
   - Review questions
   - Preview of next lesson

9. **TEACHER NOTES**
   - Common misconceptions to address
   - Differentiation strategies
   - Additional resources

Return JSON with this structure:
{
  "title": "Engaging lesson title",
  "summary": "Detailed overview of the lesson (2-3 sentences)",
  "objectives": ["Students will be able to...", "Students will demonstrate..."],
  "sections": [
    {
      "title": "Section title",
      "content": "DETAILED CONTENT: Multiple paragraphs of student-ready explanation. Include full sentences and clear explanations. This should be readable text that students can study from. Include examples, analogies, and clear step-by-step explanations where appropriate. Each section should be 200-400 words.",
      "duration": 10,
      "activities": [{
        "name": "Activity name",
        "description": "Full activity description with step-by-step instructions",
        "materials": ["Material 1", "Material 2"],
        "duration": 10,
        "discussionQuestions": ["Question 1?", "Question 2?"]
      }],
      "teachingTips": ["Tip 1", "Tip 2"],
      "visualAids": ["Description of diagram/chart to include"],
      "realWorldConnections": ["How this applies to real life"]
    }
  ],
  "vocabulary": [
    {
      "term": "Word",
      "definition": "Clear, student-friendly definition",
      "example": "Example sentence using the word in context",
      "memoryAid": "Trick to remember (optional)"
    }
  ],
  "practiceExercises": [
    {
      "question": "Exercise or problem",
      "type": "practice",
      "hint": "Helpful hint",
      "answer": "Correct answer with explanation"
    }
  ],
  "assessment": {
    "questions": [
      {
        "question": "Detailed question text",
        "type": "multiple_choice",
        "options": ["A) Option", "B) Option", "C) Option", "D) Option"],
        "correctAnswer": "A",
        "explanation": "Why this is correct and why others are wrong",
        "points": 2,
        "difficulty": "medium"
      }
    ],
    "totalPoints": 30,
    "passingScore": 21,
    "scoringGuide": "Description of how to score"
  },
  "summaryPoints": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"],
  "reviewQuestions": ["What did you learn about...?", "How would you explain...?"],
  "teacherNotes": "Detailed implementation notes including: common misconceptions, differentiation strategies, extension activities for advanced learners, support strategies for struggling students, cross-curricular connections",
  "additionalResources": ["Book/website recommendation 1", "Book/website recommendation 2"],
  "prerequisites": ["What students should already know"],
  "nextSteps": "What to teach next and how this connects"
}

IMPORTANT:
- Write content FOR STUDENTS, not as notes for teachers
- Make content engaging and age-appropriate
- Include plenty of examples and real-world connections
- Each section's content should be substantial (200-400 words)
- This should be comprehensive enough to use as a standalone study resource`;
}

function buildQuizPrompt(input: GenerateQuizInput): string {
  const questionCount = input.questionCount || 10;
  const types = input.questionTypes || ['multiple_choice', 'true_false'];

  return `You are an expert educator creating an assessment quiz.

CONTENT TO CREATE QUIZ FROM:
${input.content}

QUIZ REQUIREMENTS:
- Number of questions: ${questionCount}
- Question types: ${types.join(', ')}
- Difficulty: ${input.difficulty || 'mixed'}
- Grade level: ${input.gradeLevel || 'Elementary'}
${input.title ? `- Quiz title: ${input.title}` : ''}

Create a quiz that:
1. Tests understanding of key concepts
2. Has clear, unambiguous questions
3. Includes explanations for correct answers
4. Progresses from easier to harder questions
5. Uses appropriate vocabulary for the grade level

Return JSON with this structure:
{
  "title": "Quiz title",
  "questions": [
    {
      "id": "q1",
      "question": "Question text",
      "type": "multiple_choice",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "Explanation of why this is correct",
      "difficulty": "easy",
      "points": 1
    }
  ],
  "totalPoints": 10,
  "estimatedTime": 15
}`;
}

function buildFlashcardsPrompt(input: GenerateFlashcardsInput): string {
  const cardCount = input.cardCount || 20;

  return `You are an expert educator creating flashcards for effective studying.

CONTENT TO CREATE FLASHCARDS FROM:
${input.content}

FLASHCARD REQUIREMENTS:
- Number of cards: ${cardCount}
- Grade level: ${input.gradeLevel || 'Elementary'}
${input.includeHints ? '- Include helpful hints' : ''}
${input.title ? `- Deck title: ${input.title}` : ''}

Create flashcards that:
1. Focus on key facts and concepts
2. Use clear, concise language
3. Are appropriate for the grade level
4. Cover the most important information
5. Progress from foundational to more complex concepts

Return JSON with this structure:
{
  "title": "Flashcard deck title",
  "cards": [
    {
      "id": "card1",
      "front": "Question or term",
      "back": "Answer or definition",
      "hint": "Helpful hint (optional)",
      "category": "Topic category (optional)"
    }
  ]
}`;
}

function buildStudyGuidePrompt(input: GenerateStudyGuideInput): string {
  return `You are an expert educator creating a study guide.

CONTENT TO CREATE STUDY GUIDE FROM:
${input.content}

STUDY GUIDE REQUIREMENTS:
- Format: ${input.format || 'detailed'}
- Grade level: ${input.gradeLevel || 'Elementary'}
${input.includeKeyTerms ? '- Include key terms with definitions' : ''}
${input.includeReviewQuestions ? '- Include review questions' : ''}
${input.title ? `- Title: ${input.title}` : ''}

Create a study guide that:
1. Summarizes the main concepts
2. Organizes information logically
3. Highlights important points
4. Uses appropriate vocabulary
5. Helps students prepare effectively

Return JSON with this structure:
{
  "title": "Study guide title",
  "summary": "Overall summary of the content",
  "outline": [
    {
      "section": "Section title",
      "points": ["Key point 1", "Key point 2"],
      "keyTerms": [{"term": "Term", "definition": "Definition"}]
    }
  ],
  "reviewQuestions": ["Question 1", "Question 2"],
  "studyTips": ["Tip 1", "Tip 2"]
}`;
}

function buildAnalysisPrompt(
  content: string,
  options: {
    detectSubject?: boolean;
    detectGradeLevel?: boolean;
    extractKeyTerms?: boolean;
  }
): string {
  return `Analyze the following educational content and extract metadata.

CONTENT:
${content.substring(0, 8000)}

ANALYSIS TASKS:
${options.detectSubject !== false ? '- Detect the subject area (MATH, SCIENCE, ENGLISH, SOCIAL_STUDIES, ART, MUSIC, OTHER)' : ''}
${options.detectGradeLevel !== false ? '- Determine appropriate grade level (K, 1, 2, 3, 4, 5, 6, 7, 8, or range like "3-4")' : ''}
${options.extractKeyTerms !== false ? '- Extract key terms and their definitions' : ''}
- Provide a brief summary
- Suggest what types of content could be created from this (LESSON, QUIZ, FLASHCARD_DECK, STUDY_GUIDE, WORKSHEET)

Return JSON with this structure:
{
  "subject": "MATH",
  "gradeLevel": "3-4",
  "summary": "Brief summary of the content...",
  "keyTerms": [
    {"term": "Term", "definition": "Definition"}
  ],
  "suggestedContentTypes": ["LESSON", "QUIZ", "FLASHCARD_DECK"]
}`;
}

export default contentGenerationService;
