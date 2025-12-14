// Gamification routes for XP, badges, and streaks
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireChild } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { xpEngine, badgeService, streakService } from '../services/gamification/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const historyQuerySchema = z.object({
  days: z.string().transform(Number).pipe(z.number().min(1).max(90)).optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/gamification/progress
 * Get current XP progress for the authenticated child
 */
router.get(
  '/progress',
  authenticate,
  requireChild,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;

      const progress = await xpEngine.getProgress(childId);

      res.json({
        success: true,
        data: progress,
      });
    } catch (error) {
      logger.error('Error fetching XP progress', { error, childId: req.child?.id });
      next(error);
    }
  }
);

/**
 * GET /api/gamification/badges
 * Get all badges (earned and available) for the authenticated child
 */
router.get(
  '/badges',
  authenticate,
  requireChild,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;

      const badges = await badgeService.getBadgesForChild(childId);

      res.json({
        success: true,
        data: badges,
      });
    } catch (error) {
      logger.error('Error fetching badges', { error, childId: req.child?.id });
      next(error);
    }
  }
);

/**
 * GET /api/gamification/streak
 * Get current streak information for the authenticated child
 */
router.get(
  '/streak',
  authenticate,
  requireChild,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;

      const streakInfo = await streakService.getStreakInfo(childId);

      res.json({
        success: true,
        data: streakInfo,
      });
    } catch (error) {
      logger.error('Error fetching streak info', { error, childId: req.child?.id });
      next(error);
    }
  }
);

/**
 * POST /api/gamification/streak/freeze
 * Use a streak freeze to protect the current streak
 */
router.post(
  '/streak/freeze',
  authenticate,
  requireChild,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;

      const result = await streakService.useStreakFreeze(childId);

      res.json({
        success: result.success,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error using streak freeze', { error, childId: req.child?.id });
      next(error);
    }
  }
);

/**
 * GET /api/gamification/history
 * Get XP transaction history for the authenticated child
 */
router.get(
  '/history',
  authenticate,
  requireChild,
  validateInput(historyQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;
      const days = req.query.days ? parseInt(req.query.days as string) : 7;

      const history = await xpEngine.getXPHistory(childId, days);

      res.json({
        success: true,
        data: history,
      });
    } catch (error) {
      logger.error('Error fetching XP history', { error, childId: req.child?.id });
      next(error);
    }
  }
);

/**
 * GET /api/gamification/stats
 * Get XP statistics for the authenticated child
 */
router.get(
  '/stats',
  authenticate,
  requireChild,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;

      const stats = await xpEngine.getStats(childId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Error fetching XP stats', { error, childId: req.child?.id });
      next(error);
    }
  }
);

/**
 * GET /api/gamification/achievements
 * Get recent achievements for the authenticated child
 */
router.get(
  '/achievements',
  authenticate,
  requireChild,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;

      const achievements = await badgeService.getRecentAchievements(childId, Math.min(limit, 20));

      res.json({
        success: true,
        data: achievements,
      });
    } catch (error) {
      logger.error('Error fetching achievements', { error, childId: req.child?.id });
      next(error);
    }
  }
);

/**
 * GET /api/gamification/leaderboard/streaks
 * Get streak leaderboard
 */
router.get(
  '/leaderboard/streaks',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      const leaderboard = await streakService.getStreakLeaderboard(Math.min(limit, 50));

      res.json({
        success: true,
        data: leaderboard,
      });
    } catch (error) {
      logger.error('Error fetching streak leaderboard', { error });
      next(error);
    }
  }
);

/**
 * GET /api/gamification/summary
 * Get a complete gamification summary for the authenticated child
 */
router.get(
  '/summary',
  authenticate,
  requireChild,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const childId = req.child!.id;

      // Fetch all gamification data in parallel
      const [progress, badges, streakInfo, stats] = await Promise.all([
        xpEngine.getProgress(childId),
        badgeService.getBadgesForChild(childId),
        streakService.getStreakInfo(childId),
        xpEngine.getStats(childId),
      ]);

      res.json({
        success: true,
        data: {
          progress,
          badges: {
            earned: badges.earned.length,
            available: badges.available.length,
            recent: badges.earned.slice(0, 3),
          },
          streak: streakInfo,
          stats,
        },
      });
    } catch (error) {
      logger.error('Error fetching gamification summary', { error, childId: req.child?.id });
      next(error);
    }
  }
);

export default router;
