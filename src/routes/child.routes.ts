// Child profile routes
import { Router } from 'express';
import { authenticate, requireChild, authorizeChildAccess } from '../middleware/auth.js';
import { xpEngine } from '../services/gamification/xpEngine.js';
import { streakService } from '../services/gamification/streakService.js';
import { badgeService } from '../services/gamification/badgeService.js';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * GET /api/children/me/stats
 * Get current child's stats (for child dashboard)
 * Requires child authentication
 */
router.get(
  '/me/stats',
  authenticate,
  requireChild,
  async (req, res, next) => {
    try {
      const childId = req.child!.id;

      // Fetch all stats in parallel
      const [progress, streakInfo, badges, lessonsCount] = await Promise.all([
        xpEngine.getProgress(childId),
        streakService.getStreakInfo(childId),
        badgeService.getBadgesForChild(childId),
        prisma.lesson.count({
          where: {
            childId,
            processingStatus: 'COMPLETED',
          },
        }),
      ]);

      res.json({
        success: true,
        data: {
          // XP and Level
          xp: progress.totalXP,
          level: progress.level,
          xpToNextLevel: progress.xpToNextLevel,
          percentToNextLevel: progress.percentToNextLevel,

          // Streak
          streak: {
            current: streakInfo.current,
            longest: streakInfo.longest,
            isActiveToday: streakInfo.isActiveToday,
            freezeAvailable: streakInfo.freezeAvailable,
          },

          // Badges
          badgesEarned: badges.earned.length,
          totalBadges: badges.earned.length + badges.available.length,

          // Lessons
          lessonsCompleted: lessonsCount,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/children/:childId/stats
 * Get a child's stats (for parent to view)
 * Requires parent authentication with child access
 */
router.get(
  '/:childId/stats',
  authenticate,
  authorizeChildAccess(),
  async (req, res, next) => {
    try {
      const { childId } = req.params;

      // Fetch all stats in parallel
      const [progress, streakInfo, badges, lessonsCount, xpStats] = await Promise.all([
        xpEngine.getProgress(childId),
        streakService.getStreakInfo(childId),
        badgeService.getBadgesForChild(childId),
        prisma.lesson.count({
          where: {
            childId,
            processingStatus: 'COMPLETED',
          },
        }),
        xpEngine.getStats(childId),
      ]);

      res.json({
        success: true,
        data: {
          // XP and Level
          xp: progress.totalXP,
          level: progress.level,
          xpToNextLevel: progress.xpToNextLevel,
          percentToNextLevel: progress.percentToNextLevel,

          // Streak
          streak: {
            current: streakInfo.current,
            longest: streakInfo.longest,
            isActiveToday: streakInfo.isActiveToday,
            freezeAvailable: streakInfo.freezeAvailable,
          },

          // Badges
          badgesEarned: badges.earned.length,
          totalBadges: badges.earned.length + badges.available.length,
          recentBadges: badges.earned.slice(0, 5).map((b) => ({
            name: b.name,
            icon: b.icon,
            earnedAt: b.earnedAt,
          })),

          // Lessons
          lessonsCompleted: lessonsCount,

          // XP Stats (for parent view)
          xpStats: {
            todayXP: xpStats.todayXP,
            weekXP: xpStats.weekXP,
            monthXP: xpStats.monthXP,
            averageDailyXP: xpStats.averageDailyXP,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/children/me/badges
 * Get all badges for current child
 */
router.get(
  '/me/badges',
  authenticate,
  requireChild,
  async (req, res, next) => {
    try {
      const childId = req.child!.id;
      const badges = await badgeService.getBadgesForChild(childId);

      res.json({
        success: true,
        data: {
          earned: badges.earned.map((b) => ({
            id: b.id,
            code: b.code,
            name: b.name,
            description: b.description,
            icon: b.icon,
            category: b.category,
            rarity: b.rarity,
            xpReward: b.xpReward,
            earnedAt: b.earnedAt,
          })),
          available: badges.available.map((b) => ({
            id: b.id,
            code: b.code,
            name: b.name,
            description: b.description,
            icon: b.icon,
            category: b.category,
            rarity: b.rarity,
            xpReward: b.xpReward,
            requirements: b.requirements,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/children/me/xp-history
 * Get XP history for current child
 */
router.get(
  '/me/xp-history',
  authenticate,
  requireChild,
  async (req, res, next) => {
    try {
      const childId = req.child!.id;
      const days = parseInt(req.query.days as string) || 7;

      const history = await xpEngine.getXPHistory(childId, days);

      res.json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
