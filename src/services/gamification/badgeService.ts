// Badge service for achievement unlocks
import { prisma } from '../../config/database.js';
import { Badge, EarnedBadge, BadgeCategory, BadgeRarity, XPReason } from '@prisma/client';

// Badge definitions
const BADGE_DEFINITIONS = [
  // Learning badges
  {
    code: 'first_lesson',
    name: 'First Steps',
    description: 'Complete your first lesson',
    icon: '🎯',
    category: 'LEARNING' as BadgeCategory,
    rarity: 'COMMON' as BadgeRarity,
    requirements: { lessonsCompleted: 1 },
    xpReward: 25,
  },
  {
    code: 'lesson_5',
    name: 'Knowledge Seeker',
    description: 'Complete 5 lessons',
    icon: '📚',
    category: 'LEARNING' as BadgeCategory,
    rarity: 'COMMON' as BadgeRarity,
    requirements: { lessonsCompleted: 5 },
    xpReward: 50,
  },
  {
    code: 'lesson_25',
    name: 'Bookworm',
    description: 'Complete 25 lessons',
    icon: '🐛',
    category: 'LEARNING' as BadgeCategory,
    rarity: 'RARE' as BadgeRarity,
    requirements: { lessonsCompleted: 25 },
    xpReward: 100,
  },
  {
    code: 'lesson_100',
    name: 'Scholar',
    description: 'Complete 100 lessons',
    icon: '🎓',
    category: 'LEARNING' as BadgeCategory,
    rarity: 'EPIC' as BadgeRarity,
    requirements: { lessonsCompleted: 100 },
    xpReward: 500,
  },

  // Streak badges
  {
    code: 'streak_3',
    name: 'Getting Started',
    description: '3 day learning streak',
    icon: '🔥',
    category: 'STREAK' as BadgeCategory,
    rarity: 'COMMON' as BadgeRarity,
    requirements: { streakDays: 3 },
    xpReward: 30,
  },
  {
    code: 'streak_7',
    name: 'Week Warrior',
    description: '7 day learning streak',
    icon: '⚡',
    category: 'STREAK' as BadgeCategory,
    rarity: 'RARE' as BadgeRarity,
    requirements: { streakDays: 7 },
    xpReward: 75,
  },
  {
    code: 'streak_30',
    name: 'Month Master',
    description: '30 day learning streak',
    icon: '🌟',
    category: 'STREAK' as BadgeCategory,
    rarity: 'EPIC' as BadgeRarity,
    requirements: { streakDays: 30 },
    xpReward: 250,
  },
  {
    code: 'streak_100',
    name: 'Legendary Learner',
    description: '100 day learning streak',
    icon: '👑',
    category: 'STREAK' as BadgeCategory,
    rarity: 'LEGENDARY' as BadgeRarity,
    requirements: { streakDays: 100 },
    xpReward: 1000,
  },

  // Mastery badges
  {
    code: 'first_perfect',
    name: 'Perfect Score',
    description: 'Get 100% on a quiz',
    icon: '💯',
    category: 'MASTERY' as BadgeCategory,
    rarity: 'COMMON' as BadgeRarity,
    requirements: { perfectScores: 1 },
    xpReward: 50,
  },
  {
    code: 'flashcard_master',
    name: 'Flashcard Master',
    description: 'Review 100 flashcards',
    icon: '🃏',
    category: 'MASTERY' as BadgeCategory,
    rarity: 'RARE' as BadgeRarity,
    requirements: { flashcardsReviewed: 100 },
    xpReward: 100,
  },
  {
    code: 'question_asker',
    name: 'Curious Mind',
    description: 'Ask Jeffrey 50 questions',
    icon: '❓',
    category: 'MASTERY' as BadgeCategory,
    rarity: 'RARE' as BadgeRarity,
    requirements: { questionsAsked: 50 },
    xpReward: 75,
  },

  // Level badges
  {
    code: 'level_5',
    name: 'Rising Star',
    description: 'Reach level 5',
    icon: '⭐',
    category: 'SPECIAL' as BadgeCategory,
    rarity: 'COMMON' as BadgeRarity,
    requirements: { level: 5 },
    xpReward: 50,
  },
  {
    code: 'level_10',
    name: 'Super Student',
    description: 'Reach level 10',
    icon: '🌟',
    category: 'SPECIAL' as BadgeCategory,
    rarity: 'RARE' as BadgeRarity,
    requirements: { level: 10 },
    xpReward: 150,
  },
  {
    code: 'level_20',
    name: 'Learning Legend',
    description: 'Reach level 20',
    icon: '🏆',
    category: 'SPECIAL' as BadgeCategory,
    rarity: 'LEGENDARY' as BadgeRarity,
    requirements: { level: 20 },
    xpReward: 500,
  },
];

