/**
 * Stripe Referral Configuration
 *
 * Configuration for referral program coupons and rewards.
 *
 * Referral Incentive Structure:
 * - Referee (new user): 30% off first month
 * - Referrer (existing user):
 *   - Parent: Free month credit ($7.99 or $14.99 depending on tier)
 *   - Teacher: 100 bonus AI credits
 *
 * These coupons need to be created in Stripe Dashboard and IDs stored in env vars.
 */

import { SubscriptionTier, TeacherSubscriptionTier } from '@prisma/client';

// =============================================================================
// ENVIRONMENT VARIABLE LOADING
// =============================================================================

const env = process.env;

// =============================================================================
// COUPON CONFIGURATION
// =============================================================================

export interface ReferralCoupon {
  id: string;
  name: string;
  type: 'percent_off' | 'amount_off';
  value: number; // Percent for percent_off, cents for amount_off
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths?: number; // Only for 'repeating'
  currency?: string; // Only for amount_off
  stripeCouponId: string; // From env var
}

// Referee discount coupons (applied when new user signs up with referral code)
export const REFEREE_COUPONS = {
  // 30% off first month for new parents
  PARENT_30_OFF: {
    id: 'REFER_PARENT_30',
    name: 'Referral: 30% Off First Month',
    type: 'percent_off' as const,
    value: 30,
    duration: 'once' as const,
    stripeCouponId: env.STRIPE_COUPON_REFEREE_PARENT || '',
  },

  // 30% off first month for new teachers
  TEACHER_30_OFF: {
    id: 'REFER_TEACHER_30',
    name: 'Referral: 30% Off First Month (Teacher)',
    type: 'percent_off' as const,
    value: 30,
    duration: 'once' as const,
    stripeCouponId: env.STRIPE_COUPON_REFEREE_TEACHER || '',
  },
} as const;

// Referrer reward coupons (applied when their referral converts)
export const REFERRER_COUPONS = {
  // Free month for Family tier referrer ($7.99)
  FREE_MONTH_FAMILY: {
    id: 'REF_REWARD_FAMILY',
    name: 'Referral Reward: Free Month (Family)',
    type: 'amount_off' as const,
    value: 799, // $7.99 in cents
    duration: 'once' as const,
    currency: 'usd',
    stripeCouponId: env.STRIPE_COUPON_REFERRER_FAMILY || '',
  },

  // Free month for Family Plus tier referrer ($14.99)
  FREE_MONTH_FAMILY_PLUS: {
    id: 'REF_REWARD_FAMILY_PLUS',
    name: 'Referral Reward: Free Month (Family Plus)',
    type: 'amount_off' as const,
    value: 1499, // $14.99 in cents
    duration: 'once' as const,
    currency: 'usd',
    stripeCouponId: env.STRIPE_COUPON_REFERRER_FAMILY_PLUS || '',
  },

  // Free month for Teacher Basic tier referrer ($9.99)
  FREE_MONTH_TEACHER_BASIC: {
    id: 'REF_REWARD_TEACHER_BASIC',
    name: 'Referral Reward: Free Month (Teacher Basic)',
    type: 'amount_off' as const,
    value: 999, // $9.99 in cents
    duration: 'once' as const,
    currency: 'usd',
    stripeCouponId: env.STRIPE_COUPON_REFERRER_TEACHER_BASIC || '',
  },

  // Free month for Teacher Pro tier referrer ($24.99)
  FREE_MONTH_TEACHER_PRO: {
    id: 'REF_REWARD_TEACHER_PRO',
    name: 'Referral Reward: Free Month (Teacher Pro)',
    type: 'amount_off' as const,
    value: 2499, // $24.99 in cents
    duration: 'once' as const,
    currency: 'usd',
    stripeCouponId: env.STRIPE_COUPON_REFERRER_TEACHER_PRO || '',
  },
} as const;

// =============================================================================
// TEACHER BONUS CREDITS
// =============================================================================

