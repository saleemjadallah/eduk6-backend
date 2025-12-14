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
import { logger } from '../utils/logger.js';

// Allowed MIME types for uploads
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

// File extension to MIME type mapping
const EXTENSION_MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// Magic bytes for file type detection
const MAGIC_BYTES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'image/png': [0x89, 0x50, 0x4E, 0x47],        // PNG
  'image/jpeg': [0xFF, 0xD8, 0xFF],             // JPEG
  'image/webp': [0x52, 0x49, 0x46, 0x46],       // RIFF (WebP container)
};

/**
 * Validate file type matches expected MIME type based on file extension
 */
function validateFileExtension(filename: string, expectedMimeType: string): boolean {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  const expectedExtension = EXTENSION_MIME_MAP[extension];
  return expectedExtension === expectedMimeType;
}

/**
 * Check if file size is within allowed limits
 */
function validateFileSize(fileSize: number, mimeType: string): { valid: boolean; maxSize: number } {
  // Different size limits based on file type
  const maxSizes: Record<string, number> = {
    'application/pdf': 10 * 1024 * 1024,  // 10MB for PDFs
    'image/png': 5 * 1024 * 1024,          // 5MB for images
    'image/jpeg': 5 * 1024 * 1024,
    'image/webp': 5 * 1024 * 1024,
    'application/vnd.ms-powerpoint': 20 * 1024 * 1024,  // 20MB for PowerPoints
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 20 * 1024 * 1024,
  };

  const maxSize = maxSizes[mimeType] || 10 * 1024 * 1024;
  return { valid: fileSize <= maxSize, maxSize };
}

/**
 * Sanitize filename to prevent path traversal attacks
 */
function sanitizeFilename(filename: string): string {
  // Remove any path components
  let sanitized = filename.replace(/^.*[\\\/]/, '');
  // Remove any null bytes
  sanitized = sanitized.replace(/\0/g, '');
  // Remove any sequences that could be used for traversal
  sanitized = sanitized.replace(/\.\./g, '');
  // Limit length
  if (sanitized.length > 255) {
    const ext = sanitized.match(/\.[^.]+$/)?.[0] || '';
    sanitized = sanitized.substring(0, 255 - ext.length) + ext;
  }
  return sanitized;
}

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

      // Security validation: Check file extension matches MIME type
      if (!validateFileExtension(filename, mimeType)) {
        logger.warn('File extension mismatch', {
          filename,
          mimeType,
          familyId,
          childId,
        });
        res.status(400).json({
          success: false,
          error: 'File extension does not match the specified file type',
        });
        return;
      }

      // Security validation: Check MIME type is allowed
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        logger.warn('Disallowed MIME type', { mimeType, familyId, childId });
        res.status(400).json({
          success: false,
          error: 'File type not allowed',
        });
        return;
      }

      // Security validation: Check file size is within limits
      const sizeCheck = validateFileSize(fileSize, mimeType);
      if (!sizeCheck.valid) {
        logger.warn('File too large', { fileSize, maxSize: sizeCheck.maxSize, familyId, childId });
        res.status(400).json({
          success: false,
          error: `File too large. Maximum size is ${Math.round(sizeCheck.maxSize / 1024 / 1024)}MB`,
        });
        return;
      }

      // Sanitize filename
      const sanitizedFilename = sanitizeFilename(filename);

      const result = await getPresignedUploadUrl({
        familyId,
        childId,
        contentType,
        filename: sanitizedFilename,
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

      // Verify ownership - storage path must contain the family ID
      if (!storagePath.includes(`/${familyId}/`)) {
        logger.warn('Upload confirm access denied - path mismatch', {
          storagePath,
          familyId,
          childId,
        });
        res.status(403).json({
          success: false,
          error: 'Access denied',
        });
        return;
      }

      // Safety validation: Check file extension is allowed
      const extension = storagePath.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
      const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.ppt', '.pptx'];
      if (!allowedExtensions.includes(extension)) {
        logger.warn('Upload confirm rejected - invalid extension', {
          storagePath,
          extension,
          familyId,
          childId,
        });
        res.status(400).json({
          success: false,
          error: 'Invalid file type',
        });
        return;
      }

      // Safety validation: Check for path traversal attempts
      if (storagePath.includes('..') || storagePath.includes('\0')) {
        logger.error('Potential path traversal attack detected', {
          storagePath,
          familyId,
          childId,
        });
        res.status(400).json({
          success: false,
          error: 'Invalid file path',
        });
        return;
      }

      // Log successful upload confirmation for audit trail
      logger.info('Upload confirmed', {
        storagePath,
        familyId,
        childId,
        extension,
      });

      // Determine bucket based on path
      const bucketKey = storagePath.startsWith('images/') ||
                        storagePath.startsWith('videos/') ||
                        storagePath.startsWith('audio/')
                        ? 'aiContent' as const
                        : 'uploads' as const;

      // Note: Additional content safety is enforced during processing:
      // - Gemini's built-in safety filters block inappropriate content
      // - The content processor validates text content via safetyFilters
      // - Parents can review all content via the dashboard

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
