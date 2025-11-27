/**
 * Image Intent Detector
 * Detects when a user wants Jeffrey to create/draw an image using a hybrid approach:
 * 1. Fast keyword matching for obvious cases
 * 2. LLM-based classification for ambiguous cases
 */

import { genAI } from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export interface ImageIntentResult {
  isImageRequest: boolean;
  confidence: 'high' | 'medium' | 'low';
  imagePrompt?: string; // Extracted/refined prompt for image generation
  detectionMethod: 'keyword' | 'llm';
}

// Keywords and phrases that strongly indicate image generation intent
const IMAGE_KEYWORDS = [
  'draw',
  'sketch',
  'paint',
  'illustrate',
  'create a picture',
  'make a picture',
  'create an image',
  'make an image',
  'show me a picture',
  'show me an image',
  'generate an image',
  'generate a picture',
  'can you draw',
  'could you draw',
  'please draw',
  'draw me',
  'make me a drawing',
  'create a drawing',
  'visualize',
  'make a visual',
  'create a visual',
  'show what',
  'show how',
  'picture of',
  'image of',
  'drawing of',
  'illustration of',
];

// Keywords that suggest image intent but need context
const AMBIGUOUS_KEYWORDS = [
  'show',
  'make',
  'create',
  'see',
  'look like',
  'looks like',
  'what does',
  'how does',
];

// Keywords that indicate NOT an image request (even with ambiguous keywords)
const NEGATIVE_KEYWORDS = [
  'explain',
  'tell me',
  'describe',
  'what is',
  'define',
  'meaning',
  'why',
  'how does it work',
  'list',
  'summarize',
  'quiz',
  'flashcard',
  'test',
];

/**
 * Check for strong image intent keywords
 */
function checkKeywordMatch(message: string): { matched: boolean; matchedKeyword?: string } {
  const lowerMessage = message.toLowerCase();

  for (const keyword of IMAGE_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return { matched: true, matchedKeyword: keyword };
    }
  }

  return { matched: false };
}

/**
 * Check for negative indicators (not an image request)
 */
function hasNegativeIndicators(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  for (const keyword of NEGATIVE_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Check for ambiguous keywords that need LLM classification
 */
function hasAmbiguousKeywords(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  for (const keyword of AMBIGUOUS_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Use LLM to classify ambiguous requests
 */
async function classifyWithLLM(message: string, lessonContext?: string): Promise<ImageIntentResult> {
  try {
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flashLite, // Use fastest model for classification
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200,
        responseMimeType: 'application/json',
      },
    });

    const prompt = `You are an intent classifier. Determine if the user wants an AI to CREATE/GENERATE a visual image.

User message: "${message}"
${lessonContext ? `Lesson context: "${lessonContext.substring(0, 200)}..."` : ''}

Return JSON with these fields:
- isImageRequest: boolean (true if user wants a NEW image generated, false otherwise)
- confidence: "high" | "medium" | "low"
- imagePrompt: string (if isImageRequest is true, extract what should be drawn; otherwise empty string)

Examples:
- "draw a sun and ocean" -> {"isImageRequest": true, "confidence": "high", "imagePrompt": "a sun and ocean"}
- "what does a cell look like" -> {"isImageRequest": true, "confidence": "medium", "imagePrompt": "a cell (biology)"}
- "show me the steps" -> {"isImageRequest": false, "confidence": "high", "imagePrompt": ""}
- "explain photosynthesis" -> {"isImageRequest": false, "confidence": "high", "imagePrompt": ""}
- "can you make a picture of the water cycle" -> {"isImageRequest": true, "confidence": "high", "imagePrompt": "the water cycle"}

Return ONLY valid JSON, no other text.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const parsed = JSON.parse(responseText);

    return {
      isImageRequest: parsed.isImageRequest === true,
      confidence: parsed.confidence || 'medium',
      imagePrompt: parsed.imagePrompt || undefined,
      detectionMethod: 'llm',
    };
  } catch (error) {
    logger.error('LLM intent classification failed', { error, message });
    // On error, return conservative default (not an image request)
    return {
      isImageRequest: false,
      confidence: 'low',
      detectionMethod: 'llm',
    };
  }
}

/**
 * Extract the image subject from the message
 */
function extractImagePrompt(message: string, matchedKeyword?: string): string {
  let prompt = message;

  // Remove common prefixes
  const prefixesToRemove = [
    'can you', 'could you', 'please', 'i want you to', 'i need you to',
    'help me', 'would you', "i'd like you to", 'try to',
  ];

  let lowerPrompt = prompt.toLowerCase();
  for (const prefix of prefixesToRemove) {
    if (lowerPrompt.startsWith(prefix)) {
      prompt = prompt.substring(prefix.length).trim();
      lowerPrompt = prompt.toLowerCase();
    }
  }

  // Remove the matched keyword if present
  if (matchedKeyword) {
    const keywordIndex = lowerPrompt.indexOf(matchedKeyword);
    if (keywordIndex !== -1) {
      // Get everything after the keyword
      prompt = prompt.substring(keywordIndex + matchedKeyword.length).trim();
    }
  }

  // Clean up common artifacts
  prompt = prompt
    .replace(/^(a |an |the )?/i, '')
    .replace(/\?$/, '')
    .replace(/^for me\s*/i, '')
    .replace(/^of\s*/i, '')
    .trim();

  return prompt || message; // Return original if extraction fails
}

/**
 * Main detection function - hybrid approach
 */
export async function detectImageIntent(
  message: string,
  lessonContext?: { title?: string; content?: string }
): Promise<ImageIntentResult> {
  // Step 1: Check for negative indicators first
  if (hasNegativeIndicators(message)) {
    return {
      isImageRequest: false,
      confidence: 'high',
      detectionMethod: 'keyword',
    };
  }

  // Step 2: Check for strong positive keywords
  const keywordResult = checkKeywordMatch(message);
  if (keywordResult.matched) {
    const imagePrompt = extractImagePrompt(message, keywordResult.matchedKeyword);

    logger.info('Image intent detected via keyword', {
      message,
      matchedKeyword: keywordResult.matchedKeyword,
      extractedPrompt: imagePrompt,
    });

    return {
      isImageRequest: true,
      confidence: 'high',
      imagePrompt,
      detectionMethod: 'keyword',
    };
  }

  // Step 3: Check for ambiguous keywords - use LLM
  if (hasAmbiguousKeywords(message)) {
    logger.info('Ambiguous message, using LLM classification', { message });

    const contextString = lessonContext?.title
      ? `Lesson: ${lessonContext.title}`
      : lessonContext?.content?.substring(0, 200);

    return await classifyWithLLM(message, contextString);
  }

  // Step 4: Default - not an image request
  return {
    isImageRequest: false,
    confidence: 'high',
    detectionMethod: 'keyword',
  };
}

export default { detectImageIntent };
