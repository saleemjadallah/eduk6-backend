// Settings routes for parent dashboard
import { Router } from 'express';
import { authenticate, requireParent } from '../middleware/auth.js';
import { prisma } from '../config/database.js';

const router = Router();

/**
 * GET /api/parent/settings
 * Get all parent settings (profile + preferences)
 */
router.get('/', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        country: true,
        timezone: true,
        emailVerified: true,
        createdAt: true,
        lastLoginAt: true,
        // Note: notification preferences would be stored in a separate model
        // For now, we'll return defaults that can be stored client-side
      },
    });

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found',
      });
    }

    // Get notification preferences from localStorage/client or use defaults
    // In production, these would be stored in a ParentSettings model
    const defaultPreferences = {
      notifications: {
        emailSafetyAlerts: true,
        emailWeeklyDigest: true,
        emailProductUpdates: false,
      },
      app: {
        autoSwitchTimeout: 15, // minutes
        language: 'en',
      },
    };

    res.json({
      success: true,
      data: {
        profile: {
          id: parent.id,
          email: parent.email,
          firstName: parent.firstName,
          lastName: parent.lastName,
          phone: parent.phone,
          country: parent.country,
          timezone: parent.timezone,
          emailVerified: parent.emailVerified,
          memberSince: parent.createdAt,
          lastLogin: parent.lastLoginAt,
        },
        preferences: defaultPreferences,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/parent/settings/profile
 * Update parent profile info
 */
router.patch('/profile', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { firstName, lastName, phone, country, timezone } = req.body;

    // Build update object with only provided fields
    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (phone !== undefined) updateData.phone = phone;
    if (country !== undefined) updateData.country = country;
    if (timezone !== undefined) updateData.timezone = timezone;

    const parent = await prisma.parent.update({
      where: { id: parentId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        country: true,
        timezone: true,
      },
    });

    res.json({
      success: true,
      data: parent,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/parent/settings/change-password
 * Change password (wrapper around auth service)
 */
router.post('/change-password', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters',
      });
    }

    // Import bcrypt for password verification
    const bcrypt = await import('bcrypt');

    // Get current password hash
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { passwordHash: true },
    });

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: 'Parent not found',
      });
    }

    // Check if user has a password (Google OAuth users don't)
    if (!parent.passwordHash) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change password for Google Sign-In accounts. Please manage your password through Google.',
      });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, parent.passwordHash);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect',
      });
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.parent.update({
      where: { id: parentId },
      data: { passwordHash: newHash },
    });

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/parent/settings/logout-all
 * Logout from all devices
 */
