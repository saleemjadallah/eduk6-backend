// Flashcard routes for generating and managing flashcards
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { genAI } from '../config/gemini.js';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { AgeGroup } from '@prisma/client';

const router = Router();

// ============================================
// SCHEMAS
// ============================================

const generateFlashcardsSchema = z.object({
  content: z.string().min(10, 'Content must be at least 10 characters'),
  count: z.number().min(1).max(20).optional().default(5),
  childId: z.string().optional().nullable(),
  ageGroup: z.enum(['YOUNG', 'OLDER']).optional(),
  lessonId: z.string().optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/flashcards/generate
 * Generate flashcards from content
 */
router.post(
  '/generate',
  authenticate,
  validateInput(generateFlashcardsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, count } = req.body;
      let { childId, ageGroup } = req.body;

      // Get age group from child if available
      let effectiveAgeGroup: AgeGroup = (ageGroup as AgeGroup) || 'OLDER';

      if (req.child) {
        effectiveAgeGroup = req.child.ageGroup;
        childId = req.child.id;
      } else if (childId) {
        const child = await prisma.child.findUnique({
          where: { id: childId },
          select: { ageGroup: true },
        });
        if (child) {
          effectiveAgeGroup = child.ageGroup;
        }
      }

      logger.info('Flashcard generation request', {
        childId,
        ageGroup: effectiveAgeGroup,
        contentLength: content.length,
        count,
      });

      const flashcards = await generateFlashcards(content, effectiveAgeGroup, count);

      res.json({
        success: true,
        data: flashcards,
      });
    } catch (error) {
      logger.error('Flashcard generation error', { error });
      next(error);
    }
  }
);

/**
 * Generate flashcards using Gemini AI
 */
async function generateFlashcards(
  content: string,
  ageGroup: AgeGroup,
  count: number = 5
): Promise<Array<{ id: string; front: string; back: string; hint?: string; difficulty: string }>> {
  const isYoung = ageGroup === 'YOUNG';

  const prompt = `Create ${count} flashcards from this content for a ${isYoung ? 'young child (ages 4-7)' : 'child (ages 8-12)'}.

Content: ${content.substring(0, 3000)}

Requirements:
- ${isYoung ? 'Use very simple words and short phrases' : 'Use clear, age-appropriate language'}
- Each flashcard should test one concept
- Front: A question or prompt
- Back: The answer
- Hint: A helpful clue (optional)

Return ONLY a valid JSON array with this exact format, no other text:
[
  {
    "front": "question or prompt",
    "back": "answer",
    "hint": "optional hint",
    "difficulty": "easy" | "medium" | "hard"
  }
]`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.flash,
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const flashcards = JSON.parse(responseText);

    // Add IDs to each flashcard
    return flashcards.map((card: any, index: number) => ({
      id: `card-${Date.now()}-${index}`,
      front: card.front,
      back: card.back,
      hint: card.hint || null,
      difficulty: card.difficulty || 'medium',
    }));
  } catch (parseError) {
    logger.error('Failed to parse flashcard response', { responseText, parseError });
    throw new Error('Failed to generate flashcards');
  }
}

export default router;
