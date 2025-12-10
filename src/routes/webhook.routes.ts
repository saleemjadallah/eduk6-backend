/**
 * Stripe Webhook Routes
 * Handles webhook events from Stripe for:
 * - Consent verification (parent/child)
 * - Teacher subscriptions
 * - Credit pack purchases
 */

import { Router, Request, Response } from 'express';
import { stripeService } from '../services/stripe/index.js';
import { subscriptionService } from '../services/stripe/subscriptionService.js';
import { consentService } from '../services/auth/consentService.js';
import { logger } from '../utils/logger.js';
import Stripe from 'stripe';

const router = Router();

/**
 * Stripe webhook for credit card consent verification
 * POST /api/webhooks/stripe-consent
 *
 * Note: This endpoint uses raw body for signature verification
 */
router.post('/stripe-consent', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;

  if (!signature) {
    logger.warn('Stripe webhook received without signature');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    // Construct and verify the event using the CC-specific webhook secret
    event = stripeService.constructWebhookEvent(
      req.body, // Raw body (needs raw body parser middleware)
      signature,
      'consent' // Use consent webhook secret
    );
  } catch (err: any) {
    logger.error('Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  logger.info('Stripe webhook received', { type: event.type, id: event.id });

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const { consentId, parentId, type } = paymentIntent.metadata;

        logger.info('Payment intent succeeded', {
          paymentIntentId: paymentIntent.id,
          consentId,
          parentId,
          type,
        });

        // If this is for consent verification, we handle it via the API call
        // The webhook is mainly for logging and backup verification
        // The actual consent verification happens when the frontend calls verifyCreditCardConsent

        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const { consentId, parentId } = paymentIntent.metadata;

        logger.warn('Payment intent failed', {
          paymentIntentId: paymentIntent.id,
          consentId,
          parentId,
          error: paymentIntent.last_payment_error?.message,
        });

        // Optionally mark the consent as failed
        if (consentId) {
          try {
            // We could update the consent status here, but typically
            // the frontend will handle the error and show appropriate UI
          } catch (updateError) {
            logger.error('Failed to update consent status on payment failure', { updateError });
          }
        }

        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        logger.info('Charge refunded', {
          chargeId: charge.id,
          paymentIntentId: charge.payment_intent,
          amount: charge.amount_refunded,
        });
        break;
      }

      default:
        logger.debug('Unhandled Stripe event type', { type: event.type });
    }

    // Return 200 to acknowledge receipt of the event
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error processing Stripe webhook', { error, eventType: event.type });
    // Still return 200 to prevent Stripe from retrying
    // Log the error for manual investigation
    res.status(200).json({ received: true, error: 'Processing error logged' });
  }
});

/**
 * Stripe webhook for teacher subscriptions
 * POST /api/webhooks/stripe-subscription
 *
 * Handles:
 * - checkout.session.completed (subscription or credit pack purchase)
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - invoice.payment_failed
 */
router.post('/stripe-subscription', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;

  if (!signature) {
    logger.warn('Stripe subscription webhook received without signature');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    // Construct and verify the event using the teacher webhook secret
    event = stripeService.constructWebhookEvent(
      req.body,
      signature,
      'teacher' // Use teacher subscription webhook secret
    );
  } catch (err: any) {
    logger.error('Stripe subscription webhook signature verification failed', { error: err.message });
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  logger.info('Stripe subscription webhook received', { type: event.type, id: event.id });

  try {
    switch (event.type) {
      // ==========================================================================
      // CHECKOUT EVENTS
      // ==========================================================================
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        logger.info('Checkout session completed', {
          sessionId: session.id,
          mode: session.mode,
          metadata: session.metadata,
        });

        await subscriptionService.handleCheckoutCompleted(session);
        break;
      }

      // ==========================================================================
      // SUBSCRIPTION EVENTS
      // ==========================================================================
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;

        logger.info('Subscription created/updated', {
          subscriptionId: subscription.id,
          status: subscription.status,
          metadata: subscription.metadata,
        });

        await subscriptionService.handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        logger.info('Subscription deleted', {
          subscriptionId: subscription.id,
          metadata: subscription.metadata,
        });

        await subscriptionService.handleSubscriptionDeleted(subscription);
        break;
      }

      // ==========================================================================
      // INVOICE EVENTS
      // ==========================================================================
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        // Stripe API returns subscription as string or Subscription object
        // Using 'as any' due to Stripe SDK type inconsistencies
        const invoiceAny = invoice as any;
        const subscriptionId = typeof invoiceAny.subscription === 'string'
          ? invoiceAny.subscription
          : invoiceAny.subscription?.id;

        logger.warn('Invoice payment failed', {
          invoiceId: invoice.id,
          subscriptionId,
          customerId: invoice.customer,
        });

        await subscriptionService.handlePaymentFailed(invoice);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        // Stripe API returns subscription as string or Subscription object
        // Using 'as any' due to Stripe SDK type inconsistencies
        const invoiceAny = invoice as any;
        const subscriptionId = typeof invoiceAny.subscription === 'string'
          ? invoiceAny.subscription
          : invoiceAny.subscription?.id;

        logger.info('Invoice paid', {
          invoiceId: invoice.id,
          subscriptionId,
          amountPaid: invoice.amount_paid,
        });
        // Subscription update handled by customer.subscription.updated
        break;
      }

      default:
        logger.debug('Unhandled Stripe subscription event type', { type: event.type });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error processing Stripe subscription webhook', { error, eventType: event.type });
    res.status(200).json({ received: true, error: 'Processing error logged' });
  }
});

export default router;
