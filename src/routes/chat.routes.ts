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
 * Follows Google AI Studio best practices for educational content generation
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

  // Following Gemini best practices:
  // 1. Provide clear context about the audience and purpose
  // 2. Be specific about what kind of output we want
  // 3. Use natural language to describe requirements

  const prompt = `You are creating a lesson summary for ${isYoung
    ? 'a young child aged 4-7 who is just beginning their learning journey. This child responds best to simple, exciting language and relatable examples from their daily life (toys, animals, family activities, playground games).'
    : 'an elementary school student aged 8-12 who is curious and eager to learn. This student can handle more detail and appreciates understanding the "why" behind concepts.'}

LESSON CONTENT TO SUMMARIZE:
Title: ${title || 'Learning Adventure'}
Content: ${content.substring(0, 3000)}

YOUR TASK:
Transform this lesson into an engaging, memorable summary that will help the child retain and recall the key information. Think of yourself as a friendly teacher creating study notes that the child will actually want to read.

WRITING STYLE GUIDANCE:
${isYoung
  ? `- Use the simplest words possible (1-2 syllables preferred)
- Write like you're explaining to a curious 5-year-old
- Use comparisons to things they know: "It's like when you..." or "Just like your favorite..."
- Keep each sentence to 5-8 words maximum
- Add excitement with words like "Wow!", "Amazing!", "Guess what?"`
  : `- Use grade-appropriate vocabulary, explaining new terms clearly
- Connect concepts to their world: school, sports, games, nature, technology
- Encourage deeper thinking with phrases like "Here's why this matters..."
- Sentences can be 10-15 words, but vary the rhythm
- Include "Did you know?" moments to spark curiosity`}

Return ONLY a valid JSON object with this exact structure (no additional text before or after):
{
  "title": "An engaging, ${isYoung ? 'playful' : 'intriguing'} title that captures the main topic",
  "overview": "${isYoung
    ? 'One or two short, exciting sentences that make the child want to learn more. Start with something attention-grabbing!'
    : 'Two to three sentences that clearly explain what this lesson is about and why it matters. Hook them with an interesting angle.'}",
  "keyPoints": [
    ${isYoung
      ? '"Three simple key points, each one a short complete thought that stands alone"'
      : '"Four to five clear key points that capture the essential learning, each building understanding"'}
  ],
  "vocabulary": [
    {
      "term": "Important word from the lesson",
      "definition": "${isYoung
        ? 'Super simple explanation using words a 5-year-old knows'
        : 'Clear, helpful definition that connects to what they already know'}"
    }
  ],
  "funFacts": [
    "${isYoung
      ? 'Two surprising, delightful facts that will make them say Wow!'
      : 'Two or three fascinating facts that deepen understanding and spark curiosity'}"
  ],
  "takeaway": "${isYoung
    ? 'One simple, memorable sentence they can tell their parents about what they learned'
    : 'One powerful sentence capturing the most important thing to remember from this lesson'}"
}

QUALITY REQUIREMENTS:
- Every word should be purposeful and age-appropriate
- The summary should feel like a gift, not homework
- Focus on understanding, not memorization
- Include exactly ${isYoung ? '2-3' : '3-4'} vocabulary words that appear in the lesson
- Fun facts should genuinely surprise and delight`;

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
 * Follows Google AI Studio best practices for Gemini prompting
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

  // Extract the core topic for context
  const topicSummary = content.substring(0, 500);

  // Build prompt following Gemini best practices:
  // 1. Use natural language & full sentences (not tag soup)
  // 2. Be specific and descriptive (subject, setting, lighting, mood, materiality)
  // 3. Provide context (the "why" or "for whom")
  // 4. Specify style (polished editorial, technical diagram, or hand-drawn whiteboard)

  const imagePrompt = `Design a professional educational infographic poster for ${isYoung ? 'a young child aged 4-7 who is just learning to read' : 'an elementary school student aged 8-12'}, explaining the topic "${title || 'Learning Concepts'}".

CONTENT TO VISUALIZE:
${topicSummary}
${keyPointsSummary ? `\nKEY CONCEPTS TO HIGHLIGHT: ${keyPointsSummary}` : ''}

LAYOUT & COMPOSITION:
Create a single-page infographic with a clear visual hierarchy. ${isYoung
  ? 'Use a simple top-to-bottom flow with 2-3 large illustrated sections. Each section should have one big, friendly illustration with minimal supporting text.'
  : 'Organize into 3-4 distinct sections using a combination of icons, simple diagrams, and short text blocks. Use visual connectors like arrows or numbered steps to show relationships between concepts.'}

VISUAL STYLE:
${isYoung
  ? 'Create this in a warm, friendly cartoon style similar to a preschool educational poster. Use rounded shapes, thick outlines, and a soft, approachable aesthetic. Characters should have big expressive eyes and friendly smiles. Think Pixar-meets-educational-content.'
  : 'Create this as a polished editorial infographic with clean vector-style illustrations. Use a modern, engaging design similar to National Geographic Kids or Highlights magazine. Include detailed but accessible diagrams with clear labels.'}

COLOR PALETTE:
Use a harmonious ${isYoung ? 'primary color scheme with bright yellows, sky blues, and grass greens' : 'vibrant but sophisticated palette with teals, oranges, and purples'}. Ensure high contrast between text and backgrounds for readability. The overall mood should feel ${isYoung ? 'warm, safe, and inviting like a sunny classroom' : 'exciting and discovery-oriented like a science museum exhibit'}.

TYPOGRAPHY & TEXT:
${isYoung
  ? 'Use very large, bold, rounded sans-serif text. Limit text to single words or 2-3 word labels. The title should be playful and oversized.'
  : 'Use clear, modern sans-serif fonts. Include a prominent title, section headers, and brief explanatory text (keep each text block under 15 words). Ensure all text is legible at a glance.'}

SPECIFIC ELEMENTS TO INCLUDE:
${isYoung
  ? '- One friendly mascot character (like a curious animal or smiling object related to the topic) guiding the viewer\n- Large, simple icons representing each key concept\n- Decorative elements like stars, sparkles, or clouds to fill empty space'
  : '- Clear data visualizations if applicable (simple bar charts, pie charts, or comparison graphics)\n- Numbered steps or bullet points for processes\n- "Did you know?" style callout boxes for interesting facts\n- Small illustrative icons next to each section'}

CRITICAL REQUIREMENTS:
- All imagery must be child-safe, positive, and non-frightening
- No complex or abstract imagery that could confuse young learners
- Text must be accurate and clearly rendered (not garbled or misspelled)
- The design should inspire curiosity and make learning feel exciting
- Format: Single poster layout, 16:9 aspect ratio preferred`;

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
 * Follows Google AI Studio best practices for Gemini prompting
 */
