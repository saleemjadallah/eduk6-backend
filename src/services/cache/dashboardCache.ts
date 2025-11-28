/**
 * Dashboard Cache Service
 * Redis-based caching for frequently accessed dashboard data
 *
 * Features:
 * - Cache child stats aggregates
 * - Cache lesson counts
 * - Automatic invalidation on writes
 * - TTL-based expiry
 */

import { redis } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';

// Cache key prefixes
const CACHE_PREFIX = {
  CHILD_STATS: 'cache:child_stats:',
  LESSON_COUNT: 'cache:lesson_count:',
  CHILD_LESSONS: 'cache:child_lessons:',
  PARENT_DASHBOARD: 'cache:parent_dashboard:',
};

// Cache TTL in seconds
const CACHE_TTL = {
  CHILD_STATS: 300, // 5 minutes
  LESSON_COUNT: 600, // 10 minutes
  CHILD_LESSONS: 300, // 5 minutes
  PARENT_DASHBOARD: 300, // 5 minutes
};

export interface ChildStatsCache {
  xp: number;
  level: number;
  xpToNextLevel: number;
  percentToNextLevel: number;
  streak: {
    current: number;
    longest: number;
    isActiveToday: boolean;
    freezeAvailable: boolean;
  };
  badgesEarned: number;
  totalBadges: number;
  lessonsCompleted: number;
}

export interface LessonCountCache {
  total: number;
  completed: number;
  inProgress: number;
}

export const dashboardCache = {
  // ==========================================
  // Child Stats Cache
  // ==========================================

  /**
   * Get cached child stats
   */
  async getChildStats(childId: string): Promise<ChildStatsCache | null> {
    try {
      const key = `${CACHE_PREFIX.CHILD_STATS}${childId}`;
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as ChildStatsCache;
      }
      return null;
    } catch (error) {
      logger.error('Error reading child stats cache', { error, childId });
      return null;
    }
  },

  /**
   * Set child stats in cache
   */
  async setChildStats(childId: string, stats: ChildStatsCache): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.CHILD_STATS}${childId}`;
      await redis.setex(key, CACHE_TTL.CHILD_STATS, JSON.stringify(stats));
    } catch (error) {
      logger.error('Error setting child stats cache', { error, childId });
    }
  },

  /**
   * Invalidate child stats cache
   */
  async invalidateChildStats(childId: string): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.CHILD_STATS}${childId}`;
      await redis.del(key);
    } catch (error) {
      logger.error('Error invalidating child stats cache', { error, childId });
    }
  },

  // ==========================================
  // Lesson Count Cache
  // ==========================================

  /**
   * Get cached lesson count for a child
   */
  async getLessonCount(childId: string): Promise<LessonCountCache | null> {
    try {
      const key = `${CACHE_PREFIX.LESSON_COUNT}${childId}`;
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as LessonCountCache;
      }
      return null;
    } catch (error) {
      logger.error('Error reading lesson count cache', { error, childId });
      return null;
    }
  },

  /**
   * Set lesson count in cache
   */
  async setLessonCount(childId: string, counts: LessonCountCache): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.LESSON_COUNT}${childId}`;
      await redis.setex(key, CACHE_TTL.LESSON_COUNT, JSON.stringify(counts));
    } catch (error) {
      logger.error('Error setting lesson count cache', { error, childId });
    }
  },

  /**
   * Invalidate lesson count cache
   */
  async invalidateLessonCount(childId: string): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.LESSON_COUNT}${childId}`;
      await redis.del(key);
    } catch (error) {
      logger.error('Error invalidating lesson count cache', { error, childId });
    }
  },

  // ==========================================
  // Child Lessons List Cache
  // ==========================================

  /**
   * Get cached lessons list for a child
   */
  async getChildLessons(childId: string): Promise<any[] | null> {
    try {
      const key = `${CACHE_PREFIX.CHILD_LESSONS}${childId}`;
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      logger.error('Error reading child lessons cache', { error, childId });
      return null;
    }
  },

  /**
   * Set lessons list in cache
   */
  async setChildLessons(childId: string, lessons: any[]): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.CHILD_LESSONS}${childId}`;
      await redis.setex(key, CACHE_TTL.CHILD_LESSONS, JSON.stringify(lessons));
    } catch (error) {
      logger.error('Error setting child lessons cache', { error, childId });
    }
  },

  /**
   * Invalidate lessons list cache
   */
  async invalidateChildLessons(childId: string): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.CHILD_LESSONS}${childId}`;
      await redis.del(key);
    } catch (error) {
      logger.error('Error invalidating child lessons cache', { error, childId });
    }
  },

  // ==========================================
  // Parent Dashboard Cache
  // ==========================================

  /**
   * Get cached parent dashboard data
   */
  async getParentDashboard(parentId: string): Promise<any | null> {
    try {
      const key = `${CACHE_PREFIX.PARENT_DASHBOARD}${parentId}`;
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      logger.error('Error reading parent dashboard cache', { error, parentId });
      return null;
    }
  },

  /**
   * Set parent dashboard data in cache
   */
  async setParentDashboard(parentId: string, dashboard: any): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.PARENT_DASHBOARD}${parentId}`;
      await redis.setex(key, CACHE_TTL.PARENT_DASHBOARD, JSON.stringify(dashboard));
    } catch (error) {
      logger.error('Error setting parent dashboard cache', { error, parentId });
    }
  },

  /**
   * Invalidate parent dashboard cache
   */
  async invalidateParentDashboard(parentId: string): Promise<void> {
    try {
      const key = `${CACHE_PREFIX.PARENT_DASHBOARD}${parentId}`;
      await redis.del(key);
    } catch (error) {
      logger.error('Error invalidating parent dashboard cache', { error, parentId });
    }
  },

  // ==========================================
  // Bulk Invalidation
  // ==========================================

  /**
   * Invalidate all caches for a child
   * Call this when child data changes (lesson added, XP earned, etc.)
   */
  async invalidateChildCaches(childId: string, parentId?: string): Promise<void> {
    try {
      const keysToDelete = [
        `${CACHE_PREFIX.CHILD_STATS}${childId}`,
        `${CACHE_PREFIX.LESSON_COUNT}${childId}`,
        `${CACHE_PREFIX.CHILD_LESSONS}${childId}`,
      ];

      if (parentId) {
        keysToDelete.push(`${CACHE_PREFIX.PARENT_DASHBOARD}${parentId}`);
      }

      await redis.del(...keysToDelete);
    } catch (error) {
      logger.error('Error invalidating child caches', { error, childId, parentId });
    }
  },

  /**
   * Invalidate all caches for a parent
   * Call this when parent data changes
   */
  async invalidateParentCaches(parentId: string): Promise<void> {
    try {
      await redis.del(`${CACHE_PREFIX.PARENT_DASHBOARD}${parentId}`);
    } catch (error) {
      logger.error('Error invalidating parent caches', { error, parentId });
    }
  },
};

export default dashboardCache;
