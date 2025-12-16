// Admin Analytics routes for VC Dashboard
import { Router, Request, Response, NextFunction } from 'express';
import { analyticsService, cohortService, revenueService } from '../../services/admin/index.js';
import { authenticateAdmin, requireAdmin } from '../../middleware/adminAuth.js';
import { validateInput } from '../../middleware/validateInput.js';
import { z } from 'zod';

const router = Router();

// All analytics routes require admin authentication
router.use(authenticateAdmin, requireAdmin);

// ============================================
// VALIDATION SCHEMAS
// ============================================

const timeRangeSchema = z.object({
  days: z.coerce.number().min(1).max(365).optional().default(30),
});

const monthsSchema = z.object({
  months: z.coerce.number().min(1).max(24).optional().default(12),
});

// ============================================
// OVERVIEW ROUTES
// ============================================

/**
 * GET /api/admin/analytics/overview
 * Get comprehensive overview metrics (KPIs)
 */
router.get(
  '/overview',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [overview, revenue, funnel] = await Promise.all([
        analyticsService.getOverview(),
        revenueService.getRevenueOverview(),
        cohortService.getConversionFunnel(),
      ]);

      res.json({
        success: true,
        data: {
          users: {
            dau: overview.dau,
            wau: overview.wau,
            mau: overview.mau,
            dauWauRatio: overview.dauWauRatio,
            dauMauRatio: overview.dauMauRatio,
            totalParents: overview.totalParents,
            totalChildren: overview.totalChildren,
            totalTeachers: overview.totalTeachers,
            payingSubscribers: overview.payingSubscribers,
            freeUsers: overview.freeUsers,
            conversionRate: overview.conversionRate,
          },
          growth: {
            newUsersToday: overview.newUsersToday,
            newUsersThisWeek: overview.newUsersThisWeek,
            newUsersThisMonth: overview.newUsersThisMonth,
          },
          revenue: {
            mrr: revenue.mrr,
            arr: revenue.arr,
            mrrGrowthPercent: revenue.mrrGrowthPercent,
            avgRevenuePerUser: revenue.avgRevenuePerUser,
            ltv: revenue.ltv,
            currency: revenue.currency,
          },
          funnel: {
            stages: funnel.stages,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// ACTIVE USERS ROUTES
// ============================================

/**
 * GET /api/admin/analytics/active-users
 * Get DAU/WAU/MAU time series data for charts
 */
router.get(
  '/active-users',
  validateInput(timeRangeSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt(req.query.days as string) || 30;

      const [dauSeries, engagement] = await Promise.all([
        analyticsService.getDAUTimeSeries(days),
        analyticsService.getEngagementMetrics(),
      ]);

      res.json({
        success: true,
        data: {
          dauSeries,
          engagement: {
            avgSessionDuration: engagement.avgSessionDuration,
            avgSessionsPerUser: engagement.avgSessionsPerUser,
            totalSessions: engagement.totalSessions,
            totalXpAwarded: engagement.totalXpAwarded,
            lessonsCompleted: engagement.lessonsCompleted,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/analytics/user-growth
 * Get user growth time series
 */
router.get(
  '/user-growth',
  validateInput(timeRangeSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const growthSeries = await analyticsService.getUserGrowthTimeSeries(days);

      res.json({
        success: true,
        data: growthSeries,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// COHORT RETENTION ROUTES
// ============================================

/**
 * GET /api/admin/analytics/cohorts
 * Get cohort retention matrix (CRITICAL for VCs)
 */
router.get(
  '/cohorts',
  validateInput(monthsSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const months = parseInt(req.query.months as string) || 12;
      const matrix = await cohortService.getCohortRetentionMatrix(months);

      res.json({
        success: true,
        data: matrix,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/analytics/retention-average
 * Get average retention rates across all cohorts
 */
router.get(
  '/retention-average',
  validateInput(monthsSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const months = parseInt(req.query.months as string) || 6;
      const avgRetention = await cohortService.getAverageRetention(months);

      res.json({
        success: true,
        data: avgRetention,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// FUNNEL ROUTES
// ============================================

/**
 * GET /api/admin/analytics/funnel
 * Get subscription conversion funnel
 */
router.get(
  '/funnel',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const funnel = await cohortService.getConversionFunnel();

      res.json({
        success: true,
        data: funnel,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/analytics/churn
 * Get churn rate
 */
router.get(
  '/churn',
  validateInput(monthsSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const months = parseInt(req.query.months as string) || 1;
      const churn = await cohortService.getChurnRate(months);

      res.json({
        success: true,
        data: churn,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// REVENUE ROUTES
// ============================================

/**
 * GET /api/admin/analytics/revenue
 * Get comprehensive revenue metrics
 */
router.get(
  '/revenue',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [overview, breakdown, totalRevenue] = await Promise.all([
        revenueService.getRevenueOverview(),
        revenueService.getMRRBreakdown(),
        revenueService.getTotalRevenue(),
      ]);

      res.json({
        success: true,
        data: {
          overview,
          breakdown,
          total: totalRevenue,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/analytics/revenue/mrr-series
 * Get MRR time series for charts
 */
router.get(
  '/revenue/mrr-series',
  validateInput(monthsSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const months = parseInt(req.query.months as string) || 12;
      const mrrSeries = await revenueService.getHistoricalMRR(months);

      res.json({
        success: true,
        data: mrrSeries,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/analytics/revenue/daily
 * Get daily MRR for sparklines
 */
router.get(
  '/revenue/daily',
  validateInput(timeRangeSchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const dailyMRR = await revenueService.getMRRTimeSeries(days);

      res.json({
        success: true,
        data: dailyMRR,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/analytics/revenue/teacher
 * Get teacher portal revenue metrics
 */
router.get(
  '/revenue/teacher',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherRevenue = await revenueService.getTeacherRevenue();

      res.json({
        success: true,
        data: teacherRevenue,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// SEGMENT ROUTES
// ============================================

/**
 * GET /api/admin/analytics/segments
 * Get user segment breakdowns (curriculum, age group)
 */
router.get(
  '/segments',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [segments, platforms] = await Promise.all([
        cohortService.getSegmentBreakdown(),
        analyticsService.getPlatformBreakdown(),
      ]);

      res.json({
        success: true,
        data: {
          byCurriculum: segments.byCurriculum,
          byAgeGroup: segments.byAgeGroup,
          byPlatform: platforms,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// TEACHER METRICS ROUTES
// ============================================

/**
 * GET /api/admin/analytics/teachers
 * Get teacher portal metrics
 */
router.get(
  '/teachers',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [userCounts, teacherRevenue] = await Promise.all([
        analyticsService.getUserCounts(),
        revenueService.getTeacherRevenue(),
      ]);

      res.json({
        success: true,
        data: {
          totalTeachers: userCounts.totalTeachers,
          payingTeachers: teacherRevenue.payingTeachers,
          teacherMRR: teacherRevenue.mrr,
          byTier: teacherRevenue.byTier,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// CACHE MANAGEMENT ROUTES
// ============================================

/**
 * POST /api/admin/analytics/cache/invalidate
 * Invalidate all analytics caches (admin only)
 */
router.post(
  '/cache/invalidate',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await Promise.all([
        analyticsService.invalidateCache(),
        cohortService.invalidateCache(),
        revenueService.invalidateCache(),
      ]);

      res.json({
        success: true,
        message: 'Analytics cache invalidated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
