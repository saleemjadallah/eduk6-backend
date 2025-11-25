// Streak tracking service
import { prisma } from '../../config/database.js';
import { Streak } from '@prisma/client';

export const streakService = {
  /**
   * Get current streak for a child
   */
  async getCurrentStreak(childId: string): Promise<number> {
    const streak = await prisma.streak.findUnique({
      where: { childId },
    });

    if (!streak) {
      return 0;
    }

    // Check if streak is still valid
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastActivity = new Date(streak.lastActivityDate);
    lastActivity.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor(
      (today.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)
    );

    // If more than 1 day has passed, streak is broken
    if (daysDiff > 1) {
      return 0;
    }

    return streak.current;
  },

  /**
   * Record activity and update streak
   */
  async recordActivity(childId: string): Promise<Streak> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.streak.findUnique({
      where: { childId },
    });

    if (!existing) {
      // Create new streak
      return prisma.streak.create({
        data: {
          childId,
          current: 1,
          longest: 1,
          lastActivityDate: today,
        },
      });
    }

    const lastActivity = new Date(existing.lastActivityDate);
    lastActivity.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor(
      (today.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)
    );

    // Same day - no change
    if (daysDiff === 0) {
      return existing;
    }

    // Next day - increment streak
    if (daysDiff === 1) {
      const newCurrent = existing.current + 1;
      const newLongest = Math.max(existing.longest, newCurrent);

      return prisma.streak.update({
        where: { childId },
        data: {
          current: newCurrent,
          longest: newLongest,
          lastActivityDate: today,
        },
      });
    }

    // Streak broken - check for freeze
    if (existing.freezeAvailable && daysDiff === 2 && !existing.freezeUsedAt) {
      // Use freeze to save streak
      return prisma.streak.update({
        where: { childId },
        data: {
          lastActivityDate: today,
          freezeAvailable: false,
          freezeUsedAt: new Date(),
        },
      });
    }

    // Streak broken - reset
    return prisma.streak.update({
      where: { childId },
      data: {
        current: 1,
        lastActivityDate: today,
        freezeAvailable: false,
      },
    });
  },

  /**
   * Get streak information
   */
  async getStreakInfo(childId: string): Promise<{
    current: number;
    longest: number;
    lastActivityDate: Date | null;
    freezeAvailable: boolean;
    isActiveToday: boolean;
  }> {
    const streak = await prisma.streak.findUnique({
      where: { childId },
    });

    if (!streak) {
      return {
        current: 0,
        longest: 0,
        lastActivityDate: null,
        freezeAvailable: false,
        isActiveToday: false,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastActivity = new Date(streak.lastActivityDate);
    lastActivity.setHours(0, 0, 0, 0);

    const isActiveToday = lastActivity.getTime() === today.getTime();

    // Check if streak is still valid
    const daysDiff = Math.floor(
      (today.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)
    );

    const current = daysDiff > 1 ? 0 : streak.current;

    return {
      current,
      longest: streak.longest,
      lastActivityDate: streak.lastActivityDate,
      freezeAvailable: streak.freezeAvailable,
      isActiveToday,
    };
  },

  /**
   * Use a streak freeze
   */
  async useStreakFreeze(childId: string): Promise<{ success: boolean; message: string }> {
    const streak = await prisma.streak.findUnique({
      where: { childId },
    });

    if (!streak) {
      return { success: false, message: 'No streak to protect' };
    }

    if (!streak.freezeAvailable) {
      return { success: false, message: 'No freeze available' };
    }

    if (streak.freezeUsedAt) {
      return { success: false, message: 'Freeze already used' };
    }

    await prisma.streak.update({
      where: { childId },
      data: {
        freezeAvailable: false,
        freezeUsedAt: new Date(),
      },
    });

    return { success: true, message: 'Streak freeze applied!' };
  },

  /**
   * Award a streak freeze (e.g., from badge or purchase)
   */
  async awardStreakFreeze(childId: string): Promise<void> {
    await prisma.streak.upsert({
      where: { childId },
      create: {
        childId,
        current: 0,
        longest: 0,
        lastActivityDate: new Date(),
        freezeAvailable: true,
      },
      update: {
        freezeAvailable: true,
        freezeUsedAt: null,
      },
    });
  },

  /**
   * Get leaderboard by streak
   */
  async getStreakLeaderboard(limit: number = 10): Promise<
    Array<{
      childId: string;
      displayName: string;
      avatarUrl: string | null;
      current: number;
      longest: number;
    }>
  > {
    const streaks = await prisma.streak.findMany({
      where: { current: { gt: 0 } },
      orderBy: { current: 'desc' },
      take: limit,
      include: {
        child: {
          select: {
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return streaks.map((s) => ({
      childId: s.childId,
      displayName: s.child.displayName,
      avatarUrl: s.child.avatarUrl,
      current: s.current,
      longest: s.longest,
    }));
  },
};
