// Token Quota Management Service
import { prisma } from '../../config/database.js';
import { TokenOperation } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { PaymentRequiredError } from '../../middleware/errorHandler.js';

// Token cost estimates per 1K tokens (based on Gemini pricing)
const TOKEN_COSTS = {
  'gemini-2.5-flash': 0.000075,        // $0.075 per 1M tokens
  'gemini-2.5-flash-lite': 0.000025,   // $0.025 per 1M tokens
  'gemini-3-pro': 0.00125,             // $1.25 per 1M tokens
  'gemini-3-pro-preview': 0.00125,     // $1.25 per 1M tokens
  'gemini-3-pro-image-preview': 0.002, // $2 per 1M tokens (images)
  default: 0.001,                       // Default fallback
};

// Estimated tokens per operation (for pre-flight checks)
const OPERATION_ESTIMATES: Record<TokenOperation, number> = {
  CONTENT_ANALYSIS: 5000,
  LESSON_GENERATION: 3000,
  QUIZ_GENERATION: 1500,
  FLASHCARD_GENERATION: 1000,
  INFOGRAPHIC_GENERATION: 500,
  GRADING_SINGLE: 3000,
  GRADING_BATCH: 3000, // Per submission
  FEEDBACK_GENERATION: 1000,
  CHAT: 500,
};

export interface QuotaCheckResult {
  allowed: boolean;
  remainingTokens: bigint;
  estimatedCost: number;
  quotaResetDate: Date;
  warning?: string;
  percentUsed: number;
}

export interface UsageStats {
  currentMonth: {
    tokensUsed: bigint;
    operationBreakdown: Record<TokenOperation, number>;
    costEstimate: number;
  };
  history: Array<{
    date: Date;
    tokensUsed: number;
    operation: TokenOperation;
  }>;
}

export const quotaService = {
  /**
   * Check if an operation is allowed within the quota
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

    const remaining = monthlyLimit - currentUsage;
    const allowed = remaining >= BigInt(estimate);
    const percentUsed = Number((currentUsage * BigInt(100)) / monthlyLimit);

    // Calculate cost estimate
    const costPerToken = TOKEN_COSTS.default / 1000;
    const estimatedCost = estimate * costPerToken;

    let warning: string | undefined;
    if (percentUsed >= 90) {
      warning = 'You have used over 90% of your monthly token quota.';
    } else if (percentUsed >= 75) {
      warning = 'You have used over 75% of your monthly token quota.';
    }

    return {
      allowed,
      remainingTokens: remaining,
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
        operationBreakdown: operationBreakdown as Record<TokenOperation, number>,
        costEstimate: totalCost,
      },
      history: logs.map(log => ({
        date: log.createdAt,
        tokensUsed: log.tokensUsed,
        operation: log.operation,
      })),
    };
  },

  /**
   * Get quota info for display
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

    const remaining = monthlyLimit - used;
    const percentUsed = Number((used * BigInt(100)) / monthlyLimit);

    return {
      isOrgMember,
      organizationName: teacher.organization?.name || null,
      subscriptionTier: isOrgMember
        ? teacher.organization!.subscriptionTier
        : teacher.subscriptionTier,
      quota: {
        monthlyLimit: monthlyLimit.toString(),
        used: used.toString(),
        remaining: remaining.toString(),
        percentUsed,
        resetDate,
      },
    };
  },

  /**
   * Reset quota for new month
   */
  async resetQuota(teacherId: string, organizationId?: string | null): Promise<void> {
    const nextMonth = getNextMonthStart();

    if (organizationId) {
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          currentMonthUsage: 0,
          quotaResetDate: nextMonth,
        },
      });
    } else {
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
        'Token quota exceeded. Please upgrade your plan or wait for quota reset.'
      );
    }

    return check;
  },
};

/**
 * Get the start of next month for quota reset
 */
function getNextMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export default quotaService;
