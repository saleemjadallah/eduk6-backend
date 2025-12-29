/**
 * Teacher Subscription Routes
 *
 * Handles subscription management for teachers:
 * - Get subscription status and plans
 * - Create checkout sessions for subscriptions
 * - Create checkout sessions for credit pack purchases
 * - Access customer portal
 * - Cancel/resume subscriptions
 */

import { Router, Request, Response, NextFunction } from 'express';
import { subscriptionService } from '../../services/stripe/subscriptionService.js';
import { quotaService } from '../../services/teacher/quotaService.js';
import { authenticateTeacher, requireTeacher, requireVerifiedEmail } from '../../middleware/teacherAuth.js';
import { TeacherSubscriptionTier } from '@prisma/client';
import { validateStripeConfig } from '../../config/stripeProducts.js';

const router = Router();

// =============================================================================
// PUBLIC ENDPOINTS (No auth required)
// =============================================================================

/**
 * GET /api/teacher/subscription/plans
 * Get available subscription plans (public)
 */
router.get('/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = subscriptionService.getAvailablePlans();

    res.json({
      success: true,
      data: {
        plans,
        currency: 'USD',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/teacher/subscription/credit-packs
 * Get available credit packs (public)
 */
router.get('/credit-packs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const packs = subscriptionService.getAvailableCreditPacks();

    res.json({
      success: true,
      data: {
        packs,
        currency: 'USD',
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// PROTECTED ENDPOINTS (Auth required)
// =============================================================================

/**
 * GET /api/teacher/subscription
 * Get current subscription status
 */
router.get(
  '/',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [subscriptionInfo, quotaInfo] = await Promise.all([
        subscriptionService.getSubscriptionInfo(req.teacher!.id),
        quotaService.getQuotaInfo(req.teacher!.id),
      ]);

      res.json({
        success: true,
        data: {
          subscription: subscriptionInfo,
          credits: quotaInfo.credits,
          currentTier: quotaInfo.subscriptionTier,
          isInTrial: quotaInfo.isInTrial,
          trialEndsAt: quotaInfo.trialEndsAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/subscription/checkout
 * Create a checkout session for subscription
 * Requires verified email to prevent fraud
 */
router.post(
  '/checkout',
  authenticateTeacher,
  requireTeacher,
  requireVerifiedEmail,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tier, isAnnual = false, successUrl, cancelUrl } = req.body;

      // Validate tier
      if (!tier || !['BASIC', 'PROFESSIONAL'].includes(tier)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid subscription tier. Must be BASIC or PROFESSIONAL.',
        });
      }

      // Validate URLs
      if (!successUrl || !cancelUrl) {
        return res.status(400).json({
          success: false,
          error: 'Success and cancel URLs are required.',
        });
      }

      // Check Stripe configuration
      if (!subscriptionService.isConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Payment system is not configured.',
        });
      }

      const result = await subscriptionService.createCheckoutSession(
        req.teacher!.id,
        tier as TeacherSubscriptionTier,
        isAnnual,
        successUrl,
        cancelUrl
      );

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
 * POST /api/teacher/subscription/credit-pack/checkout
 * Create a checkout session for credit pack purchase
 * Requires verified email to prevent fraud
 */
router.post(
  '/credit-pack/checkout',
  authenticateTeacher,
  requireTeacher,
  requireVerifiedEmail,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { packId, successUrl, cancelUrl } = req.body;

      // Validate pack ID
      if (!packId || !['teacher_pack_100', 'teacher_pack_300', 'teacher_pack_500'].includes(packId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid credit pack ID.',
        });
      }

      // Validate URLs
      if (!successUrl || !cancelUrl) {
        return res.status(400).json({
          success: false,
          error: 'Success and cancel URLs are required.',
        });
      }

      // Check Stripe configuration
      if (!subscriptionService.isConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Payment system is not configured.',
        });
      }

      const result = await subscriptionService.createCreditPackCheckoutSession(
        req.teacher!.id,
        packId,
        successUrl,
        cancelUrl
      );

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
 * POST /api/teacher/subscription/portal
 * Create a customer portal session for managing subscription
 */
router.post(
  '/portal',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { returnUrl } = req.body;

      if (!returnUrl) {
        return res.status(400).json({
          success: false,
          error: 'Return URL is required.',
        });
      }

      // Check Stripe configuration
      if (!subscriptionService.isConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Payment system is not configured.',
        });
      }

      const result = await subscriptionService.createCustomerPortalSession(
        req.teacher!.id,
        returnUrl
      );

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
 * POST /api/teacher/subscription/cancel
 * Cancel subscription at period end
 */
router.post(
  '/cancel',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await subscriptionService.cancelSubscription(req.teacher!.id);

      res.json({
        success: true,
        message: 'Subscription will be cancelled at the end of the billing period.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/subscription/resume
 * Resume a cancelled subscription (before period end)
 */
router.post(
  '/resume',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await subscriptionService.resumeSubscription(req.teacher!.id);

      res.json({
        success: true,
        message: 'Subscription resumed successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/teacher/subscription/config-status
 * Check if Stripe is properly configured (for admin/debugging)
 */
router.get(
  '/config-status',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stripeConfigured = subscriptionService.isConfigured();
      const priceConfig = validateStripeConfig();

      res.json({
        success: true,
        data: {
          stripeConfigured,
          pricesConfigured: priceConfig.valid,
          missingPrices: priceConfig.missing,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
