// Parent dashboard routes
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { xpEngine } from '../services/gamification/xpEngine.js';
import { streakService } from '../services/gamification/streakService.js';
import { badgeService } from '../services/gamification/badgeService.js';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * GET /api/parent/dashboard
 * Get aggregated dashboard data for parent (across all children)
 * Requires parent authentication
 */
router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    // Get all children for this parent
    const children = await prisma.child.findMany({
      where: { parentId },
      include: {
        progress: true,
        streak: true,
        earnedBadges: {
          include: { badge: true },
          orderBy: { earnedAt: 'desc' },
          take: 5,
        },
        lessons: {
          where: { processingStatus: 'COMPLETED' },
          select: { id: true },
        },
      },
    });

    // Calculate aggregated stats across all children
    let totalLessons = 0;
    let totalStreak = 0;
    let longestStreak = 0;
    let completedToday = 0;

    // Get today's date for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get lessons completed today across all children
    // Use createdAt since lessons are processed immediately after creation
    const lessonsCompletedToday = await prisma.lesson.count({
      where: {
        child: { parentId },
        processingStatus: 'COMPLETED',
        createdAt: { gte: today },
      },
    });

    // Calculate per-child stats and aggregate
    const childrenWithStats = await Promise.all(
      children.map(async (child) => {
        const lessonsCount = child.lessons.length;
        totalLessons += lessonsCount;

        // Use streakService to get properly validated streak info
        const streakInfo = await streakService.getStreakInfo(child.id);

        if (streakInfo.current > longestStreak) {
          longestStreak = streakInfo.current;
        }
        totalStreak += streakInfo.current;

        // Calculate age from dateOfBirth
        const birthDate = new Date(child.dateOfBirth);
        const ageDiff = Date.now() - birthDate.getTime();
        const ageDate = new Date(ageDiff);
        const age = Math.abs(ageDate.getUTCFullYear() - 1970);

        // Check if child was active today
        const wasActiveToday =
          child.lastActiveAt && new Date(child.lastActiveAt) >= today;

        // Get XP progress
        const progress = child.progress || {
          totalXP: 0,
          level: 1,
          lessonsCompleted: 0,
        };

        // Check activity based on streak service or child's lastActiveAt
        const isActiveToday = streakInfo.isActiveToday || wasActiveToday;

        return {
          id: child.id,
          displayName: child.displayName,
          avatarUrl: child.avatarUrl,
          age,
          ageGroup: child.ageGroup,
          gradeLevel: child.gradeLevel,
          lessonsCompleted: lessonsCount,
          currentStreak: streakInfo.current,
          longestStreak: streakInfo.longest,
          lastActive: isActiveToday
            ? 'Today'
            : child.lastActiveAt
              ? formatTimeAgo(child.lastActiveAt)
              : 'Never',
          wasActiveToday: isActiveToday,
          xp: progress.totalXP,
          level: progress.level,
          recentBadges: child.earnedBadges.map((eb) => ({
            name: eb.badge.name,
            icon: eb.badge.icon,
            earnedAt: eb.earnedAt,
          })),
        };
      })
    );

    // Get recent activity across all children
    const recentActivity = await getRecentActivity(parentId);

    // Calculate weekly progress (lessons completed this week / weekly goal)
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
    weekStart.setHours(0, 0, 0, 0);

    const lessonsThisWeek = await prisma.lesson.count({
      where: {
        child: { parentId },
        processingStatus: 'COMPLETED',
        createdAt: { gte: weekStart },
      },
    });

    // Weekly goal: 7 lessons per child per week (1 per day)
    const weeklyGoal = children.length * 7;
    const weeklyProgress =
      weeklyGoal > 0 ? Math.min(100, Math.round((lessonsThisWeek / weeklyGoal) * 100)) : 0;

    res.json({
      success: true,
      data: {
        // Aggregated stats
        stats: {
          totalLessons,
          completedToday: lessonsCompletedToday,
          streakDays: longestStreak, // Show longest streak among children
          weeklyProgress,
        },
        // Per-child data
        children: childrenWithStats,
        // Recent activity feed
        recentActivity,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/parent/children/:childId/activity
 * Get detailed activity for a specific child
 * Requires parent authentication with child access
 */
router.get('/children/:childId/activity', authenticate, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { childId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    // Verify parent owns this child
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
    });

    if (!child) {
      return res.status(404).json({
        success: false,
        error: 'Child not found',
      });
    }

    // Get recent lessons
    const lessons = await prisma.lesson.findMany({
      where: { childId, processingStatus: 'COMPLETED' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        subject: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Get recent badges
    const badges = await prisma.earnedBadge.findMany({
      where: { childId },
      orderBy: { earnedAt: 'desc' },
      take: 10,
      include: { badge: true },
    });

    // Get recent XP transactions
    const xpTransactions = await prisma.xPTransaction.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Get chat activity count
    const chatCount = await prisma.chatMessage.count({
      where: {
        childId,
        role: 'USER',
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    // Build activity feed
    const activities: any[] = [];

    lessons.forEach((lesson) => {
      activities.push({
        id: `lesson-${lesson.id}`,
        type: 'lesson_completed',
        description: `Completed ${lesson.subject || 'a'} lesson: ${lesson.title}`,
        icon: getSubjectIcon(lesson.subject),
        timestamp: lesson.updatedAt,
      });
    });

    badges.forEach((eb) => {
      activities.push({
        id: `badge-${eb.id}`,
        type: 'badge_earned',
        description: `Earned "${eb.badge.name}" badge`,
        icon: eb.badge.icon,
        timestamp: eb.earnedAt,
      });
    });

    // Sort by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({
      success: true,
      data: {
        activities: activities.slice(0, limit),
        summary: {
          lessonsThisWeek: lessons.filter(
            (l) => new Date(l.createdAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          ).length,
          badgesEarned: badges.length,
          questionsAsked: chatCount,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to get recent activity across all children
async function getRecentActivity(parentId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get recent lessons
  const lessons = await prisma.lesson.findMany({
    where: {
      child: { parentId },
      processingStatus: 'COMPLETED',
      updatedAt: { gte: sevenDaysAgo },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: {
      child: { select: { displayName: true } },
    },
  });

  // Get recent badges
  const badges = await prisma.earnedBadge.findMany({
    where: {
      child: { parentId },
      earnedAt: { gte: sevenDaysAgo },
    },
    orderBy: { earnedAt: 'desc' },
    take: 10,
    include: {
      child: { select: { displayName: true } },
      badge: true,
    },
  });

  // Get recent chat activity (count questions per child)
  const chatActivity = await prisma.chatMessage.groupBy({
    by: ['childId'],
    where: {
      child: { parentId },
      role: 'USER',
      createdAt: { gte: sevenDaysAgo },
    },
    _count: { id: true },
  });

  // Build activity feed
  const activities: any[] = [];

  lessons.forEach((lesson) => {
    activities.push({
      id: `lesson-${lesson.id}`,
      child: lesson.child.displayName,
      action: `Completed ${lesson.subject || ''} lesson: ${lesson.title}`,
      time: formatTimeAgo(lesson.updatedAt),
      timestamp: lesson.updatedAt,
      icon: getSubjectIcon(lesson.subject),
      type: 'lesson',
    });
  });

  badges.forEach((eb) => {
    activities.push({
      id: `badge-${eb.id}`,
      child: eb.child.displayName,
      action: `Earned "${eb.badge.name}" badge`,
      time: formatTimeAgo(eb.earnedAt),
      timestamp: eb.earnedAt,
      icon: eb.badge.icon,
      type: 'badge',
    });
  });

  // Sort by timestamp and limit to 10
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return activities.slice(0, 10);
}

// Helper function to format time ago
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(date).toLocaleDateString();
}

// Helper function to get subject icon
function getSubjectIcon(subject: string | null): string {
  const icons: Record<string, string> = {
    MATH: '📐',
    SCIENCE: '🔬',
    ENGLISH: '📚',
    ARABIC: '📜',
    ISLAMIC_STUDIES: '🕌',
    SOCIAL_STUDIES: '🌍',
    ART: '🎨',
    MUSIC: '🎵',
    OTHER: '📖',
  };
  return subject ? icons[subject] || '📖' : '📖';
}

export default router;
