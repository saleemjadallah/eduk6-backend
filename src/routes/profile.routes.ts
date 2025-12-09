// Profile routes for managing child profiles
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireParent, authorizeChildAccess } from '../middleware/auth.js';
import { prisma } from '../config/database.js';
import { ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { AgeGroup, LearningStyle, CurriculumType } from '@prisma/client';

const router = Router();

// Helper to map age to AgeGroup (YOUNG: 4-7, OLDER: 8-14)
function getAgeGroup(age: number): AgeGroup {
  if (age >= 4 && age <= 7) return 'YOUNG';
  return 'OLDER';
}

// Helper to map curriculum string to enum
function mapCurriculumType(curriculum: string): CurriculumType {
  const mapping: Record<string, CurriculumType> = {
    american: 'AMERICAN',
    british: 'BRITISH',
    indian: 'INDIAN_CBSE',
    indian_cbse: 'INDIAN_CBSE',
    indian_icse: 'INDIAN_ICSE',
    ib: 'IB',
    arabic: 'ARABIC',
  };
  return mapping[curriculum?.toLowerCase()] || 'AMERICAN';
}

// Helper to map learning style string to enum
function mapLearningStyle(style: string): LearningStyle {
  const mapping: Record<string, LearningStyle> = {
    visual: 'VISUAL',
    auditory: 'AUDITORY',
    reading: 'READING',
    kinesthetic: 'KINESTHETIC',
  };
  return mapping[style?.toLowerCase()] || 'VISUAL';
}

/**
 * POST /api/profiles/children
 * Create a new child profile
 */
router.post(
  '/children',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;
      const {
        displayName,
        age,
        grade,
        avatarId,
        learningStyle,
        curriculumType,
        language = 'en',
        pin = '0000', // Default PIN, can be changed later
      } = req.body;

      // Validation
      if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
        throw new ValidationError('Display name is required');
      }

      if (displayName.length > 50) {
        throw new ValidationError('Display name must be 50 characters or less');
      }

      if (!age || typeof age !== 'number' || age < 4 || age > 14) {
        throw new ValidationError('Age must be between 4 and 14');
      }

      if (grade === undefined || grade === null || grade < 0 || grade > 8) {
        throw new ValidationError('Grade must be between 0 (Pre-K) and 8');
      }

      // Check parent's subscription limit
      const parent = await prisma.parent.findUnique({
        where: { id: parentId },
        include: { children: true },
      });

      if (!parent) {
        throw new NotFoundError('Parent not found');
      }

      // Subscription limits
      const maxChildren: Record<string, number> = {
        FREE: 1,
        FAMILY: 2,
        ANNUAL: 2,
        FAMILY_PLUS: 4,
      };

      const limit = maxChildren[parent.subscriptionTier] || 1;
      if (parent.children.length >= limit) {
        throw new ValidationError(
          `Your subscription allows up to ${limit} child profile${limit > 1 ? 's' : ''}. Please upgrade to add more.`
        );
      }

      // Calculate date of birth from age (approximate - January 1st of birth year)
      const currentYear = new Date().getFullYear();
      const birthYear = currentYear - age;
      const dateOfBirth = new Date(birthYear, 0, 1); // January 1st of birth year

      // Create child profile
      const child = await prisma.child.create({
        data: {
          parentId,
          displayName: displayName.trim(),
          dateOfBirth,
          pin: pin || '0000',
          ageGroup: getAgeGroup(age),
          gradeLevel: grade,
          avatarUrl: avatarId || null,
          learningStyle: mapLearningStyle(learningStyle),
          curriculumType: mapCurriculumType(curriculumType),
          preferredLanguage: language,
        },
        select: {
          id: true,
          displayName: true,
          ageGroup: true,
          gradeLevel: true,
          avatarUrl: true,
          learningStyle: true,
          curriculumType: true,
          preferredLanguage: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        data: child,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/profiles/children
 * Get all child profiles for the authenticated parent
 */
router.get(
  '/children',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parentId = req.parent!.id;

      const children = await prisma.child.findMany({
        where: { parentId },
        select: {
          id: true,
          displayName: true,
          ageGroup: true,
          gradeLevel: true,
          avatarUrl: true,
          learningStyle: true,
          curriculumType: true,
          preferredLanguage: true,
          lastActiveAt: true,
          createdAt: true,
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
  }
);

/**
 * GET /api/profiles/children/:childId
 * Get a specific child profile
 */
router.get(
  '/children/:childId',
  authenticate,
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;

      const child = await prisma.child.findUnique({
        where: { id: childId },
        select: {
          id: true,
          displayName: true,
          ageGroup: true,
          gradeLevel: true,
          avatarUrl: true,
          learningStyle: true,
          curriculumType: true,
          preferredLanguage: true,
          lastActiveAt: true,
          createdAt: true,
        },
      });

      if (!child) {
        throw new NotFoundError('Child profile not found');
      }

      res.json({
        success: true,
        data: child,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/profiles/children/:childId
 * Update a child profile
 */
router.patch(
  '/children/:childId',
  authenticate,
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const {
        displayName,
        avatarId,
        learningStyle,
        curriculumType,
        language,
      } = req.body;

      // Build update data
      const updateData: any = {};

      if (displayName !== undefined) {
        if (typeof displayName !== 'string' || displayName.trim().length === 0) {
          throw new ValidationError('Display name cannot be empty');
        }
        if (displayName.length > 50) {
          throw new ValidationError('Display name must be 50 characters or less');
        }
        updateData.displayName = displayName.trim();
      }

      if (avatarId !== undefined) {
        updateData.avatarUrl = avatarId;
      }

      if (learningStyle !== undefined) {
        updateData.learningStyle = mapLearningStyle(learningStyle);
      }

      if (curriculumType !== undefined) {
        updateData.curriculumType = mapCurriculumType(curriculumType);
      }

      if (language !== undefined) {
        updateData.preferredLanguage = language;
      }

      const child = await prisma.child.update({
        where: { id: childId },
        data: updateData,
        select: {
          id: true,
          displayName: true,
          ageGroup: true,
          gradeLevel: true,
          avatarUrl: true,
          learningStyle: true,
          curriculumType: true,
          preferredLanguage: true,
          lastActiveAt: true,
          createdAt: true,
        },
      });

      res.json({
        success: true,
        data: child,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/profiles/children/:childId
 * Delete a child profile (soft delete by setting deletedAt)
 */
router.delete(
  '/children/:childId',
  authenticate,
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;

      // For now, do a hard delete
      // In production, you might want to soft delete
      await prisma.child.delete({
        where: { id: childId },
      });

      res.json({
        success: true,
        message: 'Child profile deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
