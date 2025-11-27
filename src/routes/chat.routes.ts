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
import { geminiService } from '../services/ai/geminiService.js';
import { detectImageIntent } from '../services/ai/imageIntentDetector.js';

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
    content: z.string().optional(), // The actual lesson content for context
    summary: z.string().optional(), // Lesson summary
  }).optional().nullable(),
  conversationHistory: z.array(z.object({
    role: z.enum(['USER', 'MODEL']),
    content: z.string(),
  })).optional(),
  selectedText: z.string().optional(), // For selection-based questions
});

const summarizeSchema = z.object({
  content: z.string().min(10, 'Content is required'),
  title: z.string().optional(),
  childId: z.string().optional().nullable(),
  ageGroup: z.enum(['YOUNG', 'OLDER']).optional(),
});

const infographicSchema = z.object({
  content: z.string().min(10, 'Content is required'),
  title: z.string().optional(),
  keyConcepts: z.array(z.string()).optional(),
  childId: z.string().optional().nullable(),
  ageGroup: z.enum(['YOUNG', 'OLDER']).optional(),
});

const translateSchema = z.object({
  text: z.string().min(1, 'Text is required').max(500, 'Text too long (max 500 characters)'),
  targetLanguage: z.string().min(2, 'Target language is required'),
  childId: z.string().optional().nullable(),
  ageGroup: z.enum(['YOUNG', 'OLDER']).optional(),
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

      // Check if this is an image generation request
      const imageIntent = await detectImageIntent(message, lessonContext);

      if (imageIntent.isImageRequest && imageIntent.confidence !== 'low') {
        logger.info('Image intent detected, switching to image generation', {
          message,
          confidence: imageIntent.confidence,
          detectionMethod: imageIntent.detectionMethod,
          imagePrompt: imageIntent.imagePrompt,
        });

        // Generate image using the image model
        const imageResult = await generateChatImage(
          imageIntent.imagePrompt || message,
          lessonContext,
          effectiveAgeGroup
        );

        // Generate a friendly Jeffrey response to accompany the image
        const jeffreyResponse = generateJeffreyImageResponse(
          imageIntent.imagePrompt || message,
          effectiveAgeGroup
        );

        res.json({
          success: true,
          data: {
            content: jeffreyResponse,
            role: 'assistant',
            type: 'image',
            imageData: imageResult.imageData,
            mimeType: imageResult.mimeType,
          },
        });
        return;
      }

      // Regular text chat - Build the prompt based on context
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
 * POST /api/chat/summarize
 * Generate a structured, colorful summary of lesson content
 */
router.post(
  '/summarize',
  authenticate,
  validateInput(summarizeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, title } = req.body;
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

      logger.info('Summary generation request', {
        childId,
        ageGroup: effectiveAgeGroup,
        contentLength: content.length,
      });

      const summary = await generateStructuredSummary(content, title, effectiveAgeGroup);

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      logger.error('Summary generation error', { error });
      next(error);
    }
  }
);

/**
 * POST /api/chat/infographic
 * Generate an infographic image for the lesson
 */
router.post(
  '/infographic',
  authenticate,
  validateInput(infographicSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, title, keyConcepts } = req.body;
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

      logger.info('Infographic generation request', {
        childId,
        ageGroup: effectiveAgeGroup,
        title,
      });

      const infographic = await generateInfographic(content, title, keyConcepts, effectiveAgeGroup);

      res.json({
        success: true,
        data: infographic,
      });
    } catch (error) {
      logger.error('Infographic generation error', { error });
      next(error);
    }
  }
);

/**
 * POST /api/chat/translate
 * Translate highlighted text to a target language
 */