async function generateChatImage(
  imagePrompt: string,
  lessonContext: { title?: string; subject?: string; content?: string } | null | undefined,
  ageGroup: AgeGroup
): Promise<{ imageData: string; mimeType: string }> {
  const isYoung = ageGroup === 'YOUNG';

  // Build context-aware prompt following Gemini best practices:
  // 1. Use natural language & full sentences (not tag soup)
  // 2. Be specific and descriptive (subject, setting, lighting, mood)
  // 3. Provide context (the "why" or "for whom")

  const subjectContext = lessonContext?.title
    ? ` This illustration is for a lesson about "${lessonContext.title}" and should help the child visualize the concept.`
    : '';

  const fullPrompt = `Create an educational illustration showing: ${imagePrompt}.${subjectContext}

PURPOSE: This image is for ${isYoung ? 'a young child aged 4-7 who learns best through colorful, friendly visuals' : 'an elementary student aged 8-12 who benefits from detailed, engaging illustrations'}.

VISUAL STYLE:
${isYoung
  ? `Design this as a warm, inviting cartoon illustration that a preschooler would find delightful. Use a style reminiscent of picture books like "The Very Hungry Caterpillar" or "Pete the Cat" - simple shapes, bold colors, and friendly characters with expressive faces. Every element should feel soft, rounded, and approachable.`
  : `Create this as a polished educational illustration suitable for a children's encyclopedia or science textbook. The style should be detailed enough to be informative but vibrant and engaging like illustrations in DK Publishing or Usborne books. Include accurate details while maintaining visual appeal.`}

COMPOSITION & LIGHTING:
${isYoung
  ? `Center the main subject prominently with a simple, uncluttered background. Use warm, soft lighting like a sunny day. Leave plenty of breathing room around elements. The scene should feel calm, safe, and inviting.`
  : `Create a dynamic composition that draws the eye to key educational elements. Use lighting to highlight important details. The background can include contextual elements that add to understanding without overwhelming the main subject.`}

COLOR PALETTE:
${isYoung
  ? `Use a cheerful palette of primary colors - sunny yellows, sky blues, grass greens, and happy oranges. Colors should be saturated but not harsh. Think of the warm, comforting colors of a well-lit nursery.`
  : `Use a rich, sophisticated palette with good contrast. Include both vibrant accent colors and more nuanced tones. Colors should support the educational content - use color coding if showing different categories or concepts.`}

CRITICAL REQUIREMENTS:
- The image must be completely safe and appropriate for children
- No text, words, letters, or numbers rendered in the image
- No scary, violent, threatening, or unsettling elements
- All characters (if any) should appear friendly and welcoming
- The illustration should spark curiosity and joy about learning`;

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
