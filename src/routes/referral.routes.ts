/**
 * Referral Routes
 *
 * Endpoints for referral code management and tracking:
 * - Generate referral codes
 * - Validate referral codes (public)
 * - Get referral statistics
 * - View referral history
 * - Manage rewards
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireParent } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { referralService } from '../services/sharing/index.js';
import { logger } from '../utils/logger.js';
import { ShareChannel } from '@prisma/client';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const validateCodeSchema = z.object({
  code: z.string().min(1).max(20),
});

const historyQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).optional(),
});

// ============================================
// PUBLIC ROUTES (No auth required)
// ============================================

/**
 * GET /api/referrals/validate/:code
 * Validate a referral code (for signup page)
 * Public endpoint - no authentication required
 */
router.get(
  '/validate/:code',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.params;

      const result = await referralService.validateCode(code);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Error validating referral code', { error, code: req.params.code });
      next(error);
    }
  }
);

// ============================================
// AUTHENTICATED ROUTES (Parent)
// ============================================

/**
 * POST /api/referrals/code
 * Generate a referral code for the authenticated parent
 */
router.post(
  '/code',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      const codeInfo = await referralService.generateCodeForParent(parentId);

      res.json({
        success: true,
        data: codeInfo,
      });
    } catch (error) {
      logger.error('Error generating referral code', { error, parentId: req.parent?.id });
      next(error);
    }
  }
);

/**
 * GET /api/referrals/code
 * Get the current parent's referral code
 */
router.get(
  '/code',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      const codeInfo = await referralService.generateCodeForParent(parentId);

      res.json({
        success: true,
        data: codeInfo,
      });
    } catch (error) {
      logger.error('Error fetching referral code', { error, parentId: req.parent?.id });
      next(error);
    }
  }
);

/**
 * GET /api/referrals/stats
 * Get referral statistics for the authenticated parent
 */
router.get(
  '/stats',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      const stats = await referralService.getStats(parentId, 'parent');

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Error fetching referral stats', { error, parentId: req.parent?.id });
      next(error);
    }
  }
);

/**
 * GET /api/referrals/history
 * Get referral history for the authenticated parent
 */
router.get(
  '/history',
  authenticate,
  requireParent,
  validateInput(historyQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const history = await referralService.getHistory(parentId, 'parent', limit);

      res.json({
        success: true,
        data: history,
      });
    } catch (error) {
      logger.error('Error fetching referral history', { error, parentId: req.parent?.id });
      next(error);
    }
  }
);

/**
 * GET /api/referrals/rewards
 * Get available rewards for the authenticated parent
 */
router.get(
  '/rewards',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      const rewards = await referralService.getAvailableRewards(parentId, 'parent');

      res.json({
        success: true,
        data: rewards,
      });
    } catch (error) {
      logger.error('Error fetching referral rewards', { error, parentId: req.parent?.id });
      next(error);
    }
  }
);

/**
 * POST /api/referrals/rewards/:id/apply
 * Apply a reward to the authenticated parent's account
 */
router.post(
  '/rewards/:id/apply',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const rewardId = req.params.id;

      await referralService.applyReward(rewardId, parentId);

      res.json({
        success: true,
        message: 'Reward applied successfully. Credit will be applied to your next billing cycle.',
      });
    } catch (error) {
      logger.error('Error applying referral reward', {
        error,
        parentId: req.parent?.id,
        rewardId: req.params.id,
      });
      next(error);
    }
  }
);

/**
 * GET /api/referrals/share-links
 * Get formatted share links for different channels
 */
router.get(
  '/share-links',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      // Get or generate the referral code
      const codeInfo = await referralService.generateCodeForParent(parentId);
      const baseUrl = process.env.FRONTEND_URL || 'https://orbitlearn.com';
      const referralUrl = `${baseUrl}/start?ref=${codeInfo.code}`;

      // Generate channel-specific share links
      const shareLinks = {
        referralCode: codeInfo.code,
        referralUrl,
        channels: {
          whatsapp: `https://wa.me/?text=${encodeURIComponent(
            `Join me on Orbit Learn! My kids love learning with AI-powered lessons. Get 30% off your first month: ${referralUrl}`
          )}`,
          email: {
            subject: "Check out Orbit Learn - AI Learning for Kids!",
            body: `Hi!\n\nI wanted to share this amazing learning platform with you. My kids have been using Orbit Learn and they love it!\n\nSign up using my link and get 30% off your first month:\n${referralUrl}\n\nBest,`,
            mailto: `mailto:?subject=${encodeURIComponent(
              "Check out Orbit Learn - AI Learning for Kids!"
            )}&body=${encodeURIComponent(
              `Hi!\n\nI wanted to share this amazing learning platform with you. My kids have been using Orbit Learn and they love it!\n\nSign up using my link and get 30% off your first month:\n${referralUrl}\n\nBest,`
            )}`,
          },
          twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(
            `My kids love learning with @OrbitLearn! AI-powered lessons that make education fun. Check it out: ${referralUrl}`
          )}`,
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralUrl)}`,
          copyLink: referralUrl,
        },
      };

      res.json({
        success: true,
        data: shareLinks,
      });
    } catch (error) {
      logger.error('Error generating share links', { error, parentId: req.parent?.id });
      next(error);
    }
  }
);

export default router;