router.post(
  '/translate',
  authenticate,
  validateInput(translateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { text, targetLanguage } = req.body;
      let { childId, ageGroup } = req.body;

      // Get age group from child if available
      let effectiveAgeGroup: AgeGroup = (ageGroup as AgeGroup) || 'OLDER';

      if (req.child) {
        effectiveAgeGroup = req.child.ageGroup;
        childId = req.child.id;
      } else if (childId) {
        const child = await prisma.child.findUnique({
          where: { id: childId },
          select: { ageGroup: true, gradeLevel: true },
        });
        if (child) {
          effectiveAgeGroup = child.ageGroup;
        }
      }

      logger.info('Translation request', {
        childId,
        ageGroup: effectiveAgeGroup,
        targetLanguage,
        textLength: text.length,
      });

      const translation = await geminiService.translateText(text, targetLanguage, {
        ageGroup: effectiveAgeGroup,
      });

      res.json({
        success: true,
        data: translation,
      });
    } catch (error) {
      logger.error('Translation error', { error });
      next(error);
    }
  }
);

/**
 * Generate a structured summary using Gemini
 */
async function generateStructuredSummary(
  content: string,
  title: string | undefined,
  ageGroup: AgeGroup
): Promise<{
  title: string;
  overview: string;
  keyPoints: string[];
  vocabulary: Array<{ term: string; definition: string }>;
  funFacts: string[];
  takeaway: string;
}> {
  const isYoung = ageGroup === 'YOUNG';

  const prompt = `Create a fun, engaging summary of this lesson for a ${isYoung ? 'young child (ages 4-7)' : 'child (ages 8-12)'}.

Lesson${title ? ` (${title})` : ''}: ${content.substring(0, 3000)}

Return ONLY a valid JSON object with this exact format, no other text:
{
  "title": "${title || 'Lesson Summary'}",
  "overview": "A ${isYoung ? '1-2 sentence' : '2-3 sentence'} engaging overview of the lesson",
  "keyPoints": [
    "${isYoung ? '3 very simple key points' : '4-5 clear key points'}"
  ],
  "vocabulary": [
    {
      "term": "Important word",
      "definition": "${isYoung ? 'Very simple definition' : 'Clear definition'}"
    }
  ],
  "funFacts": [
    "${isYoung ? '2 fun, simple facts' : '2-3 interesting facts'}"
  ],
  "takeaway": "One main thing to remember from this lesson"
}

Requirements:
- ${isYoung ? 'Use very simple words a 5-year-old would understand' : 'Use clear, age-appropriate language'}
- Make it fun and engaging
- Focus on the most important concepts
- Include ${isYoung ? '2-3' : '3-4'} vocabulary words`;

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
    return JSON.parse(responseText);
  } catch (parseError) {
    logger.error('Failed to parse summary response', { responseText, parseError });
    throw new Error('Failed to generate summary');
  }
}

/**
 * Generate an infographic using Gemini's image generation
 */
async function generateInfographic(
  content: string,
  title: string | undefined,
  keyConcepts: string[] | undefined,
  ageGroup: AgeGroup
): Promise<{ imageData: string; mimeType: string; description: string }> {
  const isYoung = ageGroup === 'YOUNG';

  // Create a summary of key points for the image prompt
  const keyPointsSummary = keyConcepts?.slice(0, 4).join(', ') || '';

  const imagePrompt = `Create a colorful, child-friendly educational infographic poster about "${title || 'this topic'}".

Topic: ${content.substring(0, 500)}
${keyPointsSummary ? `Key concepts to include: ${keyPointsSummary}` : ''}

Style requirements:
- Bright, cheerful colors suitable for ${isYoung ? 'young children (ages 4-7)' : 'children (ages 8-12)'}
- ${isYoung ? 'Very simple, cartoon-style illustrations' : 'Clear, engaging illustrations'}
- Large, readable text
- Fun icons and visual elements
- Educational but playful design
- Include ${isYoung ? '2-3' : '3-4'} main visual elements representing key concepts
- NO scary or complex imagery
- Safe for children`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.image,
    generationConfig: {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: imagePrompt }],
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
    let description = '';

    for (const part of parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData;
        imageData = inlineData.data;
        mimeType = inlineData.mimeType || 'image/png';
      } else if ((part as any).text) {
        description = (part as any).text;
      }
    }

    if (!imageData) {
      throw new Error('No image data in response');
    }

    return { imageData, mimeType, description };
  } catch (error) {
    logger.error('Infographic generation failed', { error });
    // Return a fallback response indicating image generation is not available
    throw new Error('Image generation is temporarily unavailable. Please try again later.');
  }
}

/**
 * Build Jeffrey's system prompt based on context
 */
