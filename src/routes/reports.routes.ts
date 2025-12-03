// Progress Reports routes for parent dashboard
import { Router } from 'express';
import { authenticate, requireParent } from '../middleware/auth.js';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * GET /api/parent/reports/children
 * Get list of children for the selector
 */
router.get('/children', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    const children = await prisma.child.findMany({
      where: { parentId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        ageGroup: true,
        gradeLevel: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      success: true,
      data: children,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/parent/reports/:childId
 * Get comprehensive progress report for a child
 */
router.get('/:childId', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { childId } = req.params;
    const { period = '7d' } = req.query; // 7d, 30d, 90d, all

    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        ageGroup: true,
        gradeLevel: true,
        createdAt: true,
      },
    });

    if (!child) {
      return res.status(404).json({
        success: false,
        error: 'Child not found',
      });
    }

    // Calculate date range
    const now = new Date();
    let startDate: Date | null = null;
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = null; // all time
    }

    // Get all data in parallel
    const [progress, streak, recentLessons, recentBadges, lessonsBySubject, activityByDay] = await Promise.all([
      // User progress
      prisma.userProgress.findUnique({
        where: { childId },
      }),

      // Streak
      prisma.streak.findUnique({
        where: { childId },
      }),

      // Recent lessons
      prisma.lesson.findMany({
        where: {
          childId,
          ...(startDate && { createdAt: { gte: startDate } }),
        },
        select: {
          id: true,
          title: true,
          subject: true,
          percentComplete: true,
          createdAt: true,
          lastAccessedAt: true,
        },
        orderBy: { lastAccessedAt: 'desc' },
        take: 10,
      }),

      // Recent badges
      prisma.earnedBadge.findMany({
        where: {
          childId,
          ...(startDate && { earnedAt: { gte: startDate } }),
        },
        include: {
          badge: {
            select: {
              name: true,
              icon: true,
              description: true,
              category: true,
              rarity: true,
            },
          },
        },
        orderBy: { earnedAt: 'desc' },
        take: 5,
      }),

      // Lessons by subject (all time)
      prisma.lesson.groupBy({
        by: ['subject'],
        where: { childId, subject: { not: null } },
        _count: { id: true },
      }),

      // Activity by day (for chart)
      getActivityByDay(childId, startDate),
    ]);

    // Calculate period-specific stats
    const periodLessons = await prisma.lesson.count({
      where: {
        childId,
        ...(startDate && { createdAt: { gte: startDate } }),
      },
    });

    const periodCompletedLessons = await prisma.lesson.count({
      where: {
        childId,
        percentComplete: 100,
        ...(startDate && { createdAt: { gte: startDate } }),
      },
    });

    // Format subject breakdown
    const subjectBreakdown = lessonsBySubject.map(item => ({
      subject: item.subject,
      count: item._count.id,
    }));

    // Calculate average completion rate
    const avgCompletion = recentLessons.length > 0
      ? Math.round(recentLessons.reduce((sum, l) => sum + (l.percentComplete || 0), 0) / recentLessons.length)
      : 0;

    // Format study time
    const totalStudyMinutes = progress ? Math.round(progress.totalStudyTimeSeconds / 60) : 0;
    const studyTimeFormatted = formatStudyTime(totalStudyMinutes);

    res.json({
      success: true,
      data: {
        child,
        period,
        overview: {
          totalXP: progress?.totalXP || 0,
          currentXP: progress?.currentXP || 0,
          level: progress?.level || 1,
          lessonsCompleted: progress?.lessonsCompleted || 0,
          questionsAnswered: progress?.questionsAnswered || 0,
          flashcardsReviewed: progress?.flashcardsReviewed || 0,
          perfectScores: progress?.perfectScores || 0,
          totalStudyTime: studyTimeFormatted,
          totalStudyMinutes,
        },
        periodStats: {
          lessonsStarted: periodLessons,
          lessonsCompleted: periodCompletedLessons,
          avgCompletion,
        },
        streak: streak ? {
          current: streak.current,
          longest: streak.longest,
          lastActivityDate: streak.lastActivityDate,
          freezeAvailable: streak.freezeAvailable,
        } : {
          current: 0,
          longest: 0,
          lastActivityDate: null,
          freezeAvailable: false,
        },
        subjectBreakdown,
        subjectProgress: progress?.subjectProgress || {},
        recentLessons: recentLessons.map(lesson => ({
          id: lesson.id,
          title: lesson.title,
          subject: lesson.subject,
          percentComplete: lesson.percentComplete,
          createdAt: lesson.createdAt,
          lastAccessedAt: lesson.lastAccessedAt,
        })),
        recentBadges: recentBadges.map(eb => ({
          id: eb.id,
          name: eb.badge.name,
          icon: eb.badge.icon,
          description: eb.badge.description,
          category: eb.badge.category,
          rarity: eb.badge.rarity,
          earnedAt: eb.earnedAt,
        })),
        activityChart: activityByDay,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/parent/reports/:childId/export
 * Export progress report as JSON (could be extended to PDF/CSV)
 */
router.get('/:childId/export', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { childId } = req.params;

    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
      include: {
        progress: true,
        streak: true,
        lessons: {
          select: {
            id: true,
            title: true,
            subject: true,
            percentComplete: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        earnedBadges: {
          include: {
            badge: {
              select: {
                name: true,
                description: true,
                category: true,
              },
            },
          },
        },
      },
    });

    if (!child) {
      return res.status(404).json({
        success: false,
        error: 'Child not found',
      });
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      child: {
        displayName: child.displayName,
        ageGroup: child.ageGroup,
        gradeLevel: child.gradeLevel,
        accountCreated: child.createdAt,
      },
      progress: child.progress ? {
        level: child.progress.level,
        totalXP: child.progress.totalXP,
        lessonsCompleted: child.progress.lessonsCompleted,
        questionsAnswered: child.progress.questionsAnswered,
        flashcardsReviewed: child.progress.flashcardsReviewed,
        perfectScores: child.progress.perfectScores,
        totalStudyTimeMinutes: Math.round(child.progress.totalStudyTimeSeconds / 60),
        subjectProgress: child.progress.subjectProgress,
      } : null,
      streak: child.streak ? {
        current: child.streak.current,
        longest: child.streak.longest,
      } : null,
      lessons: child.lessons.map(l => ({
        title: l.title,
        subject: l.subject,
        percentComplete: l.percentComplete,
        date: l.createdAt,
      })),
      badges: child.earnedBadges.map(eb => ({
        name: eb.badge.name,
        description: eb.badge.description,
        category: eb.badge.category,
        earnedAt: eb.earnedAt,
      })),
    };

    res.json({
      success: true,
      data: exportData,
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to get activity by day for charts
async function getActivityByDay(childId: string, startDate: Date | null): Promise<Array<{ date: string; lessons: number; xp: number }>> {
  const days = startDate ? Math.ceil((Date.now() - startDate.getTime()) / (24 * 60 * 60 * 1000)) : 30;
  const result: Array<{ date: string; lessons: number; xp: number }> = [];

  // Get lessons grouped by day
  const lessons = await prisma.lesson.findMany({
    where: {
      childId,
      ...(startDate && { createdAt: { gte: startDate } }),
    },
    select: {
      createdAt: true,
    },
  });

  // Create a map of dates to counts
  const lessonsByDate = new Map<string, number>();
  lessons.forEach(lesson => {
    const dateKey = lesson.createdAt.toISOString().split('T')[0];
    lessonsByDate.set(dateKey, (lessonsByDate.get(dateKey) || 0) + 1);
  });

  // Generate array of days
  const actualDays = Math.min(days, 30); // Cap at 30 days for chart
  for (let i = actualDays - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    result.push({
      date: dateKey,
      lessons: lessonsByDate.get(dateKey) || 0,
      xp: 0, // XP tracking by day would need separate table
    });
  }

  return result;
}

// Helper function to format study time
function formatStudyTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

export default router;
