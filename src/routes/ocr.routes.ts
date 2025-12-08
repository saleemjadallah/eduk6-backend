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
 * Enhanced with detailed logging for iPad debugging
 */
router.post(
  '/extract',
  validateInput(extractTextSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.headers['x-request-id'] || `ocr-${Date.now()}`;
    const userAgent = req.headers['user-agent'] || 'unknown';

    try {
      const { image, filename, mimeType } = req.body;

      // Detect platform from user agent
      const isIPad = userAgent.toLowerCase().includes('ipad');
      const isIOS = userAgent.toLowerCase().includes('iphone') || isIPad;
      const isSafari = userAgent.toLowerCase().includes('safari') && !userAgent.toLowerCase().includes('chrome');

      logger.info('OCR extraction request received', {
        requestId,
        filename,
        mimeType,
        imageSize: image?.length || 0,
        hasDataPrefix: image?.startsWith?.('data:'),
        platform: {
          isIPad,
          isIOS,
          isSafari,
          userAgent: userAgent.substring(0, 100),
        },
      });

      // Validate image data
      if (!image || typeof image !== 'string') {
        logger.error('Invalid image data received', {
          requestId,
          imageType: typeof image,
          imageLength: image?.length || 0,
        });
        return res.status(400).json({
          success: false,
          error: 'Invalid image data',
          message: 'No valid image data was received. Please try capturing the image again.',
        });
      }

      // Check for suspiciously small image data
      if (image.length < 1000) {
        logger.warn('Suspiciously small image data', {
          requestId,
          imageLength: image.length,
          imagePreview: image.substring(0, 100),
        });
      }

      logger.info('Starting Gemini Vision OCR', { requestId, filename });

      // Extract text using Gemini Vision
      const result = await geminiService.extractTextFromImage(image, mimeType);

      logger.info('Gemini Vision OCR completed', {
        requestId,
        hasText: !!result.text,
        textLength: result.text?.length || 0,
        confidence: result.confidence,
      });

      if (!result.text) {
        logger.warn('No text extracted from image', {
          requestId,
          filename,
          mimeType,
          imageSize: image.length,
        });
        return res.status(400).json({
          success: false,
          error: 'No text could be extracted from the image',
          message: 'Please ensure the image contains readable text and try again.',
        });
      }

      logger.info('OCR extraction successful', {
        requestId,
        filename,
        textLength: result.text.length,
        confidence: result.confidence,
        textPreview: result.text.substring(0, 100),
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error('OCR extraction error', {
        requestId,
        error: errorMessage,
        stack: errorStack,
        filename: req.body?.filename,
        mimeType: req.body?.mimeType,
        imageSize: req.body?.image?.length || 0,
        userAgent: userAgent.substring(0, 100),
      });

      // Provide more specific error messages
      let userMessage = errorMessage;
      if (errorMessage.includes('SAFETY')) {
        userMessage = 'The image was flagged by content safety filters. Please try a different image.';
      } else if (errorMessage.includes('quota') || errorMessage.includes('rate')) {
        userMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (errorMessage.includes('timeout')) {
        userMessage = 'The request timed out. Please try again with a smaller image.';
      }

      res.status(500).json({
        success: false,
        error: 'Failed to extract text from image',
        message: userMessage,
        debug: {
          requestId,
          originalError: errorMessage,
        },
      });
    }
  }
);

export default router;