export interface BadgeCheckContext {
  xpEarned: number;
  totalXP: number;
  level: number;
  reason: XPReason;
  leveledUp?: boolean;
}

export const badgeService = {
  /**
   * Initialize badges in database
   */
  async initializeBadges(): Promise<void> {
    for (const badge of BADGE_DEFINITIONS) {
      await prisma.badge.upsert({
        where: { code: badge.code },
        create: {
          code: badge.code,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          category: badge.category,
          rarity: badge.rarity,
          requirements: badge.requirements,
          xpReward: badge.xpReward,
        },
        update: {
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          category: badge.category,
          rarity: badge.rarity,
          requirements: badge.requirements,
          xpReward: badge.xpReward,
        },
      });
    }
  },

  /**
   * Check and award badges based on context
   */
  async checkAndAwardBadges(
    childId: string,
    context: BadgeCheckContext
  ): Promise<Array<{ code: string; name: string; xpReward: number }>> {
    const awardedBadges: Array<{ code: string; name: string; xpReward: number }> = [];

    // Get child's stats
    const progress = await prisma.userProgress.findUnique({
      where: { childId },
    });

    const streak = await prisma.streak.findUnique({
      where: { childId },
    });

    // Get already earned badges
    const earnedBadges = await prisma.earnedBadge.findMany({
      where: { childId },
      select: { badgeId: true },
    });
    const earnedBadgeIds = new Set(earnedBadges.map((eb) => eb.badgeId));

    // Get all badges
    const allBadges = await prisma.badge.findMany();

    // Check each badge
    for (const badge of allBadges) {
      if (earnedBadgeIds.has(badge.id)) continue;

      const requirements = badge.requirements as Record<string, number>;
      let earned = false;

      // Check level requirements
      if (requirements.level && context.level >= requirements.level) {
        earned = true;
      }

      // Check lesson requirements
      if (requirements.lessonsCompleted && progress) {
        if (progress.lessonsCompleted >= requirements.lessonsCompleted) {
          earned = true;
        }
      }

      // Check streak requirements
      if (requirements.streakDays && streak) {
        if (streak.current >= requirements.streakDays) {
          earned = true;
        }
      }

      // Check perfect score requirements
      if (requirements.perfectScores && progress) {
        if (progress.perfectScores >= requirements.perfectScores) {
          earned = true;
        }
      }

      // Check flashcard requirements
      if (requirements.flashcardsReviewed && progress) {
        if (progress.flashcardsReviewed >= requirements.flashcardsReviewed) {
          earned = true;
        }
      }

      // Check question requirements
      if (requirements.questionsAsked && progress) {
        if (progress.questionsAnswered >= requirements.questionsAsked) {
          earned = true;
        }
      }

      if (earned) {
        // Award badge
        await prisma.earnedBadge.create({
          data: {
            childId,
            badgeId: badge.id,
          },
        });

        awardedBadges.push({
          code: badge.code,
          name: badge.name,
          xpReward: badge.xpReward,
        });
      }
    }

    return awardedBadges;
  },

  /**
   * Get all badges (earned and available)
   */
  async getBadgesForChild(childId: string): Promise<{
    earned: Array<Badge & { earnedAt: Date }>;
    available: Badge[];
  }> {
    const allBadges = await prisma.badge.findMany({
      orderBy: [{ category: 'asc' }, { rarity: 'asc' }],
    });

    const earnedBadges = await prisma.earnedBadge.findMany({
      where: { childId },
      include: { badge: true },
    });

    const earnedBadgeIds = new Set(earnedBadges.map((eb) => eb.badgeId));

    return {
      earned: earnedBadges.map((eb) => ({
        ...eb.badge,
        earnedAt: eb.earnedAt,
      })),
      available: allBadges.filter((b) => !earnedBadgeIds.has(b.id)),
    };
  },

  /**
   * Get recent achievements
   */
  async getRecentAchievements(
    childId: string,
    limit: number = 5
  ): Promise<
    Array<{
      type: 'badge' | 'level_up';
      name: string;
      icon: string;
      earnedAt: Date;
    }>
  > {
    const recentBadges = await prisma.earnedBadge.findMany({
      where: { childId },
      orderBy: { earnedAt: 'desc' },
      take: limit,
      include: { badge: true },
    });

    return recentBadges.map((eb) => ({
      type: 'badge' as const,
      name: eb.badge.name,
      icon: eb.badge.icon,
      earnedAt: eb.earnedAt,
    }));
  },

  /**
   * Get badge by code
   */
  async getBadgeByCode(code: string): Promise<Badge | null> {
    return prisma.badge.findUnique({
      where: { code },
    });
  },
};
