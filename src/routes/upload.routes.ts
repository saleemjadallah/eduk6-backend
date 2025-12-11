// Upload routes for file handling
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteFile,
  deleteAllChildContent,
  listChildContent,
} from '../services/storage/storageService.js';
import { getCdnUrl } from '../config/r2.js';
import { authenticate, requireParent, authorizeChildAccess } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { uploadRateLimit } from '../middleware/rateLimit.js';

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
    'application/vnd.ms-powerpoint',                                            // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  ]),
  fileSize: z.number().positive().max(10 * 1024 * 1024), // 10MB max
  lessonId: z.string().optional(),
});

const confirmUploadSchema = z.object({
  storagePath: z.string().min(1),
  childId: z.string().min(1),
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/upload/presigned
 * Get a presigned URL for direct upload to R2
 */
router.post(
  '/presigned',
  authenticate,
  requireParent,
  uploadRateLimit,
  validateInput(presignedUploadSchema),
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId, contentType, filename, mimeType, fileSize, lessonId } = req.body;
      const familyId = req.parent!.id;

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
      next(error);
    }
  }
);

/**
 * GET /api/upload/download/*
 * Get a presigned URL for viewing/downloading content
 */
router.get(
  '/download/*',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract storagePath from wildcard param
      const storagePath = req.params[0];
      const familyId = req.parent!.id;

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
 * DELETE /api/upload/file/*
 * Delete a specific file
 */
router.delete(
  '/file/*',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const storagePath = req.params[0];
      const familyId = req.parent!.id;

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
  authenticate,
  requireParent,
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const familyId = req.parent!.id;

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
  authenticate,
  requireParent,
  authorizeChildAccess(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const familyId = req.parent!.id;

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
  authenticate,
  requireParent,
  validateInput(confirmUploadSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { storagePath, childId } = req.body;
      const familyId = req.parent!.id;

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
