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
  chapters?: Array<{
    title: string;
    content: string;
    keyPoints?: string[];
  }>;
  keyConcepts: string[];
  vocabulary?: Array<{
    term: string;
    definition: string;
    example?: string;
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
    // Use Gemini 3 Pro for Jeffrey - best reasoning for educational content
    const baseConfig = context.ageGroup === 'YOUNG' ? YOUNG_CHILD_CONFIG : OLDER_CHILD_CONFIG;
    const generationConfig = {
      ...GEMINI_3_PRO_CHAT_CONFIG,
      maxOutputTokens: baseConfig.maxOutputTokens, // Age-appropriate length
    };

    // 5. Call Gemini 3 Pro for Jeffrey AI tutor
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.pro, // gemini-3-pro-preview
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig,
      systemInstruction: systemPrompt,
    });

    logger.info(`Using Gemini 3 Pro for Jeffrey chat`, {
      model: config.gemini.models.pro,
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
   * Uses Gemini 3 Pro for advanced reasoning and curriculum-aware content structuring
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
    const prompt = promptBuilder.buildContentAnalysisPrompt(content, context);

    logger.info(`Analyzing content with Gemini 3 Pro`, {
      model: config.gemini.models.pro,
      contentLength: content.length,
      ageGroup: context.ageGroup,
    });

    // Use Gemini 3 Pro for best analysis quality
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.pro, // gemini-3-pro-preview
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: GEMINI_3_PRO_ANALYSIS_CONFIG,
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    logger.info(`Gemini 3 Pro analysis completed`, {
      responseLength: responseText.length,
      tokensUsed: result.response.usageMetadata?.totalTokenCount,
    });

    let analysis: LessonAnalysis;
    try {
      const jsonText = this.extractJSON(responseText);
      analysis = JSON.parse(jsonText);
    } catch (error) {
      logger.error('Failed to parse content analysis response', {
        responseText: responseText.substring(0, 500), // Log first 500 chars for debugging
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to analyze content');
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

    const prompt = `Translate the following text to ${targetLanguage}.
This translation is for a ${isYoung ? 'young child (ages 4-7)' : 'child (ages 8-12)'}.

Text to translate: "${text}"

Return ONLY a valid JSON object with this exact format, no other text:
{
  "originalText": "${text}",
  "translatedText": "The translation in ${targetLanguage}",
  "targetLanguage": "${targetLanguage}",
  "pronunciation": "How to pronounce it (only if the target language uses a different script, like Arabic, Chinese, Japanese, Korean, Russian, Greek, Hebrew, Hindi, Thai - otherwise set to null)",
  "simpleExplanation": "A ${isYoung ? 'very simple 1-sentence explanation for a 5-year-old' : 'brief kid-friendly explanation if helpful, otherwise null'}"
}

Requirements:
- Keep the translation simple and natural
- ${isYoung ? 'Use the simplest possible words' : 'Use clear age-appropriate language'}
- If the text is a single word, provide a simple definition in simpleExplanation
- If the text is a phrase or sentence, simpleExplanation can be null unless clarification helps
- pronunciation should ONLY be included for non-Latin scripts`;

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
    } catch (error) {
      logger.error('Failed to parse translation response', {
        responseText: responseText.substring(0, 500),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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
      model: config.gemini.models.pro, // Use Pro for best detection accuracy
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

    return messages.map((msg) => ({
      role: msg.role === 'USER' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));
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
