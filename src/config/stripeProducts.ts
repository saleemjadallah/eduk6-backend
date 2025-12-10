/**
 * Stripe Products Configuration - Teacher Portal
 *
 * This file contains all Stripe product and price IDs for the TEACHER subscription system.
 * These are separate from student/family subscriptions for the AI tutor section.
 *
 * Price IDs should be set in environment variables and loaded here.
 *
 * Teacher Pricing Structure (December 2025):
 * - FREE: $0/month - 100 credits (100K tokens)
 * - BASIC: $9.99/month or $95.90/year - 500 credits (500K tokens)
 * - PROFESSIONAL: $24.99/month or $239.90/year - 2,000 credits (2M tokens)
 *
 * Teacher Credit Packs (one-time):
 * - 100 credits: $4.99
 * - 300 credits: $12.99
 * - 500 credits: $19.99
 */

import { TeacherSubscriptionTier } from '@prisma/client';

// =============================================================================
// ENVIRONMENT VARIABLE LOADING
// =============================================================================

const env = process.env;

// =============================================================================
// SUBSCRIPTION PRODUCTS
// =============================================================================

export interface SubscriptionProduct {
  name: string;
  tier: TeacherSubscriptionTier;
  credits: number;
  tokens: number;
  priceMonthly: number;    // USD
  priceAnnual: number;     // USD
  priceIdMonthly: string;
  priceIdAnnual: string;
  features: string[];
  trialDays: number;
}

export const SUBSCRIPTION_PRODUCTS: Record<TeacherSubscriptionTier, SubscriptionProduct> = {
  FREE: {
    name: 'Teacher Starter',
    tier: 'FREE',
    credits: 100,
    tokens: 100000,
    priceMonthly: 0,
    priceAnnual: 0,
    priceIdMonthly: '',  // No subscription needed
    priceIdAnnual: '',
    features: [
      '100 credits per month',
      'Basic content generation',
      'Quiz and flashcard creation',
      'Community support',
    ],
    trialDays: 0,
  },
  BASIC: {
    name: 'Teacher Plus',
    tier: 'BASIC',
    credits: 500,
    tokens: 500000,
    priceMonthly: 9.99,
    priceAnnual: 95.90,
    priceIdMonthly: env.STRIPE_PRICE_TEACHER_BASIC_MONTHLY || '',
    priceIdAnnual: env.STRIPE_PRICE_TEACHER_BASIC_ANNUAL || '',
    features: [
      '500 credits per month',
      'All content types',
      'Full lesson generation',
      'Credit rollover (up to 500)',
      'Email support',
    ],
    trialDays: 7,
  },
  PROFESSIONAL: {
    name: 'Teacher Pro',
    tier: 'PROFESSIONAL',
    credits: 2000,
    tokens: 2000000,
    priceMonthly: 24.99,
    priceAnnual: 239.90,
    priceIdMonthly: env.STRIPE_PRICE_TEACHER_PRO_MONTHLY || '',
    priceIdAnnual: env.STRIPE_PRICE_TEACHER_PRO_ANNUAL || '',
    features: [
      '2,000 credits per month',
      'All content types',
      'Priority processing',
      'AI-powered grading',
      'Infographic generation',
      'Credit rollover (up to 2,000)',
      'Priority email support',
    ],
    trialDays: 7,
  },
};

// =============================================================================
// CREDIT PACKS (ONE-TIME PURCHASES)
// =============================================================================

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  price: number;           // USD
  pricePerCredit: number;  // USD
  savings: string;         // Display text
  priceId: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: 'teacher_pack_100',
    name: 'Teacher Credit Pack - 100',
    credits: 100,
    price: 4.99,
    pricePerCredit: 0.05,
    savings: '',
    priceId: env.STRIPE_PRICE_TEACHER_CREDITS_100 || '',
  },
  {
    id: 'teacher_pack_300',
    name: 'Teacher Credit Pack - 300',
    credits: 300,
    price: 12.99,
    pricePerCredit: 0.043,
    savings: 'Save 13%',
    priceId: env.STRIPE_PRICE_TEACHER_CREDITS_300 || '',
  },
  {
    id: 'teacher_pack_500',
    name: 'Teacher Credit Pack - 500',
    credits: 500,
    price: 19.99,
    pricePerCredit: 0.04,
    savings: 'Save 20%',
    priceId: env.STRIPE_PRICE_TEACHER_CREDITS_500 || '',
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get product by tier
 */
export function getProductByTier(tier: TeacherSubscriptionTier): SubscriptionProduct {
  return SUBSCRIPTION_PRODUCTS[tier];
}

/**
 * Get product by price ID
 */
export function getProductByPriceId(priceId: string): SubscriptionProduct | null {
  for (const product of Object.values(SUBSCRIPTION_PRODUCTS)) {
    if (product.priceIdMonthly === priceId || product.priceIdAnnual === priceId) {
      return product;
    }
  }
  return null;
}

/**
 * Get credit pack by price ID
 */
export function getCreditPackByPriceId(priceId: string): CreditPack | null {
  return CREDIT_PACKS.find(pack => pack.priceId === priceId) || null;
}

/**
 * Get credit pack by ID
 */
export function getCreditPackById(packId: string): CreditPack | null {
  return CREDIT_PACKS.find(pack => pack.id === packId) || null;
}

/**
 * Check if a price ID is for a subscription
 */
export function isSubscriptionPriceId(priceId: string): boolean {
  return getProductByPriceId(priceId) !== null;
}

/**
 * Check if a price ID is for a credit pack
 */
export function isCreditPackPriceId(priceId: string): boolean {
  return getCreditPackByPriceId(priceId) !== null;
}

/**
 * Determine if a price ID is for an annual subscription
 */
export function isAnnualSubscription(priceId: string): boolean {
  for (const product of Object.values(SUBSCRIPTION_PRODUCTS)) {
    if (product.priceIdAnnual === priceId) {
      return true;
    }
  }
  return false;
}

/**
 * Get tier from price ID
 */
export function getTierFromPriceId(priceId: string): TeacherSubscriptionTier | null {
  const product = getProductByPriceId(priceId);
  return product?.tier || null;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that all required price IDs are configured
 */
export function validateStripeConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  // Check subscription prices (only BASIC and PROFESSIONAL need Stripe)
  if (!SUBSCRIPTION_PRODUCTS.BASIC.priceIdMonthly) {
    missing.push('STRIPE_PRICE_TEACHER_BASIC_MONTHLY');
  }
  if (!SUBSCRIPTION_PRODUCTS.BASIC.priceIdAnnual) {
    missing.push('STRIPE_PRICE_TEACHER_BASIC_ANNUAL');
  }
  if (!SUBSCRIPTION_PRODUCTS.PROFESSIONAL.priceIdMonthly) {
    missing.push('STRIPE_PRICE_TEACHER_PRO_MONTHLY');
  }
  if (!SUBSCRIPTION_PRODUCTS.PROFESSIONAL.priceIdAnnual) {
    missing.push('STRIPE_PRICE_TEACHER_PRO_ANNUAL');
  }

  // Check credit pack prices
  for (const pack of CREDIT_PACKS) {
    if (!pack.priceId) {
      missing.push(`STRIPE_PRICE_TEACHER_CREDITS_${pack.credits}`);
    }
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
  SUBSCRIPTION_PRODUCTS,
  CREDIT_PACKS,
  getProductByTier,
  getProductByPriceId,
  getCreditPackByPriceId,
  getCreditPackById,
  isSubscriptionPriceId,
  isCreditPackPriceId,
  isAnnualSubscription,
  getTierFromPriceId,
  validateStripeConfig,
};
