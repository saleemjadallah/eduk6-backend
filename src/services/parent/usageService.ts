/**
 * Parent Usage Service
 *
 * Tracks lesson creation usage for FREE tier limits.
 * FREE tier parents are limited to 10 lessons per month.
 * Paid tier parents have unlimited lessons.
 */

import { prisma } from '../../config/database.js';
import {
  getLessonLimitForTier,
  hasUnlimitedLessons,
} from '../../config/stripeProductsFamily.js';
import { SubscriptionTier } from '@prisma/client';

// =============================================================================
// TYPES
// =============================================================================

export interface UsageInfo {
  currentMonth: {
    lessonsCreated: number;
    lessonsLimit: number | null;
    lessonsRemaining: number | null;
    percentUsed: number | null;
  };
  resetDate: Date;
  canCreateLesson: boolean;
  tier: SubscriptionTier;
  isUnlimited: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the first day of the current month at midnight UTC
 */
function getCurrentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Get the first day of the next month (reset date)
 */
function getNextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Get or create the monthly usage record for a parent
 */
async function getOrCreateMonthlyUsage(parentId: string) {
  const currentMonth = getCurrentMonthStart();

  // Use upsert to atomically get or create
  const usage = await prisma.parentLessonUsage.upsert({
    where: {
      parentId_month: {
        parentId,
        month: currentMonth,
      },
    },
    update: {}, // Don't update anything if exists
    create: {
      parentId,
      month: currentMonth,
      lessonsCreated: 0,
    },
  });

  return usage;
}

/**
 * Check if a parent can create a lesson based on their subscription tier
 */
async function canCreateLesson(parentId: string): Promise<boolean> {
  // Get parent's subscription tier
  const parent = await prisma.parent.findUnique({
    where: { id: parentId },
    select: { subscriptionTier: true },
  });

  if (!parent) {
    return false;
  }

  // Paid tiers have unlimited lessons
  if (hasUnlimitedLessons(parent.subscriptionTier)) {
    return true;
  }

  // For FREE tier, check usage
  const limit = getLessonLimitForTier(parent.subscriptionTier);
  if (limit === null) {
    return true; // Unlimited
  }

  const usage = await getOrCreateMonthlyUsage(parentId);
  return usage.lessonsCreated < limit;
}

/**
 * Record a lesson creation (increment the monthly counter)
 */
async function recordLessonCreation(parentId: string): Promise<void> {
  const currentMonth = getCurrentMonthStart();

  // Atomically increment the counter
  await prisma.parentLessonUsage.upsert({
    where: {
      parentId_month: {
        parentId,
        month: currentMonth,
      },
    },
    update: {
      lessonsCreated: {
        increment: 1,
      },
    },
    create: {
      parentId,
      month: currentMonth,
      lessonsCreated: 1,
    },
  });
}

/**
 * Get current usage info for a parent
 */
async function getUsageInfo(parentId: string): Promise<UsageInfo> {
  // Get parent's subscription tier
  const parent = await prisma.parent.findUnique({
    where: { id: parentId },
    select: { subscriptionTier: true },
  });

  if (!parent) {
    throw new Error('Parent not found');
  }

  const tier = parent.subscriptionTier;
  const limit = getLessonLimitForTier(tier);
  const isUnlimited = limit === null;

  // Get current month usage
  const usage = await getOrCreateMonthlyUsage(parentId);
  const lessonsCreated = usage.lessonsCreated;

  // Calculate remaining and percent used
  let lessonsRemaining: number | null = null;
  let percentUsed: number | null = null;

  if (!isUnlimited && limit !== null) {
    lessonsRemaining = Math.max(0, limit - lessonsCreated);
    percentUsed = Math.round((lessonsCreated / limit) * 100);
  }

  return {
    currentMonth: {
      lessonsCreated,
      lessonsLimit: limit,
      lessonsRemaining,
      percentUsed,
    },
    resetDate: getNextMonthStart(),
    canCreateLesson: isUnlimited || (limit !== null && lessonsCreated < limit),
    tier,
    isUnlimited,
  };
}

/**
 * Get usage stats for display (used in subscription info endpoint)
 */
async function getUsageStats(parentId: string) {
  const usageInfo = await getUsageInfo(parentId);

  return {
    lessonsThisMonth: usageInfo.currentMonth.lessonsCreated,
    lessonsLimit: usageInfo.currentMonth.lessonsLimit,
    lessonsRemaining: usageInfo.currentMonth.lessonsRemaining,
    percentUsed: usageInfo.currentMonth.percentUsed,
    resetDate: usageInfo.resetDate,
    isUnlimited: usageInfo.isUnlimited,
  };
}

/**
 * Reset usage for a parent (used when subscription changes or for testing)
 */
async function resetUsage(parentId: string): Promise<void> {
  const currentMonth = getCurrentMonthStart();

  await prisma.parentLessonUsage.updateMany({
    where: {
      parentId,
      month: currentMonth,
    },
    data: {
      lessonsCreated: 0,
    },
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

export const parentUsageService = {
  getOrCreateMonthlyUsage,
  canCreateLesson,
  recordLessonCreation,
  getUsageInfo,
  getUsageStats,
  resetUsage,
};

export default parentUsageService;
