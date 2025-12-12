/**
 * Parent Usage Service
 *
 * Tracks lesson creation usage for FREE tier limits.
 * FREE tier parents are limited to 10 lessons per month.
 * Paid tier parents have unlimited lessons.
 *
 * Also handles usage notification emails at thresholds:
 * - 70%: Friendly reminder
 * - 90%: Urgent warning
 * - 100%: Limit reached notification
 */

import { prisma } from '../../config/database.js';
import {
  getLessonLimitForTier,
  hasUnlimitedLessons,
} from '../../config/stripeProductsFamily.js';
import { SubscriptionTier } from '@prisma/client';
import { emailService } from '../email/emailService.js';
import { logger } from '../../utils/logger.js';

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
 * Also checks thresholds and sends notification emails
 */
async function recordLessonCreation(parentId: string): Promise<void> {
  const currentMonth = getCurrentMonthStart();

  // Atomically increment the counter
  const usage = await prisma.parentLessonUsage.upsert({
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

  // Check and send threshold notifications (async, non-blocking)
  checkAndSendUsageNotifications(parentId, usage.lessonsCreated).catch((err) => {
    logger.error('Failed to check/send usage notifications', { error: err, parentId });
  });
}

/**
 * Check usage thresholds and send notification emails if needed
 * Tracks sent notifications to avoid duplicates
 */
async function checkAndSendUsageNotifications(
  parentId: string,
  lessonsCreated: number
): Promise<void> {
  // Get parent info including subscription tier
  const parent = await prisma.parent.findUnique({
    where: { id: parentId },
    select: {
      email: true,
      firstName: true,
      subscriptionTier: true,
    },
  });

  if (!parent) return;

  // Only send notifications for FREE tier
  if (hasUnlimitedLessons(parent.subscriptionTier)) {
    return;
  }

  const limit = getLessonLimitForTier(parent.subscriptionTier);
  if (limit === null) return;

  const percentUsed = Math.round((lessonsCreated / limit) * 100);
  const lessonsRemaining = Math.max(0, limit - lessonsCreated);
  const parentName = parent.firstName || 'there';

  // Get current notification status
  const currentMonth = getCurrentMonthStart();
  const usage = await prisma.parentLessonUsage.findUnique({
    where: {
      parentId_month: {
        parentId,
        month: currentMonth,
      },
    },
    select: {
      notified70Pct: true,
      notified90Pct: true,
      notified100Pct: true,
    },
  });

  if (!usage) return;

  // Check 100% threshold (limit reached)
  if (percentUsed >= 100 && !usage.notified100Pct) {
    await emailService.sendLimitReachedEmail(parent.email, parentName, limit);
    await prisma.parentLessonUsage.update({
      where: { parentId_month: { parentId, month: currentMonth } },
      data: { notified100Pct: true },
    });
    logger.info('Sent limit reached notification', { parentId, lessonsCreated, limit });
    return; // Don't send lower threshold emails if limit reached
  }

  // Check 90% threshold
  if (percentUsed >= 90 && !usage.notified90Pct) {
    await emailService.sendUsageWarningEmail(
      parent.email,
      parentName,
      90,
      lessonsCreated,
      limit,
      lessonsRemaining
    );
    await prisma.parentLessonUsage.update({
      where: { parentId_month: { parentId, month: currentMonth } },
      data: { notified90Pct: true },
    });
    logger.info('Sent 90% usage warning', { parentId, lessonsCreated, limit });
    return;
  }

  // Check 70% threshold
  if (percentUsed >= 70 && !usage.notified70Pct) {
    await emailService.sendUsageWarningEmail(
      parent.email,
      parentName,
      70,
      lessonsCreated,
      limit,
      lessonsRemaining
    );
    await prisma.parentLessonUsage.update({
      where: { parentId_month: { parentId, month: currentMonth } },
      data: { notified70Pct: true },
    });
    logger.info('Sent 70% usage warning', { parentId, lessonsCreated, limit });
  }
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
