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

      // Build the enhanced prompt following Gemini best practices:
      // 1. Use natural language & full sentences (not tag soup)
      // 2. Be specific and descriptive (subject, setting, lighting, mood, materiality)
      // 3. Provide context (the "why" or "for whom")

      const styleGuide: Record<string, string> = {
        cartoon: `as a polished cartoon illustration with bold black outlines, smooth cel-shading, and vibrant saturated colors. The style should be reminiscent of modern animated films like Pixar or DreamWorks, with expressive characters and dynamic poses. Use clean shapes and avoid messy or sketchy lines.`,
        illustration: `as a refined digital illustration with soft gradients, subtle shadows, and a harmonious color palette. Think of the elegant style used in award-winning children's book illustrations - sophisticated yet accessible, with careful attention to composition and balance.`,
        educational: `as a clear, informative educational graphic that balances visual appeal with clarity. Use a style similar to high-quality textbook illustrations or museum exhibit graphics - accurate, detailed, and engaging. Include visual hierarchy that guides the eye through the information.`,
        playful: `as a warm, inviting illustration that feels like a cozy children's book. Use soft, rounded shapes, gentle gradients, and a comforting color palette of pastels mixed with cheerful accent colors. Every element should feel friendly, approachable, and full of wonder.`,
      };

      const selectedStyle = style || 'playful';
      const enhancedPrompt = `Create an illustration for the landing page of an educational learning platform for children. This image will help parents and children understand that learning can be fun and engaging.

SUBJECT TO ILLUSTRATE:
${prompt}

VISUAL STYLE:
${styleGuide[selectedStyle]}

COMPOSITION & SETTING:
Create a well-balanced composition with a clear focal point. The scene should feel warm and inviting, like stepping into a beloved classroom or cozy reading nook. Use depth and layering to create visual interest, with the main subject prominently featured.

LIGHTING & ATMOSPHERE:
Use soft, warm lighting that creates a sense of comfort and positivity. Think of golden hour sunlight streaming through a window, or the warm glow of a well-lit learning space. Avoid harsh shadows or dramatic contrasts that might feel intimidating.

COLOR PALETTE:
Build a harmonious palette around warm yellows, friendly blues, fresh greens, and gentle oranges. Colors should be vibrant enough to be engaging but not so saturated that they feel overwhelming. The overall impression should be cheerful, professional, and trustworthy.

CRITICAL REQUIREMENTS:
- The image must be completely safe and appropriate for all ages
- Do NOT include any text, words, letters, or numbers in the image
- All characters should appear friendly, diverse, and welcoming
- The mood should convey joy, curiosity, and the excitement of learning
- Quality should be high enough for professional website use`;

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
