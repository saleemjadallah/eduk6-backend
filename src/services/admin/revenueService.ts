// Revenue Analytics Service for VC Dashboard
// Provides MRR/ARR calculations and revenue trends
import { prisma } from '../../config/database.js';
import { redis } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { SubscriptionTier } from '@prisma/client';

// Cache TTLs in seconds
const CACHE_TTL = {
  REVENUE: 15 * 60,         // 15 minutes for revenue metrics
  REVENUE_SERIES: 30 * 60,  // 30 minutes for historical MRR
};

// Cache key prefixes
const CACHE_KEYS = {
  MRR: 'analytics:revenue:mrr',
  ARR: 'analytics:revenue:arr',
  REVENUE_BREAKDOWN: 'analytics:revenue:breakdown',
  REVENUE_SERIES: 'analytics:revenue:series',
};

// Family subscription pricing (from stripeProductsFamily.ts)
// MRR is calculated based on monthly equivalent
const PRICING: Record<SubscriptionTier, { monthly: number; annualMonthly: number }> = {
  FREE: { monthly: 0, annualMonthly: 0 },
  FAMILY: { monthly: 7.99, annualMonthly: 57.99 / 12 }, // $4.83/month for annual
  FAMILY_PLUS: { monthly: 14.99, annualMonthly: 107.99 / 12 }, // $9.00/month for annual
  ANNUAL: { monthly: 0, annualMonthly: 0 }, // Legacy tier, treat as FAMILY annual
};

/**
 * Get the MRR contribution for a subscription tier and billing period
 */
function getMRRForTier(tier: SubscriptionTier, isAnnual: boolean): number {
  const pricing = PRICING[tier];
  if (!pricing) return 0;

  // For annual subscriptions, use the annual monthly equivalent
  return isAnnual ? pricing.annualMonthly : pricing.monthly;
}

export interface MRRBreakdown {
  total: number;
  byTier: {
    tier: string;
    count: number;
    mrr: number;
    percentage: number;
  }[];
  currency: string;
}

export interface RevenueOverview {
  mrr: number;
  arr: number;
  mrrGrowthPercent: number | null;
  avgRevenuePerUser: number;
  payingCustomers: number;
  ltv: number;
  currency: string;
}

export interface MRRDataPoint {
  date: string;
  mrr: number;
}

