/**
 * Stripe Service
 * Handles Stripe payment operations for credit card consent verification
 */

import Stripe from 'stripe';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

// Initialize Stripe client
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, {
      apiVersion: '2025-11-17.clover',
    })
  : null;

// Consent verification amount in cents ($1.00 USD)
// Note: Must be at least $1.00 to meet minimum after currency conversion
const CONSENT_VERIFICATION_AMOUNT = 100;
const CONSENT_VERIFICATION_CURRENCY = 'usd';

export const stripeService = {
  /**
   * Check if Stripe is configured
   */
  isConfigured(): boolean {
    return !!stripe;
  },

  /**
   * Create a PaymentIntent for consent verification
   * This creates a $0.50 charge that will be immediately refunded after verification
   */
  async createConsentPaymentIntent(
    parentId: string,
    consentId: string,
    email: string
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: CONSENT_VERIFICATION_AMOUNT,
        currency: CONSENT_VERIFICATION_CURRENCY,
        description: 'OrbitLearn Parental Consent Verification',
        metadata: {
          type: 'consent_verification',
          parentId,
          consentId,
        },
        receipt_email: email,
        // Capture immediately
        capture_method: 'automatic',
        // Statement descriptor (max 22 chars)
        statement_descriptor: 'ORBITLEARN VERIFY',
        statement_descriptor_suffix: 'CONSENT',
      });

      logger.info('Created consent PaymentIntent', {
        paymentIntentId: paymentIntent.id,
        parentId,
        consentId,
      });

      return {
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      logger.error('Failed to create consent PaymentIntent', { error, parentId });
      throw error;
    }
  },

  /**
   * Verify a PaymentIntent succeeded
   */
  async verifyPaymentIntent(paymentIntentId: string): Promise<{
    success: boolean;
    status: string;
    metadata?: Record<string, string>;
  }> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      return {
        success: paymentIntent.status === 'succeeded',
        status: paymentIntent.status,
        metadata: paymentIntent.metadata as Record<string, string>,
      };
    } catch (error) {
      logger.error('Failed to verify PaymentIntent', { error, paymentIntentId });
      throw error;
    }
  },

  /**
   * Refund a consent verification charge
   * Called automatically after successful verification
   */
  async refundConsentCharge(paymentIntentId: string): Promise<{ refundId: string }> {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          type: 'consent_verification_refund',
          reason: 'Automatic refund after successful parental consent verification',
        },
      });

      logger.info('Refunded consent charge', {
        refundId: refund.id,
        paymentIntentId,
        status: refund.status,
      });

      return { refundId: refund.id };
    } catch (error) {
      logger.error('Failed to refund consent charge', { error, paymentIntentId });
      throw error;
    }
  },

  /**
   * Construct and verify Stripe webhook event
   * @param payload - Raw request body
   * @param signature - Stripe signature header
   * @param webhookType - Which webhook secret to use: 'default', 'consent', or 'teacher'
   */
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookType: 'default' | 'consent' | 'teacher' = 'default'
  ): Stripe.Event {
    if (!stripe) {
      throw new Error('Stripe is not configured');
    }

    let secret: string | undefined;
    switch (webhookType) {
      case 'consent':
        secret = config.stripe.webhookSecretCC;
        break;
      case 'teacher':
        secret = config.stripe.webhookSecretTeacher;
        break;
      default:
        secret = config.stripe.webhookSecret;
    }

    if (!secret) {
      throw new Error(`Stripe webhook secret for '${webhookType}' is not configured`);
    }

    return stripe.webhooks.constructEvent(payload, signature, secret);
  },

  /**
   * Get Stripe instance for advanced operations
   */
  getStripe(): Stripe | null {
    return stripe;
  },
};

export default stripeService;
