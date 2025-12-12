// Token Quota Management Service
import { prisma } from '../../config/database.js';
import { TokenOperation, TeacherSubscriptionTier } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { PaymentRequiredError } from '../../middleware/errorHandler.js';
import { emailService } from '../email/emailService.js';

// =============================================================================
// TOKEN COSTS (Updated December 2025 - Google Gemini API Pricing)
// =============================================================================
// These are BLENDED costs (input + output) per 1K tokens
// Assuming typical 25% input, 75% output distribution for educational content
// Source: https://ai.google.dev/gemini-api/docs/pricing (Updated Dec 5, 2025)
const TOKEN_COSTS = {
  // Gemini 2.5 Flash: $0.30/1M input, $2.50/1M output → ~$1.85/1M blended
  'gemini-2.5-flash': 0.00185,

  // Gemini 2.5 Flash-Lite: $0.10/1M input, $0.40/1M output → ~$0.325/1M blended
  'gemini-2.5-flash-lite': 0.000325,

  // Gemini 3 Pro Preview: $2.00/1M input, $12.00/1M output → ~$9.50/1M blended
  'gemini-3-pro': 0.0095,
  'gemini-3-pro-preview': 0.0095,

  // Gemini 3 Pro Image: $120/1M output tokens (images only, ~$0.134 per 1K/2K image)
  'gemini-3-pro-image-preview': 0.12,

  // Gemini 2.0 Flash (legacy): $0.10/1M input, $0.40/1M output → ~$0.325/1M blended
  'gemini-2.0-flash': 0.000325,

  // Default fallback
  default: 0.002,
};

// =============================================================================
// OPERATION TOKEN ESTIMATES (for pre-flight quota checks)
// =============================================================================
// These estimates include both input and output tokens
const OPERATION_ESTIMATES: Record<TokenOperation, number> = {
  CONTENT_ANALYSIS: 5000,        // ~2K input + ~3K output
  LESSON_GENERATION: 8000,       // Guide: ~5.5K, Full: ~12K (use average)
  QUIZ_GENERATION: 3000,         // ~1K input + ~2K output (10 questions)
  FLASHCARD_GENERATION: 2500,    // ~800 input + ~1.5K output (20 cards)
  INFOGRAPHIC_GENERATION: 1600,  // ~500 input + ~1.1K output tokens
  GRADING_SINGLE: 4000,          // ~2K input + ~2K output
  GRADING_BATCH: 4000,           // Per submission
  FEEDBACK_GENERATION: 1500,     // ~500 input + ~1K output
  CHAT: 800,                     // ~300 input + ~500 output
};

// =============================================================================
// CREDIT SYSTEM CONFIGURATION
// =============================================================================
// 1 Credit = 1,000 tokens (simplified for user understanding)
const TOKENS_PER_CREDIT = 1000;

// Monthly credit allocations by subscription tier
const TIER_CREDITS: Record<TeacherSubscriptionTier, number> = {
  FREE: 100,           // 100K tokens
  BASIC: 500,          // 500K tokens
  PROFESSIONAL: 2000,  // 2M tokens
};

// Maximum rollover cap (2x monthly allocation)
const ROLLOVER_MULTIPLIER = 2;

export interface QuotaCheckResult {
  allowed: boolean;
  remainingTokens: bigint;
  remainingCredits: number;
  estimatedCost: number;
  quotaResetDate: Date;
  warning?: string;
  percentUsed: number;
}

export interface CreditBalance {
  subscription: number;      // Current month subscription credits
  rollover: number;          // Rolled over from previous month
  bonus: number;             // From credit pack purchases
  total: number;             // Total available
  used: number;              // Used this month
  remaining: number;         // Total - Used
}

export interface UsageStats {
  currentMonth: {
    tokensUsed: bigint;
    creditsUsed: number;
    operationBreakdown: Record<TokenOperation, number>;
    costEstimate: number;
  };
  history: Array<{
    date: Date;
    tokensUsed: number;
    creditsUsed: number;
    operation: TokenOperation;
  }>;
}

// =============================================================================
// CREDIT CONVERSION UTILITIES
// =============================================================================

/**
 * Convert tokens to credits (rounds up)
 */