export const revenueService = {
  /**
   * Calculate current MRR (Monthly Recurring Revenue)
   */
  async getMRR(): Promise<number> {
    const cacheKey = CACHE_KEYS.MRR;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return parseFloat(cached);
    }

    // Get all active paying subscribers
    const subscribers = await prisma.parent.findMany({
      where: {
        subscriptionTier: {
          not: 'FREE',
        },
        subscriptionStatus: 'ACTIVE',
      },
      select: {
        id: true,
        subscriptionTier: true,
        stripeSubscriptionId: true,
      },
    });

    // Calculate MRR
    let mrr = 0;
    for (const sub of subscribers) {
      // Determine if annual based on subscription ID pattern or default to monthly
      // In a real implementation, you'd query Stripe for the billing interval
      // For now, we'll assume monthly unless the tier is ANNUAL
      const isAnnual = sub.subscriptionTier === 'ANNUAL';
      mrr += getMRRForTier(sub.subscriptionTier, isAnnual);
    }

    // Round to 2 decimal places
    mrr = Math.round(mrr * 100) / 100;

    await redis.setex(cacheKey, CACHE_TTL.REVENUE, mrr.toString());

    return mrr;
  },

  /**
   * Calculate ARR (Annual Recurring Revenue)
   */
  async getARR(): Promise<number> {
    const mrr = await this.getMRR();
    return Math.round(mrr * 12 * 100) / 100;
  },

  /**
   * Get MRR breakdown by tier
   */
  async getMRRBreakdown(): Promise<MRRBreakdown> {
    const cacheKey = CACHE_KEYS.REVENUE_BREAKDOWN;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    // Get subscriber counts by tier
    const tierCounts = await prisma.parent.groupBy({
      by: ['subscriptionTier'],
      where: {
        subscriptionTier: {
          not: 'FREE',
        },
        subscriptionStatus: 'ACTIVE',
      },
      _count: {
        id: true,
      },
    });

    let totalMRR = 0;
    const byTier: { tier: string; count: number; mrr: number; percentage: number }[] = [];

    for (const tc of tierCounts) {
      const count = tc._count.id;
      const tierMRR = count * getMRRForTier(tc.subscriptionTier, tc.subscriptionTier === 'ANNUAL');
      totalMRR += tierMRR;

      byTier.push({
        tier: tc.subscriptionTier,
        count,
        mrr: Math.round(tierMRR * 100) / 100,
        percentage: 0, // Will calculate after we have total
      });
    }

    // Calculate percentages
    for (const tier of byTier) {
      tier.percentage = totalMRR > 0 ? Math.round((tier.mrr / totalMRR) * 10000) / 100 : 0;
    }

    const result: MRRBreakdown = {
      total: Math.round(totalMRR * 100) / 100,
      byTier: byTier.sort((a, b) => b.mrr - a.mrr), // Sort by MRR descending
      currency: 'USD',
    };

    await redis.setex(cacheKey, CACHE_TTL.REVENUE, JSON.stringify(result));

    return result;
  },

  /**
   * Get comprehensive revenue overview
   */
  async getRevenueOverview(): Promise<RevenueOverview> {
    const [mrr, breakdown, previousMRR] = await Promise.all([
      this.getMRR(),
      this.getMRRBreakdown(),
      this.getHistoricalMRR(1), // Get last month's MRR
    ]);

    const payingCustomers = breakdown.byTier.reduce((sum, t) => sum + t.count, 0);
    const avgRevenuePerUser = payingCustomers > 0 ? mrr / payingCustomers : 0;

    // Calculate growth from previous month
    let mrrGrowthPercent: number | null = null;
    if (previousMRR.length > 0 && previousMRR[0].mrr > 0) {
      mrrGrowthPercent = Math.round(((mrr - previousMRR[0].mrr) / previousMRR[0].mrr) * 10000) / 100;
    }

    // Estimate LTV (simplified: ARPU * estimated lifetime in months)
    // Assuming 12-month average lifetime for now
    const estimatedLifetimeMonths = 12;
    const ltv = Math.round(avgRevenuePerUser * estimatedLifetimeMonths * 100) / 100;

    return {
      mrr: Math.round(mrr * 100) / 100,
      arr: Math.round(mrr * 12 * 100) / 100,
      mrrGrowthPercent,
      avgRevenuePerUser: Math.round(avgRevenuePerUser * 100) / 100,
      payingCustomers,
      ltv,
      currency: 'USD',
    };
  },

  /**
   * Get historical MRR data points (for charts)
   * Note: This is an approximation based on current subscribers and their created dates
   * In production, you'd track MRR changes in a separate table
   */
  async getHistoricalMRR(months: number = 12): Promise<MRRDataPoint[]> {
    const cacheKey = `${CACHE_KEYS.REVENUE_SERIES}:${months}m`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    const result: MRRDataPoint[] = [];
    const today = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const targetDate = new Date(today);
      targetDate.setUTCMonth(targetDate.getUTCMonth() - i);
      targetDate.setUTCDate(1);
      targetDate.setUTCHours(0, 0, 0, 0);

      const endOfMonth = new Date(targetDate);
      endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);

      // Get subscribers who were active at this point in time
      // This is an approximation - counting subscribers created before end of month
      // In production, you'd track subscription state changes
      const subscribers = await prisma.parent.findMany({
        where: {
          subscriptionTier: {
            not: 'FREE',
          },
          // Subscriber must have been created before this month ended
          createdAt: {
            lt: endOfMonth,
          },
          // And either still active or subscription ended after this month
          OR: [
            {
              subscriptionStatus: 'ACTIVE',
            },
            {
              subscriptionStatus: {
                in: ['CANCELLED', 'EXPIRED'],
              },
              // If cancelled/expired, we'd need to check when
              // For simplicity, we count all historical subscribers
            },
          ],
        },
        select: {
          subscriptionTier: true,
        },
      });

      let mrr = 0;
      for (const sub of subscribers) {
        mrr += getMRRForTier(sub.subscriptionTier, sub.subscriptionTier === 'ANNUAL');
      }

      result.push({
        date: targetDate.toISOString().slice(0, 7), // "YYYY-MM"
        mrr: Math.round(mrr * 100) / 100,
      });
    }

    await redis.setex(cacheKey, CACHE_TTL.REVENUE_SERIES, JSON.stringify(result));

    return result;
  },

  /**
   * Get MRR time series for sparklines (last N days)
   * This shows daily MRR changes
   */
  async getMRRTimeSeries(days: number = 30): Promise<MRRDataPoint[]> {
    const cacheKey = `analytics:revenue:daily:${days}d`;

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    // For daily MRR, we'll use a snapshot approach
    // In production, you'd track MRR changes with events
    const result: MRRDataPoint[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const targetDate = new Date(today);
      targetDate.setUTCDate(targetDate.getUTCDate() - i);

      const nextDay = new Date(targetDate);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      // Count subscribers who existed on this day
      const subscribers = await prisma.parent.findMany({
        where: {
          subscriptionTier: {
            not: 'FREE',
          },
          createdAt: {
            lt: nextDay,
          },
          subscriptionStatus: 'ACTIVE',
        },
        select: {
          subscriptionTier: true,
        },
      });

      let mrr = 0;
      for (const sub of subscribers) {
        mrr += getMRRForTier(sub.subscriptionTier, sub.subscriptionTier === 'ANNUAL');
      }

      result.push({
        date: targetDate.toISOString().split('T')[0],
        mrr: Math.round(mrr * 100) / 100,
      });
    }

    await redis.setex(cacheKey, CACHE_TTL.REVENUE, JSON.stringify(result));

    return result;
  },

  /**
   * Get teacher revenue metrics
   */
  async getTeacherRevenue(): Promise<{
    mrr: number;
    payingTeachers: number;
    byTier: { tier: string; count: number; mrr: number }[];
  }> {
    const cacheKey = 'analytics:revenue:teacher';

    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }

    // Teacher pricing (from CLAUDE.md)
    const teacherPricing: Record<string, number> = {
      FREE: 0,
      BASIC: 9.99,
      PROFESSIONAL: 24.99,
    };

    const tierCounts = await prisma.teacher.groupBy({
      by: ['subscriptionTier'],
      where: {
        subscriptionTier: {
          not: 'FREE',
        },
        subscriptionStatus: 'ACTIVE',
      },
      _count: {
        id: true,
      },
    });

    let mrr = 0;
    const byTier: { tier: string; count: number; mrr: number }[] = [];

    for (const tc of tierCounts) {
      const count = tc._count.id;
      const tierMRR = count * (teacherPricing[tc.subscriptionTier] || 0);
      mrr += tierMRR;

      byTier.push({
        tier: tc.subscriptionTier,
        count,
        mrr: Math.round(tierMRR * 100) / 100,
      });
    }

    const payingTeachers = byTier.reduce((sum, t) => sum + t.count, 0);

    const result = {
      mrr: Math.round(mrr * 100) / 100,
      payingTeachers,
      byTier,
    };

    await redis.setex(cacheKey, CACHE_TTL.REVENUE, JSON.stringify(result));

    return result;
  },

  /**
   * Get combined revenue (Family + Teacher)
   */
  async getTotalRevenue(): Promise<{
    totalMRR: number;
    totalARR: number;
    familyMRR: number;
    teacherMRR: number;
    currency: string;
  }> {
    const [familyMRR, teacherRevenue] = await Promise.all([
      this.getMRR(),
      this.getTeacherRevenue(),
    ]);

    const totalMRR = familyMRR + teacherRevenue.mrr;

    return {
      totalMRR: Math.round(totalMRR * 100) / 100,
      totalARR: Math.round(totalMRR * 12 * 100) / 100,
      familyMRR: Math.round(familyMRR * 100) / 100,
      teacherMRR: Math.round(teacherRevenue.mrr * 100) / 100,
      currency: 'USD',
    };
  },

  /**
   * Invalidate revenue cache
   */
  async invalidateCache(): Promise<void> {
    const keys = await redis.keys('analytics:revenue:*');
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`Invalidated ${keys.length} revenue cache keys`);
    }
  },
};
