// Chat routes for Jeffrey AI assistant
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

const chatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000),
  childId: z.string().optional().nullable(),
  ageGroup: z.enum(['YOUNG', 'OLDER']).optional(),
  lessonContext: z.object({
    lessonId: z.string().optional(),
    title: z.string().optional(),
    subject: z.string().optional(),
    keyConcepts: z.array(z.string()).optional(),
  }).optional().nullable(),
  conversationHistory: z.array(z.object({
    role: z.enum(['USER', 'MODEL']),
    content: z.string(),
  })).optional(),
  selectedText: z.string().optional(), // For selection-based questions
});

// ============================================
// ROUTES
// ============================================

/**
 * POST /api/chat
 * Send a message to Jeffrey AI assistant
 */
router.post(
  '/',
  authenticate,
  validateInput(chatMessageSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { message, lessonContext, conversationHistory, selectedText } = req.body;
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

      logger.info('Chat request received', {
        childId,
        ageGroup: effectiveAgeGroup,
        hasLessonContext: !!lessonContext,
        hasSelectedText: !!selectedText,
        messageLength: message.length,
      });

      // Build the prompt based on context
      const systemPrompt = buildJeffreyPrompt(effectiveAgeGroup, lessonContext, selectedText);

      // Build conversation history for context
      const history = conversationHistory?.map((msg: { role: string; content: string }) => ({
        role: msg.role === 'USER' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      })) || [];

      const model = genAI.getGenerativeModel({
        model: config.gemini.models.flash,
        systemInstruction: systemPrompt,
      });

      // Start chat with history
      const chat = model.startChat({
        history: history as any,
      });

      // Send the message
      const result = await chat.sendMessage(message);
      const response = result.response.text();

      logger.info('Chat response generated', {
        childId,
        responseLength: response.length,
      });

      res.json({
        success: true,
        data: {
          content: response,
          role: 'assistant',
        },
      });
    } catch (error) {
      logger.error('Chat error', { error });
      next(error);
    }
  }
);

/**
 * Build Jeffrey's system prompt based on context
 */
function buildJeffreyPrompt(
  ageGroup: AgeGroup,
  lessonContext?: { title?: string; subject?: string; keyConcepts?: string[] } | null,
  selectedText?: string
): string {
  const isYoung = ageGroup === 'YOUNG';

  let prompt = `You are Jeffrey, a friendly and encouraging AI tutor for ${isYoung ? 'young children ages 4-7' : 'children ages 8-12'}.

Your personality:
- Warm, patient, and encouraging
- Use ${isYoung ? 'very simple words and short sentences' : 'clear, age-appropriate language'}
- ${isYoung ? 'Add fun emojis to make responses engaging' : 'Be educational but fun'}
- Celebrate curiosity and effort
- Never be condescending

Guidelines:
- ${isYoung ? 'Keep responses under 3 sentences' : 'Keep responses concise but informative'}
- Use analogies and examples ${isYoung ? 'from everyday life that young kids understand' : 'relevant to their world'}
- If asked something inappropriate or beyond scope, gently redirect to learning
- Always be positive and supportive`;

  if (lessonContext) {
    prompt += `\n\nCurrent lesson context:`;
    if (lessonContext.title) {
      prompt += `\n- Lesson: ${lessonContext.title}`;
    }
    if (lessonContext.subject) {
      prompt += `\n- Subject: ${lessonContext.subject}`;
    }
    if (lessonContext.keyConcepts?.length) {
      prompt += `\n- Key concepts: ${lessonContext.keyConcepts.join(', ')}`;
    }
    prompt += `\n\nTry to relate your answers to the lesson when relevant.`;
  }

  if (selectedText) {
    prompt += `\n\nThe child has selected this text and is asking about it:\n"${selectedText.substring(0, 500)}"`;
  }

  return prompt;
}

export default router;
