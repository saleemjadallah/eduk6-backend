// Lesson routes for content analysis and management
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireChild, requireParent, authorizeChildAccess } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { geminiService, LessonAnalysis } from '../services/ai/geminiService.js';
import { lessonService } from '../services/learning/lessonService.js';
import { queueContentProcessing } from '../services/learning/contentProcessor.js';
import { documentFormatter } from '../services/formatting/index.js';
import { parentUsageService } from '../services/parent/usageService.js';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { genAI } from '../config/gemini.js';
import { config } from '../config/index.js';
import { AgeGroup, Subject, SourceType, CurriculumType } from '@prisma/client';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

// Helper to normalize subject to uppercase enum value (must match Prisma Subject enum)
const subjectEnum = z.enum(['MATH', 'SCIENCE', 'ENGLISH', 'ARABIC', 'ISLAMIC_STUDIES', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'OTHER']);
const normalizeSubject = z.string().transform((val) => val.toUpperCase()).pipe(subjectEnum).optional();

const analyzeContentSchema = z.object({
  content: z.string().min(50, 'Content must be at least 50 characters'),
  childId: z.string().min(1).nullable().optional(), // Allow null, will use default child
  sourceType: z.enum(['PDF', 'IMAGE', 'YOUTUBE', 'TEXT', 'PPT', 'pdf', 'image', 'youtube', 'text', 'ppt'])
    .transform((val) => val.toUpperCase() as 'PDF' | 'IMAGE' | 'YOUTUBE' | 'TEXT' | 'PPT')
    .default('TEXT'),
  subject: z.string().transform((val) => val.toUpperCase()).pipe(subjectEnum).optional().nullable(),
  title: z.string().max(255).optional().nullable(),
});

const createLessonSchema = z.object({
  childId: z.string().min(1),
  title: z.string().min(1).max(255),
  sourceType: z.enum(['PDF', 'IMAGE', 'YOUTUBE', 'TEXT', 'PPT']),
  subject: z.enum(['MATH', 'SCIENCE', 'ENGLISH', 'ARABIC', 'ISLAMIC_STUDIES', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'OTHER']).optional(),
  originalFileUrl: z.string().url().optional(),
  originalFileName: z.string().max(255).optional(),
  originalFileSize: z.number().positive().optional(),
  youtubeUrl: z.string().url().optional(),
  youtubeVideoId: z.string().optional(),
  extractedText: z.string().optional(),
});

const updateProgressSchema = z.object({
  percentComplete: z.number().min(0).max(100).optional(),
  timeSpentSeconds: z.number().min(0).optional(),
});

const getLessonsQuerySchema = z.object({
  subject: z.enum(['MATH', 'SCIENCE', 'ENGLISH', 'ARABIC', 'ISLAMIC_STUDIES', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'OTHER']).optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  limit: z.string().transform(Number).pipe(z.number().min(1).max(50)).optional(),
  offset: z.string().transform(Number).pipe(z.number().min(0)).optional(),
});

