// Gemini AI Service for chat and content generation
import {
  genAI,
  CHILD_SAFETY_SETTINGS,
  YOUNG_CHILD_CONFIG,
  OLDER_CHILD_CONFIG,
} from '../../config/gemini.js';
import { config } from '../../config/index.js';
import { promptBuilder, LessonContext } from './promptBuilder.js';
import { safetyFilters, SafetyValidation } from './safetyFilters.js';
import { AgeGroup, Subject, ChatMessage } from '@prisma/client';
import { logger } from '../../utils/logger.js';

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

export class GeminiService {
  /**
   * Chat with Jeffrey AI tutor
   */
  async chat(
    message: string,
    context: {
      childId: string;
      ageGroup: AgeGroup;
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

    // 2. Build system prompt
    const systemPrompt = promptBuilder.buildSystemInstructions({
      ageGroup: context.ageGroup,
      lessonContext: context.lessonContext,
    });

    // 3. Build conversation history
    const history = this.formatConversationHistory(context.conversationHistory);

    // 4. Get appropriate config for age group
    const generationConfig =
      context.ageGroup === 'YOUNG' ? YOUNG_CHILD_CONFIG : OLDER_CHILD_CONFIG;

    // 5. Call Gemini
    const model = genAI.getGenerativeModel({
      model: config.gemini.models.flash,
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig,
      systemInstruction: systemPrompt,
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
   */
  async analyzeContent(
    content: string,
    context: { ageGroup: AgeGroup; subject?: Subject | null }
  ): Promise<LessonAnalysis> {
    const prompt = promptBuilder.buildContentAnalysisPrompt(content, context);

    const model = genAI.getGenerativeModel({
      model: config.gemini.models.pro, // Use Pro for better analysis
      safetySettings: CHILD_SAFETY_SETTINGS,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let analysis: LessonAnalysis;
    try {
      analysis = JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse content analysis response', { responseText });
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
   */
  async generateFlashcards(
    lessonContent: string,
    context: { ageGroup: AgeGroup; subject?: Subject | null; count?: number }
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
      return JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse flashcard response', { responseText });
      throw new Error('Failed to generate flashcards');
    }
  }

  /**
   * Generate a quiz from lesson content
   */
  async generateQuiz(
    lessonContent: string,
    context: { ageGroup: AgeGroup; type: string; count?: number }
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
      return JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse quiz response', { responseText });
      throw new Error('Failed to generate quiz');
    }
  }

  /**
   * Answer a question about selected text
   */
  async answerTextSelection(
    selectedText: string,
    userQuestion: string,
    context: {
      childId: string;
      ageGroup: AgeGroup;
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
      context
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
