// OCR routes for extracting text from images
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateInput } from '../middleware/validateInput.js';
import { geminiService } from '../services/ai/geminiService.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const extractTextSchema = z.object({
  image: z.string().min(100, 'Image data is required'), // Base64 encoded image
  filename: z.string().optional(),
  mimeType: z.string().optional().default('image/jpeg'),
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/ocr/extract
 * Extract text from an image using Gemini Vision (OCR)
 * Used for camera capture of worksheets, textbooks, notes, etc.
 */
router.post(
  '/extract',
  validateInput(extractTextSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { image, filename, mimeType } = req.body;

      logger.info('OCR extraction request', {
        filename,
        mimeType,
        imageSize: image.length,
      });

      // Extract text using Gemini Vision
      const result = await geminiService.extractTextFromImage(image, mimeType);

      if (!result.text) {
        logger.warn('No text extracted from image', { filename });
        return res.status(400).json({
          success: false,
          error: 'No text could be extracted from the image',
          message: 'Please ensure the image contains readable text and try again.',
        });
      }

      logger.info('OCR extraction successful', {
        filename,
        textLength: result.text.length,
        confidence: result.confidence,
      });

      res.json({
        success: true,
        data: {
          text: result.text,
          confidence: result.confidence,
          metadata: result.metadata,
        },
      });
    } catch (error) {
      logger.error('OCR extraction error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: 'Failed to extract text from image',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default router;
