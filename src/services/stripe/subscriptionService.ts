/**
 * Teacher Subscription Service
 *
 * Handles Stripe subscription operations for teacher subscriptions:
 * - Creating checkout sessions for new subscriptions
 * - Managing subscription lifecycle (upgrades, downgrades, cancellations)
 * - Processing credit pack purchases
 * - Customer portal access
 */

import Stripe from 'stripe';
import { prisma } from '../../config/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { TeacherSubscriptionTier } from '@prisma/client';
import {
  getProductByTier,
  getProductByPriceId,
  getCreditPackByPriceId,
  isAnnualSubscription,
  getTierFromPriceId,
  SUBSCRIPTION_PRODUCTS,
  CREDIT_PACKS,
} from '../../config/stripeProducts.js';
import { quotaService, creditsToTokens } from '../teacher/quotaService.js';

// Initialize Stripe client
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

// =============================================================================
// TYPES
// =============================================================================

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface CustomerPortalResult {
  url: string;
}

export interface SubscriptionInfo {
  id: string;
  status: string;
  tier: TeacherSubscriptionTier;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  isAnnual: boolean;
}

// =============================================================================
// SUBSCRIPTION SERVICE
// =============================================================================

export const subscriptionService = {
  /**
   * Check if Stripe is configured
   */
  isConfigured(): boolean {
    return !!stripe;
  },

  /**
   * Get or create a Stripe customer for a teacher
   */
  async getOrCreateCustomer(teacherId: string): Promise<string> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        stripeCustomerId: true,
      },
    });

    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Return existing customer ID if present
    if (teacher.stripeCustomerId) {
      return teacher.stripeCustomerId;
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({
      email: teacher.email,
      name: [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || undefined,
      metadata: {
        teacherId: teacher.id,
        type: 'teacher',
      },
    });

    // Save customer ID to database
    await prisma.teacher.update({
      where: { id: teacherId },
      data: { stripeCustomerId: customer.id },
    });

    logger.info('Created Stripe customer for teacher', {
      teacherId,
      customerId: customer.id,
    });

    return customer.id;
  },

  /**
   * Create a checkout session for a subscription
   */
  async createCheckoutSession(
    teacherId: string,
    tier: TeacherSubscriptionTier,
    isAnnual: boolean = false,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSessionResult> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    if (tier === 'FREE') {
      throw new Error('Cannot create checkout session for FREE tier');
    }

    const product = getProductByTier(tier);
    const priceId = isAnnual ? product.priceIdAnnual : product.priceIdMonthly;

    if (!priceId) {
      throw new Error(`Price ID not configured for ${tier} ${isAnnual ? 'annual' : 'monthly'}`);
    }

    const customerId = await this.getOrCreateCustomer(teacherId);

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
        teacherId,
        tier,
        isAnnual: isAnnual.toString(),
      },
      subscription_data: {
        metadata: {
          teacherId,
          tier,
        },
      },
    };

    // Add trial period if configured
    if (product.trialDays > 0) {
      sessionParams.subscription_data!.trial_period_days = product.trialDays;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    logger.info('Created checkout session', {
      teacherId,
      tier,
      isAnnual,
      sessionId: session.id,
    });

    return {
      sessionId: session.id,
      url: session.url!,
    };
  },

  /**
   * Create a checkout session for a credit pack purchase
   */
  async createCreditPackCheckoutSession(
    teacherId: string,
    packId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSessionResult> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const pack = CREDIT_PACKS.find(p => p.id === packId);
    if (!pack) {
      throw new Error(`Credit pack not found: ${packId}`);
    }

    if (!pack.priceId) {
      throw new Error(`Price ID not configured for credit pack: ${packId}`);
    }

    const customerId = await this.getOrCreateCustomer(teacherId);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [
        {
          price: pack.priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        teacherId,
        type: 'credit_pack',
        packId,
        credits: pack.credits.toString(),
      },
    });

    logger.info('Created credit pack checkout session', {
      teacherId,
      packId,
      credits: pack.credits,
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
    teacherId: string,
    returnUrl: string
  ): Promise<CustomerPortalResult> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { stripeCustomerId: true },
    });

    if (!teacher?.stripeCustomerId) {
      throw new Error('No Stripe customer found for teacher');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: teacher.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  },

  /**
   * Get current subscription info for a teacher
   */
  async getSubscriptionInfo(teacherId: string): Promise<SubscriptionInfo | null> {
    if (!stripe) {
      return null;
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionTier: true,
      },
    });

    if (!teacher?.stripeSubscriptionId) {
      return null;
    }

    try {
      const subscription = await stripe.subscriptions.retrieve(teacher.stripeSubscriptionId);

      const priceId = subscription.items.data[0]?.price?.id;
      const tier = priceId ? getTierFromPriceId(priceId) : teacher.subscriptionTier;

      // Stripe API returns current_period_end as a number (Unix timestamp)
      const currentPeriodEnd = (subscription as any).current_period_end as number;

      return {
        id: subscription.id,
        status: subscription.status,
        tier: tier || teacher.subscriptionTier,
        currentPeriodEnd: new Date(currentPeriodEnd * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        isAnnual: priceId ? isAnnualSubscription(priceId) : false,
      };
    } catch (error) {
      logger.error('Failed to retrieve subscription', { error, teacherId });
      return null;
    }
  },

  /**
   * Cancel a subscription at period end
   */
  async cancelSubscription(teacherId: string): Promise<void> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { stripeSubscriptionId: true },
    });

    if (!teacher?.stripeSubscriptionId) {
      throw new Error('No active subscription found');
    }

    await stripe.subscriptions.update(teacher.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    logger.info('Subscription set to cancel at period end', {
      teacherId,
      subscriptionId: teacher.stripeSubscriptionId,
    });
  },

  /**
   * Resume a cancelled subscription (before period end)
   */
  async resumeSubscription(teacherId: string): Promise<void> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { stripeSubscriptionId: true },
    });

    if (!teacher?.stripeSubscriptionId) {
      throw new Error('No subscription found');
    }

    await stripe.subscriptions.update(teacher.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    logger.info('Subscription resumed', {
      teacherId,
      subscriptionId: teacher.stripeSubscriptionId,
    });
  },

  // =============================================================================
  // WEBHOOK HANDLERS
  // =============================================================================

  /**
   * Handle subscription created/updated from webhook
   */
  async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    const teacherId = subscription.metadata.teacherId;
    if (!teacherId) {
      logger.warn('Subscription has no teacherId in metadata', {
        subscriptionId: subscription.id,
      });
      return;
    }

    const priceId = subscription.items.data[0]?.price?.id;
    const tier = priceId ? getTierFromPriceId(priceId) : null;

    if (!tier) {
      logger.warn('Could not determine tier from price', {
        subscriptionId: subscription.id,
        priceId,
      });
      return;
    }

    const product = getProductByTier(tier);

    // Calculate trial end if applicable
    let trialEndsAt: Date | null = null;
    if (subscription.trial_end) {
      trialEndsAt = new Date(subscription.trial_end * 1000);
    }

    // Stripe API returns current_period_end as a number (Unix timestamp)
    const currentPeriodEnd = (subscription as any).current_period_end as number;

    // Update teacher's subscription info
    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        subscriptionTier: tier,
        subscriptionStatus: subscription.status === 'active' || subscription.status === 'trialing' ? 'ACTIVE' : 'PAST_DUE',
        stripeSubscriptionId: subscription.id,
        subscriptionExpiresAt: new Date(currentPeriodEnd * 1000),
        monthlyTokenQuota: BigInt(creditsToTokens(product.credits)),
        trialEndsAt,
      },
    });

    logger.info('Subscription created/updated', {
      teacherId,
      subscriptionId: subscription.id,
      tier,
      status: subscription.status,
    });
  },

  /**
   * Handle subscription deleted from webhook
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const teacherId = subscription.metadata.teacherId;
    if (!teacherId) {
      logger.warn('Subscription has no teacherId in metadata', {
        subscriptionId: subscription.id,
      });
      return;
    }

    // Revert to FREE tier
    const freeProduct = getProductByTier('FREE');

    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        subscriptionTier: 'FREE',
        subscriptionStatus: 'ACTIVE',
        stripeSubscriptionId: null,
        subscriptionExpiresAt: null,
        monthlyTokenQuota: BigInt(creditsToTokens(freeProduct.credits)),
        trialEndsAt: null,
      },
    });

    logger.info('Subscription deleted, reverted to FREE tier', {
      teacherId,
      subscriptionId: subscription.id,
    });
  },

  /**
   * Handle checkout session completed from webhook
   */
  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const teacherId = session.metadata?.teacherId;
    if (!teacherId) {
      logger.warn('Checkout session has no teacherId in metadata', {
        sessionId: session.id,
      });
      return;
    }

    // Check if this is a credit pack purchase
    if (session.metadata?.type === 'credit_pack') {
      const credits = parseInt(session.metadata.credits || '0', 10);
      if (credits > 0) {
        await quotaService.addBonusCredits(teacherId, credits);

        logger.info('Credit pack purchased', {
          teacherId,
          credits,
          sessionId: session.id,
        });
      }
      return;
    }

    // For subscriptions, the subscription.created webhook will handle the update
    logger.info('Checkout session completed', {
      teacherId,
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

    // Find teacher by subscription ID
    const teacher = await prisma.teacher.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: { id: true },
    });

    if (teacher) {
      await prisma.teacher.update({
        where: { id: teacher.id },
        data: {
          subscriptionStatus: 'PAST_DUE',
        },
      });

      logger.warn('Subscription payment failed', {
        teacherId: teacher.id,
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
    return Object.values(SUBSCRIPTION_PRODUCTS).map(product => ({
      tier: product.tier,
      name: product.name,
      credits: product.credits,
      priceMonthly: product.priceMonthly,
      priceAnnual: product.priceAnnual,
      features: product.features,
      trialDays: product.trialDays,
    }));
  },

  /**
   * Get available credit packs for display
   */
  getAvailableCreditPacks() {
    return CREDIT_PACKS.map(pack => ({
      id: pack.id,
      name: pack.name,
      credits: pack.credits,
      price: pack.price,
      pricePerCredit: pack.pricePerCredit,
      savings: pack.savings,
    }));
  },
};

export default subscriptionService;
