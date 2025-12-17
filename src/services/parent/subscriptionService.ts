/**
 * Family Subscription Service
 *
 * Handles Stripe subscription operations for family/parent subscriptions:
 * - Creating checkout sessions for new subscriptions
 * - Managing subscription lifecycle (upgrades, downgrades, cancellations)
 * - Customer portal access
 * - Webhook handlers for subscription events
 */

import Stripe from 'stripe';
import { prisma } from '../../config/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { SubscriptionTier } from '@prisma/client';
import {
  getFamilyProductByTier,
  getFamilyProductByPriceId,
  getFamilyTierFromPriceId,
  isFamilyAnnualSubscription,
  getAvailableFamilyPlans,
  getChildLimitForTier,
  getLessonLimitForTier,
  FAMILY_SUBSCRIPTION_PRODUCTS,
} from '../../config/stripeProductsFamily.js';

// Initialize Stripe client
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

// =============================================================================
// TYPES
// =============================================================================

export interface FamilyCheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface FamilyCustomerPortalResult {
  url: string;
}

export interface FamilySubscriptionInfo {
  id: string;
  status: string;
  tier: SubscriptionTier;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  isAnnual: boolean;
  childLimit: number;
  lessonLimit: number | null;
  isInTrial: boolean;
  trialEndsAt: Date | null;
}

// =============================================================================
// FAMILY SUBSCRIPTION SERVICE
// =============================================================================

