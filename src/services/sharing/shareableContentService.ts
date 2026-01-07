/**
 * Shareable Content Service
 *
 * Creates privacy-safe shareable content with opaque tokens.
 * IMPORTANT: No child PII (ID, name, DOB, parent email) in share links.
 *
 * Shareable content types:
 * - Badge unlocks
 * - Streak milestones (7, 30, 100 days)
 * - Quiz results
 * - Progress reports
 * - Level ups
 */

import crypto from 'crypto';
import { prisma } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { ShareableContentType, ShareChannel, Prisma } from '@prisma/client';

// =============================================================================
// TYPES
// =============================================================================

export interface ShareableContentResult {
  id: string;
  token: string;
  shareUrl: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  contentType: ShareableContentType;
  expiresAt: Date | null;
}

export interface BadgeShareData {
  badgeName: string;
  badgeDescription: string;
  badgeIcon: string;
  badgeRarity: string;
  badgeCategory: string;
  earnedAt: string;
  ageGroup: 'YOUNG' | 'OLDER';
  displayName?: string;
  avatarUrl?: string;
}

export interface StreakShareData {
  streakDays: number;
  milestone: number;
  ageGroup: 'YOUNG' | 'OLDER';
  displayName?: string;
  avatarUrl?: string;
}

export interface QuizShareData {
  score: number;
  correctAnswers: number;
  totalQuestions: number;
  subject: string;
  topic: string;
  xpEarned: number;
  ageGroup: 'YOUNG' | 'OLDER';
  displayName?: string;
  avatarUrl?: string;
}

export interface ProgressShareData {
  period: 'WEEKLY' | 'MONTHLY';
  lessonsCompleted: number;
  quizzesCompleted: number;
  xpEarned: number;
  currentStreak: number;
  badgesEarned: number;
  currentLevel: number;
  ageGroup: 'YOUNG' | 'OLDER';
  displayName?: string;
  avatarUrl?: string;
}

export interface LevelUpShareData {
  newLevel: number;
  levelName: string;
  totalXp: number;
  ageGroup: 'YOUNG' | 'OLDER';
  displayName?: string;
  avatarUrl?: string;
}

interface ChildSettings {
  showName?: boolean;
  showAvatar?: boolean;
  enablePrompts?: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a URL-safe opaque token
 */
function generateShareToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

/**
 * Get the base URL for share links
 */
function getShareBaseUrl(): string {
  return process.env.FRONTEND_URL || 'https://orbitlearn.com';
}

/**
 * Get age group from child's date of birth
 */
function getAgeGroup(dateOfBirth: Date): 'YOUNG' | 'OLDER' {
  const today = new Date();
  const age = today.getFullYear() - dateOfBirth.getFullYear();
  return age < 8 ? 'YOUNG' : 'OLDER';
}

/**
 * Check if parent allows sharing child's display info
 */
async function getSharingPreferences(parentId: string, childId: string): Promise<{
  includeDisplayName: boolean;
  includeAvatar: boolean;
}> {
  const preferences = await prisma.parentSharingPreferences.findUnique({
    where: { parentId },
  });

  if (!preferences) {
    return { includeDisplayName: false, includeAvatar: false };
  }

  // Parse childSettings JSON
  const childSettings = preferences.childSettings as Record<string, ChildSettings> || {};
  const settings = childSettings[childId] || {};

  return {
    includeDisplayName: settings.showName ?? false,
    includeAvatar: settings.showAvatar ?? false,
  };
}

/**
 * Get or create referral code for a parent
 */
async function getParentReferralCode(parentId: string): Promise<{ id: string; code: string }> {
  // Check if parent has an existing referral code
  let referralCode = await prisma.referralCode.findFirst({
    where: { parentId, isActive: true },
    select: { id: true, code: true },
  });

  if (!referralCode) {
    // Get parent info for code generation
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { firstName: true },
    });

    const prefix = parent?.firstName?.substring(0, 5).toUpperCase() || 'ORBIT';
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `${prefix}-${suffix}`;

    referralCode = await prisma.referralCode.create({
      data: {
        code,
        parentId,
      },
      select: { id: true, code: true },
    });
  }

  return referralCode;
}

// =============================================================================
// SHAREABLE CONTENT SERVICE
// =============================================================================

