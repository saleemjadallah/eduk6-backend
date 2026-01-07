/**
 * Teacher Referral Routes
 *
 * Endpoints for teacher referral code management:
 * - Generate/get referral code
 * - Get referral statistics
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateTeacher, requireTeacher } from '../../middleware/teacherAuth.js';
import { referralService } from '../../services/sharing/index.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * POST /api/teacher/referrals/code
 * Generate or get a referral code for the authenticated teacher
 */
router.post(
  '/code',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherId = req.teacher!.id;

      const codeInfo = await referralService.generateCodeForTeacher(teacherId);

      res.json({
        success: true,
        data: codeInfo,
      });
    } catch (error) {
      logger.error('Error generating teacher referral code', { error, teacherId: req.teacher?.id });
      next(error);
    }
  }
);

/**
 * GET /api/teacher/referrals/stats
 * Get referral statistics for the authenticated teacher
 */
router.get(
  '/stats',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teacherId = req.teacher!.id;

      const stats = await referralService.getStats(teacherId, 'teacher');

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Error fetching teacher referral stats', { error, teacherId: req.teacher?.id });
      next(error);
    }
  }
);

export default router;
