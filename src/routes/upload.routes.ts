import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteFile,
  deleteAllChildContent,
  listChildContent,
} from '../services/storageService.js';
import { getCdnUrl } from '../lib/r2Client.js';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const presignedUploadSchema = z.object({
  childId: z.string().min(1),
  contentType: z.enum(['lesson', 'profile']),
  filename: z.string().min(1).max(255),
  mimeType: z.enum([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
  ]),
  fileSize: z.number().positive().max(10 * 1024 * 1024), // 10MB max
  lessonId: z.string().optional(),
});

// ============================================
// MIDDLEWARE (Placeholder - implement real auth later)
// ============================================

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    familyId: string;
  };
}

// Placeholder auth middleware - replace with real Firebase auth
const authenticateParent = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // TODO: Implement Firebase authentication
  // For now, use test values - REPLACE WITH REAL AUTH
  req.user = {
    id: 'test-user-id',
    familyId: 'test-family-id',
  };
  next();
};

// Placeholder child access auth - verify parent owns child
const authorizeChildAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // TODO: Implement real child access verification
  // Should verify that the child belongs to the authenticated parent's family
  next();
};

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/upload/presigned
 * Get a presigned URL for direct upload to R2
 */
router.post(
  '/presigned',
  authenticateParent,
  authorizeChildAccess,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const validatedBody = presignedUploadSchema.parse(req.body);
      const { childId, contentType, filename, mimeType, fileSize, lessonId } = validatedBody;
      const familyId = req.user!.familyId;

      const result = await getPresignedUploadUrl({
        familyId,
        childId,
        contentType,
        filename,
        mimeType,
        fileSize,
        lessonId,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }
      next(error);
    }
  }
);

/**
 * GET /api/upload/download/:storagePath
 * Get a presigned URL for viewing/downloading content
 */
router.get(
  '/download/*',
  authenticateParent,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Extract storagePath from wildcard param
      const storagePath = req.params[0];
      const familyId = req.user!.familyId;

      if (!storagePath) {
        res.status(400).json({
          success: false,
          error: 'Storage path required',
        });
        return;
      }

      // Verify the file belongs to this family (COPPA compliance)
      if (!storagePath.includes(`/${familyId}/`)) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
        });
        return;
      }

      const downloadUrl = await getPresignedDownloadUrl(storagePath);

      res.json({
        success: true,
        data: { downloadUrl },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/upload/:storagePath
 * Delete a specific file
 */
router.delete(
  '/file/*',
  authenticateParent,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const storagePath = req.params[0];
      const familyId = req.user!.familyId;

      if (!storagePath) {
        res.status(400).json({
          success: false,
          error: 'Storage path required',
        });
        return;
      }

      // Verify the file belongs to this family
      if (!storagePath.includes(`/${familyId}/`)) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
        });
        return;
      }

      await deleteFile('uploads', storagePath);

      res.json({
        success: true,
        message: 'File deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/upload/child/:childId
 * Delete ALL content for a child (COPPA: parent-requested deletion)
 */
router.delete(
  '/child/:childId',
  authenticateParent,
  authorizeChildAccess,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const familyId = req.user!.familyId;

      const result = await deleteAllChildContent(familyId, childId);

      res.json({
        success: true,
        message: `Deleted ${result.deleted} files`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/upload/child/:childId
 * List all content for a child (parent dashboard)
 */
router.get(
  '/child/:childId',
  authenticateParent,
  authorizeChildAccess,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const familyId = req.user!.familyId;

      const files = await listChildContent(familyId, childId);

      res.json({
        success: true,
        data: { files },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/upload/confirm
 * Confirm upload completion and run safety checks
 */
router.post(
  '/confirm',
  authenticateParent,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { storagePath, childId } = req.body;
      const familyId = req.user!.familyId;

      if (!storagePath || !childId) {
        res.status(400).json({
          success: false,
          error: 'storagePath and childId required',
        });
        return;
      }

      // Verify ownership
      if (!storagePath.includes(`/${familyId}/`)) {
        res.status(403).json({
          success: false,
          error: 'Access denied',
        });
        return;
      }

      // TODO: Add content safety checks here
      // For now, just confirm the upload

      // Determine bucket based on path
      const bucketKey = storagePath.startsWith('images/') ||
                        storagePath.startsWith('videos/') ||
                        storagePath.startsWith('audio/')
                        ? 'aiContent' as const
                        : 'uploads' as const;

      res.json({
        success: true,
        data: {
          storagePath,
          publicUrl: getCdnUrl(bucketKey, storagePath),
          requiresReview: false,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
