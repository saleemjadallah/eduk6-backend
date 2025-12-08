/**
 * Export Routes for Teacher Content
 * Handles PDF export and Google Drive integration
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireTeacher } from '../../middleware/teacherAuth.js';
import { prisma } from '../../config/database.js';
import { exportContent, exportMultipleContent, ExportOptions } from '../../services/teacher/exportService.js';
import * as googleDriveService from '../../services/teacher/googleDriveService.js';

const router = Router();

// All routes require teacher authentication
router.use(requireTeacher);

// Validation schemas
const exportOptionsSchema = z.object({
  format: z.enum(['pdf', 'html']).default('pdf'),
  includeAnswers: z.boolean().default(true),
  includeTeacherNotes: z.boolean().default(true),
  paperSize: z.enum(['letter', 'a4']).default('letter'),
  colorScheme: z.enum(['color', 'grayscale']).default('color'),
});

const batchExportSchema = z.object({
  contentIds: z.array(z.string().uuid()).min(1).max(20),
  options: exportOptionsSchema.optional(),
});

// ============================================
// PDF EXPORT ROUTES
// ============================================

/**
 * Export single content to PDF/HTML
 * GET /api/teacher/export/:contentId
 */
router.get('/:contentId', async (req: Request, res: Response) => {
  try {
    const { contentId } = req.params;
    const teacherId = req.teacher!.id;

    // Parse query params
    const options: ExportOptions = {
      format: (req.query.format as 'pdf' | 'html') || 'pdf',
      includeAnswers: req.query.includeAnswers !== 'false',
      includeTeacherNotes: req.query.includeTeacherNotes !== 'false',
      paperSize: (req.query.paperSize as 'letter' | 'a4') || 'letter',
      colorScheme: (req.query.colorScheme as 'color' | 'grayscale') || 'color',
    };

    // Verify content exists and belongs to teacher
    const content = await prisma.teacherContent.findFirst({
      where: {
        id: contentId,
        teacherId,
      },
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Content not found',
      });
    }

    // Generate export
    const result = await exportContent(content, options);

    // Set response headers
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);

    // Send file
    return res.send(result.data);
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to export content',
    });
  }
});

/**
 * Export multiple content items as single PDF
 * POST /api/teacher/export/batch
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const { contentIds, options } = batchExportSchema.parse(req.body);

    // Fetch all content
    const contents = await prisma.teacherContent.findMany({
      where: {
        id: { in: contentIds },
        teacherId,
      },
    });

    if (contents.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No content found',
      });
    }

    // Generate combined export
    const result = await exportMultipleContent(contents, options);

    // Set response headers
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);

    return res.send(result.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Batch export error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to export content',
    });
  }
});

// ============================================
// GOOGLE DRIVE ROUTES
// ============================================

/**
 * Check Google Drive connection status
 * GET /api/teacher/export/drive/status
 */
router.get('/drive/status', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const connected = await googleDriveService.isGoogleDriveConnected(teacherId);

    return res.json({
      success: true,
      data: {
        connected,
      },
    });
  } catch (error) {
    console.error('Drive status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check Drive status',
    });
  }
});

/**
 * Get Google Drive authorization URL
 * GET /api/teacher/export/drive/auth-url
 */
router.get('/drive/auth-url', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;

    // Include teacher ID in state for callback
    const state = Buffer.from(JSON.stringify({ teacherId })).toString('base64');
    const authUrl = googleDriveService.getAuthorizationUrl(state);

    return res.json({
      success: true,
      data: {
        authUrl,
      },
    });
  } catch (error) {
    console.error('Auth URL error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL',
    });
  }
});

/**
 * Handle Google OAuth callback
 * POST /api/teacher/export/drive/callback
 */
router.post('/drive/callback', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code required',
      });
    }

    // Exchange code for tokens
    const tokens = await googleDriveService.exchangeCodeForTokens(code);

    // Save tokens for teacher
    await googleDriveService.saveTeacherDriveTokens(teacherId, tokens);

    return res.json({
      success: true,
      message: 'Google Drive connected successfully',
    });
  } catch (error) {
    console.error('Drive callback error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to connect Google Drive',
    });
  }
});

