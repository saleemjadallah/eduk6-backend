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

/**
 * POST /api/children/:childId/xp
 * Award XP to a specific child (parent can award to their children)
 * Requires parent authentication with child access
 */
router.post(
  '/:childId/xp',
  authenticate,
  authorizeChildAccess(),
  async (req, res, next) => {
    try {
      const { childId } = req.params;
      const { amount, reason, sourceType, sourceId } = req.body;

      // Validate input
      if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Invalid XP amount (must be 1-1000)',
        });
      }

      // Map frontend reasons to backend XPReason enum
      // Valid reasons from Prisma schema XPReason enum
      const validReasons = [
        'LESSON_COMPLETE',
        'LESSON_PROGRESS',
        'FLASHCARD_REVIEW',
        'FLASHCARD_CORRECT',
        'QUIZ_COMPLETE',
        'QUIZ_PERFECT',
        'CHAT_QUESTION',
        'DAILY_CHALLENGE',
        'TEXT_SELECTION',
        'BADGE_EARNED',
        'STREAK_BONUS',
        'FIRST_OF_DAY',
        'EXERCISE_CORRECT',
        'EXERCISE_PERFECT',
      ];

      // Default to CHAT_QUESTION for unknown reasons (most common action)
      const xpReason = validReasons.includes(reason) ? reason : 'CHAT_QUESTION';

      const result = await xpEngine.awardXP(childId, {
        amount,
        reason: xpReason as any,
        sourceType,
        sourceId,
      });

      res.json({
        success: true,
        data: {
          xpAwarded: result.xpAwarded,
          currentXP: result.currentXP,
          totalXP: result.totalXP,
          level: result.newLevel || (await xpEngine.getProgress(childId)).level,
          leveledUp: result.leveledUp,
          newBadges: result.newBadges,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/children/me/xp
 * Award XP to current child
 * Requires child authentication
 */
router.post(
  '/me/xp',
  authenticate,
  requireChild,
  async (req, res, next) => {
    try {
      const childId = req.child!.id;
      const { amount, reason, sourceType, sourceId } = req.body;

      // Validate input
      if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Invalid XP amount (must be 1-1000)',
        });
      }

      // Map frontend reasons to backend XPReason enum
      // Valid reasons from Prisma schema XPReason enum
      const validReasons = [
        'LESSON_COMPLETE',
        'LESSON_PROGRESS',
        'FLASHCARD_REVIEW',
        'FLASHCARD_CORRECT',
        'QUIZ_COMPLETE',
        'QUIZ_PERFECT',
        'CHAT_QUESTION',
        'DAILY_CHALLENGE',
        'TEXT_SELECTION',
        'BADGE_EARNED',
        'STREAK_BONUS',
        'FIRST_OF_DAY',
        'EXERCISE_CORRECT',
        'EXERCISE_PERFECT',
      ];

      // Default to CHAT_QUESTION for unknown reasons (most common action)
      const xpReason = validReasons.includes(reason) ? reason : 'CHAT_QUESTION';

      const result = await xpEngine.awardXP(childId, {
        amount,
        reason: xpReason as any,
        sourceType,
        sourceId,
      });

      res.json({
        success: true,
        data: {
          xpAwarded: result.xpAwarded,
          currentXP: result.currentXP,
          totalXP: result.totalXP,
          level: result.newLevel || (await xpEngine.getProgress(childId)).level,
          leveledUp: result.leveledUp,
          newBadges: result.newBadges,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/children/:childId/activity
 * Record activity for a specific child (parent can record for their children)
 * Requires parent authentication with child access
 */
router.post(
  '/:childId/activity',
  authenticate,
  authorizeChildAccess(),
  async (req, res, next) => {
    try {
      const { childId } = req.params;

      await streakService.recordActivity(childId);
      const streakInfo = await streakService.getStreakInfo(childId);

      res.json({
        success: true,
        data: {
          streak: streakInfo,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/children/me/activity
 * Record activity for streak tracking (call on app open/lesson start)
 * Requires child authentication
 */
router.post(
  '/me/activity',
  authenticate,
  requireChild,
  async (req, res, next) => {
    try {
      const childId = req.child!.id;

      await streakService.recordActivity(childId);
      const streakInfo = await streakService.getStreakInfo(childId);

      res.json({
        success: true,
        data: {
          streak: streakInfo,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
