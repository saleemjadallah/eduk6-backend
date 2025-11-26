// AI Prompt Builder for child-appropriate content
import { AgeGroup, Subject, CurriculumType } from '@prisma/client';
import {
  getCurriculumGuidance,
  getFlashcardCurriculumGuidance,
  getQuizCurriculumGuidance,
  getGradeLevelConfig,
} from '../../config/curricula.js';

export interface LessonContext {
  title: string;
  subject?: Subject | null;
  summary?: string | null;
  keyConcepts?: string[];
}

export interface PromptContext {
  ageGroup: AgeGroup;
  curriculumType?: CurriculumType | null;
  gradeLevel?: number | null;
  lessonContext?: LessonContext;
}

export class PromptBuilder {
  /**
   * Build system instructions for Jeffrey AI tutor
   * Now includes curriculum-aware teaching approach
   */
  buildSystemInstructions(context: PromptContext): string {
    const instructions: string[] = [];

    // Core identity
    instructions.push(this.getJeffreyIdentity());

    // Safety rules (CRITICAL)
    instructions.push(this.getSafetyRules());

    // Age-appropriate communication
    instructions.push(this.getAgeGuidance(context.ageGroup));

    // Curriculum-specific teaching approach (subtle adaptations)
    instructions.push(getCurriculumGuidance(
      context.curriculumType,
      context.ageGroup,
      context.gradeLevel
    ));

    // Lesson context
    if (context.lessonContext) {
      instructions.push(this.getLessonGuidance(context.lessonContext));
    }

    return instructions.join('\n\n');
  }

  private getJeffreyIdentity(): string {
    return `You are Jeffrey, a friendly and enthusiastic AI learning buddy for children on the NanoBanana learning platform.

PERSONALITY:
- Always positive, encouraging, and patient
- Use simple, age-appropriate language
- Celebrate every effort and success
- Make learning fun with enthusiasm
- Use emojis sparingly but warmly
- Never be condescending or boring

GOAL:
Help children understand concepts deeply through conversation, examples, and analogies they can relate to.`;
  }

  private getSafetyRules(): string {
    return `CRITICAL SAFETY RULES (NEVER VIOLATE):

1. NEVER ask for or mention personal information (real names, addresses, phone numbers, school names, parent names, age specifics)

2. NEVER discuss topics inappropriate for children:
   - Violence, weapons, or scary content
   - Romance, relationships, or adult themes
   - Drugs, alcohol, or substances
   - Politics or controversial social issues
   - Death or serious illness in detail
   - Horror or disturbing content

3. NEVER provide external links or suggest visiting websites

4. NEVER pretend to be a real person, teacher, parent, or authority figure

5. If asked about these topics, redirect kindly:
   "That's not something I know about! Let's focus on your lesson. What would you like to learn about [subject]?"

6. If a child seems upset or mentions harm, respond with:
   "It sounds like you might be having a tough time. That's okay! Maybe talk to a grown-up you trust about how you're feeling. I'm here to help with learning!"

7. NEVER discuss how you work or your capabilities beyond being a learning helper`;
  }

  private getAgeGuidance(ageGroup: AgeGroup): string {
    if (ageGroup === 'YOUNG') {
      return `LANGUAGE FOR AGES 4-7:
- Use very simple words (1-2 syllables preferred)
- Keep sentences short (5-10 words max)
- Use lots of examples from daily life
- Reference things kids love: animals, toys, games, family
- Always be extra encouraging
- Use more emojis for visual appeal
- Explain everything as if talking to a young child`;
    }

    return `LANGUAGE FOR AGES 8-12:
- Use grade-appropriate vocabulary
- Explain new words when introducing them
- Give more detailed explanations
- Use analogies from their world (games, sports, movies)
- Encourage curiosity and deeper questions
- Can handle slightly longer conversations`;
  }

  private getLessonGuidance(lesson: LessonContext): string {
    return `CURRENT LESSON CONTEXT:

Subject: ${lesson.subject || 'General'}
Topic: ${lesson.title}
Key Concepts: ${lesson.keyConcepts?.join(', ') || 'None specified'}

Summary: ${lesson.summary || 'No summary available'}

When answering questions:
1. First try to relate answers to the current lesson
2. Use examples from the lesson content when possible
3. If the question is unrelated, gently guide back to the lesson
4. Suggest exploring related topics within the lesson`;
  }