export function tokensToCredits(tokens: number | bigint): number {
  return Math.ceil(Number(tokens) / TOKENS_PER_CREDIT);
}

/**
 * Convert credits to tokens
 */
export function creditsToTokens(credits: number): number {
  return credits * TOKENS_PER_CREDIT;
}

/**
 * Get credit allocation for a subscription tier
 */
export function getTierCredits(tier: TeacherSubscriptionTier): number {
  return TIER_CREDITS[tier] || TIER_CREDITS.FREE;
}

/**
 * Get rollover cap for a subscription tier
 */
export function getRolloverCap(tier: TeacherSubscriptionTier): number {
  return getTierCredits(tier) * ROLLOVER_MULTIPLIER;
}

/**
 * Get estimated credits for an operation
 */
export function getOperationCredits(operation: TokenOperation): number {
  return tokensToCredits(OPERATION_ESTIMATES[operation] || 1000);
}

export const quotaService = {
  /**
   * Check if an operation is allowed within the quota
   * Now includes rollover credits and bonus credits
   */
  async checkQuota(
    teacherId: string,
    operation: TokenOperation,
    estimatedTokens?: number
  ): Promise<QuotaCheckResult> {
    const estimate = estimatedTokens || OPERATION_ESTIMATES[operation] || 1000;

    // Get teacher with org info
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: {
        organization: {
          select: {
            monthlyTokenQuota: true,
            currentMonthUsage: true,
            quotaResetDate: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Use org quota if part of organization, else individual quota
    const monthlyLimit = teacher.organization
      ? teacher.organization.monthlyTokenQuota
      : teacher.monthlyTokenQuota;

    const currentUsage = teacher.organization
      ? teacher.organization.currentMonthUsage
      : teacher.currentMonthUsage;

    const resetDate = teacher.organization
      ? teacher.organization.quotaResetDate
      : teacher.quotaResetDate;

    // Check if quota needs to be reset (new month)
    if (new Date() > resetDate) {
      await this.resetQuota(teacherId, teacher.organizationId);
      // Re-fetch updated values
      return this.checkQuota(teacherId, operation, estimatedTokens);
    }

    // Calculate total available tokens including rollover and bonus credits
    // For now, these fields might not exist yet in the database
    const rolledOverTokens = BigInt((teacher as any).rolledOverCredits || 0) * BigInt(TOKENS_PER_CREDIT);
    const bonusTokens = BigInt((teacher as any).bonusCredits || 0) * BigInt(TOKENS_PER_CREDIT);

    const totalAvailable = monthlyLimit + rolledOverTokens + bonusTokens;
    const remaining = totalAvailable - currentUsage;
    const allowed = remaining >= BigInt(estimate);

    // Calculate percent used of subscription credits only (for display)
    const percentUsed = monthlyLimit > BigInt(0)
      ? Number((currentUsage * BigInt(100)) / monthlyLimit)
      : 100;

    // Calculate cost estimate using the appropriate model
    const costPerToken = TOKEN_COSTS.default / 1000;
    const estimatedCost = estimate * costPerToken;

    let warning: string | undefined;
    if (percentUsed >= 90) {
      warning = 'You have used over 90% of your monthly credit quota. Consider purchasing a credit pack.';
    } else if (percentUsed >= 75) {
      warning = 'You have used over 75% of your monthly credit quota.';
    }

    return {
      allowed,
      remainingTokens: remaining,
      remainingCredits: tokensToCredits(remaining),
      estimatedCost,
      quotaResetDate: resetDate,
      warning,
      percentUsed,
    };
  },

  /**
   * Record token usage after an operation
   */
  async recordUsage(params: {
    teacherId: string;
    operation: TokenOperation;
    tokensUsed: number;
    modelUsed: string;
    resourceType?: string;
    resourceId?: string;
  }): Promise<void> {
    const { teacherId, operation, tokensUsed, modelUsed, resourceType, resourceId } = params;

    // Calculate estimated cost
    const costRate = TOKEN_COSTS[modelUsed as keyof typeof TOKEN_COSTS] || TOKEN_COSTS.default;
    const estimatedCost = (tokensUsed / 1000) * costRate;

    // Get teacher to check org membership
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { organizationId: true },
    });

    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Create usage log
    await prisma.tokenUsageLog.create({
      data: {
        teacherId,
        operation,
        tokensUsed,
        modelUsed,
        resourceType,
        resourceId,
        estimatedCost,
      },
    });

    // Update current usage
    if (teacher.organizationId) {
      // Update org usage and create org log
      await prisma.$transaction([
        prisma.organization.update({
          where: { id: teacher.organizationId },
          data: {
            currentMonthUsage: { increment: tokensUsed },
          },
        }),
        prisma.orgTokenUsageLog.create({
          data: {
            organizationId: teacher.organizationId,
            teacherId,
            operation,
            tokensUsed,
            modelUsed,
            resourceType,
            resourceId,
            estimatedCost,
          },
        }),
      ]);
    } else {
      // Update individual teacher usage
      await prisma.teacher.update({
        where: { id: teacherId },
        data: {
          currentMonthUsage: { increment: tokensUsed },
        },
      });

      // Check and send credit usage notifications (async, non-blocking)
      // Only for individual teachers (org members use org notifications)
      checkAndSendCreditNotifications(teacherId).catch((err) => {
        logger.error('Failed to check/send credit notifications', { error: err, teacherId });
      });
    }

    logger.info(`Token usage recorded`, {
      teacherId,
      operation,
      tokensUsed,
      modelUsed,
      estimatedCost,
    });
  },

  /**
   * Get usage statistics for a teacher
   */
  async getUsageStats(
    teacherId: string,
    period: 'day' | 'week' | 'month' = 'month'
  ): Promise<UsageStats> {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: {
        organization: {
          select: {
            monthlyTokenQuota: true,
            currentMonthUsage: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Get usage logs
    const logs = await prisma.tokenUsageLog.findMany({
      where: {
        teacherId,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Calculate breakdown by operation
    const operationBreakdown: Record<string, number> = {};
    let totalCost = 0;

    for (const log of logs) {
      operationBreakdown[log.operation] = (operationBreakdown[log.operation] || 0) + log.tokensUsed;
      totalCost += Number(log.estimatedCost || 0);
    }

    const currentUsage = teacher.organization
      ? teacher.organization.currentMonthUsage
      : teacher.currentMonthUsage;

    return {
      currentMonth: {
        tokensUsed: currentUsage,
        creditsUsed: tokensToCredits(currentUsage),
        operationBreakdown: operationBreakdown as Record<TokenOperation, number>,
        costEstimate: totalCost,
      },
      history: logs.map(log => ({
        date: log.createdAt,
        tokensUsed: log.tokensUsed,
        creditsUsed: tokensToCredits(log.tokensUsed),
        operation: log.operation,
      })),
    };
  },

  /**
   * Get quota info for display (with credit balance)
   */
  async getQuotaInfo(teacherId: string) {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: {
        organization: {
          select: {
            name: true,
            monthlyTokenQuota: true,
            currentMonthUsage: true,
            quotaResetDate: true,
            subscriptionTier: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new Error('Teacher not found');
    }

    const isOrgMember = !!teacher.organization;
    const monthlyLimit = isOrgMember
      ? teacher.organization!.monthlyTokenQuota
      : teacher.monthlyTokenQuota;
    const used = isOrgMember
      ? teacher.organization!.currentMonthUsage
      : teacher.currentMonthUsage;
    const resetDate = isOrgMember
      ? teacher.organization!.quotaResetDate
      : teacher.quotaResetDate;
    const tier = isOrgMember
      ? 'FREE' as TeacherSubscriptionTier // Org members use org tier
      : teacher.subscriptionTier;

    // Get rollover and bonus credits (if fields exist)
    const rolloverCredits = (teacher as any).rolledOverCredits || 0;
    const bonusCredits = (teacher as any).bonusCredits || 0;

    // Calculate credit balance
    const subscriptionCredits = tokensToCredits(monthlyLimit);
    const totalCredits = subscriptionCredits + rolloverCredits + bonusCredits;
    const usedCredits = tokensToCredits(used);
    const remainingCredits = totalCredits - usedCredits;

    const creditBalance: CreditBalance = {
      subscription: subscriptionCredits,
      rollover: rolloverCredits,
      bonus: bonusCredits,
      total: totalCredits,
      used: usedCredits,
      remaining: Math.max(0, remainingCredits),
    };

    const remaining = monthlyLimit - used;
    const percentUsed = monthlyLimit > BigInt(0)
      ? Number((used * BigInt(100)) / monthlyLimit)
      : 0;

    return {
      isOrgMember,
      organizationName: teacher.organization?.name || null,
      subscriptionTier: isOrgMember
        ? teacher.organization!.subscriptionTier
        : teacher.subscriptionTier,
      // Legacy quota info (tokens)
      quota: {
        monthlyLimit: monthlyLimit.toString(),
        used: used.toString(),
        remaining: remaining.toString(),
        percentUsed,
        resetDate,
      },
      // New credit balance info
      credits: creditBalance,
      // Trial info (if applicable)
      trialEndsAt: (teacher as any).trialEndsAt || null,
      isInTrial: (teacher as any).trialEndsAt ? new Date() < new Date((teacher as any).trialEndsAt) : false,
    };
  },

  /**
   * Get credit balance for a teacher
   */
  async getCreditBalance(teacherId: string): Promise<CreditBalance> {
    const info = await this.getQuotaInfo(teacherId);
    return info.credits;
  },

  /**
   * Reset quota for new month (with rollover calculation)
   */
  async resetQuota(teacherId: string, organizationId?: string | null): Promise<void> {
    const nextMonth = getNextMonthStart();

    if (organizationId) {
      // For organizations, just reset (no rollover for now)
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          currentMonthUsage: 0,
          quotaResetDate: nextMonth,
        },
      });
    } else {
      // For individual teachers, calculate rollover
      const teacher = await prisma.teacher.findUnique({
        where: { id: teacherId },
        select: {
          monthlyTokenQuota: true,
          currentMonthUsage: true,
          subscriptionTier: true,
        },
      });

      if (teacher) {
        // Calculate unused credits from this month
        const unusedTokens = teacher.monthlyTokenQuota - teacher.currentMonthUsage;
        const unusedCredits = Math.max(0, tokensToCredits(unusedTokens));

        // Cap rollover at 1x monthly allocation (per plan config)
        const tierCredits = getTierCredits(teacher.subscriptionTier);
        const rolloverCap = tierCredits; // Cap at 1 month's worth
        const newRolloverCredits = Math.min(unusedCredits, rolloverCap);

        await prisma.teacher.update({
          where: { id: teacherId },
          data: {
            currentMonthUsage: 0,
            quotaResetDate: nextMonth,
            // Only update if the field exists (after migration)
            ...(typeof (teacher as any).rolledOverCredits !== 'undefined' && {
              rolledOverCredits: newRolloverCredits,
            }),
          },
        });

        logger.info(`Quota reset for teacher ${teacherId}`, {
          unusedCredits,
          rolloverCap,
          newRolloverCredits,
        });
        return;
      }

      // Fallback if teacher not found (shouldn't happen)
      await prisma.teacher.update({
        where: { id: teacherId },
        data: {
          currentMonthUsage: 0,
          quotaResetDate: nextMonth,
        },
      });
    }

    logger.info(`Quota reset for teacher ${teacherId}`);
  },

  /**
   * Reset all quotas (cron job - call monthly)
   */
  async resetAllMonthlyQuotas(): Promise<{ teachersReset: number; orgsReset: number }> {
    const now = new Date();
    const nextMonth = getNextMonthStart();

    // Reset individual teachers whose reset date has passed
    const teacherResult = await prisma.teacher.updateMany({
      where: {
        organizationId: null,
        quotaResetDate: { lt: now },
      },
      data: {
        currentMonthUsage: 0,
        quotaResetDate: nextMonth,
      },
    });

    // Reset organizations whose reset date has passed
    const orgResult = await prisma.organization.updateMany({
      where: {
        quotaResetDate: { lt: now },
      },
      data: {
        currentMonthUsage: 0,
        quotaResetDate: nextMonth,
      },
    });

    logger.info(`Monthly quota reset completed`, {
      teachersReset: teacherResult.count,
      orgsReset: orgResult.count,
    });

    return {
      teachersReset: teacherResult.count,
      orgsReset: orgResult.count,
    };
  },

  /**
   * Estimate tokens for text content
   */
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  },

  /**
   * Estimate tokens for grading operation
   */
  estimateGradingTokens(submissionLength: number, rubricCriteriaCount: number): number {
    // Base tokens for prompt + submission text + response
    const baseTokens = 500;
    const submissionTokens = Math.ceil(submissionLength / 4);
    const responseTokens = rubricCriteriaCount * 150; // ~150 tokens per criterion feedback

    return baseTokens + submissionTokens + responseTokens;
  },

  /**
   * Check quota and throw if not allowed
   */
  async enforceQuota(
    teacherId: string,
    operation: TokenOperation,
    estimatedTokens?: number
  ): Promise<QuotaCheckResult> {
    const check = await this.checkQuota(teacherId, operation, estimatedTokens);

    if (!check.allowed) {
      throw new PaymentRequiredError(
        'Credit quota exceeded. Please purchase a credit pack or upgrade your plan.'
      );
    }

    return check;
  },

  // =============================================================================
  // CREDIT PACK & SUBSCRIPTION MANAGEMENT
  // =============================================================================

  /**
   * Add bonus credits from a credit pack purchase
   */
  async addBonusCredits(teacherId: string, credits: number): Promise<void> {
    // This will work after the migration adds the bonusCredits field
    try {
      await prisma.teacher.update({
        where: { id: teacherId },
        data: {
          bonusCredits: { increment: credits },
        } as any, // Cast to any until migration adds the field
      });

      logger.info(`Added ${credits} bonus credits to teacher ${teacherId}`);
    } catch (error) {
      // If field doesn't exist yet, log warning
      logger.warn(`Could not add bonus credits - field may not exist yet`, {
        teacherId,
        credits,
        error,
      });
      throw error;
    }
  },

  /**
   * Update subscription tier and adjust quota accordingly
   */
  async updateSubscriptionTier(
    teacherId: string,
    newTier: TeacherSubscriptionTier,
    options?: {
      stripeSubscriptionId?: string;
      trialEndsAt?: Date;
    }
  ): Promise<void> {
    const tierCredits = getTierCredits(newTier);
    const newTokenQuota = creditsToTokens(tierCredits);

    const updateData: any = {
      subscriptionTier: newTier,
      monthlyTokenQuota: newTokenQuota,
    };

    if (options?.stripeSubscriptionId) {
      updateData.stripeSubscriptionId = options.stripeSubscriptionId;
    }

    if (options?.trialEndsAt) {
      updateData.trialEndsAt = options.trialEndsAt;
    }

    await prisma.teacher.update({
      where: { id: teacherId },
      data: updateData,
    });

    logger.info(`Updated subscription tier for teacher ${teacherId}`, {
      newTier,
      tierCredits,
      newTokenQuota,
    });
  },

  /**
   * Start a trial period for a teacher
   */
  async startTrial(
    teacherId: string,
    tier: TeacherSubscriptionTier,
    trialDays: number = 7
  ): Promise<Date> {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    await this.updateSubscriptionTier(teacherId, tier, { trialEndsAt });

    logger.info(`Started ${trialDays}-day trial for teacher ${teacherId}`, {
      tier,
      trialEndsAt,
    });

    return trialEndsAt;
  },

  /**
   * Check if a teacher's trial has expired
   */
  async checkTrialExpiry(teacherId: string): Promise<boolean> {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: {
        subscriptionTier: true,
      },
    });

    if (!teacher) {
      throw new Error('Teacher not found');
    }

    const trialEndsAt = (teacher as any).trialEndsAt;
    if (!trialEndsAt) {
      return false; // No trial set
    }

    const hasExpired = new Date() > new Date(trialEndsAt);

    if (hasExpired && teacher.subscriptionTier !== 'FREE') {
      // Trial expired, revert to FREE tier
      await this.updateSubscriptionTier(teacherId, 'FREE');
      logger.info(`Trial expired for teacher ${teacherId}, reverted to FREE tier`);
      return true;
    }

    return false;
  },

  /**
   * Get operation cost estimate in credits
   */
  getOperationCreditCost(operation: TokenOperation): number {
    return getOperationCredits(operation);
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get the start of next month for quota reset
 */
function getNextMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

/**
 * Get the start of current month for notification tracking
 */
function getCurrentMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Format tier name for display
 */
function formatTierName(tier: TeacherSubscriptionTier): string {
  switch (tier) {
    case 'PROFESSIONAL':
      return 'Professional';
    case 'BASIC':
      return 'Basic';
    case 'FREE':
    default:
      return 'Free';
  }
}

/**
 * Check credit usage thresholds and send notification emails if needed
 * Tracks sent notifications to avoid duplicates
 */
async function checkAndSendCreditNotifications(teacherId: string): Promise<void> {
  // Get teacher info including usage and notification status
  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: {
      email: true,
      firstName: true,
      subscriptionTier: true,
      monthlyTokenQuota: true,
      currentMonthUsage: true,
      rolledOverCredits: true,
      bonusCredits: true,
      notifiedWarning70: true,
      notifiedWarning90: true,
      notifiedLimitReached: true,
      lastNotificationReset: true,
    },
  });

  if (!teacher) return;

  // Check if we need to reset notification flags for a new month
  const currentMonth = getCurrentMonthStart();
  const lastReset = teacher.lastNotificationReset;

  if (!lastReset || new Date(lastReset) < currentMonth) {
    // New month - reset notification flags
    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        notifiedWarning70: false,
        notifiedWarning90: false,
        notifiedLimitReached: false,
        lastNotificationReset: currentMonth,
      },
    });
    // Re-fetch with reset flags
    return checkAndSendCreditNotifications(teacherId);
  }

  // Calculate credits
  const subscriptionCredits = tokensToCredits(teacher.monthlyTokenQuota);
  const totalCredits = subscriptionCredits + (teacher.rolledOverCredits || 0) + (teacher.bonusCredits || 0);
  const usedCredits = tokensToCredits(teacher.currentMonthUsage);
  const remainingCredits = Math.max(0, totalCredits - usedCredits);

  // Calculate percentage based on subscription credits (not total with bonuses)
  const percentUsed = subscriptionCredits > 0
    ? Math.round((usedCredits / subscriptionCredits) * 100)
    : 0;

  const teacherName = teacher.firstName || 'there';
  const tierName = formatTierName(teacher.subscriptionTier);

  // Check 100% threshold (limit reached)
  if (percentUsed >= 100 && !teacher.notifiedLimitReached) {
    await emailService.sendTeacherCreditLimitReachedEmail(
      teacher.email,
      teacherName,
      subscriptionCredits,
      tierName
    );

    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        notifiedLimitReached: true,
        notifiedWarning90: true, // Also mark 90% as sent
        notifiedWarning70: true, // Also mark 70% as sent
      },
    });

    logger.info(`Credit limit reached notification sent to teacher ${teacherId}`, {
      percentUsed,
      usedCredits,
      totalCredits,
    });
    return;
  }

  // Check 90% threshold
  if (percentUsed >= 90 && !teacher.notifiedWarning90) {
    await emailService.sendTeacherCreditWarningEmail(
      teacher.email,
      teacherName,
      90,
      usedCredits,
      subscriptionCredits,
      remainingCredits,
      tierName
    );

    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        notifiedWarning90: true,
        notifiedWarning70: true, // Also mark 70% as sent
      },
    });

    logger.info(`Credit 90% warning notification sent to teacher ${teacherId}`, {
      percentUsed,
      usedCredits,
      remainingCredits,
    });
    return;
  }

  // Check 70% threshold
  if (percentUsed >= 70 && !teacher.notifiedWarning70) {
    await emailService.sendTeacherCreditWarningEmail(
      teacher.email,
      teacherName,
      70,
      usedCredits,
      subscriptionCredits,
      remainingCredits,
      tierName
    );

    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        notifiedWarning70: true,
      },
    });

    logger.info(`Credit 70% warning notification sent to teacher ${teacherId}`, {
      percentUsed,
      usedCredits,
      remainingCredits,
    });
  }
}

// Export credit utilities for use in other services
export {
  TOKENS_PER_CREDIT,
  TIER_CREDITS,
  TOKEN_COSTS,
  OPERATION_ESTIMATES,
};

export default quotaService;