export const shareableContentService = {
  /**
   * Create a shareable badge unlock
   */
  async createBadgeShare(
    parentId: string,
    childId: string,
    earnedBadgeId: string
  ): Promise<ShareableContentResult> {
    // Fetch the earned badge with related data
    const earnedBadge = await prisma.earnedBadge.findUnique({
      where: { id: earnedBadgeId },
      include: {
        badge: true,
        child: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            dateOfBirth: true,
            parentId: true,
          },
        },
      },
    });

    if (!earnedBadge) {
      throw new Error('Earned badge not found');
    }

    // Verify parent owns this child
    if (earnedBadge.child.parentId !== parentId) {
      throw new Error('Unauthorized: Child does not belong to this parent');
    }

    // Get sharing preferences
    const prefs = await getSharingPreferences(parentId, childId);

    // Build privacy-safe snapshot
    const snapshotData: BadgeShareData = {
      badgeName: earnedBadge.badge.name,
      badgeDescription: earnedBadge.badge.description,
      badgeIcon: earnedBadge.badge.icon,
      badgeRarity: earnedBadge.badge.rarity,
      badgeCategory: earnedBadge.badge.category,
      earnedAt: earnedBadge.earnedAt.toISOString(),
      ageGroup: getAgeGroup(earnedBadge.child.dateOfBirth),
      ...(prefs.includeDisplayName && earnedBadge.child.displayName
        ? { displayName: earnedBadge.child.displayName }
        : {}),
      ...(prefs.includeAvatar && earnedBadge.child.avatarUrl
        ? { avatarUrl: earnedBadge.child.avatarUrl }
        : {}),
    };

    // Get parent's referral code for share link
    const referralCode = await getParentReferralCode(parentId);

    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 day expiry

    const shareableContent = await prisma.shareableContent.create({
      data: {
        token,
        parentId,
        contentType: 'BADGE',
        snapshotData: snapshotData as unknown as Prisma.InputJsonValue,
        title: `${earnedBadge.badge.icon} ${earnedBadge.badge.name} Badge Unlocked!`,
        description: earnedBadge.badge.description,
        referralCodeId: referralCode.id,
        expiresAt,
      },
    });

    const shareUrl = `${getShareBaseUrl()}/s/${token}?ref=${referralCode.code}`;

    logger.info('Created badge share', {
      shareableContentId: shareableContent.id,
      badgeId: earnedBadge.badgeId,
      parentId,
    });

    return {
      id: shareableContent.id,
      token,
      shareUrl,
      title: shareableContent.title,
      description: shareableContent.description,
      imageUrl: shareableContent.imageUrl,
      contentType: shareableContent.contentType,
      expiresAt: shareableContent.expiresAt,
    };
  },

  /**
   * Create a shareable streak milestone
   */
  async createStreakShare(
    parentId: string,
    childId: string,
    milestone: 7 | 30 | 100
  ): Promise<ShareableContentResult> {
    // Fetch child and streak
    const child = await prisma.child.findUnique({
      where: { id: childId },
      include: {
        streak: true,
      },
    });

    if (!child) {
      throw new Error('Child not found');
    }

    if (child.parentId !== parentId) {
      throw new Error('Unauthorized: Child does not belong to this parent');
    }

    if (!child.streak || child.streak.current < milestone) {
      throw new Error(`Streak milestone ${milestone} not reached`);
    }

    const prefs = await getSharingPreferences(parentId, childId);

    const snapshotData: StreakShareData = {
      streakDays: child.streak.current,
      milestone,
      ageGroup: getAgeGroup(child.dateOfBirth),
      ...(prefs.includeDisplayName && child.displayName
        ? { displayName: child.displayName }
        : {}),
      ...(prefs.includeAvatar && child.avatarUrl
        ? { avatarUrl: child.avatarUrl }
        : {}),
    };

    const referralCode = await getParentReferralCode(parentId);
    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const title = milestone >= 100
      ? `${milestone} Day Streak! Incredible!`
      : milestone >= 30
        ? `${milestone} Day Streak! Amazing!`
        : `${milestone} Day Streak!`;

    const shareableContent = await prisma.shareableContent.create({
      data: {
        token,
        parentId,
        contentType: 'STREAK_MILESTONE',
        snapshotData: snapshotData as unknown as Prisma.InputJsonValue,
        title,
        description: `Learning every day for ${milestone} days straight!`,
        referralCodeId: referralCode.id,
        expiresAt,
      },
    });

    const shareUrl = `${getShareBaseUrl()}/s/${token}?ref=${referralCode.code}`;

    logger.info('Created streak share', {
      shareableContentId: shareableContent.id,
      milestone,
      parentId,
    });

    return {
      id: shareableContent.id,
      token,
      shareUrl,
      title: shareableContent.title,
      description: shareableContent.description,
      imageUrl: shareableContent.imageUrl,
      contentType: shareableContent.contentType,
      expiresAt: shareableContent.expiresAt,
    };
  },

  /**
   * Create a shareable quiz result
   */
  async createQuizResultShare(
    parentId: string,
    quizAttemptId: string
  ): Promise<ShareableContentResult> {
    const quizAttempt = await prisma.quizAttempt.findUnique({
      where: { id: quizAttemptId },
      include: {
        quiz: {
          include: {
            lesson: {
              include: {
                child: {
                  select: {
                    id: true,
                    displayName: true,
                    avatarUrl: true,
                    dateOfBirth: true,
                    parentId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!quizAttempt || !quizAttempt.quiz.lesson.child) {
      throw new Error('Quiz attempt not found');
    }

    const child = quizAttempt.quiz.lesson.child;

    if (child.parentId !== parentId) {
      throw new Error('Unauthorized: Child does not belong to this parent');
    }

    const prefs = await getSharingPreferences(parentId, child.id);

    // Calculate correct answers from quiz data
    const answers = quizAttempt.answers as any[];
    const correctAnswers = Array.isArray(answers)
      ? answers.filter((a: any) => a.isCorrect === true).length
      : 0;
    const totalQuestions = Array.isArray(answers) ? answers.length : 0;

    const snapshotData: QuizShareData = {
      score: quizAttempt.score,
      correctAnswers,
      totalQuestions,
      subject: quizAttempt.quiz.lesson.subject || 'General',
      topic: quizAttempt.quiz.lesson.title || 'Quiz',
      xpEarned: quizAttempt.xpEarned,
      ageGroup: getAgeGroup(child.dateOfBirth),
      ...(prefs.includeDisplayName && child.displayName
        ? { displayName: child.displayName }
        : {}),
      ...(prefs.includeAvatar && child.avatarUrl
        ? { avatarUrl: child.avatarUrl }
        : {}),
    };

    const referralCode = await getParentReferralCode(parentId);
    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const scoreEmoji = quizAttempt.score >= 90 ? '' : quizAttempt.score >= 70 ? '' : '';
    const title = `${scoreEmoji} Quiz Score: ${correctAnswers}/${totalQuestions}!`;

    const shareableContent = await prisma.shareableContent.create({
      data: {
        token,
        parentId,
        contentType: 'QUIZ_RESULT',
        snapshotData: snapshotData as unknown as Prisma.InputJsonValue,
        title,
        description: `${quizAttempt.quiz.lesson.subject || 'Quiz'}: ${quizAttempt.quiz.lesson.title || 'Learning'}`,
        referralCodeId: referralCode.id,
        expiresAt,
      },
    });

    const shareUrl = `${getShareBaseUrl()}/s/${token}?ref=${referralCode.code}`;

    logger.info('Created quiz result share', {
      shareableContentId: shareableContent.id,
      quizAttemptId,
      parentId,
    });

    return {
      id: shareableContent.id,
      token,
      shareUrl,
      title: shareableContent.title,
      description: shareableContent.description,
      imageUrl: shareableContent.imageUrl,
      contentType: shareableContent.contentType,
      expiresAt: shareableContent.expiresAt,
    };
  },

  /**
   * Create a shareable progress report
   */
  async createProgressReportShare(
    parentId: string,
    childId: string,
    period: 'WEEKLY' | 'MONTHLY'
  ): Promise<ShareableContentResult> {
    const child = await prisma.child.findUnique({
      where: { id: childId },
      include: {
        streak: true,
        progress: true,
      },
    });

    if (!child) {
      throw new Error('Child not found');
    }

    if (child.parentId !== parentId) {
      throw new Error('Unauthorized: Child does not belong to this parent');
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    if (period === 'WEEKLY') {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate.setMonth(startDate.getMonth() - 1);
    }

    // Fetch activity data for the period
    const [lessons, quizAttempts, badges, xpTransactions] = await Promise.all([
      prisma.lesson.count({
        where: {
          childId,
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.quizAttempt.count({
        where: {
          quiz: {
            lesson: {
              childId,
            },
          },
          completedAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.earnedBadge.count({
        where: {
          childId,
          earnedAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.xPTransaction.aggregate({
        where: {
          childId,
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
    ]);

    const prefs = await getSharingPreferences(parentId, childId);

    const snapshotData: ProgressShareData = {
      period,
      lessonsCompleted: lessons,
      quizzesCompleted: quizAttempts,
      xpEarned: xpTransactions._sum.amount || 0,
      currentStreak: child.streak?.current || 0,
      badgesEarned: badges,
      currentLevel: child.progress?.level || 1,
      ageGroup: getAgeGroup(child.dateOfBirth),
      ...(prefs.includeDisplayName && child.displayName
        ? { displayName: child.displayName }
        : {}),
      ...(prefs.includeAvatar && child.avatarUrl
        ? { avatarUrl: child.avatarUrl }
        : {}),
    };

    const referralCode = await getParentReferralCode(parentId);
    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const title = period === 'WEEKLY'
      ? `This Week's Learning Journey!`
      : `This Month's Learning Achievements!`;

    const shareableContent = await prisma.shareableContent.create({
      data: {
        token,
        parentId,
        contentType: 'PROGRESS_REPORT',
        snapshotData: snapshotData as unknown as Prisma.InputJsonValue,
        title,
        description: `${lessons} lessons, ${badges} badges, ${child.streak?.current || 0} day streak!`,
        referralCodeId: referralCode.id,
        expiresAt,
      },
    });

    const shareUrl = `${getShareBaseUrl()}/s/${token}?ref=${referralCode.code}`;

    logger.info('Created progress report share', {
      shareableContentId: shareableContent.id,
      period,
      parentId,
    });

    return {
      id: shareableContent.id,
      token,
      shareUrl,
      title: shareableContent.title,
      description: shareableContent.description,
      imageUrl: shareableContent.imageUrl,
      contentType: shareableContent.contentType,
      expiresAt: shareableContent.expiresAt,
    };
  },

  /**
   * Create a shareable level up announcement
   */
  async createLevelUpShare(
    parentId: string,
    childId: string,
    newLevel: number
  ): Promise<ShareableContentResult> {
    const child = await prisma.child.findUnique({
      where: { id: childId },
      include: {
        progress: true,
      },
    });

    if (!child) {
      throw new Error('Child not found');
    }

    if (child.parentId !== parentId) {
      throw new Error('Unauthorized: Child does not belong to this parent');
    }

    const prefs = await getSharingPreferences(parentId, childId);

    // Level names
    const levelNames: Record<number, string> = {
      1: 'Curious Explorer',
      2: 'Knowledge Seeker',
      3: 'Learning Adventurer',
      4: 'Wisdom Hunter',
      5: 'Star Scholar',
      6: 'Brain Champion',
      7: 'Genius in Training',
      8: 'Master Learner',
      9: 'Knowledge Master',
      10: 'Learning Legend',
    };

    const snapshotData: LevelUpShareData = {
      newLevel,
      levelName: levelNames[newLevel] || `Level ${newLevel}`,
      totalXp: child.progress?.totalXP || 0,
      ageGroup: getAgeGroup(child.dateOfBirth),
      ...(prefs.includeDisplayName && child.displayName
        ? { displayName: child.displayName }
        : {}),
      ...(prefs.includeAvatar && child.avatarUrl
        ? { avatarUrl: child.avatarUrl }
        : {}),
    };

    const referralCode = await getParentReferralCode(parentId);
    const token = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const title = ` Level ${newLevel}: ${levelNames[newLevel] || 'Level Up'}!`;

    const shareableContent = await prisma.shareableContent.create({
      data: {
        token,
        parentId,
        contentType: 'LEVEL_UP',
        snapshotData: snapshotData as unknown as Prisma.InputJsonValue,
        title,
        description: `Reached Level ${newLevel} on the learning journey!`,
        referralCodeId: referralCode.id,
        expiresAt,
      },
    });

    const shareUrl = `${getShareBaseUrl()}/s/${token}?ref=${referralCode.code}`;

    logger.info('Created level up share', {
      shareableContentId: shareableContent.id,
      newLevel,
      parentId,
    });

    return {
      id: shareableContent.id,
      token,
      shareUrl,
      title: shareableContent.title,
      description: shareableContent.description,
      imageUrl: shareableContent.imageUrl,
      contentType: shareableContent.contentType,
      expiresAt: shareableContent.expiresAt,
    };
  },

  /**
   * Get shareable content by token (public endpoint)
   */
  async getByToken(token: string): Promise<{
    id: string;
    contentType: ShareableContentType;
    snapshotData: any;
    title: string;
    description: string | null;
    imageUrl: string | null;
    referralCode: string | null;
    isExpired: boolean;
  } | null> {
    const content = await prisma.shareableContent.findUnique({
      where: { token },
      include: {
        referralCode: {
          select: { code: true },
        },
      },
    });

    if (!content || !content.isActive) {
      return null;
    }

    // Check expiry
    const isExpired = content.expiresAt ? content.expiresAt < new Date() : false;

    // Increment view count (fire-and-forget)
    prisma.shareableContent.update({
      where: { id: content.id },
      data: { viewCount: { increment: 1 } },
    }).catch(() => {}); // Ignore errors

    return {
      id: content.id,
      contentType: content.contentType,
      snapshotData: content.snapshotData,
      title: content.title,
      description: content.description,
      imageUrl: content.imageUrl,
      referralCode: content.referralCode?.code || null,
      isExpired,
    };
  },

  /**
   * Track a share event (when user actually shares via a channel)
   */
  async trackShareEvent(
    contentId: string,
    channel: ShareChannel,
    parentId: string
  ): Promise<void> {
    await prisma.shareEvent.create({
      data: {
        shareableContentId: contentId,
        channel,
        parentId,
      },
    });

    logger.info('Share event tracked', {
      contentId,
      channel,
      parentId,
    });
  },

  /**
   * Get share analytics for a parent
   */
  async getShareStats(parentId: string): Promise<{
    totalShares: number;
    totalViews: number;
    sharesByType: Record<string, number>;
    sharesByChannel: Record<string, number>;
  }> {
    const [contents, events] = await Promise.all([
      prisma.shareableContent.findMany({
        where: { parentId },
        select: {
          contentType: true,
          viewCount: true,
        },
      }),
      prisma.shareEvent.findMany({
        where: { parentId },
        select: { channel: true },
      }),
    ]);

    const sharesByType: Record<string, number> = {};
    let totalViews = 0;

    for (const content of contents) {
      sharesByType[content.contentType] = (sharesByType[content.contentType] || 0) + 1;
      totalViews += content.viewCount;
    }

    const sharesByChannel: Record<string, number> = {};
    for (const event of events) {
      sharesByChannel[event.channel] = (sharesByChannel[event.channel] || 0) + 1;
    }

    return {
      totalShares: contents.length,
      totalViews,
      sharesByType,
      sharesByChannel,
    };
  },

  /**
   * Deactivate a share (parent can revoke)
   */
  async deactivateShare(shareId: string, parentId: string): Promise<void> {
    const content = await prisma.shareableContent.findUnique({
      where: { id: shareId },
      select: { parentId: true },
    });

    if (!content) {
      throw new Error('Share not found');
    }

    if (content.parentId !== parentId) {
      throw new Error('Unauthorized: Cannot deactivate this share');
    }

    await prisma.shareableContent.update({
      where: { id: shareId },
      data: { isActive: false },
    });

    logger.info('Share deactivated', { shareId, parentId });
  },

  /**
   * Get all shares created by a parent
   */
  async getParentShares(
    parentId: string,
    limit: number = 20
  ): Promise<ShareableContentResult[]> {
    const contents = await prisma.shareableContent.findMany({
      where: { parentId, isActive: true },
      include: {
        referralCode: {
          select: { code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return contents.map(content => ({
      id: content.id,
      token: content.token,
      shareUrl: `${getShareBaseUrl()}/s/${content.token}${content.referralCode ? `?ref=${content.referralCode.code}` : ''}`,
      title: content.title,
      description: content.description,
      imageUrl: content.imageUrl,
      contentType: content.contentType,
      expiresAt: content.expiresAt,
    }));
  },
};

export default shareableContentService;
