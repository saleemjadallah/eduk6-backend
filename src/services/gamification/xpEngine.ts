// XP Engine - Core gamification mechanics
import { prisma } from '../../config/database.js';
import { XPReason, UserProgress } from '@prisma/client';
import { badgeService } from './badgeService.js';
import { streakService } from './streakService.js';

// XP values for different actions
export const XP_VALUES = {
  LESSON_COMPLETE: 50,
  LESSON_PROGRESS: 5,     // Per 10% progress
  FLASHCARD_REVIEW: 2,
  FLASHCARD_CORRECT: 5,
  QUIZ_COMPLETE: 20,
  QUIZ_PERFECT: 50,       // Bonus for 100%
  CHAT_QUESTION: 3,
  DAILY_CHALLENGE: 100,
  STREAK_BONUS: 10,       // Per day of streak
  TEXT_SELECTION: 2,
  FIRST_OF_DAY: 25,       // First activity of the day
  BADGE_EARNED: 0,        // XP from badge itself
} as const;

// Level thresholds (XP required for each level)
const LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 800, 1200, 1700, 2300, 3000, 4000,
  5000, 6500, 8000, 10000, 12500, 15000, 18000, 22000, 27000, 33000,
];

export interface XPAward {
  amount: number;
  reason: XPReason;
  sourceType?: string;
  sourceId?: string;
  bonus?: { multiplier: number; reason: string };
}

export interface XPAwardResult {
  xpAwarded: number;
  newLevel?: number;
  leveledUp: boolean;
  newBadges: Array<{ code: string; name: string; xpReward: number }>;
  currentXP: number;
  totalXP: number;
}

/**
 * Calculate level from total XP
 */
function calculateLevel(totalXP: number): { level: number; xpIntoLevel: number; xpToNextLevel: number } {
  let level = 1;

  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (totalXP >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
    } else {
      break;
    }
  }

  const currentLevelXP = LEVEL_THRESHOLDS[level - 1] || 0;
  const nextLevelXP = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const xpIntoLevel = totalXP - currentLevelXP;
  const xpToNextLevel = nextLevelXP - totalXP;

  return { level, xpIntoLevel, xpToNextLevel };
}

