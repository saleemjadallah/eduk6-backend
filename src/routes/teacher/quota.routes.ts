// Teacher Quota Routes
import { Router, Request, Response, NextFunction } from 'express';
import { quotaService } from '../../services/teacher/index.js';
import { authenticateTeacher, requireTeacher } from '../../middleware/teacherAuth.js';

const router = Router();

/**
 * GET /api/teacher/quota
 * Get current quota information
 */
router.get(
  '/',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await quotaService.getQuotaInfo(req.teacher!.id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/teacher/quota/usage
 * Get detailed usage statistics
 */
router.get(
  '/usage',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const period = (req.query.period as 'day' | 'week' | 'month') || 'month';
      const stats = await quotaService.getUsageStats(req.teacher!.id, period);

      // Convert BigInt to string for JSON serialization
      res.json({
        success: true,
        data: {
          currentMonth: {
            tokensUsed: stats.currentMonth.tokensUsed.toString(),
            operationBreakdown: stats.currentMonth.operationBreakdown,
            costEstimate: stats.currentMonth.costEstimate,
          },
          history: stats.history,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/teacher/quota/check
 * Pre-flight check for a specific operation
 */
router.get(
  '/check',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const operation = req.query.operation as string;
      const estimatedTokens = req.query.tokens ? parseInt(req.query.tokens as string) : undefined;

      if (!operation) {
        res.status(400).json({
          success: false,
          error: 'Operation type is required',
        });
        return;
      }

      const check = await quotaService.checkQuota(
        req.teacher!.id,
        operation as any,
        estimatedTokens
      );

      res.json({
        success: true,
        data: {
          allowed: check.allowed,
          remainingTokens: check.remainingTokens.toString(),
          estimatedCost: check.estimatedCost,
          percentUsed: check.percentUsed,
          quotaResetDate: check.quotaResetDate,
          warning: check.warning,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
