/**
 * Stripe Products Configuration - Family/Student Subscriptions
 *
 * This file contains all Stripe product and price IDs for the FAMILY subscription system.
 * These are separate from teacher subscriptions (see stripeProducts.ts).
 *
 * Price IDs should be set in environment variables and loaded here.
 *
 * Family Pricing Structure (December 2025):
 * - FREE: $0/month - 1 child, 10 lessons/month
 * - FAMILY: $7.99/month or $57.99/year (~40% off, $4.83/month effective) - 2 children, unlimited lessons
 * - FAMILY_PLUS: $14.99/month or $107.99/year (~40% off, $9.00/month effective) - 4 children, unlimited lessons
 */

import { SubscriptionTier } from '@prisma/client';

// =============================================================================
// ENVIRONMENT VARIABLE LOADING
// =============================================================================

const env = process.env;

// =============================================================================
// SUBSCRIPTION PRODUCTS
// =============================================================================

export interface FamilySubscriptionProduct {
  name: string;
  tier: SubscriptionTier;
  childLimit: number;
  lessonsPerMonth: number | null; // null = unlimited
  priceMonthly: number; // USD
  priceAnnual: number; // USD
  priceIdMonthly: string;
  priceIdAnnual: string;
  features: string[];
  trialDays: number;
}

// Only include the 3 main tiers - ANNUAL is handled as FAMILY with annual billing
export const FAMILY_SUBSCRIPTION_PRODUCTS: Record<
  Exclude<SubscriptionTier, 'ANNUAL'>,
  FamilySubscriptionProduct
> = {
  FREE: {
    name: 'Free',
    tier: 'FREE',
    childLimit: 1,
    lessonsPerMonth: 10,
    priceMonthly: 0,
    priceAnnual: 0,
    priceIdMonthly: '', // No subscription needed
    priceIdAnnual: '',
    features: [
      '1 child profile',
      '10 lessons per month',
      'Basic AI tutoring',
      'Progress tracking',
      'Gamification & rewards',
    ],
    trialDays: 0,
  },
  FAMILY: {
    name: 'Family',
    tier: 'FAMILY',
    childLimit: 2,
    lessonsPerMonth: null, // Unlimited
    priceMonthly: 7.99,
    priceAnnual: 57.99, // ~40% savings ($4.83/month effective)
    priceIdMonthly: env.STRIPE_PRICE_FAMILY_MONTHLY || '',
    priceIdAnnual: env.STRIPE_PRICE_FAMILY_ANNUAL || '',
    features: [
      '2 child profiles',
      'Unlimited lessons',
      'Full AI tutoring',
      'Advanced progress analytics',
      'Priority support',
    ],
    trialDays: 7,
  },
  FAMILY_PLUS: {
    name: 'Family Plus',
    tier: 'FAMILY_PLUS',
    childLimit: 4,
    lessonsPerMonth: null, // Unlimited
    priceMonthly: 14.99,
    priceAnnual: 107.99, // ~40% savings ($9.00/month effective)
    priceIdMonthly: env.STRIPE_PRICE_FAMILY_PLUS_MONTHLY || '',
    priceIdAnnual: env.STRIPE_PRICE_FAMILY_PLUS_ANNUAL || '',
    features: [
      '4 child profiles',
      'Unlimited lessons',
      'Advanced AI features',
      'Priority processing',
      'Premium support',
      'Early access to new features',
    ],
    trialDays: 7,
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get family product by tier
 */
export function getFamilyProductByTier(
  tier: SubscriptionTier
): FamilySubscriptionProduct {
  // ANNUAL tier maps to FAMILY with annual billing
  if (tier === 'ANNUAL') {
    return FAMILY_SUBSCRIPTION_PRODUCTS.FAMILY;
  }
  return FAMILY_SUBSCRIPTION_PRODUCTS[tier];
}

/**
 * Get family product by price ID
 */
export function getFamilyProductByPriceId(
  priceId: string
): FamilySubscriptionProduct | null {
  if (!priceId) return null;
  for (const product of Object.values(FAMILY_SUBSCRIPTION_PRODUCTS)) {
    if (product.priceIdMonthly === priceId || product.priceIdAnnual === priceId) {
      return product;
    }
  }
  return null;
}

/**
 * Get tier from price ID
 */
export function getFamilyTierFromPriceId(priceId: string): SubscriptionTier | null {
  const product = getFamilyProductByPriceId(priceId);
  return product?.tier || null;
}

/**
 * Determine if a price ID is for an annual subscription
 */
export function isFamilyAnnualSubscription(priceId: string): boolean {
  if (!priceId) return false;
  for (const product of Object.values(FAMILY_SUBSCRIPTION_PRODUCTS)) {
    if (product.priceIdAnnual === priceId) {
      return true;
    }
  }
  return false;
}

/**
 * Get child limit for a subscription tier
 */
export function getChildLimitForTier(tier: SubscriptionTier): number {
  const product = getFamilyProductByTier(tier);
  return product.childLimit;
}

/**
 * Get lesson limit for a subscription tier
 * Returns null for unlimited
 */
export function getLessonLimitForTier(tier: SubscriptionTier): number | null {
  const product = getFamilyProductByTier(tier);
  return product.lessonsPerMonth;
}

/**
 * Check if a tier has unlimited lessons
 */
export function hasUnlimitedLessons(tier: SubscriptionTier): boolean {
  return getLessonLimitForTier(tier) === null;
}

/**
 * Check if a price ID is for a family subscription
 */
export function isFamilySubscriptionPriceId(priceId: string): boolean {
  return getFamilyProductByPriceId(priceId) !== null;
}

/**
 * Get all available plans for display (excludes FREE for checkout)
 */
export function getAvailableFamilyPlans(): FamilySubscriptionProduct[] {
  return Object.values(FAMILY_SUBSCRIPTION_PRODUCTS);
}

/**
 * Get paid plans only (for checkout options)
 */
export function getPaidFamilyPlans(): FamilySubscriptionProduct[] {
  return Object.values(FAMILY_SUBSCRIPTION_PRODUCTS).filter(
    (product) => product.priceMonthly > 0
  );
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that all required price IDs are configured
 */
export function validateFamilyStripeConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  // Check FAMILY prices
  if (!FAMILY_SUBSCRIPTION_PRODUCTS.FAMILY.priceIdMonthly) {
    missing.push('STRIPE_PRICE_FAMILY_MONTHLY');
  }
  if (!FAMILY_SUBSCRIPTION_PRODUCTS.FAMILY.priceIdAnnual) {
    missing.push('STRIPE_PRICE_FAMILY_ANNUAL');
  }

  // Check FAMILY_PLUS prices
  if (!FAMILY_SUBSCRIPTION_PRODUCTS.FAMILY_PLUS.priceIdMonthly) {
    missing.push('STRIPE_PRICE_FAMILY_PLUS_MONTHLY');
  }
  if (!FAMILY_SUBSCRIPTION_PRODUCTS.FAMILY_PLUS.priceIdAnnual) {
    missing.push('STRIPE_PRICE_FAMILY_PLUS_ANNUAL');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  FAMILY_SUBSCRIPTION_PRODUCTS,
  getFamilyProductByTier,
  getFamilyProductByPriceId,
  getFamilyTierFromPriceId,
  isFamilyAnnualSubscription,
  getChildLimitForTier,
  getLessonLimitForTier,
  hasUnlimitedLessons,
  isFamilySubscriptionPriceId,
  getAvailableFamilyPlans,
  getPaidFamilyPlans,
  validateFamilyStripeConfig,
};