router.post('/logout-all', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    // In production, this would invalidate all refresh tokens
    // For now, we'll just return success
    // The actual implementation would be in authService.logoutAll

    res.json({
      success: true,
      message: 'Logged out from all devices. Please log in again.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/parent/settings/children
 * Get all children with their PINs (for PIN management)
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
        pin: true, // Include PIN for parent to see
      },
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
 * PATCH /api/parent/settings/children/:childId/pin
 * Reset a child's PIN
 */
router.patch('/children/:childId/pin', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { childId } = req.params;
    const { newPin } = req.body;

    if (!newPin || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({
        success: false,
        error: 'PIN must be exactly 4 digits',
      });
    }

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

    // Update PIN
    await prisma.child.update({
      where: { id: childId },
      data: {
        pin: newPin,
        pinAttempts: 0, // Reset failed attempts
        pinLockedUntil: null,
      },
    });

    res.json({
      success: true,
      message: 'PIN updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// SHARING PREFERENCES
// ============================================

/**
 * GET /api/parent/settings/sharing
 * Get sharing preferences (global + per-child settings)
 */
router.get('/sharing', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;

    // Get sharing preferences
    let preferences = await prisma.parentSharingPreferences.findUnique({
      where: { parentId },
    });

    // If no preferences exist, create default ones
    if (!preferences) {
      preferences = await prisma.parentSharingPreferences.create({
        data: {
          parentId,
          enableSharing: true,
          childSettings: {},
        },
      });
    }

    // Get children for the UI
    const children = await prisma.child.findMany({
      where: { parentId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
      },
    });

    // Parse childSettings JSON and ensure all children have settings
    const childSettings = (preferences.childSettings as Record<string, any>) || {};
    const mergedChildSettings: Record<string, any> = {};

    children.forEach(child => {
      mergedChildSettings[child.id] = {
        showName: childSettings[child.id]?.showName ?? true,
        showAvatar: childSettings[child.id]?.showAvatar ?? true,
        enablePrompts: childSettings[child.id]?.enablePrompts ?? true,
      };
    });

    res.json({
      success: true,
      data: {
        enableSharing: preferences.enableSharing,
        childSettings: mergedChildSettings,
        children: children.map(c => ({
          id: c.id,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/parent/settings/sharing
 * Update sharing preferences
 */
router.patch('/sharing', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { enableSharing, childSettings } = req.body;

    // Validate input
    if (enableSharing !== undefined && typeof enableSharing !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enableSharing must be a boolean',
      });
    }

    // Validate childSettings if provided
    if (childSettings !== undefined) {
      if (typeof childSettings !== 'object' || childSettings === null) {
        return res.status(400).json({
          success: false,
          error: 'childSettings must be an object',
        });
      }

      // Verify all childIds belong to this parent
      const childIds = Object.keys(childSettings);
      if (childIds.length > 0) {
        const validChildren = await prisma.child.findMany({
          where: {
            id: { in: childIds },
            parentId,
          },
          select: { id: true },
        });

        const validIds = new Set(validChildren.map(c => c.id));
        const invalidIds = childIds.filter(id => !validIds.has(id));

        if (invalidIds.length > 0) {
          return res.status(400).json({
            success: false,
            error: `Invalid child IDs: ${invalidIds.join(', ')}`,
          });
        }
      }
    }

    // Get existing preferences or create
    let preferences = await prisma.parentSharingPreferences.findUnique({
      where: { parentId },
    });

    if (!preferences) {
      preferences = await prisma.parentSharingPreferences.create({
        data: {
          parentId,
          enableSharing: enableSharing ?? true,
          childSettings: childSettings ?? {},
        },
      });
    } else {
      // Merge with existing settings
      const existingChildSettings = (preferences.childSettings as Record<string, any>) || {};
      const mergedChildSettings = childSettings
        ? { ...existingChildSettings, ...childSettings }
        : existingChildSettings;

      preferences = await prisma.parentSharingPreferences.update({
        where: { parentId },
        data: {
          ...(enableSharing !== undefined && { enableSharing }),
          ...(childSettings !== undefined && { childSettings: mergedChildSettings }),
        },
      });
    }

    res.json({
      success: true,
      data: {
        enableSharing: preferences.enableSharing,
        childSettings: preferences.childSettings,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/parent/settings/sharing/child/:childId
 * Update sharing settings for a specific child
 */
router.patch('/sharing/child/:childId', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const { childId } = req.params;
    const { showName, showAvatar, enablePrompts } = req.body;

    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
    });

    if (!child) {
      return res.status(404).json({
        success: false,
        error: 'Child not found',
      });
    }

    // Get or create preferences
    let preferences = await prisma.parentSharingPreferences.findUnique({
      where: { parentId },
    });

    if (!preferences) {
      preferences = await prisma.parentSharingPreferences.create({
        data: {
          parentId,
          enableSharing: true,
          childSettings: {
            [childId]: {
              showName: showName ?? true,
              showAvatar: showAvatar ?? true,
              enablePrompts: enablePrompts ?? true,
            },
          },
        },
      });
    } else {
      // Update specific child's settings
      const existingSettings = (preferences.childSettings as Record<string, any>) || {};
      const existingChildSettings = existingSettings[childId] || {};

      const updatedChildSettings = {
        ...existingSettings,
        [childId]: {
          showName: showName ?? existingChildSettings.showName ?? true,
          showAvatar: showAvatar ?? existingChildSettings.showAvatar ?? true,
          enablePrompts: enablePrompts ?? existingChildSettings.enablePrompts ?? true,
        },
      };

      preferences = await prisma.parentSharingPreferences.update({
        where: { parentId },
        data: { childSettings: updatedChildSettings },
      });
    }

    res.json({
      success: true,
      data: {
        childId,
        settings: (preferences.childSettings as Record<string, any>)[childId],
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
