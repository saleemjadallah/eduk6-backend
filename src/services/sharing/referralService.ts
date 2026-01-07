/**
 * Referral Service
 *
 * Handles referral code generation, validation, and tracking:
 * - Generate unique referral codes for parents and teachers
 * - Validate referral codes during signup
 * - Track referral conversions
 * - Manage referral rewards
 */

import crypto from 'crypto';
import { prisma } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import {
  ReferralStatus,
  ShareChannel,
  RewardType,
  RewardStatus,
  SubscriptionTier,
  TeacherSubscriptionTier,
} from '@prisma/client';

// =============================================================================
// TYPES
// =============================================================================

export interface ReferralCodeInfo {
  code: string;
  totalReferrals: number;
  successfulReferrals: number;
  isActive: boolean;
  createdAt: Date;
}

export interface ReferralStats {
  totalReferrals: number;
  pendingReferrals: number;
  convertedReferrals: number;
  totalRewardsEarned: number;
  pendingRewards: number;
}

export interface CreateReferralResult {
  referralId: string;
  referralCodeId: string;
  expiresAt: Date;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Attribution window in days
const ATTRIBUTION_WINDOW_DAYS = 30;

// Referral code format: NAME-XXXX (readable, opaque)
const CODE_SUFFIX_LENGTH = 4;
const CODE_SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (0,O,1,I)

// =============================================================================
// REFERRAL CODE SERVICE
// =============================================================================

export const referralService = {
  /**
   * Generate a unique referral code for a parent
   */
  async generateCodeForParent(parentId: string): Promise<ReferralCodeInfo> {
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { id: true, firstName: true, referralCode: true },
    });

    if (!parent) {
      throw new Error('Parent not found');
    }

    // Return existing code if already generated
    if (parent.referralCode) {
      return {
        code: parent.referralCode.code,
        totalReferrals: parent.referralCode.totalReferrals,
        successfulReferrals: parent.referralCode.successfulReferrals,
        isActive: parent.referralCode.isActive,
        createdAt: parent.referralCode.createdAt,
      };
    }

    // Generate unique code
    const code = await generateUniqueCode(parent.firstName || 'ORBIT');

    const referralCode = await prisma.referralCode.create({
      data: {
        code,
        parentId,
      },
    });

    logger.info('Generated referral code for parent', { parentId, code });

