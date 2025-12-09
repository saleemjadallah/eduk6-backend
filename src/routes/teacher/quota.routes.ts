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
 * Get detailed usage statistics formatted for the frontend
 */
router.get(
  '/usage',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const period = (req.query.period as 'day' | 'week' | 'month') || 'month';
      const stats = await quotaService.getUsageStats(req.teacher!.id, period);

      // Transform data for frontend consumption

      // 1. Build daily usage array (last 7 days)
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dailyMap: Record<string, number> = {};

      // Initialize last 7 days with 0
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayName = dayNames[date.getDay()];
        dailyMap[dayName] = 0;
      }

      // Aggregate history by day
      for (const entry of stats.history) {
        const entryDate = new Date(entry.date);
        const dayName = dayNames[entryDate.getDay()];
        if (dailyMap[dayName] !== undefined) {
          dailyMap[dayName] += entry.tokensUsed;
        }
      }

      // Convert to array format
      const daily = Object.entries(dailyMap).map(([date, credits]) => ({
        date,
        credits,
      }));

      // 2. Build operation breakdown with names and percentages
      const operationLabels: Record<string, string> = {
        LESSON_GENERATION: 'Lesson Generation',
        QUIZ_GENERATION: 'Quiz Generation',
        FLASHCARD_GENERATION: 'Flashcard Creation',
        INFOGRAPHIC_GENERATION: 'Infographics',
        CONTENT_ANALYSIS: 'Content Analysis',
        GRADING_SINGLE: 'Single Grading',
        GRADING_BATCH: 'Batch Grading',
        FEEDBACK_GENERATION: 'Feedback',
        CHAT: 'Chat',
      };

      const breakdown = stats.currentMonth.operationBreakdown;
      const totalTokens = Object.values(breakdown).reduce((sum, val) => sum + (val || 0), 0);

      const byOperation = Object.entries(breakdown)
        .filter(([_, credits]) => credits > 0)
        .map(([type, credits]) => ({
          type,
          name: operationLabels[type] || type,
          credits,
          percentage: totalTokens > 0 ? Math.round((credits / totalTokens) * 100) : 0,
        }))
        .sort((a, b) => b.credits - a.credits);

      // 3. Build recent activity from history
      const recentActivity = stats.history.slice(0, 5).map(entry => {
        const entryDate = new Date(entry.date);
        const now = new Date();
        const diffMs = now.getTime() - entryDate.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        let time: string;
        if (diffHours < 1) {
          time = 'Just now';
        } else if (diffHours < 24) {
          time = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        } else if (diffDays === 1) {
          time = 'Yesterday';
        } else {
          time = `${diffDays} days ago`;
        }

        // Map operation to content type for display
        const operationToType: Record<string, string> = {
          LESSON_GENERATION: 'LESSON',
          QUIZ_GENERATION: 'QUIZ',
          FLASHCARD_GENERATION: 'FLASHCARD_DECK',
          INFOGRAPHIC_GENERATION: 'INFOGRAPHIC',
          CONTENT_ANALYSIS: 'LESSON',
        };

        return {
          type: operationToType[entry.operation] || 'LESSON',
          title: operationLabels[entry.operation] || entry.operation,
          credits: entry.tokensUsed,
          time,
        };
      });

      res.json({
        success: true,
        data: {
          daily,
          byOperation,
          recentActivity,
          // Also include raw data for debugging/future use
          _raw: {
            currentMonth: {
              tokensUsed: stats.currentMonth.tokensUsed.toString(),
              operationBreakdown: stats.currentMonth.operationBreakdown,
              costEstimate: stats.currentMonth.costEstimate,
            },
          },
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
