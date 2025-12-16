// Analytics Service for VC Dashboard
// Provides DAU/WAU/MAU metrics, user counts, and time series data
import { prisma } from '../../config/database.js';
import { redis } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';

// Cache TTLs in seconds
const CACHE_TTL = {
  OVERVIEW: 5 * 60,        // 5 minutes for overview metrics
  DAU_SERIES: 10 * 60,     // 10 minutes for DAU time series
  USER_COUNTS: 5 * 60,     // 5 minutes for user counts
};

// Cache key prefixes
const CACHE_KEYS = {
  OVERVIEW: 'analytics:overview',
  DAU_SERIES: 'analytics:dau:series',
  USER_COUNTS: 'analytics:users:counts',
  DAU: 'analytics:dau',
  WAU: 'analytics:wau',
  MAU: 'analytics:mau',
};

/**
 * Get start of day in UTC
 */
function getStartOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get start of week (Sunday) in UTC
 */
function getStartOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

/**
 * Get start of month in UTC
 */
function getStartOfMonth(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  return d;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export interface OverviewMetrics {
  dau: number;
  wau: number;
  mau: number;
  dauWauRatio: number;
  dauMauRatio: number;
  totalParents: number;
  totalChildren: number;
  totalTeachers: number;
  payingSubscribers: number;
  freeUsers: number;
  conversionRate: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
}

export interface DAUDataPoint {
  date: string;
  count: number;
}

export interface UserGrowthDataPoint {
  date: string;
  totalUsers: number;
  newUsers: number;
}

export const analyticsService = {
  /**
   * Get Daily Active Users for a specific date
   */
  async getDAU(date: Date = new Date()): Promise<number> {
    const startOfDay = getStartOfDay(date);
    const cacheKey = `${CACHE_KEYS.DAU}:${formatDate(startOfDay)}`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return parseInt(cached, 10);
    }

    // Query ActivitySession for unique children on that day
    const result = await prisma.activitySession.groupBy({
      by: ['childId'],
      where: {
        createdDate: startOfDay,
      },
    });

    const count = result.length;

    // Cache result (longer TTL for historical dates, shorter for today)
    const isToday = formatDate(startOfDay) === formatDate(new Date());
    await redis.setex(cacheKey, isToday ? CACHE_TTL.OVERVIEW : 3600, count.toString());

    return count;
  },

  /**
   * Get Weekly Active Users (last 7 days)
   */
  async getWAU(date: Date = new Date()): Promise<number> {
    const startOfDay = getStartOfDay(date);
    const weekAgo = new Date(startOfDay);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

    const cacheKey = `${CACHE_KEYS.WAU}:${formatDate(startOfDay)}`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return parseInt(cached, 10);
    }

    // Unique children with activity in the last 7 days
    const result = await prisma.activitySession.groupBy({
      by: ['childId'],
      where: {
        createdDate: {
          gte: weekAgo,
          lte: startOfDay,
        },
      },
    });

    const count = result.length;
    await redis.setex(cacheKey, CACHE_TTL.OVERVIEW, count.toString());

    return count;
  },

  /**
   * Get Monthly Active Users (last 30 days)
   */
  async getMAU(date: Date = new Date()): Promise<number> {
    const startOfDay = getStartOfDay(date);
    const monthAgo = new Date(startOfDay);
    monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);

    const cacheKey = `${CACHE_KEYS.MAU}:${formatDate(startOfDay)}`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return parseInt(cached, 10);
    }

    // Unique children with activity in the last 30 days
    const result = await prisma.activitySession.groupBy({
      by: ['childId'],
      where: {
        createdDate: {
          gte: monthAgo,
          lte: startOfDay,
        },
      },
    });

    const count = result.length;
    await redis.setex(cacheKey, CACHE_TTL.OVERVIEW, count.toString());

    return count;
  },

  /**
   * Get DAU time series for sparklines (last N days)
   */
  async getDAUTimeSeries(days: number = 30): Promise<DAUDataPoint[]> {
    const cacheKey = `${CACHE_KEYS.DAU_SERIES}:${days}d`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    const result: DAUDataPoint[] = [];
    const today = getStartOfDay();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);

      const dau = await this.getDAU(date);
      result.push({
        date: formatDate(date),
        count: dau,
      });
    }

    await redis.setex(cacheKey, CACHE_TTL.DAU_SERIES, JSON.stringify(result));

    return result;
  },

  /**
   * Get user counts (parents, children, teachers)
   */
  async getUserCounts(): Promise<{
    totalParents: number;
    totalChildren: number;
    totalTeachers: number;
    payingSubscribers: number;
    freeUsers: number;
    tierBreakdown: { tier: string; count: number }[];
  }> {
    const cacheKey = CACHE_KEYS.USER_COUNTS;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    // Execute counts in parallel
    const [
      totalParents,
      totalChildren,
      totalTeachers,
      payingSubscribers,
      tierBreakdown,
    ] = await Promise.all([
      prisma.parent.count(),
      prisma.child.count(),
      prisma.teacher.count(),
      prisma.parent.count({
        where: {
          subscriptionTier: {
            not: 'FREE',
          },
        },
      }),
      prisma.parent.groupBy({
        by: ['subscriptionTier'],
        _count: {
          id: true,
        },
      }),
    ]);

    const result = {
      totalParents,
      totalChildren,
      totalTeachers,
      payingSubscribers,
      freeUsers: totalParents - payingSubscribers,
      tierBreakdown: tierBreakdown.map(t => ({
        tier: t.subscriptionTier,
        count: t._count.id,
      })),
    };

    await redis.setex(cacheKey, CACHE_TTL.USER_COUNTS, JSON.stringify(result));

    return result;
  },

  /**
   * Get new users count for a date range
   */
  async getNewUsers(startDate: Date, endDate: Date): Promise<number> {
    return prisma.parent.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  },

  /**
   * Get comprehensive overview metrics
   */
  async getOverview(): Promise<OverviewMetrics> {
    const cacheKey = CACHE_KEYS.OVERVIEW;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    const today = getStartOfDay();
    const weekAgo = new Date(today);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);

    // Get all metrics in parallel
    const [
      dau,
      wau,
      mau,
      userCounts,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
    ] = await Promise.all([
      this.getDAU(),
      this.getWAU(),
      this.getMAU(),
      this.getUserCounts(),
      this.getNewUsers(today, new Date()),
      this.getNewUsers(weekAgo, new Date()),
      this.getNewUsers(monthAgo, new Date()),
    ]);

    const result: OverviewMetrics = {
      dau,
      wau,
      mau,
      dauWauRatio: wau > 0 ? Math.round((dau / wau) * 100) / 100 : 0,
      dauMauRatio: mau > 0 ? Math.round((dau / mau) * 100) / 100 : 0,
      totalParents: userCounts.totalParents,
      totalChildren: userCounts.totalChildren,
      totalTeachers: userCounts.totalTeachers,
      payingSubscribers: userCounts.payingSubscribers,
      freeUsers: userCounts.freeUsers,
      conversionRate: userCounts.totalParents > 0
        ? Math.round((userCounts.payingSubscribers / userCounts.totalParents) * 10000) / 100
        : 0,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
    };

    await redis.setex(cacheKey, CACHE_TTL.OVERVIEW, JSON.stringify(result));

    return result;
  },

  /**
   * Get user growth time series
   */
  async getUserGrowthTimeSeries(days: number = 30): Promise<UserGrowthDataPoint[]> {
    const cacheKey = `analytics:growth:${days}d`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    const result: UserGrowthDataPoint[] = [];
    const today = getStartOfDay();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);
      const nextDay = new Date(date);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      // Count total users up to this date
      const [totalUsers, newUsers] = await Promise.all([
        prisma.parent.count({
          where: {
            createdAt: {
              lt: nextDay,
            },
          },
        }),
        prisma.parent.count({
          where: {
            createdAt: {
              gte: date,
              lt: nextDay,
            },
          },
        }),
      ]);

      result.push({
        date: formatDate(date),
        totalUsers,
        newUsers,
      });
    }

    await redis.setex(cacheKey, CACHE_TTL.DAU_SERIES, JSON.stringify(result));

    return result;
  },

  /**
   * Get engagement metrics
   */
  async getEngagementMetrics(date: Date = new Date()): Promise<{
    avgSessionDuration: number;
    avgSessionsPerUser: number;
    totalSessions: number;
    totalXpAwarded: number;
    lessonsCompleted: number;
  }> {
    const startOfDay = getStartOfDay(date);
    const cacheKey = `analytics:engagement:${formatDate(startOfDay)}`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    const sessions = await prisma.activitySession.findMany({
      where: {
        createdDate: startOfDay,
      },
      select: {
        durationMinutes: true,
        xpEarned: true,
        lessonsCompleted: true,
        childId: true,
      },
    });

    const uniqueUsers = new Set(sessions.map(s => s.childId)).size;
    const totalDuration = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    const totalXp = sessions.reduce((sum, s) => sum + s.xpEarned, 0);
    const lessonsCompleted = sessions.reduce((sum, s) => sum + s.lessonsCompleted, 0);

    const result = {
      avgSessionDuration: sessions.length > 0 ? Math.round(totalDuration / sessions.length) : 0,
      avgSessionsPerUser: uniqueUsers > 0 ? Math.round((sessions.length / uniqueUsers) * 100) / 100 : 0,
      totalSessions: sessions.length,
      totalXpAwarded: totalXp,
      lessonsCompleted,
    };

    const isToday = formatDate(startOfDay) === formatDate(new Date());
    await redis.setex(cacheKey, isToday ? CACHE_TTL.OVERVIEW : 3600, JSON.stringify(result));

    return result;
  },

  /**
   * Get platform/device breakdown
   */
  async getPlatformBreakdown(days: number = 30): Promise<{ platform: string; count: number }[]> {
    const today = getStartOfDay();
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - days);

    const cacheKey = `analytics:platforms:${days}d`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    const result = await prisma.activitySession.groupBy({
      by: ['platform'],
      where: {
        createdDate: {
          gte: startDate,
          lte: today,
        },
      },
      _count: {
        id: true,
      },
    });

    const mapped = result.map(r => ({
      platform: r.platform || 'unknown',
      count: r._count.id,
    }));

    await redis.setex(cacheKey, CACHE_TTL.DAU_SERIES, JSON.stringify(mapped));

    return mapped;
  },

  /**
   * Invalidate all analytics cache (useful after data changes)
   */
  async invalidateCache(): Promise<void> {
    const keys = await redis.keys('analytics:*');
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`Invalidated ${keys.length} analytics cache keys`);
    }
  },
};
