// Exercise routes for interactive lesson exercises
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { exerciseService } from '../services/learning/exerciseService.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ForbiddenError } from '../middleware/errorHandler.js';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const submitAnswerSchema = z.object({
  submittedAnswer: z.string().min(1, 'Answer is required'),
  lessonId: z.string().uuid().optional(), // Required when exerciseId is a marker like "ex-1"
});

const hintParamSchema = z.object({
  exerciseId: z.string().uuid(),
  hintNumber: z.enum(['1', '2']),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/exercises/lesson/:lessonId
 * Get all exercises for a lesson with completion status
 * Parents can view exercises, completion status requires child session
 */
router.get(
  '/lesson/:lessonId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lessonId } = req.params;

      // If child session exists, get exercises with completion status
      // Otherwise, return exercises without completion tracking (for parent preview)
      const childId = req.child?.id || null;

      const exercises = await exerciseService.getExercisesForLesson(
        lessonId,
        childId
      );

      logger.info('Fetched exercises for lesson', {
        lessonId,
        childId: childId || 'parent-preview',
        exerciseCount: exercises.length,
        completedCount: childId ? exercises.filter(e => e.isCompleted).length : 'N/A',
      });

      res.json({
        success: true,
        data: exercises,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/exercises/:exerciseId
 * Get a single exercise (hides answer until completed)
 */
router.get(
  '/:exerciseId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { exerciseId } = req.params;

      if (!req.child) {
        throw new ForbiddenError('Child authentication required');
      }

      const exercise = await exerciseService.getExerciseForChild(
        exerciseId,
        req.child.id
      );

      res.json({
        success: true,
        data: exercise,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/exercises/:exerciseId/submit
 * Submit an answer for validation
 * Works for both child sessions and parents viewing child lessons
 *
 * The exerciseId can be either:
 * - A UUID (database ID)
 * - An HTML marker ID like "ex-1" (from formattedContent, requires lessonId in body)
 */
router.post(
  '/:exerciseId/submit',
  authenticate,
  validateInput(submitAnswerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { exerciseId } = req.params;
      const { submittedAnswer, lessonId } = req.body;

      // Check if exerciseId is a UUID or a marker ID
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isUUID = uuidPattern.test(exerciseId);

      logger.info('Exercise submit request', {
        exerciseId,
        isUUID,
        lessonId: lessonId || 'not provided',
        hasChildSession: !!req.child,
      });

      // Find the exercise - supports both UUID and marker IDs
      let exercise;
      if (isUUID) {
        exercise = await exerciseService.getExerciseWithLesson(exerciseId);
      } else {
        // Marker ID like "ex-1" - requires lessonId
        if (!lessonId) {
          throw new NotFoundError(
            'Exercise not found. When using inline exercises, lessonId is required.'
          );
        }
        exercise = await exerciseService.findByOriginalPosition(lessonId, exerciseId);
        logger.info('Looking up exercise by marker', {
          lessonId,
          markerId: exerciseId,
          found: !!exercise,
        });
      }

      if (!exercise) {
        logger.warn('Exercise not found', { exerciseId, lessonId, isUUID });
        throw new NotFoundError('Exercise not found');
      }

      // Get the actual database ID for submitting
      const actualExerciseId = exercise.id;

      // Get child context - either from child session or from exercise's lesson
      let childId = req.child?.id;
      let ageGroup = req.child?.ageGroup;

      if (!childId) {
        // Parent viewing - get child from exercise's lesson
        // Verify parent owns this child
        if (req.parent) {
          const child = await exerciseService.getChildForExercise(actualExerciseId, req.parent.id);
          if (!child) {
            throw new ForbiddenError('Access denied to this exercise');
          }
          childId = child.id;
          ageGroup = child.ageGroup;
        } else {
          throw new ForbiddenError('Authentication required');
        }
      }

      logger.info('Exercise answer submitted', {
        exerciseId: actualExerciseId,
        originalId: exerciseId,
        childId,
        answerLength: submittedAnswer.length,
        isParentSession: !req.child,
      });

      const result = await exerciseService.submitAnswer(
        actualExerciseId,
        childId,
        submittedAnswer,
        ageGroup!
      );

      logger.info('Exercise answer result', {
        exerciseId: actualExerciseId,
        childId,
        isCorrect: result.isCorrect,
        attemptNumber: result.attemptNumber,
        xpAwarded: result.xpAwarded,
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
 * GET /api/exercises/:exerciseId/hint/:hintNumber
 * Get a specific hint for an exercise
 */
router.get(
  '/:exerciseId/hint/:hintNumber',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { exerciseId, hintNumber } = req.params;

      if (!req.child) {
        throw new ForbiddenError('Child authentication required');
      }

      // Validate hint number
      if (hintNumber !== '1' && hintNumber !== '2') {
        throw new NotFoundError('Invalid hint number');
      }

      const hint = await exerciseService.getHint(
        exerciseId,
        req.child.id,
        parseInt(hintNumber) as 1 | 2
      );

      res.json({
        success: true,
        data: { hint },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/exercises/stats
 * Get exercise statistics for the current child
 */
router.get(
  '/stats/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.child) {
        throw new ForbiddenError('Child authentication required');
      }

      const stats = await exerciseService.getStatsForChild(req.child.id);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
