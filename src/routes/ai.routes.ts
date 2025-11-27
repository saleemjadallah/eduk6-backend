// AI routes for public image generation (landing page, etc.)
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateInput } from '../middleware/validateInput.js';
import { genAI } from '../config/gemini.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const generateImageSchema = z.object({
  prompt: z.string().min(10, 'Prompt must be at least 10 characters').max(1000),
  style: z.enum(['cartoon', 'illustration', 'educational', 'playful']).optional().default('playful'),
  cacheKey: z.string().optional(), // Client-side cache key
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/ai/generate-image
 * Generate an image using Gemini's native image generation
 * This is a public endpoint for landing page images
 */
router.post(
  '/generate-image',
  validateInput(generateImageSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { prompt, style } = req.body;

      logger.info('Landing page image generation request', {
        promptLength: prompt.length,
        style,
      });

      // Build the enhanced prompt with style guidelines
      const styleGuide: Record<string, string> = {
        cartoon: 'in a fun cartoon style with bold outlines and bright colors',
        illustration: 'as a clean, modern illustration with soft gradients',
        educational: 'as an educational infographic with clear visuals',
        playful: 'in a playful, child-friendly style with warm, inviting colors',
      };

      const selectedStyle = style || 'playful';
      const enhancedPrompt = `${prompt}. Create this ${styleGuide[selectedStyle]}.

Style requirements:
- Child-safe and appropriate for all ages
- Bright, cheerful color palette
- NO text or words in the image
- High quality, detailed artwork
- Welcoming and positive mood`;

      const model = genAI.getGenerativeModel({
        model: config.gemini.models.image,
        generationConfig: {
          temperature: 1,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
        },
      });

      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: enhancedPrompt }],
          },
        ],
        generationConfig: {
          responseModalities: ['image', 'text'],
        },
      } as any);

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts;

      if (!parts) {
        throw new Error('No response parts from image generation');
      }

      let imageData = '';
      let mimeType = 'image/png';

      for (const part of parts) {
        if ((part as any).inlineData) {
          const inlineData = (part as any).inlineData;
          imageData = inlineData.data;
          mimeType = inlineData.mimeType || 'image/png';
          break;
        }
      }

      if (!imageData) {
        throw new Error('No image data in response');
      }

      logger.info('Landing page image generated successfully', {
        mimeType,
        dataLength: imageData.length,
      });

      res.json({
        success: true,
        data: {
          imageData,
          mimeType,
          dataUrl: `data:${mimeType};base64,${imageData}`,
        },
      });
    } catch (error) {
      logger.error('Landing page image generation error', { error });

      // Return a graceful error response
      res.status(500).json({
        success: false,
        error: 'Image generation is temporarily unavailable',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default router;