export const xpEngine = {
  /**
   * Award XP to a child
   */
  async awardXP(childId: string, award: XPAward): Promise<XPAwardResult> {
    // Get or create progress record
    let progress = await prisma.userProgress.findUnique({
      where: { childId },
    });

    if (!progress) {
      progress = await prisma.userProgress.create({
        data: { childId },
      });
    }

    // Calculate bonuses
    let finalAmount = award.amount;
    let wasBonus = false;
    let bonusReason = '';

    // Streak bonus
    const streak = await streakService.getCurrentStreak(childId);
    if (streak > 0) {
      const streakBonus = Math.min(streak * 0.1, 1); // Max 100% bonus
      finalAmount = Math.floor(finalAmount * (1 + streakBonus));
      wasBonus = true;
      bonusReason = `streak_${streak}`;
    }

    // First of day bonus
    const isFirstToday = await this.isFirstActivityToday(childId);
    if (isFirstToday) {
      finalAmount += XP_VALUES.FIRST_OF_DAY;
      wasBonus = true;
      bonusReason += bonusReason ? '_first_of_day' : 'first_of_day';
    }

    // Custom bonus
    if (award.bonus) {
      finalAmount = Math.floor(finalAmount * award.bonus.multiplier);
      wasBonus = true;
      bonusReason = award.bonus.reason;
    }

    // Record transaction
    await prisma.xPTransaction.create({
      data: {
        childId,
        amount: finalAmount,
        reason: award.reason,
        sourceType: award.sourceType,
        sourceId: award.sourceId,
        wasBonus,
        bonusMultiplier: wasBonus ? finalAmount / award.amount : null,
        bonusReason: bonusReason || null,
      },
    });

    // Calculate new level
    const oldLevel = progress.level;
    const newTotalXP = progress.totalXP + finalAmount;
    const { level, xpIntoLevel, xpToNextLevel } = calculateLevel(newTotalXP);
    const leveledUp = level > oldLevel;

    // Update progress
    await prisma.userProgress.update({
      where: { childId },
      data: {
        currentXP: xpIntoLevel,
        totalXP: newTotalXP,
        level,
      },
    });

    // Update streak
    await streakService.recordActivity(childId);

    // Check for badge unlocks
    const newBadges = await badgeService.checkAndAwardBadges(childId, {
      xpEarned: finalAmount,
      totalXP: newTotalXP,
      level,
      reason: award.reason,
      leveledUp,
    });

    return {
      xpAwarded: finalAmount,
      newLevel: leveledUp ? level : undefined,
      leveledUp,
      newBadges,
      currentXP: xpIntoLevel,
      totalXP: newTotalXP,
    };
  },

  /**
   * Check if this is the first activity today
   */
  async isFirstActivityToday(childId: string): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayActivity = await prisma.xPTransaction.findFirst({
      where: {
        childId,
        createdAt: { gte: today },
      },
    });

    return !todayActivity;
  },

  /**
   * Get user progress
   */
  async getProgress(childId: string): Promise<{
    xp: number;
    totalXP: number;
    level: number;
    xpToNextLevel: number;
    percentToNextLevel: number;
  }> {
    let progress = await prisma.userProgress.findUnique({
      where: { childId },
    });

    if (!progress) {
      progress = await prisma.userProgress.create({
        data: { childId },
      });
    }

    const { xpIntoLevel, xpToNextLevel } = calculateLevel(progress.totalXP);
    const totalForLevel = xpIntoLevel + xpToNextLevel;
    const percentToNextLevel = Math.round((xpIntoLevel / totalForLevel) * 100);

    return {
      xp: progress.currentXP,
      totalXP: progress.totalXP,
      level: progress.level,
      xpToNextLevel,
      percentToNextLevel,
    };
  },

  /**
   * Get XP history
   */
  async getXPHistory(
    childId: string,
    days: number = 7
  ): Promise<{
    transactions: Array<{
      amount: number;
      reason: XPReason;
      wasBonus: boolean;
      createdAt: Date;
    }>;
    totalByDay: Array<{ date: string; total: number }>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const transactions = await prisma.xPTransaction.findMany({
      where: {
        childId,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        amount: true,
        reason: true,
        wasBonus: true,
        createdAt: true,
      },
    });

    // Group by day
    const byDay = new Map<string, number>();
    for (const tx of transactions) {
      const dateKey = tx.createdAt.toISOString().split('T')[0];
      byDay.set(dateKey, (byDay.get(dateKey) || 0) + tx.amount);
    }

    const totalByDay = Array.from(byDay.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { transactions, totalByDay };
  },

  /**
   * Get XP statistics
   */
  async getStats(childId: string): Promise<{
    todayXP: number;
    weekXP: number;
    monthXP: number;
    averageDailyXP: number;
  }> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now);
    monthStart.setDate(monthStart.getDate() - 30);
    monthStart.setHours(0, 0, 0, 0);

    const [todayResult, weekResult, monthResult] = await Promise.all([
      prisma.xPTransaction.aggregate({
        where: { childId, createdAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      prisma.xPTransaction.aggregate({
        where: { childId, createdAt: { gte: weekStart } },
        _sum: { amount: true },
      }),
      prisma.xPTransaction.aggregate({
        where: { childId, createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
    ]);

    const todayXP = todayResult._sum.amount || 0;
    const weekXP = weekResult._sum.amount || 0;
    const monthXP = monthResult._sum.amount || 0;
    const averageDailyXP = Math.round(monthXP / 30);

    return { todayXP, weekXP, monthXP, averageDailyXP };
  },
};