  /**
   * Build prompt for generating flashcards from lesson content
   * Now includes curriculum-aware style guidance
   */
  buildFlashcardPrompt(
    content: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      count?: number;
    }
  ): string {
    const ageDesc = context.ageGroup === 'YOUNG'
      ? 'young child (ages 4-7)'
      : 'child (ages 8-12)';

    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (context.ageGroup === 'YOUNG' ? 1 : 4));
    const curriculumGuidance = getFlashcardCurriculumGuidance(context.curriculumType);

    return `Generate ${context.count || 10} flashcards from this educational content for a ${ageDesc}.

Content:
${content}

Requirements:
- Each card should test ONE concept only
- Questions should be clear and simple
- Answers should be concise (1-2 sentences max)
- Use age-appropriate language (max ${gradeConfig.maxSentenceLength} words per sentence)
- Make it engaging and fun
- Include helpful hints where appropriate
${curriculumGuidance}

Return as JSON array:
[
  {
    "front": "Question text",
    "back": "Answer text",
    "hint": "Optional hint"
  }
]`;
  }

  /**
   * Build prompt for content analysis
   * Now includes curriculum-aware content structuring
   */
  buildContentAnalysisPrompt(
    content: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      subject?: Subject | null;
    }
  ): string {
    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (context.ageGroup === 'YOUNG' ? 1 : 4));
    const curriculumGuidance = getCurriculumGuidance(context.curriculumType, context.ageGroup, context.gradeLevel);

    return `Analyze this educational content and extract key information for a ${context.ageGroup === 'YOUNG' ? 'young child (4-7)' : 'child (8-12)'}.

Content:
${content}

Subject hint: ${context.subject || 'Unknown'}

Language requirements:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Vocabulary level: ${gradeConfig.vocabularyTier.replace('_', ' ')}

${curriculumGuidance}

Extract and return as JSON:
{
  "title": "A concise, engaging title",
  "summary": "A ${context.ageGroup === 'YOUNG' ? '2-3 sentence' : '3-5 sentence'} summary in simple language",
  "gradeLevel": "Estimated grade level (K-6)",
  "chapters": [
    {
      "title": "Chapter title",
      "content": "Chapter summary",
      "keyPoints": ["point 1", "point 2"]
    }
  ],
  "keyConcepts": ["concept1", "concept2", ...],
  "vocabulary": [
    {
      "term": "word",
      "definition": "simple definition",
      "example": "example sentence"
    }
  ],
  "suggestedQuestions": ["question1", "question2", ...],
  "confidence": 0.0-1.0
}`;
  }

  /**
   * Build prompt for quiz generation
   * Now includes curriculum-aware assessment style
   */
  buildQuizPrompt(
    content: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      type: string;
      count?: number;
    }
  ): string {
    const count = context.count || 5;
    const ageDesc = context.ageGroup === 'YOUNG'
      ? 'young child (4-7 years old)'
      : 'child (8-12 years old)';

    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (context.ageGroup === 'YOUNG' ? 1 : 4));
    const curriculumGuidance = getQuizCurriculumGuidance(context.curriculumType);

    return `Create a ${context.type.toLowerCase()} quiz with ${count} questions from this content for a ${ageDesc}.

Content:
${content}

Language requirements:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Vocabulary level: ${gradeConfig.vocabularyTier.replace('_', ' ')}
${curriculumGuidance}

Requirements:
- Questions must be age-appropriate
- Use simple, clear language
- Include positive feedback for correct answers
- For wrong answers, provide gentle, educational explanations

Return as JSON:
{
  "title": "Quiz title",
  "questions": [
    {
      "id": "q1",
      "question": "Question text",
      "type": "${context.type}",
      "options": ["A", "B", "C", "D"],  // for MULTIPLE_CHOICE
      "correctAnswer": "A",
      "explanation": "Why this is correct",
      "encouragement": "Great job!" // Shown when correct
    }
  ]
}`;
  }

  /**
   * Build prompt for answering questions about selected text
   * Now includes curriculum-aware explanation style
   */
  buildTextSelectionAnswerPrompt(
    selectedText: string,
    userQuestion: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      lessonContext?: LessonContext;
    }
  ): string {
    const ageGuidance = context.ageGroup === 'YOUNG'
      ? 'Explain in very simple terms a 5-year-old would understand. Use short sentences.'
      : 'Explain clearly for a child aged 8-12. You can use slightly more complex vocabulary.';

    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (context.ageGroup === 'YOUNG' ? 1 : 4));
    const curriculumGuidance = getCurriculumGuidance(context.curriculumType, context.ageGroup, context.gradeLevel);

    return `A child selected this text from their lesson:

"${selectedText}"

And asked: "${userQuestion || 'Can you explain this?'}"

${ageGuidance}

Language requirements:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Vocabulary level: ${gradeConfig.vocabularyTier.replace('_', ' ')}

${curriculumGuidance}

${context.lessonContext ? `
Lesson context:
- Subject: ${context.lessonContext.subject || 'General'}
- Topic: ${context.lessonContext.title}
` : ''}

Respond as Jeffrey, the friendly learning buddy. Be encouraging and helpful!`;
  }
}

export const promptBuilder = new PromptBuilder();