// Teachers get bonus AI credits instead of subscription discounts when referring parents
export const TEACHER_REFERRAL_CREDITS = {
  // Credits for referring a parent who converts
  REFER_PARENT: 50,

  // Credits for referring a teacher who converts
  REFER_TEACHER: 100,
};

// =============================================================================
// ATTRIBUTION SETTINGS
// =============================================================================

export const REFERRAL_SETTINGS = {
  // Attribution window in days (how long after clicking referral link is attribution valid)
  ATTRIBUTION_WINDOW_DAYS: 30,

  // Reward expiry in days (how long referrer has to redeem their reward)
  REWARD_EXPIRY_DAYS: 365,

  // Maximum referrals per user per month (to prevent abuse)
  MAX_REFERRALS_PER_MONTH: 50,

  // Minimum subscription duration before referral is credited (prevents abuse)
  MIN_SUBSCRIPTION_DAYS_FOR_CREDIT: 7,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the referee coupon ID for a user type
 */
export function getRefereeCouponId(userType: 'parent' | 'teacher'): string {
  return userType === 'parent'
    ? REFEREE_COUPONS.PARENT_30_OFF.stripeCouponId
    : REFEREE_COUPONS.TEACHER_30_OFF.stripeCouponId;
}

/**
 * Get the referrer coupon for a parent based on their subscription tier
 */
export function getReferrerCouponForParent(
  tier: SubscriptionTier
): typeof REFERRER_COUPONS.FREE_MONTH_FAMILY | typeof REFERRER_COUPONS.FREE_MONTH_FAMILY_PLUS | null {
  switch (tier) {
    case 'FAMILY':
    case 'ANNUAL': // ANNUAL is basically FAMILY with annual billing
      return REFERRER_COUPONS.FREE_MONTH_FAMILY;
    case 'FAMILY_PLUS':
      return REFERRER_COUPONS.FREE_MONTH_FAMILY_PLUS;
    case 'FREE':
    default:
      // FREE tier parents don't have a subscription to credit
      return null;
  }
}

/**
 * Get the referrer coupon for a teacher based on their subscription tier
 */
export function getReferrerCouponForTeacher(
  tier: TeacherSubscriptionTier
): typeof REFERRER_COUPONS.FREE_MONTH_TEACHER_BASIC | typeof REFERRER_COUPONS.FREE_MONTH_TEACHER_PRO | null {
  switch (tier) {
    case 'BASIC':
      return REFERRER_COUPONS.FREE_MONTH_TEACHER_BASIC;
    case 'PROFESSIONAL':
      return REFERRER_COUPONS.FREE_MONTH_TEACHER_PRO;
    case 'FREE':
    default:
      // FREE tier teachers get bonus credits instead
      return null;
  }
}

/**
 * Get the credit amount for a teacher referring someone
 */
export function getTeacherReferralCredits(referredUserType: 'parent' | 'teacher'): number {
  return referredUserType === 'teacher'
    ? TEACHER_REFERRAL_CREDITS.REFER_TEACHER
    : TEACHER_REFERRAL_CREDITS.REFER_PARENT;
}

/**
 * Check if referral coupons are configured
 */
export function isReferralConfigured(): boolean {
  return !!(
    REFEREE_COUPONS.PARENT_30_OFF.stripeCouponId ||
    REFEREE_COUPONS.TEACHER_30_OFF.stripeCouponId
  );
}

/**
 * Get the credit amount in dollars for a reward type
 */
export function getRewardCreditAmount(
  userType: 'parent' | 'teacher',
  tier: SubscriptionTier | TeacherSubscriptionTier
): number {
  if (userType === 'parent') {
    const coupon = getReferrerCouponForParent(tier as SubscriptionTier);
    return coupon ? coupon.value / 100 : 0;
  } else {
    const coupon = getReferrerCouponForTeacher(tier as TeacherSubscriptionTier);
    return coupon ? coupon.value / 100 : 0;
  }
}