/**
 * Disconnect Google Drive
 * DELETE /api/teacher/export/drive/disconnect
 */
router.delete('/drive/disconnect', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    await googleDriveService.disconnectGoogleDrive(teacherId);

    return res.json({
      success: true,
      message: 'Google Drive disconnected',
    });
  } catch (error) {
    console.error('Drive disconnect error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect Google Drive',
    });
  }
});

/**
 * Save content to Google Drive
 * POST /api/teacher/export/:contentId/drive
 */
router.post('/:contentId/drive', async (req: Request, res: Response) => {
  try {
    const { contentId } = req.params;
    const teacherId = req.teacher!.id;

    // Parse options
    const options: ExportOptions = {
      format: 'pdf',
      includeAnswers: req.body.includeAnswers !== false,
      includeTeacherNotes: req.body.includeTeacherNotes !== false,
      paperSize: req.body.paperSize || 'letter',
      colorScheme: req.body.colorScheme || 'color',
    };

    // Verify content exists and belongs to teacher
    const content = await prisma.teacherContent.findFirst({
      where: {
        id: contentId,
        teacherId,
      },
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Content not found',
      });
    }

    // Generate PDF
    const exportResult = await exportContent(content, options);

    // Upload to Drive
    const driveResult = await googleDriveService.uploadToDrive(teacherId, {
      name: exportResult.filename,
      mimeType: exportResult.mimeType,
      data: exportResult.data as Buffer,
    }, {
      description: `Exported from Orbit Learn: ${content.title}`,
    });

    if (!driveResult.success) {
      return res.status(400).json({
        success: false,
        error: driveResult.error,
      });
    }

    return res.json({
      success: true,
      data: {
        fileId: driveResult.fileId,
        webViewLink: driveResult.webViewLink,
      },
    });
  } catch (error) {
    console.error('Drive upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save to Google Drive',
    });
  }
});

/**
 * Save multiple content items to Google Drive
 * POST /api/teacher/export/batch/drive
 */
router.post('/batch/drive', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const { contentIds, options } = batchExportSchema.parse(req.body);

    // Fetch all content
    const contents = await prisma.teacherContent.findMany({
      where: {
        id: { in: contentIds },
        teacherId,
      },
    });

    if (contents.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No content found',
      });
    }

    // Generate combined PDF
    const exportResult = await exportMultipleContent(contents, options);

    // Upload to Drive
    const driveResult = await googleDriveService.uploadToDrive(teacherId, {
      name: exportResult.filename,
      mimeType: exportResult.mimeType,
      data: exportResult.data,
    }, {
      description: `Batch export from Orbit Learn (${contents.length} items)`,
    });

    if (!driveResult.success) {
      return res.status(400).json({
        success: false,
        error: driveResult.error,
      });
    }

    return res.json({
      success: true,
      data: {
        fileId: driveResult.fileId,
        webViewLink: driveResult.webViewLink,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('Batch Drive upload error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save to Google Drive',
    });
  }
});

/**
 * List files in Google Drive Orbit Learn folder
 * GET /api/teacher/export/drive/files
 */
router.get('/drive/files', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const pageToken = req.query.pageToken as string | undefined;

    const result = await googleDriveService.listDriveFiles(teacherId, pageSize, pageToken);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    return res.json({
      success: true,
      data: {
        files: result.files,
        nextPageToken: result.nextPageToken,
      },
    });
  } catch (error) {
    console.error('Drive list error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list Drive files',
    });
  }
});

/**
 * Delete file from Google Drive
 * DELETE /api/teacher/export/drive/files/:fileId
 */
router.delete('/drive/files/:fileId', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const { fileId } = req.params;

    const result = await googleDriveService.deleteFromDrive(teacherId, fileId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    return res.json({
      success: true,
      message: 'File deleted from Drive',
    });
  } catch (error) {
    console.error('Drive delete error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete file',
    });
  }
});

export default router;
