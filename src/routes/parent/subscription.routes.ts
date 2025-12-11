/**
 * Parent/Family Subscription Routes
 *
 * Handles subscription management for parents:
 * - Get subscription status and plans
 * - Create checkout sessions for subscriptions
 * - Access customer portal
 * - Cancel/resume subscriptions
 * - Get usage stats
 */

import { Router, Request, Response, NextFunction } from 'express';
import { familySubscriptionService } from '../../services/parent/subscriptionService.js';
import { parentUsageService } from '../../services/parent/usageService.js';
import { authenticate, requireParent } from '../../middleware/auth.js';
import { SubscriptionTier } from '@prisma/client';
import { validateFamilyStripeConfig, getChildLimitForTier } from '../../config/stripeProductsFamily.js';
import { prisma } from '../../config/database.js';

const router = Router();

// =============================================================================
// PUBLIC ENDPOINTS (No auth required)
// =============================================================================

/**
 * GET /api/parent/subscription/plans
 * Get available subscription plans (public)
 */
router.get('/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = familySubscriptionService.getAvailablePlans();

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

// =============================================================================
// PROTECTED ENDPOINTS (Auth required)
// =============================================================================

/**
 * GET /api/parent/subscription
 * Get current subscription status
 */
router.get(
  '/',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      // Get subscription info and usage stats in parallel
      const [subscriptionInfo, usageStats, parent] = await Promise.all([
        familySubscriptionService.getSubscriptionInfo(parentId),
        parentUsageService.getUsageStats(parentId),
        prisma.parent.findUnique({
          where: { id: parentId },
          select: {
            subscriptionTier: true,
            _count: { select: { children: true } },
          },
        }),
      ]);

      const childLimit = getChildLimitForTier(parent?.subscriptionTier || 'FREE');

      res.json({
        success: true,
        data: {
          subscription: subscriptionInfo,
          usage: usageStats,
          limits: {
            childLimit,
            childrenUsed: parent?._count.children || 0,
            canAddChild: (parent?._count.children || 0) < childLimit,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/parent/subscription/usage
 * Get detailed usage stats
 */
router.get(
  '/usage',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const usageInfo = await parentUsageService.getUsageInfo(req.parent!.id);

      res.json({
        success: true,
        data: usageInfo,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/parent/subscription/checkout
 * Create a checkout session for subscription
 */
router.post(
  '/checkout',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tier, isAnnual = false, successUrl, cancelUrl } = req.body;

      // Validate tier
      const validTiers: SubscriptionTier[] = ['FAMILY', 'FAMILY_PLUS', 'ANNUAL'];
      if (!tier || !validTiers.includes(tier)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid subscription tier. Must be FAMILY, FAMILY_PLUS, or ANNUAL.',
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
      if (!familySubscriptionService.isConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Payment system is not configured.',
        });
      }

      const result = await familySubscriptionService.createCheckoutSession(
        req.parent!.id,
        tier as SubscriptionTier,
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
 * POST /api/parent/subscription/portal
 * Create a customer portal session for managing subscription
 */
router.post(
  '/portal',
  authenticate,
  requireParent,
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
      if (!familySubscriptionService.isConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Payment system is not configured.',
        });
      }

      const result = await familySubscriptionService.createCustomerPortalSession(
        req.parent!.id,
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
 * POST /api/parent/subscription/cancel
 * Cancel subscription at period end
 */
router.post(
  '/cancel',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await familySubscriptionService.cancelSubscription(req.parent!.id);

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
 * POST /api/parent/subscription/resume
 * Resume a cancelled subscription (before period end)
 */
router.post(
  '/resume',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await familySubscriptionService.resumeSubscription(req.parent!.id);

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
 * GET /api/parent/subscription/config-status
 * Check if Stripe is properly configured (for debugging)
 */
router.get(
  '/config-status',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stripeConfigured = familySubscriptionService.isConfigured();
      const priceConfig = validateFamilyStripeConfig();

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
