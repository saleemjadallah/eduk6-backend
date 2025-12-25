// Gemini AI Service for chat and content generation
// Uses Gemini 3 Pro for advanced reasoning and Ollie AI tutor
import {
  genAI,
  CHILD_SAFETY_SETTINGS,
  YOUNG_CHILD_CONFIG,
  OLDER_CHILD_CONFIG,
  GEMINI_3_PRO_ANALYSIS_CONFIG,
  GEMINI_3_PRO_CHAT_CONFIG,
} from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { promptBuilder, LessonContext } from './promptBuilder.js';
import { safetyFilters, SafetyValidation } from './safetyFilters.js';
import { AgeGroup, Subject, ChatMessage, CurriculumType } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import type { ContentBlock } from '../formatting/contentBlocks.js';

// Google Cloud Translation API v2 REST endpoint
const GOOGLE_TRANSLATE_API_URL = 'https://translation.googleapis.com/language/translate/v2';

/**
 * Translate text using Google Cloud Translation API v2 (REST)
 * Uses API key for authentication (simpler than service account)
 */
async function googleTranslate(text: string, targetLang: string, apiKey: string): Promise<string> {
  const response = await fetch(`${GOOGLE_TRANSLATE_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: text,
      target: targetLang,
      source: 'en',
      format: 'text',
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: { message?: string } };
    throw new Error(error.error?.message || `Google Translate API error: ${response.status}`);
  }

  const data = await response.json() as { data?: { translations?: Array<{ translatedText?: string }> } };
  return data.data?.translations?.[0]?.translatedText || '';
}

// Common context interface for curriculum-aware AI operations
export interface ChildContext {
  childId: string;
  ageGroup: AgeGroup;
  curriculumType?: CurriculumType | null;
  gradeLevel?: number | null;
}

export interface ChatResponse {
  content: string;
  safetyRatings?: unknown;
  tokensUsed?: number;
  responseTimeMs: number;
  wasFiltered: boolean;
  filterReason?: string;
}

export interface LessonAnalysis {
  title: string;
  summary: string;
  subject?: string; // Detected subject from content (MATH, SCIENCE, ENGLISH, etc.)
  gradeLevel: string;
  formattedContent?: string; // AI-formatted version of the content with proper line breaks and structure
  chapters?: Array<{
    title: string;
    content?: string;
    keyPoints?: string[];
  }>;
  keyConcepts: string[];
  vocabulary?: Array<{
    term: string;
    definition: string;
    example?: string;
  }>;
  exercises?: Array<{
    id: string;
    type: 'MATH_PROBLEM' | 'FILL_IN_BLANK' | 'SHORT_ANSWER' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
    questionText: string;
    expectedAnswer: string;
    acceptableAnswers?: string[];
    hint1?: string;
    hint2?: string;
    explanation?: string;
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    locationInContent?: string; // Where this exercise appears (e.g., "Set A, Question 3")
  }>;
  suggestedQuestions: string[];
  confidence: number;
  // Rich structured content blocks for hybrid AI+deterministic rendering
  contentBlocks?: ContentBlock[];
}

export interface GeneratedFlashcard {
  front: string;
  back: string;
  hint?: string;
}

export interface GeneratedQuiz {
  title: string;
  questions: Array<{
    id: string;
    question: string;
    type: string;
    options?: string[];
    correctAnswer: string;
    explanation: string;
    encouragement?: string;
  }>;
}

export interface GeneratedImage {
  imageData: string; // base64 encoded
  mimeType: string;
}

export interface OCRResult {
  text: string;
  confidence: number;
  metadata?: {
    documentType?: string;
    language?: string;
  };
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  targetLanguage: string;
  pronunciation?: string; // For languages with different scripts
  simpleExplanation?: string; // Kid-friendly explanation of the word/phrase
}

export interface PDFAnalysisResult {
  extractedText: string;
  suggestedTitle: string;
  summary: string;
  detectedSubject: string | null;
  detectedGradeLevel: string | null;
  keyTopics: string[];
  vocabulary: Array<{ term: string; definition: string }>;
  tokensUsed: number;
}

export interface DetectedExercise {
  type: 'FILL_IN_BLANK' | 'MATH_PROBLEM' | 'SHORT_ANSWER' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  questionText: string;
  contextText?: string;
  originalPosition?: string;
  expectedAnswer: string;
  acceptableAnswers?: string[];
  answerType?: 'TEXT' | 'NUMBER' | 'SELECTION';
  options?: string[];
  hint1?: string;
  hint2?: string;
  explanation?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
}

export interface ExerciseValidationResult {
  isCorrect: boolean;
  confidence: number;
  feedback: string;
}

export class GeminiService {
  /**
   * Extract JSON from a response that might contain markdown code blocks or extra text
   */
  private extractJSON(text: string): string {
    // First, try to parse as-is (in case it's already clean JSON)
    try {
      JSON.parse(text);
      return text;
    } catch {
      // Continue to extraction logic
    }

    // Try to extract JSON from markdown code blocks
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      return jsonBlockMatch[1].trim();
    }

    // Try to find JSON array or object in the text
    const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
    const jsonObjectMatch = text.match(/\{[\s\S]*\}/);

    // Prefer the longer match (more complete JSON)
    if (jsonArrayMatch && jsonObjectMatch) {
      return jsonArrayMatch[0].length > jsonObjectMatch[0].length
        ? jsonArrayMatch[0]
        : jsonObjectMatch[0];
    }

    return jsonArrayMatch?.[0] || jsonObjectMatch?.[0] || text;
  }

  /**
   * Chat with Ollie AI tutor
   * Now supports curriculum-aware teaching style personalization
   */
  async chat(
    message: string,
    context: ChildContext & {
      lessonContext?: LessonContext;
      conversationHistory?: ChatMessage[];
    }
  ): Promise<ChatResponse> {
    const startTime = Date.now();

    // 1. Pre-filter user input
    const inputValidation = await safetyFilters.validateInput(
      message,
      context.ageGroup
    );

    if (!inputValidation.passed) {
      return this.createSafetyBlockedResponse(
        inputValidation,
        context.childId,
        message,
        startTime
      );
    }

    // 2. Build system prompt with curriculum context
    const systemPrompt = promptBuilder.buildSystemInstructions({
      ageGroup: context.ageGroup,
      curriculumType: context.curriculumType,
      gradeLevel: context.gradeLevel,
      lessonContext: context.lessonContext,
    });

    // 3. Build conversation history
    const history = this.formatConversationHistory(context.conversationHistory);

    // 4. Get appropriate config for age group
    // Use Gemini 3 Flash for Ollie - fast and intelligent for text-based chat
    const baseConfig = context.ageGroup === 'YOUNG' ? YOUNG_CHILD_CONFIG : OLDER_CHILD_CONFIG;
    const generationConfig = {
      temperature: 1.0,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: baseConfig.maxOutputTokens, // Age-appropriate length
    };

    // 5. Call Gemini 3 Flash for Ollie AI tutor
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash, // gemini-3-flash-preview
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig,
      systemInstruction: systemPrompt,
    });

    logger.info(`Using Gemini 3 Flash for Ollie chat`, {
      model: config.gemini.models.flash,
      ageGroup: context.ageGroup,
    });

    const chat = model.startChat({ history });

    let result;
    try {
      result = await chat.sendMessage(message);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('SAFETY')) {
        await safetyFilters.logIncident(context.childId, 'BLOCKED_BY_GEMINI', 'MEDIUM', {
          inputText: message,
          flags: ['gemini_safety_block'],
        });

        return this.createSafetyBlockedResponse(
          { passed: false, flags: ['blocked_by_gemini'] },
          context.childId,
          message,
          startTime
        );
      }
      throw error;
    }

    const response = result.response;
    const responseText = response.text();

    // 6. Post-filter output
    const outputValidation = await safetyFilters.validateOutput(
      responseText,
      context.ageGroup
    );

    if (!outputValidation.passed) {
      await safetyFilters.logIncident(context.childId, 'HARMFUL_CONTENT', 'HIGH', {
        inputText: message,
        outputText: responseText,
        flags: outputValidation.flags,
      });

      return this.createSafetyBlockedResponse(
        outputValidation,
        context.childId,
        message,
        startTime
      );
    }

    return {
      content: responseText,
      safetyRatings: response.candidates?.[0]?.safetyRatings,
      tokensUsed: response.usageMetadata?.totalTokenCount,
      responseTimeMs: Date.now() - startTime,
      wasFiltered: false,
    };
  }

  /**
   * Analyze content and extract structured lesson data
   * Uses Gemini 3 Flash for metadata extraction (exercises, vocabulary, etc.)
   *
   * Note: Formatting is handled separately by the deterministic DocumentFormatter
   * service, which provides 100% reliable output without AI variability.
   */
  async analyzeContent(
    content: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      subject?: Subject | null;
    }
  ): Promise<LessonAnalysis> {
    const analysisPrompt = promptBuilder.buildContentAnalysisPrompt(content, context);

    logger.info(`Starting content analysis`, {
      contentLength: content.length,
      ageGroup: context.ageGroup,
      model: config.gemini.models.pro,
    });

    // Use Gemini 3 Pro for content analysis - better reasoning for:
    // - Complex content structure detection (tables, sections, hierarchies)
    // - Accurate contentBlocks extraction for beautiful PDF formatting
    // - Higher quality metadata extraction (exercises, vocabulary)
    // Set maxOutputTokens high to prevent truncation on large documents
    const analysisModel = genAI.getGenerativeModel({
      model: config.gemini.models.pro, // gemini-3-pro-preview
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 32768, // Pro max is 32K
        responseMimeType: 'application/json',
      },
    });

    // Helper function to attempt analysis with retry
    const attemptAnalysis = async (retryCount = 0): Promise<Awaited<ReturnType<typeof analysisModel.generateContent>>> => {
      try {
        const result = await analysisModel.generateContent(analysisPrompt);
        const responseText = result.response.text();

        // Check if response appears truncated (incomplete JSON)
        const trimmed = responseText.trim();
        if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
          logger.warn('Analysis response appears truncated', {
            responseLength: responseText.length,
            lastChars: responseText.substring(responseText.length - 100),
            finishReason: result.response.candidates?.[0]?.finishReason,
          });

          if (retryCount < 2) {
            logger.info(`Retrying analysis (attempt ${retryCount + 2})...`);
            // Wait a bit before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return attemptAnalysis(retryCount + 1);
          }
        }

        return result;
      } catch (error) {
        if (retryCount < 2) {
          logger.warn(`Analysis failed, retrying (attempt ${retryCount + 2})...`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
          return attemptAnalysis(retryCount + 1);
        }
        throw error;
      }
    };

    // Run analysis (formatting is now handled by deterministic DocumentFormatter)
    const analysisResult = await attemptAnalysis();

    // Process analysis result
    const analysisResponseText = analysisResult.response.text();

    logger.info(`Gemini 3 Flash analysis completed`, {
      responseLength: analysisResponseText.length,
      tokensUsed: analysisResult.response.usageMetadata?.totalTokenCount,
    });

    let analysis: LessonAnalysis;
    try {
      const jsonText = this.extractJSON(analysisResponseText);
      analysis = JSON.parse(jsonText);

      logger.info('Content analysis parsed successfully', {
        hasExercises: !!analysis.exercises,
        exerciseCount: analysis.exercises?.length || 0,
        vocabularyCount: analysis.vocabulary?.length || 0,
      });
    } catch (error) {
      // Check if the response appears truncated
      const trimmed = analysisResponseText.trim();
      const isTruncated = !trimmed.endsWith('}') && !trimmed.endsWith(']');
      const finishReason = analysisResult.response.candidates?.[0]?.finishReason;

      logger.error('Failed to parse content analysis response', {
        responseLength: analysisResponseText.length,
        responseText: analysisResponseText.substring(0, 1000),
        lastChars: analysisResponseText.substring(analysisResponseText.length - 200),
        isTruncated,
        finishReason,
        tokensUsed: analysisResult.response.usageMetadata?.totalTokenCount,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Provide more specific error message
      if (isTruncated || finishReason === 'MAX_TOKENS') {
        throw new Error('Failed to analyze content: Response was truncated. The lesson content may be too complex.');
      }
      throw new Error('Failed to analyze content');
    }

    // Note: formattedContent is NOT set here - it will be set by the
    // deterministic DocumentFormatter in contentProcessor.ts for 100% reliability

    // Validate content is child-appropriate
    const safetyCheck = await safetyFilters.validateContent(analysis, context.ageGroup);
    if (!safetyCheck.passed) {
      throw new Error('Content contains inappropriate material');
    }

    return analysis;
  }

  /**
   * Analyze a PDF document using native vision for superior structure detection.
   *
   * This method sends the PDF directly to Gemini (not extracted text), allowing
   * the model to SEE the visual layout: tables, headers, bullet points, etc.
   *
   * Uses structured output with JSON schema to guarantee contentBlocks format.
   */
  async analyzePDFWithVision(
    pdfBuffer: Buffer,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      subject?: Subject | null;
    }
  ): Promise<LessonAnalysis> {
    const isYoung = context.ageGroup === 'YOUNG';
    const pdfBase64 = pdfBuffer.toString('base64');

    logger.info('Analyzing PDF with native vision', {
      pdfSize: pdfBuffer.length,
      ageGroup: context.ageGroup,
      model: config.gemini.models.flash,
    });

    // JSON Schema for structured output - guarantees valid contentBlocks
    const contentBlocksSchema = {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Engaging title for the lesson' },
        summary: { type: 'string', description: 'Brief summary of the content (2-4 sentences)' },
        subject: {
          type: 'string',
          enum: ['MATH', 'SCIENCE', 'ENGLISH', 'ARABIC', 'ISLAMIC_STUDIES', 'SOCIAL_STUDIES', 'ART', 'MUSIC', 'OTHER'],
          description: 'The subject area'
        },
        gradeLevel: { type: 'string', description: 'Estimated grade level (K-8)' },
        keyConcepts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key concepts covered (3-8 items)'
        },
        vocabulary: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              term: { type: 'string' },
              definition: { type: 'string' },
              example: { type: 'string' }
            },
            required: ['term', 'definition']
          }
        },
        contentBlocks: {
          type: 'array',
          description: 'Structured content blocks representing the document layout',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['metadata', 'header', 'paragraph', 'explanation', 'example',
                       'keyConceptBox', 'rule', 'formula', 'wordProblem', 'bulletList',
                       'numberedList', 'stepByStep', 'tip', 'note', 'warning',
                       'question', 'answer', 'definition', 'vocabulary', 'table', 'divider']
              },
              // Header fields
              level: { type: 'integer', minimum: 1, maximum: 4 },
              text: { type: 'string' },
              // List fields
              title: { type: 'string' },
              items: { type: 'array', items: { type: 'string' } },
              // Table fields
              headers: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              // Definition fields
              term: { type: 'string' },
              definition: { type: 'string' },
              example: { type: 'string' },
              // Divider fields
              style: { type: 'string', enum: ['solid', 'dashed', 'section'] },
              label: { type: 'string' },
              // Step-by-step fields
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    content: { type: 'string' }
                  }
                }
              }
            },
            required: ['type']
          }
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: ['title', 'summary', 'contentBlocks']
    };

    const prompt = `You are an expert educational content analyzer with vision capabilities.

LOOK at this PDF document visually and extract its structure into content blocks.

YOUR TASK:
1. VISUALLY identify the document structure:
   - Headers (look for larger/bold text)
   - Tables (look for grid structures with rows and columns)
   - Bullet lists (look for • or - markers)
   - Numbered lists (look for 1. 2. 3. sequences)
   - Paragraphs of text
   - Key concepts or highlighted boxes
   - Definitions and vocabulary terms

2. Convert what you SEE into structured content blocks.

CRITICAL RULES FOR CONTENT BLOCKS:

HEADERS:
- Use "header" with level 2 for main section titles
- Use "header" with level 3 for sub-sections
- MUST have "level" (1-4) and "text" properties

PARAGRAPHS:
- Use "paragraph" for regular text content
- Keep paragraphs SHORT (3-5 sentences max)
- NEVER create walls of text - split into multiple paragraphs
- MUST have "text" property

TABLES:
- Use "table" when you SEE tabular data with rows and columns
- MUST have "headers" (array of column names) and "rows" (array of arrays)
- Each row is an array of cell values

LISTS:
- Use "bulletList" for unordered lists (• markers)
- Use "numberedList" for ordered lists (1. 2. 3.)
- MUST have "items" array with each list item as a string
- Optionally include "title" for the list header

DEFINITIONS:
- Use "definition" for vocabulary terms
- MUST have "term" and "definition" properties

KEY CONCEPTS:
- Use "keyConceptBox" for important highlighted ideas
- MUST have "text" property, optionally "title"

DIVIDERS:
- Use "divider" between major sections
- Include "style": "section" and optionally "label"

LANGUAGE: ${isYoung ? 'Use very simple words for ages 4-7' : 'Use grade-appropriate language for ages 8-12'}

Extract ALL visible content - do not skip anything you can see in the document.`;

    // Use Gemini 3 Flash with native PDF vision
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.2, // Low for accurate structure extraction
        maxOutputTokens: 65536,
        responseMimeType: 'application/json',
        responseSchema: contentBlocksSchema as any,
      },
    });

    try {
      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBase64,
          },
        },
      ]);

      const responseText = result.response.text();

      logger.info('PDF vision analysis completed', {
        responseLength: responseText.length,
        tokensUsed: result.response.usageMetadata?.totalTokenCount,
      });

      const analysis = JSON.parse(responseText) as LessonAnalysis;

      // Log what we got
      logger.info('PDF vision extracted content blocks', {
        blockCount: analysis.contentBlocks?.length || 0,
        blockTypes: analysis.contentBlocks?.map(b => b.type).slice(0, 15),
        hasTable: analysis.contentBlocks?.some(b => b.type === 'table'),
        hasBulletList: analysis.contentBlocks?.some(b => b.type === 'bulletList'),
      });

      // Validate content is child-appropriate
      const safetyCheck = await safetyFilters.validateContent(analysis, context.ageGroup);
      if (!safetyCheck.passed) {
        throw new Error('Content contains inappropriate material');
      }

      return analysis;
    } catch (error) {
      logger.error('PDF vision analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to analyze PDF with vision');
    }
  }

  /**
   * Generate flashcards from lesson content
   * Now supports curriculum-aware flashcard style
   */
  async generateFlashcards(
    lessonContent: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      subject?: Subject | null;
      count?: number;
    }
  ): Promise<GeneratedFlashcard[]> {
    const prompt = promptBuilder.buildFlashcardPrompt(lessonContent, context);

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    try {
      const jsonText = this.extractJSON(responseText);
      return JSON.parse(jsonText);
    } catch (error) {
      logger.error('Failed to parse flashcard response', {
        responseText: responseText.substring(0, 500),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to generate flashcards');
    }
  }

  /**
   * Generate a quiz from lesson content
   * Now supports curriculum-aware assessment style
   */
  async generateQuiz(
    lessonContent: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      type: string;
      count?: number;
    }
  ): Promise<GeneratedQuiz> {
    const prompt = promptBuilder.buildQuizPrompt(lessonContent, context);

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    try {
      const jsonText = this.extractJSON(responseText);
      return JSON.parse(jsonText);
    } catch (error) {
      logger.error('Failed to parse quiz response', {
        responseText: responseText.substring(0, 500),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to generate quiz');
    }
  }

  /**
   * Answer a question about selected text
   * Now supports curriculum-aware explanation style
   */
  async answerTextSelection(
    selectedText: string,
    userQuestion: string,
    context: ChildContext & {
      lessonContext?: LessonContext;
    }
  ): Promise<ChatResponse> {
    const startTime = Date.now();

    // Validate input
    const inputValidation = await safetyFilters.validateInput(
      userQuestion || '',
      context.ageGroup
    );

    if (!inputValidation.passed) {
      return this.createSafetyBlockedResponse(
        inputValidation,
        context.childId,
        userQuestion,
        startTime
      );
    }

    const prompt = promptBuilder.buildTextSelectionAnswerPrompt(
      selectedText,
      userQuestion,
      {
        ageGroup: context.ageGroup,
        curriculumType: context.curriculumType,
        gradeLevel: context.gradeLevel,
        lessonContext: context.lessonContext,
      }
    );

    const generationConfig =
      context.ageGroup === 'YOUNG' ? YOUNG_CHILD_CONFIG : OLDER_CHILD_CONFIG;

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig,
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Validate output
    const outputValidation = await safetyFilters.validateOutput(
      responseText,
      context.ageGroup
    );

    if (!outputValidation.passed) {
      return this.createSafetyBlockedResponse(
        outputValidation,
        context.childId,
        userQuestion,
        startTime
      );
    }

    return {
      content: responseText,
      responseTimeMs: Date.now() - startTime,
      wasFiltered: false,
    };
  }

  /**
   * Generate an image using Gemini's native image generation
   */
  async generateImage(prompt: string): Promise<GeneratedImage> {
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
          parts: [{ text: prompt }],
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

    for (const part of parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData;
        return {
          imageData: inlineData.data,
          mimeType: inlineData.mimeType || 'image/png',
        };
      }
    }

    throw new Error('No image data in response');
  }

  /**
   * Extract text from an image using Gemini's vision capabilities (OCR)
   * Optimized for educational documents: worksheets, textbooks, handwritten notes
   */
  async extractTextFromImage(
    imageBase64: string,
    mimeType: string
  ): Promise<OCRResult> {
    logger.info('Starting OCR extraction with Gemini Vision', {
      mimeType,
      imageSize: imageBase64.length,
    });

    // Use Gemini Flash for vision - fast and accurate for OCR
    // Set maxOutputTokens high to prevent truncation on dense worksheets/documents
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.1, // Very low for accurate text extraction
        maxOutputTokens: 65536,
      },
    });

    const prompt = `You are an expert OCR system designed to extract text from educational documents.

Analyze this image and extract ALL text content exactly as it appears. This could be:
- A worksheet or homework assignment
- Textbook pages
- Handwritten notes
- Printed educational materials

Instructions:
1. Extract ALL text visible in the image
2. Preserve the structure and layout as much as possible (use line breaks and spacing)
3. For handwritten text, do your best to interpret it accurately
4. Include any numbers, equations, or special characters
5. If there are multiple columns or sections, process them in reading order (left to right, top to bottom)
6. Include headers, titles, questions, and any instructions visible
7. For math problems, preserve the formatting (fractions, equations, etc.)

Return ONLY the extracted text, nothing else. Do not add explanations or commentary.
If no text is visible, return "[No text detected]".`;

    // Remove data URL prefix if present
    let cleanBase64 = imageBase64;
    if (imageBase64.includes(',')) {
      cleanBase64 = imageBase64.split(',')[1];
    }

    try {
      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType || 'image/jpeg',
            data: cleanBase64,
          },
        },
      ]);

      const response = result.response;
      const extractedText = response.text();

      if (!extractedText || extractedText === '[No text detected]') {
        logger.warn('No text detected in image');
        return {
          text: '',
          confidence: 0,
          metadata: {
            documentType: 'unknown',
          },
        };
      }

      logger.info('OCR extraction completed', {
        textLength: extractedText.length,
        tokensUsed: response.usageMetadata?.totalTokenCount,
      });

      return {
        text: extractedText.trim(),
        confidence: 0.9, // High confidence for Gemini vision
        metadata: {
          documentType: 'educational',
          language: 'en',
        },
      };
    } catch (error) {
      logger.error('OCR extraction failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to extract text from image');
    }
  }

  /**
   * Analyze a PDF document using Gemini's native PDF capabilities
   * Extracts text and educational metadata for content generation
   */
  async analyzePDF(pdfBase64: string): Promise<PDFAnalysisResult> {
    logger.info('Starting PDF analysis with Gemini', {
      pdfSize: pdfBase64.length,
    });

    // Use Gemini Flash for PDF analysis
    // Set maxOutputTokens high (65536 is the max for Flash) to prevent truncation
    // for large documents - the model only generates what it needs
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 65536,
        responseMimeType: 'application/json',
      },
    });

    const prompt = `You are an expert educator analyzing a PDF document to extract educational content.

Analyze this PDF and extract:
1. ALL text content from the document
2. A suggested title for teaching this content
3. A brief summary (2-3 sentences)
4. The subject area (MATH, SCIENCE, ENGLISH, SOCIAL_STUDIES, ART, MUSIC, or OTHER)
5. The appropriate grade level (K, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, or a range like "3-5")
6. Key topics covered (3-8 topics)
7. Important vocabulary terms with definitions (5-15 terms)

Return JSON with this exact structure:
{
  "extractedText": "Full text content from the PDF...",
  "suggestedTitle": "Title for the lesson",
  "summary": "Brief summary of what this content covers...",
  "detectedSubject": "SCIENCE",
  "detectedGradeLevel": "5",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "vocabulary": [
    {"term": "word1", "definition": "definition1"},
    {"term": "word2", "definition": "definition2"}
  ]
}

If the PDF is unreadable or contains no educational content, still return the JSON structure with empty/null values where appropriate.`;

    // Clean base64 - remove data URL prefix if present
    let cleanBase64 = pdfBase64;
    if (pdfBase64.includes(',')) {
      cleanBase64 = pdfBase64.split(',')[1];
    }

    try {
      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: cleanBase64,
          },
        },
      ]);

      const response = result.response;
      const responseText = response.text();
      const tokensUsed = response.usageMetadata?.totalTokenCount || 3000;

      const jsonText = this.extractJSON(responseText);
      const analysis = JSON.parse(jsonText);

      logger.info('PDF analysis completed', {
        textLength: analysis.extractedText?.length || 0,
        subject: analysis.detectedSubject,
        gradeLevel: analysis.detectedGradeLevel,
        tokensUsed,
      });

      return {
        extractedText: analysis.extractedText || '',
        suggestedTitle: analysis.suggestedTitle || 'Untitled Document',
        summary: analysis.summary || '',
        detectedSubject: analysis.detectedSubject || null,
        detectedGradeLevel: analysis.detectedGradeLevel || null,
        keyTopics: analysis.keyTopics || [],
        vocabulary: analysis.vocabulary || [],
        tokensUsed,
      };
    } catch (error) {
      logger.error('PDF analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to analyze PDF. The file may be corrupted or unreadable.');
    }
  }

  /**
   * Translate selected text to a target language using hybrid approach:
   * 1. Google Cloud Translate API for reliable, accurate translation
   * 2. Gemini AI for kid-friendly pronunciation and explanation
   */
  async translateText(
    text: string,
    targetLanguage: string,
    context: {
      ageGroup: AgeGroup;
      gradeLevel?: number | null;
    }
  ): Promise<TranslationResult> {
    const isYoung = context.ageGroup === 'YOUNG';

    // Language code mapping for Google Translate
    const languageCodeMap: Record<string, string> = {
      'arabic': 'ar',
      'spanish': 'es',
      'french': 'fr',
      'german': 'de',
      'italian': 'it',
      'portuguese': 'pt',
      'chinese': 'zh',
      'japanese': 'ja',
      'korean': 'ko',
      'russian': 'ru',
      'hindi': 'hi',
      'hebrew': 'he',
      'turkish': 'tr',
      'dutch': 'nl',
      'polish': 'pl',
      'vietnamese': 'vi',
      'thai': 'th',
      'indonesian': 'id',
      'malay': 'ms',
      'swahili': 'sw',
      'urdu': 'ur',
      'persian': 'fa',
      'bengali': 'bn',
      'punjabi': 'pa',
      'tamil': 'ta',
      'telugu': 'te',
      'marathi': 'mr',
      'gujarati': 'gu',
    };

    const targetLangCode = languageCodeMap[targetLanguage.toLowerCase()] || targetLanguage.substring(0, 2).toLowerCase();

    logger.info('Starting hybrid translation', {
      text: text.substring(0, 100),
      targetLanguage,
      targetLangCode,
      ageGroup: context.ageGroup,
    });

    // Step 1: Use Google Cloud Translate REST API for reliable translation
    let translatedText: string;
    try {
      // Use dedicated Cloud Translation API key (separate from Gemini API key)
      const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || config.gemini.apiKey;

      translatedText = await googleTranslate(text, targetLangCode, apiKey);

      if (!translatedText) {
        throw new Error('Empty translation from Google Translate');
      }

      logger.info('Google Translate successful', {
        originalLength: text.length,
        translatedLength: translatedText.length,
        targetLangCode,
      });
    } catch (googleError) {
      logger.error('Google Translate failed', {
        error: googleError instanceof Error ? googleError.message : 'Unknown error',
      });
      throw new Error('Failed to translate text');
    }

    // Return just the translation - no extra context needed for lesson content
    return {
      originalText: text,
      translatedText,
      targetLanguage,
      pronunciation: undefined,
      simpleExplanation: undefined,
    };
  }

  /**
   * Detect interactive exercises in lesson content
   * Scans content for fill-in-blanks, math problems, practice questions, etc.
   */
  async detectExercises(
    content: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      subject?: Subject | null;
    }
  ): Promise<DetectedExercise[]> {
    const prompt = promptBuilder.buildExerciseDetectionPrompt(content, context);

    logger.info('Detecting exercises in content', {
      contentLength: content.length,
      ageGroup: context.ageGroup,
      subject: context.subject,
    });

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash, // Use Flash for text-based analysis
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.3, // Lower temperature for more consistent detection
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
    });

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonText = this.extractJSON(responseText);
      const exercises = JSON.parse(jsonText) as DetectedExercise[];

      logger.info(`Detected ${exercises.length} exercises in content`, {
        exerciseTypes: exercises.map(e => e.type),
      });

      // Validate and clean up the exercises
      return exercises.filter(ex =>
        ex.questionText &&
        ex.expectedAnswer &&
        ex.type
      );
    } catch (error) {
      logger.error('Failed to detect exercises', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Return empty array on error - don't fail the whole content processing
      return [];
    }
  }

  /**
   * Validate a student's answer to an exercise using AI
   * Provides flexible matching and personalized feedback
   */
  async validateExerciseAnswer(
    exercise: {
      questionText: string;
      expectedAnswer: string;
      acceptableAnswers: string[];
      answerType: string;
      type: string;
    },
    submittedAnswer: string,
    attemptNumber: number,
    ageGroup: AgeGroup
  ): Promise<ExerciseValidationResult> {
    // First, try simple matching for fast response
    const simpleMatch = this.checkSimpleMatch(
      submittedAnswer,
      exercise.expectedAnswer,
      exercise.acceptableAnswers
    );

    if (simpleMatch) {
      // Exact or close match - skip AI call for faster response
      const feedback = ageGroup === 'YOUNG'
        ? 'Yay! You got it right! Great job!'
        : 'Excellent! That\'s correct!';

      return {
        isCorrect: true,
        confidence: 1.0,
        feedback,
      };
    }

    // Use AI for more flexible validation
    const prompt = promptBuilder.buildExerciseValidationPrompt(
      exercise,
      submittedAnswer,
      attemptNumber,
      ageGroup
    );

    logger.info('Validating exercise answer with AI', {
      exerciseType: exercise.type,
      attemptNumber,
      ageGroup,
    });

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash, // Use Flash for faster validation
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.2, // Low temperature for consistent evaluation
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
      },
    });

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const jsonText = this.extractJSON(responseText);
      const validation = JSON.parse(jsonText) as ExerciseValidationResult;

      logger.info('AI validation result', {
        isCorrect: validation.isCorrect,
        confidence: validation.confidence,
      });

      return validation;
    } catch (error) {
      logger.error('Failed to validate answer with AI', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Fallback: strict comparison
      const isCorrect = submittedAnswer.toLowerCase().trim() ===
        exercise.expectedAnswer.toLowerCase().trim();

      return {
        isCorrect,
        confidence: 0.5,
        feedback: isCorrect
          ? 'That looks right!'
          : 'Hmm, that\'s not quite right. Try again!',
      };
    }
  }

  /**
   * Simple string matching for fast answer validation
   * Returns true if exact or close match, false if needs AI
   */
  private checkSimpleMatch(
    submitted: string,
    expected: string,
    acceptable: string[]
  ): boolean {
    const normalizedSubmitted = submitted.toLowerCase().trim();
    const normalizedExpected = expected.toLowerCase().trim();

    // Exact match
    if (normalizedSubmitted === normalizedExpected) {
      return true;
    }

    // Check acceptable answers
    for (const alt of acceptable) {
      if (normalizedSubmitted === alt.toLowerCase().trim()) {
        return true;
      }
    }

    // Number comparison (handles "1/8" vs "0.125")
    try {
      const submittedNum = this.parseNumber(normalizedSubmitted);
      const expectedNum = this.parseNumber(normalizedExpected);

      if (submittedNum !== null && expectedNum !== null) {
        // Allow small floating point tolerance
        if (Math.abs(submittedNum - expectedNum) < 0.0001) {
          return true;
        }
      }
    } catch {
      // Not a number comparison
    }

    return false;
  }

  /**
   * Parse a string to a number, handling fractions
   */
  private parseNumber(str: string): number | null {
    // Handle fractions like "1/8"
    if (str.includes('/')) {
      const parts = str.split('/');
      if (parts.length === 2) {
        const num = parseFloat(parts[0]);
        const denom = parseFloat(parts[1]);
        if (!isNaN(num) && !isNaN(denom) && denom !== 0) {
          return num / denom;
        }
      }
    }

    // Handle regular numbers
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
  }

  /**
   * Format conversation history for Gemini chat
   */
  private formatConversationHistory(
    messages?: ChatMessage[]
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    if (!messages || messages.length === 0) {
      return [];
    }

    // Format messages
    const formatted = messages.map((msg) => ({
      role: msg.role === 'USER' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // Gemini requires history to start with 'user' role
    // If first message is from 'model', skip it (or prepend a user greeting)
    if (formatted.length > 0 && formatted[0].role === 'model') {
      // Skip leading model messages until we find a user message
      const firstUserIndex = formatted.findIndex(m => m.role === 'user');
      if (firstUserIndex === -1) {
        // No user messages at all - return empty history
        return [];
      }
      return formatted.slice(firstUserIndex);
    }

    return formatted;
  }

  /**
   * Create a safety-blocked response
   */
  private async createSafetyBlockedResponse(
    validation: SafetyValidation,
    childId: string,
    inputText: string,
    startTime: number
  ): Promise<ChatResponse> {
    // Log the incident
    const incidentType = validation.flags.includes('jailbreak_attempt')
      ? 'JAILBREAK_ATTEMPT'
      : validation.flags.includes('pii_request')
      ? 'PII_DETECTED'
      : validation.flags.includes('profanity')
      ? 'PROFANITY'
      : 'INAPPROPRIATE_TOPIC';

    await safetyFilters.logIncident(
      childId,
      incidentType as any,
      validation.severity || 'LOW',
      {
        inputText,
        flags: validation.flags,
      }
    );

    return {
      content:
        "I'm not sure about that topic! Let's talk about something from your lesson instead. What would you like to learn about?",
      responseTimeMs: Date.now() - startTime,
      wasFiltered: true,
      filterReason: validation.flags.join(', '),
    };
  }
}

export const geminiService = new GeminiService();
