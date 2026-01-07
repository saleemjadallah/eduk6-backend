/**
 * Share Routes
 *
 * Endpoints for creating and viewing shareable content:
 * - Create shareable content (badges, streaks, quizzes, progress)
 * - View shared content (public)
 * - Track share events
 * - Get share statistics
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireParent } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { shareableContentService } from '../services/sharing/index.js';
import { logger } from '../utils/logger.js';
import { ShareChannel } from '@prisma/client';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const createBadgeShareSchema = z.object({
  childId: z.string().uuid(),
  earnedBadgeId: z.string().uuid(),
});

const createStreakShareSchema = z.object({
  childId: z.string().uuid(),
  milestone: z.number().refine(val => [7, 30, 100].includes(val), {
    message: 'Milestone must be 7, 30, or 100',
  }),
});

const createQuizShareSchema = z.object({
  quizAttemptId: z.string().uuid(),
});

const createProgressShareSchema = z.object({
  childId: z.string().uuid(),
  period: z.enum(['WEEKLY', 'MONTHLY']),
});

const createLevelUpShareSchema = z.object({
  childId: z.string().uuid(),
  newLevel: z.number().min(1).max(100),
});

const trackShareEventSchema = z.object({
  channel: z.enum(['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'COPY_LINK', 'OTHER']),
});

// ============================================
// PUBLIC ROUTES (No auth required)
// ============================================

/**
 * GET /api/share/:token
 * View shared content (public)
 * Used for the public share page
 */
router.get(
  '/:token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params;

      const content = await shareableContentService.getByToken(token);

      if (!content) {
        return res.status(404).json({
          success: false,
          message: 'Share not found or has expired',
        });
      }

      res.json({
        success: true,
        data: content,
      });
    } catch (error) {
      logger.error('Error fetching share', { error, token: req.params.token });
      next(error);
    }
  }
);

// ============================================
// AUTHENTICATED ROUTES (Parent)
// ============================================

/**
 * POST /api/share/badge
 * Create a shareable badge unlock
 */
router.post(
  '/badge',
  authenticate,
  requireParent,
  validateInput(createBadgeShareSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const { childId, earnedBadgeId } = req.body;

      const result = await shareableContentService.createBadgeShare(
        parentId,
        childId,
        earnedBadgeId
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error creating badge share', {
        error,
        parentId: req.parent?.id,
      });
      next(error);
    }
  }
);

/**
 * POST /api/share/streak
 * Create a shareable streak milestone
 */
router.post(
  '/streak',
  authenticate,
  requireParent,
  validateInput(createStreakShareSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const { childId, milestone } = req.body;

      const result = await shareableContentService.createStreakShare(
        parentId,
        childId,
        milestone as 7 | 30 | 100
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error creating streak share', {
        error,
        parentId: req.parent?.id,
      });
      next(error);
    }
  }
);

/**
 * POST /api/share/quiz
 * Create a shareable quiz result
 */
router.post(
  '/quiz',
  authenticate,
  requireParent,
  validateInput(createQuizShareSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const { quizAttemptId } = req.body;

      const result = await shareableContentService.createQuizResultShare(
        parentId,
        quizAttemptId
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error creating quiz share', {
        error,
        parentId: req.parent?.id,
      });
      next(error);
    }
  }
);

/**
 * POST /api/share/progress
 * Create a shareable progress report
 */
router.post(
  '/progress',
  authenticate,
  requireParent,
  validateInput(createProgressShareSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const { childId, period } = req.body;

      const result = await shareableContentService.createProgressReportShare(
        parentId,
        childId,
        period
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error creating progress share', {
        error,
        parentId: req.parent?.id,
      });
      next(error);
    }
  }
);

/**
 * POST /api/share/level-up
 * Create a shareable level up announcement
 */
router.post(
  '/level-up',
  authenticate,
  requireParent,
  validateInput(createLevelUpShareSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const { childId, newLevel } = req.body;

      const result = await shareableContentService.createLevelUpShare(
        parentId,
        childId,
        newLevel
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error creating level up share', {
        error,
        parentId: req.parent?.id,
      });
      next(error);
    }
  }
);

/**
 * POST /api/share/:id/track
 * Track when a share is actually sent via a channel
 */
router.post(
  '/:id/track',
  authenticate,
  requireParent,
  validateInput(trackShareEventSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const { id } = req.params;
      const { channel } = req.body;

      await shareableContentService.trackShareEvent(
        id,
        channel as ShareChannel,
        parentId
      );

      res.json({
        success: true,
        message: 'Share tracked successfully',
      });
    } catch (error) {
      logger.error('Error tracking share', {
        error,
        parentId: req.parent?.id,
        shareId: req.params.id,
      });
      next(error);
    }
  }
);

/**
 * DELETE /api/share/:id
 * Deactivate/revoke a share
 */
router.delete(
  '/:id',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const { id } = req.params;

      await shareableContentService.deactivateShare(id, parentId);

      res.json({
        success: true,
        message: 'Share deactivated successfully',
      });
    } catch (error) {
      logger.error('Error deactivating share', {
        error,
        parentId: req.parent?.id,
        shareId: req.params.id,
      });
      next(error);
    }
  }
);

/**
 * GET /api/share/my/shares
 * Get all shares created by the authenticated parent
 */
router.get(
  '/my/shares',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const shares = await shareableContentService.getParentShares(parentId, limit);

      res.json({
        success: true,
        data: shares,
      });
    } catch (error) {
      logger.error('Error fetching parent shares', {
        error,
        parentId: req.parent?.id,
      });
      next(error);
    }
  }
);

/**
 * GET /api/share/my/stats
 * Get share statistics for the authenticated parent
 */
router.get(
  '/my/stats',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      const stats = await shareableContentService.getShareStats(parentId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Error fetching share stats', {
        error,
        parentId: req.parent?.id,
      });
      next(error);
    }
  }
);

export default router;
