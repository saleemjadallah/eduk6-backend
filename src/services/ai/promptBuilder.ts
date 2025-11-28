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
  "subject": "MUST be exactly one of: MATH, SCIENCE, ENGLISH, ARABIC, ISLAMIC_STUDIES, SOCIAL_STUDIES, ART, MUSIC, OTHER (detect from content)",
  "gradeLevel": "Estimated grade level (K-6)",
  "formattedContent": "The FULL lesson content rewritten with proper HTML formatting. Use these tags:
    - <h2> for main section titles/chapters
    - <h3> for subsections
    - <p> for paragraphs (wrap all text in paragraphs)
    - <b> or <strong> for important terms and vocabulary words
    - <ul> and <li> for bullet lists
    - <ol> and <li> for numbered lists
    Make it well-structured, readable, and engaging for children. Include ALL the content from the original, properly organized into clear sections.",
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

  /**
   * Build prompt for detecting interactive exercises in lesson content
   * Identifies fill-in-blanks, math problems, practice questions, etc.
   */
  buildExerciseDetectionPrompt(
    content: string,
    context: {
      ageGroup: AgeGroup;
      curriculumType?: CurriculumType | null;
      gradeLevel?: number | null;
      subject?: Subject | null;
    }
  ): string {
    const ageDesc = context.ageGroup === 'YOUNG'
      ? 'young child (ages 4-7)'
      : 'child (ages 8-12)';

    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (context.ageGroup === 'YOUNG' ? 1 : 4));

    return `Analyze this educational content and detect any EXISTING practice exercises, problems, or questions that require student answers.

Content:
${content}

Target audience: ${ageDesc}
Subject hint: ${context.subject || 'Unknown'}

IMPORTANT: You are NOT generating new questions. You are DETECTING exercises that already exist in the content.

Look for:
1. FILL_IN_BLANK: Questions with blanks like "___", "_____", or "______" that need to be filled
2. MATH_PROBLEM: Math equations to solve (e.g., "1/2 × 1/4 = ___", "5 + 3 = ?", "Solve: 12 ÷ 4")
3. SHORT_ANSWER: Open-ended questions asking for brief text answers
4. MULTIPLE_CHOICE: Questions with lettered or numbered options (A, B, C, D or 1, 2, 3, 4)
5. TRUE_FALSE: Statements asking true or false

For each exercise detected, extract:
- The exact question/problem text
- The correct answer (calculate it if it's a math problem)
- Alternative acceptable answers (different formats, spellings, etc.)
- Context from surrounding text
- Difficulty level based on the child's grade

Create helpful hints that guide without giving away the answer:
- hint1: A gentle nudge in the right direction
- hint2: More specific guidance, still not the answer

Create an explanation that teaches WHY the answer is correct.

Return as JSON array (return empty array [] if no exercises found):
[
  {
    "type": "FILL_IN_BLANK" | "MATH_PROBLEM" | "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "TRUE_FALSE",
    "questionText": "The exact question or problem text",
    "contextText": "Surrounding context (1-2 sentences before/after)",
    "originalPosition": "Description of where this appears (e.g., 'Set A, Question 1')",
    "expectedAnswer": "The correct answer",
    "acceptableAnswers": ["Alternative valid answers", "like different formats"],
    "answerType": "TEXT" | "NUMBER" | "SELECTION",
    "options": ["A) Option 1", "B) Option 2"] // Only for MULTIPLE_CHOICE
    "hint1": "A gentle hint that guides thinking",
    "hint2": "A more specific hint",
    "explanation": "Clear explanation of why this is the answer, written for a ${ageDesc}",
    "difficulty": "EASY" | "MEDIUM" | "HARD"
  }
]

Language requirements for hints and explanations:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Use encouraging, child-friendly language
- For YOUNG children: Very simple words, short sentences
- For OLDER children: Can use grade-appropriate vocabulary

Remember: Only detect exercises that ALREADY EXIST in the content. Do not create new ones.`;
  }

  /**
   * Build prompt for validating a student's answer with AI
   * Returns whether the answer is correct and personalized feedback
   */
  buildExerciseValidationPrompt(
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
  ): string {
    const isYoung = ageGroup === 'YOUNG';

    return `You are Jeffrey, a friendly AI learning buddy. A child submitted an answer to this exercise.

EXERCISE:
Question: ${exercise.questionText}
Expected Answer: ${exercise.expectedAnswer}
Also Acceptable: ${exercise.acceptableAnswers.join(', ') || 'None'}
Answer Type: ${exercise.answerType}
Exercise Type: ${exercise.type}

STUDENT'S ANSWER: "${submittedAnswer}"

ATTEMPT NUMBER: ${attemptNumber}

Determine if the answer is CORRECT using these rules:
1. For math: Accept equivalent forms (1/8 = 0.125 = "one eighth")
2. For text: Accept minor typos, different capitalizations
3. For numbers: Accept with or without units if meaning is clear
4. Be reasonably flexible - we want to recognize understanding, not penalize formatting

Return JSON:
{
  "isCorrect": true or false,
  "confidence": 0.0 to 1.0,
  "feedback": "Your response to the child"
}

FEEDBACK GUIDELINES for ${isYoung ? 'YOUNG children (4-7)' : 'OLDER children (8-12)'}:

If CORRECT:
${isYoung
  ? '- Use excited, celebratory language: "Yay! You did it! 🎉", "Wow, you\'re so smart!", "Amazing job!"'
  : '- Use encouraging, warm language: "Excellent work!", "That\'s exactly right!", "Great job!"'
}
- Keep it brief (1-2 sentences)
- Be enthusiastic but not over-the-top

If INCORRECT:
${attemptNumber >= 3
  ? `- This is their last attempt, so be gentle: "That's okay! The answer is ${exercise.expectedAnswer}. [Brief explanation of why]"`
  : isYoung
    ? '- Be very gentle: "Hmm, not quite! Let\'s try again!", "Almost! Think about..."'
    : '- Be supportive: "Not quite, but good thinking! Try again.", "Close! Remember that..."'
}
- ${attemptNumber < 3 ? 'Do NOT reveal the answer yet' : ''}
- Give a subtle nudge toward the right answer
- Keep it short (1-2 sentences)

Keep feedback SHORT and ${isYoung ? 'very simple' : 'clear'}. Max 2 sentences.`;
  }
}

export const promptBuilder = new PromptBuilder();
