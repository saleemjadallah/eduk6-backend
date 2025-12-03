// Privacy controls routes for parent dashboard
import { Router } from 'express';
import { authenticate, requireParent } from '../middleware/auth.js';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * GET /api/parent/privacy
 * Get privacy settings and consent status
 */
router.get('/', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    // Get parent with consent info
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        consents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            method: true,
            status: true,
            consentGivenAt: true,
            expiresAt: true,
          },
        },
        children: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found',
      });
    }

    // Get latest consent
    const latestConsent = parent.consents[0] || null;

    // Get privacy preferences from database (or use defaults if not set)
    const storedPreferences = await prisma.parentPrivacyPreferences.findUnique({
      where: { parentId },
    });

    const privacyPreferences = {
      dataCollection: {
        learningAnalytics: storedPreferences?.learningAnalytics ?? true,
        usageAnalytics: storedPreferences?.usageAnalytics ?? true,
        personalization: storedPreferences?.personalization ?? true,
      },
      dataSharing: {
        thirdPartyAnalytics: storedPreferences?.thirdPartyAnalytics ?? false,
        improvementResearch: storedPreferences?.improvementResearch ?? false,
      },
    };

    // Data summary
    const dataSummary = await getDataSummary(parentId);

    res.json({
      success: true,
      data: {
        consent: latestConsent ? {
          status: latestConsent.status,
          method: latestConsent.method,
          grantedAt: latestConsent.consentGivenAt,
          expiresAt: latestConsent.expiresAt,
        } : null,
        preferences: privacyPreferences,
        dataSummary,
        children: parent.children,
        accountCreated: parent.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/parent/privacy
 * Update privacy preferences
 */
router.patch('/', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { dataCollection, dataSharing } = req.body;

    // Upsert privacy preferences to database
    const updatedRecord = await prisma.parentPrivacyPreferences.upsert({
      where: { parentId },
      update: {
        learningAnalytics: dataCollection?.learningAnalytics ?? true,
        usageAnalytics: dataCollection?.usageAnalytics ?? true,
        personalization: dataCollection?.personalization ?? true,
        thirdPartyAnalytics: dataSharing?.thirdPartyAnalytics ?? false,
        improvementResearch: dataSharing?.improvementResearch ?? false,
      },
      create: {
        parentId,
        learningAnalytics: dataCollection?.learningAnalytics ?? true,
        usageAnalytics: dataCollection?.usageAnalytics ?? true,
        personalization: dataCollection?.personalization ?? true,
        thirdPartyAnalytics: dataSharing?.thirdPartyAnalytics ?? false,
        improvementResearch: dataSharing?.improvementResearch ?? false,
      },
    });

    // Return in the same format the frontend expects
    const updatedPreferences = {
      dataCollection: {
        learningAnalytics: updatedRecord.learningAnalytics,
        usageAnalytics: updatedRecord.usageAnalytics,
        personalization: updatedRecord.personalization,
      },
      dataSharing: {
        thirdPartyAnalytics: updatedRecord.thirdPartyAnalytics,
        improvementResearch: updatedRecord.improvementResearch,
      },
    };

    res.json({
      success: true,
      data: updatedPreferences,
      message: 'Privacy preferences updated',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/parent/privacy/export-data
 * Request data export (GDPR/COPPA compliance)
 */
router.post('/export-data', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    // Get all parent data
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: {
        children: {
          include: {
            lessons: {
              select: {
                id: true,
                title: true,
                subject: true,
                createdAt: true,
                percentComplete: true,
              },
            },
            progress: true,
            streak: true,
            earnedBadges: {
              include: { badge: true },
            },
            safetyLogs: {
              select: {
                id: true,
                incidentType: true,
                severity: true,
                createdAt: true,
                wasBlocked: true,
              },
            },
          },
        },
        consents: true,
      },
    });

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found',
      });
    }

    // Format data for export (remove sensitive fields)
    const exportData = {
      exportDate: new Date().toISOString(),
      account: {
        email: parent.email,
        firstName: parent.firstName,
        lastName: parent.lastName,
        country: parent.country,
        timezone: parent.timezone,
        createdAt: parent.createdAt,
        subscriptionTier: parent.subscriptionTier,
      },
      children: parent.children.map(child => ({
        displayName: child.displayName,
        ageGroup: child.ageGroup,
        gradeLevel: child.gradeLevel,
        learningStyle: child.learningStyle,
        curriculumType: child.curriculumType,
        createdAt: child.createdAt,
        lessons: child.lessons,
        progress: child.progress,
        streak: child.streak,
        badges: child.earnedBadges.map(eb => ({
          name: eb.badge.name,
          earnedAt: eb.earnedAt,
        })),
        safetyIncidents: child.safetyLogs.length,
      })),
      consents: parent.consents.map(c => ({
        method: c.method,
        status: c.status,
        grantedAt: c.consentGivenAt,
      })),
    };

    // In production, this would:
    // 1. Queue a background job to compile the data
    // 2. Send an email with a download link
    // For now, we return the data directly

    res.json({
      success: true,
      data: exportData,
      message: 'Data export generated. In production, this would be emailed to you.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/parent/privacy/consent-history
 * Get consent history
 */
router.get('/consent-history', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    const consents = await prisma.consent.findMany({
      where: { parentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        method: true,
        status: true,
        consentGivenAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    res.json({
      success: true,
      data: consents,
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to get data summary
async function getDataSummary(parentId: string) {
  const children = await prisma.child.findMany({
    where: { parentId },
    select: { id: true },
  });

  const childIds = children.map(c => c.id);

  if (childIds.length === 0) {
    return {
      totalLessons: 0,
      totalChatMessages: 0,
      totalSafetyLogs: 0,
      totalFlashcards: 0,
      accountAgeMonths: 0,
    };
  }

  const [lessonsCount, chatCount, safetyCount, flashcardCount, parent] = await Promise.all([
    prisma.lesson.count({ where: { childId: { in: childIds } } }),
    prisma.chatMessage.count({ where: { childId: { in: childIds } } }),
    prisma.safetyLog.count({ where: { childId: { in: childIds } } }),
    prisma.flashcardDeck.count({ where: { childId: { in: childIds } } }),
    prisma.parent.findUnique({ where: { id: parentId }, select: { createdAt: true } }),
  ]);

  const accountAgeMonths = parent
    ? Math.floor((Date.now() - new Date(parent.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30))
    : 0;

  return {
    totalLessons: lessonsCount,
    totalChatMessages: chatCount,
    totalSafetyLogs: safetyCount,
    totalFlashcards: flashcardCount,
    accountAgeMonths,
  };
}

export default router;
