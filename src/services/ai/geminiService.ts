// Gemini AI Service for chat and content generation
// Uses Gemini 3 Pro for advanced reasoning and Jeffrey AI tutor
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

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  targetLanguage: string;
  pronunciation?: string; // For languages with different scripts
  simpleExplanation?: string; // Kid-friendly explanation of the word/phrase
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
   * Chat with Jeffrey AI tutor
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
    // Use Gemini 2.5 Flash for Jeffrey - fast and reliable for text-based chat
    const baseConfig = context.ageGroup === 'YOUNG' ? YOUNG_CHILD_CONFIG : OLDER_CHILD_CONFIG;
    const generationConfig = {
      temperature: 1.0,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: baseConfig.maxOutputTokens, // Age-appropriate length
    };

    // 5. Call Gemini 2.5 Flash for Jeffrey AI tutor
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash, // gemini-2.5-flash
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig,
      systemInstruction: systemPrompt,
    });

    logger.info(`Using Gemini 2.5 Flash for Jeffrey chat`, {
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
   * Uses parallel AI calls with Gemini 2.5 Flash for both:
   * - Analysis: metadata extraction (exercises, vocabulary, etc.)
   * - Formatting: content structure with proper line breaks
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
    const formattingPrompt = promptBuilder.buildContentFormattingPrompt(content);

    logger.info(`Starting parallel content analysis`, {
      contentLength: content.length,
      ageGroup: context.ageGroup,
      model: config.gemini.models.flash,
    });

    // Use Gemini 2.5 Flash for both - stable and fast
    const analysisModel = genAI.getGenerativeModel({
      model: config.gemini.models.flash, // gemini-2.5-flash
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    });

    const formattingModel = genAI.getGenerativeModel({
      model: config.gemini.models.flash, // gemini-2.5-flash
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8000,
      },
    });

    // Run both calls in parallel
    const [analysisResult, formattingResult] = await Promise.all([
      analysisModel.generateContent(analysisPrompt),
      formattingModel.generateContent(formattingPrompt).catch((error) => {
        logger.error('Formatting call failed, will use raw content', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }),
    ]);

    // Process analysis result
    const analysisResponseText = analysisResult.response.text();

    logger.info(`Gemini 2.5 Flash analysis completed`, {
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
      logger.error('Failed to parse content analysis response', {
        responseText: analysisResponseText.substring(0, 1000),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to analyze content');
    }

    // Process formatting result
    if (formattingResult) {
      let formattedContent = formattingResult.response.text();

      logger.info(`Gemini 2.5 Flash formatting completed`, {
        responseLength: formattedContent.length,
        tokensUsed: formattingResult.response.usageMetadata?.totalTokenCount,
        firstChars: formattedContent.substring(0, 150),
        singleNewlines: (formattedContent.match(/\n/g) || []).length,
        blankLines: (formattedContent.match(/\n\n/g) || []).length, // KEY: Must have blank lines!
      });

      // Clean up any "Here is..." intro that Gemini might add
      formattedContent = formattedContent
        .replace(/^["']/, '') // Remove leading quote
        .replace(/["']$/, '') // Remove trailing quote
        .replace(/^(Here is|Here's|The formatted content is|Below is)[^:]*:\s*/i, '') // Remove intro phrases
        .trim();

      analysis.formattedContent = formattedContent;
    } else {
      // Fall back to raw content if formatting failed
      logger.warn('Using raw content as fallback - formatting call returned null');
      analysis.formattedContent = content;
    }

    // Validate content is child-appropriate
    const safetyCheck = await safetyFilters.validateContent(analysis, context.ageGroup);
    if (!safetyCheck.passed) {
      throw new Error('Content contains inappropriate material');
    }

    return analysis;
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
   * Translate selected text to a target language
   * Provides kid-friendly translations with optional pronunciation and explanation
   * Follows Google AI Studio best practices for educational content
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

    // Following Gemini best practices:
    // 1. Provide clear context about the audience
    // 2. Be specific about what kind of output we want
    // 3. Use natural language to describe requirements

    const prompt = `You are helping ${isYoung
      ? 'a young child aged 4-7 who is just starting to learn about different languages and finds it exciting to discover new words'
      : 'an elementary school student aged 8-12 who is curious about languages and enjoys learning how people communicate around the world'}.

TRANSLATION REQUEST:
Please translate this text into ${targetLanguage}: "${text}"

YOUR TASK:
Provide a translation that feels natural and would actually be used by native ${targetLanguage} speakers. ${isYoung
  ? 'If there are multiple ways to say something, choose the simplest, most common version that a child would understand.'
  : 'Choose clear, standard language that represents how the phrase would commonly be expressed.'}

WHAT TO INCLUDE:
${isYoung
  ? `- A simple, easy-to-remember translation
- For languages with different writing systems (Arabic, Chinese, etc.), show how to pronounce it using sounds they know
- A fun, simple explanation that makes the child excited about learning the new word`
  : `- An accurate, natural translation
- For languages with different writing systems, provide a phonetic pronunciation guide
- If helpful, a brief note about interesting language facts or usage context`}

Return ONLY a valid JSON object with this exact structure (no additional text):
{
  "originalText": "The original text",
  "translatedText": "The translation in ${targetLanguage}",
  "targetLanguage": "${targetLanguage}",
  "pronunciation": ${isYoung
    ? '"Simple pronunciation using familiar sounds, like \\"say: Bone-jour\\" (only for non-Latin scripts, otherwise null)"'
    : '"Phonetic guide for non-Latin scripts, otherwise null"'},
  "simpleExplanation": "${isYoung
    ? 'A delightful 1-sentence explanation like: \\"This is how kids in France say hello!\\"'
    : 'A brief, interesting note about the translation if it adds value, otherwise null'}"
}

QUALITY STANDARDS:
- Translation must be accurate and natural-sounding
- Pronunciation (when included) should use sounds familiar to English speakers
- Explanation should spark curiosity about languages, not feel like a lecture`;

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    logger.info('Translation completed', {
      originalLength: text.length,
      targetLanguage,
      ageGroup: context.ageGroup,
      responseLength: responseText.length,
    });

    try {
      const jsonText = this.extractJSON(responseText);
      const parsed = JSON.parse(jsonText);
      return {
        originalText: text,
        translatedText: parsed.translatedText,
        targetLanguage: targetLanguage,
        pronunciation: parsed.pronunciation || undefined,
        simpleExplanation: parsed.simpleExplanation || undefined,
      };
    } catch (parseError) {
      logger.error('Failed to parse translation response', {
        responseText: responseText.substring(0, 1000),
        error: parseError instanceof Error ? parseError.message : 'Unknown error',
      });

      // Fallback: Try to extract fields using more robust regex for Unicode/RTL text
      try {
        // Match content between quotes, handling escaped quotes and Unicode
        const extractField = (fieldName: string): string | null => {
          const regex = new RegExp(`"${fieldName}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
          const match = responseText.match(regex);
          return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null;
        };

        const translatedText = extractField('translatedText');

        if (translatedText) {
          logger.info('Using fallback regex extraction for translation');
          return {
            originalText: text,
            translatedText: translatedText,
            targetLanguage: targetLanguage,
            pronunciation: extractField('pronunciation') || undefined,
            simpleExplanation: extractField('simpleExplanation') || undefined,
          };
        }
      } catch (fallbackError) {
        logger.error('Fallback extraction also failed', {
          error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error',
        });
      }

      throw new Error('Failed to translate text');
    }
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