    return {
      code: referralCode.code,
      totalReferrals: referralCode.totalReferrals,
      successfulReferrals: referralCode.successfulReferrals,
      isActive: referralCode.isActive,
      createdAt: referralCode.createdAt,
    };
  },

  /**
   * Generate a unique referral code for a teacher
   */
  async generateCodeForTeacher(teacherId: string): Promise<ReferralCodeInfo> {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: { id: true, firstName: true, referralCode: true },
    });

    if (!teacher) {
      throw new Error('Teacher not found');
    }

    // Return existing code if already generated
    if (teacher.referralCode) {
      return {
        code: teacher.referralCode.code,
        totalReferrals: teacher.referralCode.totalReferrals,
        successfulReferrals: teacher.referralCode.successfulReferrals,
        isActive: teacher.referralCode.isActive,
        createdAt: teacher.referralCode.createdAt,
      };
    }

    // Generate unique code
    const code = await generateUniqueCode(teacher.firstName || 'TEACH');

    const referralCode = await prisma.referralCode.create({
      data: {
        code,
        teacherId,
      },
    });

    logger.info('Generated referral code for teacher', { teacherId, code });

    return {
      code: referralCode.code,
      totalReferrals: referralCode.totalReferrals,
      successfulReferrals: referralCode.successfulReferrals,
      isActive: referralCode.isActive,
      createdAt: referralCode.createdAt,
    };
  },

  /**
   * Validate a referral code (public endpoint for signup page)
   */
  async validateCode(code: string): Promise<{
    isValid: boolean;
    referralCodeId?: string;
    ownerType?: 'parent' | 'teacher';
  }> {
    const referralCode = await prisma.referralCode.findUnique({
      where: { code: code.toUpperCase() },
      select: {
        id: true,
        isActive: true,
        parentId: true,
        teacherId: true,
      },
    });

    if (!referralCode || !referralCode.isActive) {
      return { isValid: false };
    }

    return {
      isValid: true,
      referralCodeId: referralCode.id,
      ownerType: referralCode.parentId ? 'parent' : 'teacher',
    };
  },

  /**
   * Create a referral record when a user signs up with a referral code
   */
  async createReferral(
    referralCodeId: string,
    referredUserId: string,
    userType: 'parent' | 'teacher',
    channel: ShareChannel = 'COPY_LINK'
  ): Promise<CreateReferralResult> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ATTRIBUTION_WINDOW_DAYS);

    const referralData: any = {
      referralCodeId,
      channel,
      status: 'SIGNED_UP' as ReferralStatus,
      signedUpAt: new Date(),
      expiresAt,
    };

    if (userType === 'parent') {
      referralData.referredParentId = referredUserId;
    } else {
      referralData.referredTeacherId = referredUserId;
    }

    const referral = await prisma.referral.create({
      data: referralData,
    });

    // Increment total referrals count
    await prisma.referralCode.update({
      where: { id: referralCodeId },
      data: { totalReferrals: { increment: 1 } },
    });

    logger.info('Created referral record', {
      referralId: referral.id,
      referralCodeId,
      referredUserId,
      userType,
      channel,
    });

    return {
      referralId: referral.id,
      referralCodeId,
      expiresAt,
    };
  },

  /**
   * Update referral status when user starts trial
   */
  async updateToTrialing(referredUserId: string, userType: 'parent' | 'teacher'): Promise<void> {
    const whereClause =
      userType === 'parent'
        ? { referredParentId: referredUserId }
        : { referredTeacherId: referredUserId };

    await prisma.referral.updateMany({
      where: {
        ...whereClause,
        status: 'SIGNED_UP',
      },
      data: {
        status: 'TRIALING',
      },
    });

    logger.info('Updated referral to trialing', { referredUserId, userType });
  },

  /**
   * Mark referral as converted and trigger reward creation
   * Called from subscription webhook when user becomes paid subscriber
   */
  async markAsConverted(
    referredUserId: string,
    userType: 'parent' | 'teacher'
  ): Promise<void> {
    const whereClause =
      userType === 'parent'
        ? { referredParentId: referredUserId }
        : { referredTeacherId: referredUserId };

    const referral = await prisma.referral.findFirst({
      where: {
        ...whereClause,
        status: { in: ['SIGNED_UP', 'TRIALING'] },
        expiresAt: { gte: new Date() }, // Within attribution window
      },
      include: {
        referralCode: {
          include: {
            parent: { select: { id: true, subscriptionTier: true } },
            teacher: { select: { id: true, subscriptionTier: true } },
          },
        },
      },
    });

    if (!referral) {
      logger.debug('No active referral found for conversion', { referredUserId, userType });
      return;
    }

    // Update referral status
    await prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'CONVERTED',
        subscribedAt: new Date(),
      },
    });

    // Increment successful referrals count
    await prisma.referralCode.update({
      where: { id: referral.referralCodeId },
      data: { successfulReferrals: { increment: 1 } },
    });

    // Create reward for referrer
    await this.createReferrerReward(referral);

    logger.info('Referral marked as converted', {
      referralId: referral.id,
      referredUserId,
      userType,
    });
  },

  /**
   * Create reward for the referrer after successful conversion
   */
  async createReferrerReward(referral: any): Promise<void> {
    const referralCode = referral.referralCode;
    const isParentReferrer = !!referralCode.parentId;

    let rewardData: any = {
      referralId: referral.id,
      status: 'AVAILABLE' as RewardStatus,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year expiry
    };

    if (isParentReferrer) {
      // Parent referrer gets free month credit
      const parentTier = referralCode.parent?.subscriptionTier || 'FAMILY';
      const creditAmount = parentTier === 'FAMILY_PLUS' ? 14.99 : 7.99;

      rewardData = {
        ...rewardData,
        parentId: referralCode.parentId,
        rewardType: 'SUBSCRIPTION_CREDIT' as RewardType,
        amount: creditAmount,
        description: `Free month credit for successful referral ($${creditAmount})`,
      };
    } else {
      // Teacher referrer gets bonus credits
      rewardData = {
        ...rewardData,
        teacherId: referralCode.teacherId,
        rewardType: 'TEACHER_CREDITS' as RewardType,
        amount: 100,
        description: '100 bonus AI credits for successful referral',
      };

      // Directly add bonus credits to teacher account
      await prisma.teacher.update({
        where: { id: referralCode.teacherId },
        data: { bonusCredits: { increment: 100 } },
      });

      // Mark as already applied
      rewardData.status = 'APPLIED';
      rewardData.appliedAt = new Date();
    }

    await prisma.referralReward.create({ data: rewardData });

    // Mark referrer as rewarded
    await prisma.referral.update({
      where: { id: referral.id },
      data: { referrerRewarded: true },
    });

    logger.info('Created referrer reward', {
      referralId: referral.id,
      referrerId: referralCode.parentId || referralCode.teacherId,
      rewardType: rewardData.rewardType,
    });
  },

  /**
   * Get referral statistics for a user
   */
  async getStats(userId: string, userType: 'parent' | 'teacher'): Promise<ReferralStats> {
    const whereClause =
      userType === 'parent' ? { parentId: userId } : { teacherId: userId };

    const referralCode = await prisma.referralCode.findFirst({
      where: whereClause,
      include: {
        referrals: {
          select: { status: true },
        },
      },
    });

    if (!referralCode) {
      return {
        totalReferrals: 0,
        pendingReferrals: 0,
        convertedReferrals: 0,
        totalRewardsEarned: 0,
        pendingRewards: 0,
      };
    }

    const referrals = referralCode.referrals;
    const pendingStatuses: ReferralStatus[] = ['PENDING', 'SIGNED_UP', 'TRIALING'];

    // Get rewards
    const rewards = await prisma.referralReward.findMany({
      where: whereClause,
      select: { status: true, amount: true },
    });

    const appliedRewards = rewards.filter(r => r.status === 'APPLIED');
    const pendingRewards = rewards.filter(r => r.status === 'AVAILABLE' || r.status === 'PENDING');

    return {
      totalReferrals: referralCode.totalReferrals,
      pendingReferrals: referrals.filter(r => pendingStatuses.includes(r.status)).length,
      convertedReferrals: referralCode.successfulReferrals,
      totalRewardsEarned: appliedRewards.reduce((sum, r) => sum + Number(r.amount || 0), 0),
      pendingRewards: pendingRewards.length,
    };
  },

  /**
   * Get referral history for a user
   */
  async getHistory(
    userId: string,
    userType: 'parent' | 'teacher',
    limit: number = 20
  ): Promise<any[]> {
    const whereClause =
      userType === 'parent' ? { parentId: userId } : { teacherId: userId };

    const referralCode = await prisma.referralCode.findFirst({
      where: whereClause,
    });

    if (!referralCode) {
      return [];
    }

    const referrals = await prisma.referral.findMany({
      where: { referralCodeId: referralCode.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        channel: true,
        status: true,
        signedUpAt: true,
        subscribedAt: true,
        createdAt: true,
        referrerRewarded: true,
      },
    });

    return referrals;
  },

  /**
   * Get available rewards for a user
   */
  async getAvailableRewards(userId: string, userType: 'parent' | 'teacher'): Promise<any[]> {
    const whereClause =
      userType === 'parent' ? { parentId: userId } : { teacherId: userId };

    const rewards = await prisma.referralReward.findMany({
      where: {
        ...whereClause,
        status: 'AVAILABLE',
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    return rewards;
  },

  /**
   * Apply a reward to a parent's account (triggers Stripe coupon application)
   */
  async applyReward(rewardId: string, parentId: string): Promise<void> {
    const reward = await prisma.referralReward.findFirst({
      where: {
        id: rewardId,
        parentId,
        status: 'AVAILABLE',
      },
    });

    if (!reward) {
      throw new Error('Reward not found or already applied');
    }

    // Mark as applied (actual Stripe coupon application happens in subscription service)
    await prisma.referralReward.update({
      where: { id: rewardId },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
      },
    });

    logger.info('Applied referral reward', { rewardId, parentId });
  },

  /**
   * Expire old referrals that are past the attribution window
   * Should be called by a scheduled job
   */
  async expireOldReferrals(): Promise<number> {
    const result = await prisma.referral.updateMany({
      where: {
        status: { in: ['PENDING', 'SIGNED_UP', 'TRIALING'] },
        expiresAt: { lt: new Date() },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    if (result.count > 0) {
      logger.info(`Expired ${result.count} referrals past attribution window`);
    }

    return result.count;
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a unique referral code
 * Format: NAME-XXXX (e.g., SARAH-AB12)
 */
async function generateUniqueCode(baseName: string): Promise<string> {
  const sanitizedName = baseName
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 5) || 'ORBIT';

  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const suffix = generateRandomSuffix();
    const code = `${sanitizedName}-${suffix}`;

    // Check if code already exists
    const existing = await prisma.referralCode.findUnique({
      where: { code },
    });

    if (!existing) {
      return code;
    }

    attempts++;
  }

  // Fallback: use timestamp-based suffix
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `${sanitizedName}-${timestamp}`;
}

/**
 * Generate a random alphanumeric suffix
 */
function generateRandomSuffix(): string {
  const bytes = crypto.randomBytes(CODE_SUFFIX_LENGTH);
  let suffix = '';
  for (let i = 0; i < CODE_SUFFIX_LENGTH; i++) {
    suffix += CODE_SUFFIX_CHARS[bytes[i] % CODE_SUFFIX_CHARS.length];
  }
  return suffix;
}

export default referralService;