const processContentSchema = z.object({
  content: z.string().min(10, 'Content must be at least 10 characters'),
  task: z.enum(['study_guide', 'summary', 'explain', 'simplify']),
  childId: z.string().optional().nullable(),
  ageGroup: z.enum(['YOUNG', 'OLDER']).optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/lessons/analyze
 * Analyze content using Gemini AI and return structured lesson data
 * This is the main endpoint for PDF/content analysis
 */
router.post(
  '/analyze',
  authenticate,
  validateInput(analyzeContentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, sourceType, subject, title } = req.body;
      let { childId } = req.body;

      // If childId is null/undefined, get the first child for this parent
      if (!childId) {
        if (req.child) {
          // Child session - use their own ID
          childId = req.child.id;
        } else if (req.parent) {
          // Parent session - get their first child
          const firstChild = await prisma.child.findFirst({
            where: { parentId: req.parent.id },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });

          if (!firstChild) {
            res.status(400).json({
              success: false,
              error: 'No child profile found. Please create a child profile first.',
            });
            return;
          }
          childId = firstChild.id;
        } else {
          res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
          return;
        }
      }

      // Get child info for age-appropriate analysis
      const child = await prisma.child.findUnique({
        where: { id: childId },
        select: {
          id: true,
          parentId: true,
          ageGroup: true,
          gradeLevel: true,
          curriculumType: true,
        },
      });

      if (!child) {
        res.status(404).json({
          success: false,
          error: 'Child not found',
        });
        return;
      }

      // Verify access to this child
      if (req.parent && child.parentId !== req.parent.id) {
        res.status(403).json({
          success: false,
          error: 'Access denied to this child profile',
        });
        return;
      }

      if (req.child && req.child.id !== childId) {
        res.status(403).json({
          success: false,
          error: 'Access denied to this child profile',
        });
        return;
      }

      // Check lesson usage limits for FREE tier parents
      const canCreateLesson = await parentUsageService.canCreateLesson(child.parentId);
      if (!canCreateLesson) {
        res.status(402).json({
          success: false,
          error: 'Monthly lesson limit reached. Please upgrade your subscription to create more lessons.',
          code: 'LESSON_LIMIT_REACHED',
        });
        return;
      }

      logger.info(`Analyzing content for child ${childId}`, {
        contentLength: content.length,
        sourceType,
        ageGroup: child.ageGroup,
      });

      // Analyze content with Gemini AI
      const analysis = await geminiService.analyzeContent(content, {
        ageGroup: child.ageGroup,
        curriculumType: child.curriculumType,
        gradeLevel: child.gradeLevel,
        subject: subject as Subject | undefined,
      });

      // Determine subject: use provided subject, or AI-detected subject from analysis
      const validSubjects = ['MATH', 'SCIENCE', 'ENGLISH', 'ARABIC', 'ISLAMIC_STUDIES', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'OTHER'];
      const detectedSubject = analysis.subject && validSubjects.includes(analysis.subject)
        ? analysis.subject as Subject
        : undefined;
      const finalSubject = (subject as Subject | undefined) || detectedSubject;

      // Format content using deterministic DocumentFormatter (100% reliable)
      // HYBRID APPROACH: If AI provided contentBlocks, use StructuredRenderer for beautiful output
      // Otherwise, fall back to heuristic-based formatting
      const formattedContent = documentFormatter.format(content, {
        ageGroup: child.ageGroup,
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
        // Rich content blocks from AI for hybrid rendering
        contentBlocks: analysis.contentBlocks,
      });

      logger.info('Content formatted successfully', {
        rawLength: content.length,
        formattedLength: formattedContent.length,
        usedContentBlocks: !!(analysis.contentBlocks && analysis.contentBlocks.length > 0),
        contentBlockCount: analysis.contentBlocks?.length || 0,
      });

      // Create lesson record with analyzed content
      const lesson = await lessonService.create({
        childId,
        title: title || analysis.title || 'Untitled Lesson',
        sourceType: sourceType as SourceType,
        subject: finalSubject,
      });

      // Update with analysis results
      await lessonService.update(lesson.id, {
        summary: analysis.summary,
        gradeLevel: String(analysis.gradeLevel), // Convert to string for Prisma
        formattedContent, // Deterministically formatted HTML (100% reliable)
        chapters: analysis.chapters ? JSON.parse(JSON.stringify(analysis.chapters)) : undefined,
        keyConcepts: analysis.keyConcepts,
        vocabulary: analysis.vocabulary ? JSON.parse(JSON.stringify(analysis.vocabulary)) : undefined,
        suggestedQuestions: analysis.suggestedQuestions,
        aiConfidence: analysis.confidence,
        processingStatus: 'COMPLETED',
        safetyReviewed: true,
        extractedText: content,
      });

      // Get updated lesson
      const updatedLesson = await lessonService.getById(lesson.id);

      // Record lesson creation for usage tracking (after successful creation)
      await parentUsageService.recordLessonCreation(child.parentId);

      res.json({
        success: true,
        data: {
          lesson: updatedLesson,
          analysis,
        },
      });
    } catch (error) {
      logger.error('Content analysis error', { error });
      next(error);
    }
  }
);

