// Quiz routes for generating and managing quizzes
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

const generateQuizSchema = z.object({
  content: z.string().min(10, 'Content must be at least 10 characters'),
  count: z.number().min(1).max(10).optional().default(5),
  type: z.enum(['multiple_choice', 'true_false', 'fill_blank']).optional().default('multiple_choice'),
  childId: z.string().optional().nullable(),
  ageGroup: z.enum(['YOUNG', 'OLDER']).optional(),
  lessonId: z.string().optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/quizzes/generate
 * Generate a quiz from content
 */
router.post(
  '/generate',
  authenticate,
  validateInput(generateQuizSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, count, type } = req.body;
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

      logger.info('Quiz generation request', {
        childId,
        ageGroup: effectiveAgeGroup,
        contentLength: content.length,
        count,
        type,
      });

      const quiz = await generateQuiz(content, effectiveAgeGroup, count, type);

      res.json({
        success: true,
        data: quiz,
      });
    } catch (error) {
      logger.error('Quiz generation error', { error });
      next(error);
    }
  }
);

/**
 * Generate quiz using Gemini AI
 */
async function generateQuiz(
  content: string,
  ageGroup: AgeGroup,
  count: number = 5,
  type: string = 'multiple_choice'
): Promise<{ title: string; questions: Array<any> }> {
  const isYoung = ageGroup === 'YOUNG';

  const prompt = `Create a ${count}-question ${type.replace('_', ' ')} quiz from this content for a ${isYoung ? 'young child (ages 4-7)' : 'child (ages 8-12)'}.

Content: ${content.substring(0, 3000)}

Requirements:
- ${isYoung ? 'Use very simple words and short questions' : 'Use clear, age-appropriate language'}
- Questions should test understanding, not just memorization
- Include encouraging feedback for correct and incorrect answers
- Make it fun and engaging

Return ONLY a valid JSON object with this exact format, no other text:
{
  "title": "Quiz title",
  "questions": [
    {
      "question": "The question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "Why this is correct",
      "encouragement": "Great job!" or "Keep trying!"
    }
  ]
}

For correctAnswer, use the index (0-3) of the correct option.`;

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
    const quiz = JSON.parse(responseText);

    // Add IDs to questions
    quiz.questions = quiz.questions.map((q: any, index: number) => ({
      id: `q-${Date.now()}-${index}`,
      ...q,
    }));

    return quiz;
  } catch (parseError) {
    logger.error('Failed to parse quiz response', { responseText, parseError });
    throw new Error('Failed to generate quiz');
  }
}

export default router;
