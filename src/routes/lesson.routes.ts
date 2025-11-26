// Lesson routes for content analysis and management
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireChild, requireParent, authorizeChildAccess } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { geminiService, LessonAnalysis } from '../services/ai/geminiService.js';
import { lessonService } from '../services/learning/lessonService.js';
import { queueContentProcessing } from '../services/learning/contentProcessor.js';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { AgeGroup, Subject, SourceType, CurriculumType } from '@prisma/client';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const analyzeContentSchema = z.object({
  content: z.string().min(50, 'Content must be at least 50 characters'),
  childId: z.string().min(1),
  sourceType: z.enum(['PDF', 'IMAGE', 'YOUTUBE', 'TEXT']).default('TEXT'),
  subject: z.enum(['MATH', 'READING', 'SCIENCE', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'LANGUAGE', 'OTHER']).optional(),
  title: z.string().max(255).optional(),
});

const createLessonSchema = z.object({
  childId: z.string().min(1),
  title: z.string().min(1).max(255),
  sourceType: z.enum(['PDF', 'IMAGE', 'YOUTUBE', 'TEXT']),
  subject: z.enum(['MATH', 'READING', 'SCIENCE', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'LANGUAGE', 'OTHER']).optional(),
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
  subject: z.enum(['MATH', 'READING', 'SCIENCE', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'LANGUAGE', 'OTHER']).optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  limit: z.string().transform(Number).pipe(z.number().min(1).max(50)).optional(),
  offset: z.string().transform(Number).pipe(z.number().min(0)).optional(),
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
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, childId, sourceType, subject, title } = req.body;

      // Get child info for age-appropriate analysis
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

      // Create lesson record with analyzed content
      const lesson = await lessonService.create({
        childId,
        title: title || analysis.title || 'Untitled Lesson',
        sourceType: sourceType as SourceType,
        subject: subject as Subject | undefined,
      });

      // Update with analysis results
      await lessonService.update(lesson.id, {
        summary: analysis.summary,
        gradeLevel: analysis.gradeLevel,
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