function buildJeffreyPrompt(
  ageGroup: AgeGroup,
  lessonContext?: { title?: string; subject?: string; keyConcepts?: string[]; content?: string; summary?: string } | null,
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
- Always be positive and supportive
- When asked to create flashcards, generate them in a clear format with Question/Answer pairs
- When asked to explain content, break it down into simple, understandable parts`;

  if (lessonContext) {
    prompt += `\n\n=== CURRENT LESSON CONTEXT ===`;
    if (lessonContext.title) {
      prompt += `\nLesson Title: ${lessonContext.title}`;
    }
    if (lessonContext.subject) {
      prompt += `\nSubject: ${lessonContext.subject}`;
    }
    if (lessonContext.keyConcepts?.length) {
      prompt += `\nKey Concepts: ${lessonContext.keyConcepts.join(', ')}`;
    }
    if (lessonContext.summary) {
      prompt += `\n\nLesson Summary:\n${lessonContext.summary.substring(0, 1000)}`;
    }
    if (lessonContext.content) {
      // Include lesson content (truncated to avoid token limits)
      const truncatedContent = lessonContext.content.substring(0, 4000);
      prompt += `\n\n=== LESSON CONTENT ===\n${truncatedContent}`;
      if (lessonContext.content.length > 4000) {
        prompt += '\n[Content truncated for brevity]';
      }
    }
    prompt += `\n\nIMPORTANT: Use this lesson content to answer questions accurately. When the student asks about specific topics from the lesson, reference this content directly.`;
  }

  if (selectedText) {
    prompt += `\n\n=== SELECTED TEXT ===\nThe child has selected this text and is asking about it:\n"${selectedText.substring(0, 500)}"`;
  }

  return prompt;
}

/**
 * Generate an image for chat using the image model
 */
async function generateChatImage(
  imagePrompt: string,
  lessonContext: { title?: string; subject?: string; content?: string } | null | undefined,
  ageGroup: AgeGroup
): Promise<{ imageData: string; mimeType: string }> {
  const isYoung = ageGroup === 'YOUNG';

  // Build context-aware prompt
  let contextualPrompt = imagePrompt;
  if (lessonContext?.title) {
    contextualPrompt = `${imagePrompt} (from a lesson about ${lessonContext.title})`;
  }

  const fullPrompt = `Create a colorful, child-friendly educational illustration: ${contextualPrompt}

Style requirements:
- Bright, cheerful colors suitable for ${isYoung ? 'young children (ages 4-7)' : 'children (ages 8-12)'}
- ${isYoung ? 'Very simple, cartoon-style, cute and friendly' : 'Clear, engaging, educational style'}
- Fun and appealing to kids
- NO text or words in the image
- NO scary, violent, or inappropriate content
- High quality, detailed artwork
- Educational and age-appropriate`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.image,
    generationConfig: {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: fullPrompt }],
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

    return { imageData, mimeType };
  } catch (error) {
    logger.error('Chat image generation failed', { error, imagePrompt });
    throw new Error('Image generation is temporarily unavailable. Please try again later.');
  }
}

/**
 * Generate Jeffrey's friendly response to accompany an image
 */
function generateJeffreyImageResponse(imagePrompt: string, ageGroup: AgeGroup): string {
  const isYoung = ageGroup === 'YOUNG';

  const responses = isYoung
    ? [
        `Ta-da! 🎨 I drew ${imagePrompt} for you! Do you like it?`,
        `Look what I made! 🖼️ Here's ${imagePrompt}! Pretty cool, right?`,
        `Here you go! ✨ I created ${imagePrompt} just for you!`,
        `Wow, that was fun to draw! 🌟 Here's ${imagePrompt}!`,
      ]
    : [
        `Here's the image you asked for! I created ${imagePrompt} for you.`,
        `I drew ${imagePrompt}! Let me know if you'd like me to make any changes or draw something else.`,
        `Here you go! This is my illustration of ${imagePrompt}. What do you think?`,
        `I created this image of ${imagePrompt} for you! Feel free to ask for more drawings!`,
      ];

  return responses[Math.floor(Math.random() * responses.length)];
}

export default router;
