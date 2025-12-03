// Safety logs routes for parent dashboard
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../config/database.js';
import { SafetyIncidentType, SafetySeverity, Prisma } from '@prisma/client';

const router = Router();

/**
 * GET /api/parent/safety/incidents
 * Get paginated list of safety incidents across all children
 * Supports filtering, sorting, and pagination
 */
router.get('/incidents', authenticate, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

    // Filter parameters
    const childId = req.query.childId as string | undefined;
    const severity = req.query.severity as SafetySeverity | undefined;
    const incidentType = req.query.incidentType as SafetyIncidentType | undefined;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const reviewed = req.query.reviewed as string | undefined;

    // Build where clause
    const where: Prisma.SafetyLogWhereInput = {
      child: { parentId },
    };

    // Apply filters
    if (childId) {
      where.childId = childId;
    }
    if (severity && Object.values(SafetySeverity).includes(severity)) {
      where.severity = severity;
    }
    if (incidentType && Object.values(SafetyIncidentType).includes(incidentType)) {
      where.incidentType = incidentType;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) {
        // Include the entire end date
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        where.createdAt.lte = endOfDay;
      }
    }
    if (reviewed === 'true') {
      where.parentAction = { not: null };
    } else if (reviewed === 'false') {
      where.parentAction = null;
    }

    // Valid sort fields
    const validSortFields = ['createdAt', 'severity', 'incidentType'];
    const orderByField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';

    // Get total count for pagination
    const total = await prisma.safetyLog.count({ where });

    // Get incidents with pagination
    const incidents = await prisma.safetyLog.findMany({
      where,
      include: {
        child: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { [orderByField]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Format response
    const formattedIncidents = incidents.map(incident => ({
      id: incident.id,
      childId: incident.childId,
      childName: incident.child.displayName,
      childAvatar: incident.child.avatarUrl,
      incidentType: incident.incidentType,
      severity: incident.severity,
      wasBlocked: incident.wasBlocked,
      reviewed: incident.parentAction !== null,
      parentAction: incident.parentAction,
      createdAt: incident.createdAt,
      flags: incident.flags,
    }));

    res.json({
      success: true,
      data: {
        incidents: formattedIncidents,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/parent/safety/summary
 * Get summary statistics for safety incidents
 */
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    // Get all children IDs for this parent
    const children = await prisma.child.findMany({
      where: { parentId },
      select: { id: true, displayName: true },
    });
    const childIds = children.map(c => c.id);

    if (childIds.length === 0) {
      return res.json({
        success: true,
        data: {
          totalIncidents: 0,
          bySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
          unreviewedCount: 0,
          last7Days: { total: 0, trend: [0, 0, 0, 0, 0, 0, 0] },
          byChild: [],
        },
      });
    }

    // Total incidents
    const totalIncidents = await prisma.safetyLog.count({
      where: { childId: { in: childIds } },
    });

    // Count by severity
    const severityCounts = await prisma.safetyLog.groupBy({
      by: ['severity'],
      where: { childId: { in: childIds } },
      _count: { id: true },
    });

    const bySeverity = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    severityCounts.forEach(s => {
      bySeverity[s.severity] = s._count.id;
    });

    // Unreviewed count
    const unreviewedCount = await prisma.safetyLog.count({
      where: {
        childId: { in: childIds },
        parentAction: null,
      },
    });

    // Last 7 days trend
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const last7DaysIncidents = await prisma.safetyLog.findMany({
      where: {
        childId: { in: childIds },
        createdAt: { gte: sevenDaysAgo },
      },
      select: { createdAt: true },
    });

    // Create daily counts for the last 7 days
    const trend: number[] = [0, 0, 0, 0, 0, 0, 0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    last7DaysIncidents.forEach(incident => {
      const incidentDate = new Date(incident.createdAt);
      incidentDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.floor((today.getTime() - incidentDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo >= 0 && daysAgo < 7) {
        trend[6 - daysAgo]++; // Index 6 is today, 0 is 6 days ago
      }
    });

    // Count by child
    const childCounts = await prisma.safetyLog.groupBy({
      by: ['childId'],
      where: { childId: { in: childIds } },
      _count: { id: true },
    });

    const byChild = children.map(child => ({
      childId: child.id,
      childName: child.displayName,
      count: childCounts.find(c => c.childId === child.id)?._count.id || 0,
    }));

    res.json({
      success: true,
      data: {
        totalIncidents,
        bySeverity,
        unreviewedCount,
        last7Days: {
          total: last7DaysIncidents.length,
          trend,
        },
        byChild,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/parent/safety/incidents/:incidentId
 * Get full details of a specific incident
 */
router.get('/incidents/:incidentId', authenticate, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { incidentId } = req.params;

    const incident = await prisma.safetyLog.findFirst({
      where: {
        id: incidentId,
        child: { parentId },
      },
      include: {
        child: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!incident) {
      return res.status(404).json({
        success: false,
        error: 'Incident not found',
      });
    }

    res.json({
      success: true,
      data: {
        id: incident.id,
        childId: incident.childId,
        childName: incident.child.displayName,
        childAvatar: incident.child.avatarUrl,
        incidentType: incident.incidentType,
        severity: incident.severity,
        inputText: incident.inputText,
        outputText: incident.outputText,
        lessonId: incident.lessonId,
        geminiSafetyRatings: incident.geminiSafetyRatings,
        flags: incident.flags,
        wasBlocked: incident.wasBlocked,
        parentNotified: incident.parentNotified,
        parentNotifiedAt: incident.parentNotifiedAt,
        parentAction: incident.parentAction,
        reviewed: incident.parentAction !== null,
        createdAt: incident.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/parent/safety/incidents/:incidentId
 * Mark incident as reviewed with optional action
 */
router.patch('/incidents/:incidentId', authenticate, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { incidentId } = req.params;
    const { action } = req.body;

    // Validate action if provided
    const validActions = ['acknowledged', 'restricted', 'discussed_with_child', 'dismissed'];
    if (action && !validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: `Invalid action. Must be one of: ${validActions.join(', ')}`,
      });
    }

    // Verify incident belongs to parent's child
    const incident = await prisma.safetyLog.findFirst({
      where: {
        id: incidentId,
        child: { parentId },
      },
    });

    if (!incident) {
      return res.status(404).json({
        success: false,
        error: 'Incident not found',
      });
    }

    // Update incident
    const updatedIncident = await prisma.safetyLog.update({
      where: { id: incidentId },
      data: {
        parentAction: action || 'acknowledged',
        parentNotified: true,
        parentNotifiedAt: new Date(),
      },
      include: {
        child: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: {
        id: updatedIncident.id,
        childName: updatedIncident.child.displayName,
        parentAction: updatedIncident.parentAction,
        parentNotifiedAt: updatedIncident.parentNotifiedAt,
        reviewed: true,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