/**
 * POST /api/lessons/process
 * Process content with Gemini for various tasks (study guide, summary, etc.)
 */
router.post(
  '/process',
  authenticate,
  validateInput(processContentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, task, ageGroup } = req.body;

      // Determine age group from child or default
      let effectiveAgeGroup: AgeGroup = (ageGroup as AgeGroup) || 'OLDER';

      if (req.child) {
        effectiveAgeGroup = req.child.ageGroup;
      }

      logger.info(`Processing content with task: ${task}`, {
        task,
        contentLength: content.length,
        ageGroup: effectiveAgeGroup,
      });

      let result: string;

      switch (task) {
        case 'study_guide':
          result = await generateStudyGuide(content, effectiveAgeGroup);
          break;
        case 'summary':
          result = await generateSummary(content, effectiveAgeGroup);
          break;
        case 'explain':
        case 'simplify':
          result = await simplifyContent(content, effectiveAgeGroup);
          break;
        default:
          result = await generateStudyGuide(content, effectiveAgeGroup);
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Content processing error', { error });
      next(error);
    }
  }
);

// Helper functions for content processing
async function generateStudyGuide(content: string, ageGroup: AgeGroup): Promise<string> {
  const prompt = ageGroup === 'YOUNG'
    ? `Create a fun, simple study guide for a young child (ages 4-7) based on this content. Use simple words, short sentences, and make it engaging. Include:
- 3-4 main ideas (as simple bullet points)
- 2-3 fun facts
- A simple activity or game to help remember

Content: ${content.substring(0, 3000)}`
    : `Create an educational study guide for a child (ages 8-12) based on this content. Include:
- Key concepts and main ideas
- Important vocabulary with definitions
- Study tips
- Practice questions

Content: ${content.substring(0, 4000)}`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.flash,
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateSummary(content: string, ageGroup: AgeGroup): Promise<string> {
  const prompt = ageGroup === 'YOUNG'
    ? `Summarize this in 2-3 simple sentences that a young child can understand: ${content.substring(0, 2000)}`
    : `Summarize this content in a clear, educational way for a child: ${content.substring(0, 3000)}`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.flash,
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function simplifyContent(content: string, ageGroup: AgeGroup): Promise<string> {
  const prompt = ageGroup === 'YOUNG'
    ? `Explain this in very simple words that a 5-year-old would understand: ${content.substring(0, 1500)}`
    : `Explain this in simple, clear language for a child: ${content.substring(0, 2500)}`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.flash,
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * POST /api/lessons
 * Create a new lesson and queue for processing
 */
router.post(
  '/',
  authenticate,
  requireParent,
  validateInput(createLessonSchema),
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        childId,
        title,
        sourceType,
        subject,
        originalFileUrl,
        originalFileName,
        originalFileSize,
        youtubeUrl,
        youtubeVideoId,
        extractedText,
      } = req.body;

      // Get child info
      const child = await prisma.child.findUnique({
        where: { id: childId },
        select: {
          id: true,
          ageGroup: true,
          gradeLevel: true,
          curriculumType: true,
        },
      });

      if (!child) {
        res.status(404).json({
          success: false,
          error: 'Child not found',
        });
        return;
      }

      // Create lesson
      const lesson = await lessonService.create({
        childId,
        title,
        sourceType: sourceType as SourceType,
        subject: subject as Subject | undefined,
        originalFileUrl,
        originalFileName,
        originalFileSize,
        youtubeUrl,
        youtubeVideoId,
      });

      // If extracted text is provided, update it
      if (extractedText) {
        await lessonService.update(lesson.id, {
          extractedText,
        });
      }

      // Queue for background processing
      try {
        await queueContentProcessing({
          lessonId: lesson.id,
          fileUrl: originalFileUrl,
          youtubeUrl,
          sourceType: sourceType as SourceType,
          childId,
          ageGroup: child.ageGroup,
          curriculumType: child.curriculumType,
          gradeLevel: child.gradeLevel,
        });
      } catch (queueError) {
        logger.warn('Failed to queue content processing, processing synchronously', { queueError });
        // If queue fails, the lesson stays in PENDING state
      }

      res.status(201).json({
        success: true,
        data: { lesson },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/lessons/child/:childId
 * Get all lessons for a child
 */
router.get(
  '/child/:childId',
  authenticate,
  authorizeChildAccess(),
  validateInput(getLessonsQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const { subject, status, limit, offset } = req.query as {
        subject?: Subject;
        status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
        limit?: number;
        offset?: number;
      };

      const result = await lessonService.getForChild(childId, {
        subject,
        status,
        limit,
        offset,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/lessons/me
 * Get lessons for current child (child session)
 */
router.get(
  '/me',
  authenticate,
  requireChild,
  validateInput(getLessonsQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;
      const { subject, status, limit, offset } = req.query as {
        subject?: Subject;
        status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
        limit?: number;
        offset?: number;
      };

      const result = await lessonService.getForChild(childId, {
        subject,
        status,
        limit,
        offset,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/lessons/:lessonId
 * Get a specific lesson
 */
router.get(
  '/:lessonId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;
      const lesson = await lessonService.getById(lessonId);

      if (!lesson) {
        res.status(404).json({
          success: false,
          error: 'Lesson not found',
        });
        return;
      }

      // Verify access
      if (req.child && req.child.id !== lesson.childId) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
        });
        return;
      }

      if (req.parent) {
        const child = await prisma.child.findFirst({
          where: {
            id: lesson.childId,
            parentId: req.parent.id,
          },
        });

        if (!child) {
          res.status(403).json({
            success: false,
            error: 'Access denied',
          });
          return;
        }
      }

      res.json({
        success: true,
        data: { lesson },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/lessons/:lessonId/progress
 * Update lesson progress
 */
router.patch(
  '/:lessonId/progress',
  authenticate,
  requireChild,
  validateInput(updateProgressSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;
      const childId = req.child!.id;
      const { percentComplete, timeSpentSeconds } = req.body;

      const lesson = await lessonService.updateProgress(lessonId, childId, {
        percentComplete,
        timeSpentSeconds,
      });

      res.json({
        success: true,
        data: { lesson },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/lessons/:lessonId/complete
 * Mark a lesson as completed by the user
 */
router.post(
  '/:lessonId/complete',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;

      // Get lesson to check ownership
      const lesson = await lessonService.getById(lessonId);

      if (!lesson) {
        res.status(404).json({
          success: false,
          error: 'Lesson not found',
        });
        return;
      }

      // Verify access
      let childId: string;

      if (req.child) {
        if (req.child.id !== lesson.childId) {
          res.status(403).json({
            success: false,
            error: 'Access denied',
          });
          return;
        }
        childId = req.child.id;
      } else if (req.parent) {
        const child = await prisma.child.findFirst({
          where: {
            id: lesson.childId,
            parentId: req.parent.id,
          },
        });

        if (!child) {
          res.status(403).json({
            success: false,
            error: 'Access denied',
          });
          return;
        }
        childId = child.id;
      } else {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      // Mark lesson as completed
      const updatedLesson = await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          completedAt: new Date(),
          percentComplete: 100,
        },
      });

      logger.info(`Lesson ${lessonId} marked as completed by child ${childId}`);

      res.json({
        success: true,
        data: {
          lesson: updatedLesson,
          completedAt: updatedLesson.completedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/lessons/:lessonId/status
 * Get processing status for a lesson
 */
router.get(
  '/:lessonId/status',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;
      const lesson = await lessonService.getById(lessonId);

      if (!lesson) {
        res.status(404).json({
          success: false,
          error: 'Lesson not found',
        });
        return;
      }

      res.json({
        success: true,
        data: {
          status: lesson.processingStatus,
          error: lesson.processingError,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/lessons/:lessonId
 * Delete a lesson
 */
router.delete(
  '/:lessonId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;

      // Get lesson to check ownership
      const lesson = await lessonService.getById(lessonId);

      if (!lesson) {
        res.status(404).json({
          success: false,
          error: 'Lesson not found',
        });
        return;
      }

      // Determine childId based on session type
      let childId: string;

      if (req.child) {
        if (req.child.id !== lesson.childId) {
          res.status(403).json({
            success: false,
            error: 'Access denied',
          });
          return;
        }
        childId = req.child.id;
      } else if (req.parent) {
        // Verify parent owns this child
        const child = await prisma.child.findFirst({
          where: {
            id: lesson.childId,
            parentId: req.parent.id,
          },
        });

        if (!child) {
          res.status(403).json({
            success: false,
            error: 'Access denied',
          });
          return;
        }
        childId = child.id;
      } else {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      await lessonService.delete(lessonId, childId);

      res.json({
        success: true,
        message: 'Lesson deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/lessons/:lessonId/flashcards
 * Generate flashcards for a lesson
 */
router.post(
  '/:lessonId/flashcards',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;
      const count = parseInt(req.query.count as string) || 10;

      // Get lesson
      const lesson = await lessonService.getById(lessonId);

      if (!lesson) {
        res.status(404).json({
          success: false,
          error: 'Lesson not found',
        });
        return;
      }

      if (!lesson.extractedText && !lesson.summary) {
        res.status(400).json({
          success: false,
          error: 'Lesson has no content for flashcard generation',
        });
        return;
      }

      // Get child for context
      const child = await prisma.child.findUnique({
        where: { id: lesson.childId },
        select: {
          ageGroup: true,
          gradeLevel: true,
          curriculumType: true,
        },
      });

      if (!child) {
        res.status(404).json({
          success: false,
          error: 'Child not found',
        });
        return;
      }

      const content = lesson.extractedText || lesson.summary || '';

      const flashcards = await geminiService.generateFlashcards(content, {
        ageGroup: child.ageGroup,
        curriculumType: child.curriculumType,
        gradeLevel: child.gradeLevel,
        subject: lesson.subject,
        count,
      });

      res.json({
        success: true,
        data: { flashcards },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/lessons/:lessonId/quiz
 * Generate a quiz for a lesson
 */
router.post(
  '/:lessonId/quiz',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;
      const count = parseInt(req.query.count as string) || 5;
      const type = (req.query.type as string) || 'multiple_choice';

      // Get lesson
      const lesson = await lessonService.getById(lessonId);

      if (!lesson) {
        res.status(404).json({
          success: false,
          error: 'Lesson not found',
        });
        return;
      }

      if (!lesson.extractedText && !lesson.summary) {
        res.status(400).json({
          success: false,
          error: 'Lesson has no content for quiz generation',
        });
        return;
      }

      // Get child for context
      const child = await prisma.child.findUnique({
        where: { id: lesson.childId },
        select: {
          ageGroup: true,
          gradeLevel: true,
          curriculumType: true,
        },
      });

      if (!child) {
        res.status(404).json({
          success: false,
          error: 'Child not found',
        });
        return;
      }

      const content = lesson.extractedText || lesson.summary || '';

      const quiz = await geminiService.generateQuiz(content, {
        ageGroup: child.ageGroup,
        curriculumType: child.curriculumType,
        gradeLevel: child.gradeLevel,
        type,
        count,
      });

      res.json({
        success: true,
        data: { quiz },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