export const familySubscriptionService = {
  /**
   * Check if Stripe is configured
   */
  isConfigured(): boolean {
    return !!stripe;
  },

  /**
   * Get or create a Stripe customer for a parent
   */
  async getOrCreateCustomer(parentId: string): Promise<string> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        stripeCustomerId: true,
      },
    });

    if (!parent) {
      throw new Error('Parent not found');
    }

    // Return existing customer ID if present
    if (parent.stripeCustomerId) {
      return parent.stripeCustomerId;
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({
      email: parent.email,
      name: [parent.firstName, parent.lastName].filter(Boolean).join(' ') || undefined,
      metadata: {
        parentId: parent.id,
        type: 'family',
      },
    });

    // Save customer ID to database
    await prisma.parent.update({
      where: { id: parentId },
      data: { stripeCustomerId: customer.id },
    });

    logger.info('Created Stripe customer for parent', {
      parentId,
      customerId: customer.id,
    });

    return customer.id;
  },

  /**
   * Create a checkout session for a subscription
   */
  async createCheckoutSession(
    parentId: string,
    tier: SubscriptionTier,
    isAnnual: boolean = false,
    successUrl: string,
    cancelUrl: string
  ): Promise<FamilyCheckoutSessionResult> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    if (tier === 'FREE') {
      throw new Error('Cannot create checkout session for FREE tier');
    }

    // ANNUAL tier should use FAMILY with annual billing
    const effectiveTier = tier === 'ANNUAL' ? 'FAMILY' : tier;
    const effectiveAnnual = tier === 'ANNUAL' ? true : isAnnual;

    const product = getFamilyProductByTier(effectiveTier);
    const priceId = effectiveAnnual ? product.priceIdAnnual : product.priceIdMonthly;

    if (!priceId) {
      throw new Error(`Price ID not configured for ${effectiveTier} ${effectiveAnnual ? 'annual' : 'monthly'}`);
    }

    const customerId = await this.getOrCreateCustomer(parentId);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        parentId,
        tier: effectiveTier,
        isAnnual: effectiveAnnual.toString(),
        type: 'family',
      },
      subscription_data: {
        metadata: {
          parentId,
          tier: effectiveTier,
          type: 'family',
        },
      },
    };

    // Add trial period if configured
    if (product.trialDays > 0) {
      sessionParams.subscription_data!.trial_period_days = product.trialDays;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    logger.info('Created family checkout session', {
      parentId,
      tier: effectiveTier,
      isAnnual: effectiveAnnual,
      sessionId: session.id,
    });

    return {
      sessionId: session.id,
      url: session.url!,
    };
  },

  /**
   * Create a customer portal session for managing subscription
   */
  async createCustomerPortalSession(
    parentId: string,
    returnUrl: string
  ): Promise<FamilyCustomerPortalResult> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    // Get or create customer - handles manually upgraded users who don't have a Stripe customer
    const customerId = await this.getOrCreateCustomer(parentId);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  },

  /**
   * Get current subscription info for a parent
   */
  async getSubscriptionInfo(parentId: string): Promise<FamilySubscriptionInfo | null> {
    if (!stripe) {
      return null;
    }

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionTier: true,
        trialEndsAt: true,
      },
    });

    if (!parent?.stripeSubscriptionId) {
      // Return info for FREE tier (no Stripe subscription)
      const product = getFamilyProductByTier(parent?.subscriptionTier || 'FREE');
      return {
        id: '',
        status: 'active',
        tier: parent?.subscriptionTier || 'FREE',
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        isAnnual: false,
        childLimit: product.childLimit,
        lessonLimit: product.lessonsPerMonth,
        isInTrial: false,
        trialEndsAt: null,
      };
    }

    try {
      const subscription = await stripe.subscriptions.retrieve(parent.stripeSubscriptionId);

      const priceId = subscription.items.data[0]?.price?.id;
      const tier = priceId ? getFamilyTierFromPriceId(priceId) : parent.subscriptionTier;
      const product = getFamilyProductByTier(tier || 'FREE');

      // Stripe API returns current_period_end as a number (Unix timestamp)
      const currentPeriodEnd = (subscription as any).current_period_end as number;
      const trialEnd = subscription.trial_end;

      const isInTrial = subscription.status === 'trialing';
      const trialEndsAt = trialEnd ? new Date(trialEnd * 1000) : null;

      return {
        id: subscription.id,
        status: subscription.status,
        tier: tier || parent.subscriptionTier,
        currentPeriodEnd: new Date(currentPeriodEnd * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        isAnnual: priceId ? isFamilyAnnualSubscription(priceId) : false,
        childLimit: product.childLimit,
        lessonLimit: product.lessonsPerMonth,
        isInTrial,
        trialEndsAt,
      };
    } catch (error) {
      logger.error('Failed to retrieve family subscription', { error, parentId });
      return null;
    }
  },

  /**
   * Cancel a subscription at period end
   */
  async cancelSubscription(parentId: string): Promise<void> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { stripeSubscriptionId: true },
    });

    if (!parent?.stripeSubscriptionId) {
      throw new Error('No active subscription found');
    }

    await stripe.subscriptions.update(parent.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    logger.info('Family subscription set to cancel at period end', {
      parentId,
      subscriptionId: parent.stripeSubscriptionId,
    });
  },

  /**
   * Resume a cancelled subscription (before period end)
   */
  async resumeSubscription(parentId: string): Promise<void> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { stripeSubscriptionId: true },
    });

    if (!parent?.stripeSubscriptionId) {
      throw new Error('No subscription found');
    }

    await stripe.subscriptions.update(parent.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    logger.info('Family subscription resumed', {
      parentId,
      subscriptionId: parent.stripeSubscriptionId,
    });
  },

  // =============================================================================
  // WEBHOOK HANDLERS
  // =============================================================================

  /**
   * Handle subscription created/updated from webhook
   */
  async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    // Only handle family subscriptions
    if (subscription.metadata.type !== 'family') {
      return;
    }

    const parentId = subscription.metadata.parentId;
    if (!parentId) {
      logger.warn('Family subscription has no parentId in metadata', {
        subscriptionId: subscription.id,
      });
      return;
    }

    const priceId = subscription.items.data[0]?.price?.id;
    const tier = priceId ? getFamilyTierFromPriceId(priceId) : null;

    if (!tier) {
      logger.warn('Could not determine tier from price for family subscription', {
        subscriptionId: subscription.id,
        priceId,
      });
      return;
    }

    // Calculate trial end if applicable
    let trialEndsAt: Date | null = null;
    if (subscription.trial_end) {
      trialEndsAt = new Date(subscription.trial_end * 1000);
    }

    // Stripe API returns current_period_end as a number (Unix timestamp)
    const currentPeriodEnd = (subscription as any).current_period_end as number;

    // Determine subscription status
    const subscriptionStatus = (subscription.status === 'active' || subscription.status === 'trialing')
      ? 'ACTIVE' as const
      : 'PAST_DUE' as const;

    // Build update data
    const updateData = {
      subscriptionTier: tier,
      subscriptionStatus,
      stripeSubscriptionId: subscription.id,
      subscriptionExpiresAt: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      trialEndsAt,
    };

    logger.info('Updating parent subscription', {
      parentId,
      subscriptionId: subscription.id,
      updateData: {
        ...updateData,
        subscriptionExpiresAt: updateData.subscriptionExpiresAt?.toISOString(),
        trialEndsAt: updateData.trialEndsAt?.toISOString(),
      },
    });

    // Update parent's subscription info
    try {
      await prisma.parent.update({
        where: { id: parentId },
        data: updateData,
      });

      logger.info('Family subscription created/updated', {
        parentId,
        subscriptionId: subscription.id,
        tier,
        status: subscription.status,
      });
    } catch (error) {
      logger.error('Failed to update parent subscription', {
        parentId,
        subscriptionId: subscription.id,
        updateData: {
          ...updateData,
          subscriptionExpiresAt: updateData.subscriptionExpiresAt?.toISOString(),
          trialEndsAt: updateData.trialEndsAt?.toISOString(),
        },
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  },

  /**
   * Handle subscription deleted from webhook
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    // Only handle family subscriptions
    if (subscription.metadata.type !== 'family') {
      return;
    }

    const parentId = subscription.metadata.parentId;
    if (!parentId) {
      logger.warn('Family subscription has no parentId in metadata', {
        subscriptionId: subscription.id,
      });
      return;
    }

    // Revert to FREE tier
    await prisma.parent.update({
      where: { id: parentId },
      data: {
        subscriptionTier: 'FREE',
        subscriptionStatus: 'ACTIVE',
        stripeSubscriptionId: null,
        subscriptionExpiresAt: null,
        trialEndsAt: null,
      },
    });

    logger.info('Family subscription deleted, reverted to FREE tier', {
      parentId,
      subscriptionId: subscription.id,
    });
  },

  /**
   * Handle checkout session completed from webhook
   */
  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    // Only handle family checkouts
    if (session.metadata?.type !== 'family') {
      return;
    }

    const parentId = session.metadata?.parentId;
    if (!parentId) {
      logger.warn('Family checkout session has no parentId in metadata', {
        sessionId: session.id,
      });
      return;
    }

    // For subscriptions, the subscription.created webhook will handle the update
    logger.info('Family checkout session completed', {
      parentId,
      sessionId: session.id,
      mode: session.mode,
    });
  },

  /**
   * Handle invoice payment failed from webhook
   */
  async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    // Stripe API returns subscription as string or Subscription object
    // Using 'as any' due to Stripe SDK type inconsistencies
    const invoiceAny = invoice as any;
    const subscriptionId = typeof invoiceAny.subscription === 'string'
      ? invoiceAny.subscription
      : invoiceAny.subscription?.id;

    if (!subscriptionId) {
      return;
    }

    // Find parent by subscription ID
    const parent = await prisma.parent.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: { id: true },
    });

    if (parent) {
      await prisma.parent.update({
        where: { id: parent.id },
        data: {
          subscriptionStatus: 'PAST_DUE',
        },
      });

      logger.warn('Family subscription payment failed', {
        parentId: parent.id,
        subscriptionId,
        invoiceId: invoice.id,
      });
    }
  },

  // =============================================================================
  // UTILITIES
  // =============================================================================

  /**
   * Get available plans for display
   */
  getAvailablePlans() {
    return Object.values(FAMILY_SUBSCRIPTION_PRODUCTS).map(product => ({
      tier: product.tier,
      name: product.name,
      childLimit: product.childLimit,
      lessonsPerMonth: product.lessonsPerMonth,
      priceMonthly: product.priceMonthly,
      priceAnnual: product.priceAnnual,
      features: product.features,
      trialDays: product.trialDays,
    }));
  },
};

export default familySubscriptionService;
