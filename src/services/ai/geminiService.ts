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

export class GeminiService {
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
   * Now supports curriculum-aware content structuring
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
      return JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse flashcard response', { responseText });
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
      return JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse quiz response', { responseText });
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
