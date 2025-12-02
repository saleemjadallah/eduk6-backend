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
   * Follows Google AI Studio best practices for educational content generation
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
    const isYoung = context.ageGroup === 'YOUNG';
    const cardCount = context.count || 10;

    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (isYoung ? 1 : 4));
    const curriculumGuidance = getFlashcardCurriculumGuidance(context.curriculumType);

    return `You are creating a set of ${cardCount} flashcards for ${isYoung
      ? 'a young child aged 4-7 who is just learning to read and responds best to simple, fun questions with clear, memorable answers'
      : 'an elementary school student aged 8-12 who can handle more detail and appreciates understanding the reasoning behind concepts'}.

LESSON CONTENT TO CREATE FLASHCARDS FROM:
${content}

YOUR TASK:
Transform the key concepts from this lesson into engaging flashcards that make studying feel like a game. Each flashcard should help the child remember one specific piece of information through active recall.

FLASHCARD DESIGN PRINCIPLES:
${isYoung
  ? `- Questions should be like friendly puzzles: "What color is...?", "How many...?", "What does a ___ do?"
- Answers should be 1-5 words maximum - short enough to say in one breath
- Use familiar comparisons: "It's like a...", "Think of it as..."
- Hints should give a fun clue without giving away the answer`
  : `- Questions should encourage thinking: "Why does...?", "What happens when...?", "How is ___ different from ___?"
- Answers should be clear and complete but concise (1-2 sentences maximum)
- Connect concepts to their experiences: school, sports, games, nature
- Hints should guide their thinking process toward the answer`}

LANGUAGE REQUIREMENTS:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Vocabulary level: ${gradeConfig.vocabularyTier.replace('_', ' ')}
- Every word should be purposeful and age-appropriate
${curriculumGuidance}

QUALITY STANDARDS:
- Each card tests exactly ONE concept (never combine multiple facts)
- Questions are clear and unambiguous - only one correct answer possible
- Answers are factually accurate based on the lesson content
- Hints guide thinking without being too obvious
- The set covers the most important concepts from the lesson
- Cards progress from foundational to more challenging concepts

Return ONLY a valid JSON array with this exact structure (no additional text):
[
  {
    "front": "${isYoung ? 'Simple, engaging question' : 'Clear, thought-provoking question'}",
    "back": "${isYoung ? 'Short, memorable answer' : 'Complete but concise answer'}",
    "hint": "${isYoung ? 'Fun clue that helps them remember' : 'Thinking prompt that guides toward the answer'}"
  }
]`;
  }

  /**
   * Build prompt for content analysis
   * Extracts metadata AND formats the content for display
   * The formattedContent preserves ALL original text but adds proper structure
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
    const isYoung = context.ageGroup === 'YOUNG';

    return `You are analyzing educational content for ${isYoung
      ? 'a young child aged 4-7 who is just beginning their learning journey'
      : 'an elementary student aged 8-12 who can handle more detailed explanations'}.

You have TWO jobs:
1. EXTRACT metadata (title, summary, vocabulary, exercises, etc.)
2. FORMAT the content for readable display

CONTENT TO ANALYZE AND FORMAT:
${content}

SUBJECT HINT: ${context.subject || 'Not specified'}

═══════════════════════════════════════════════════════════
TASK 1: FORMAT THE CONTENT (formattedContent field)
═══════════════════════════════════════════════════════════

CRITICAL RULES - YOU MUST FOLLOW THESE EXACTLY:
- DO NOT summarize, shorten, or remove ANY content
- DO NOT add new content, explanations, or commentary
- DO NOT change any wording - preserve the EXACT original text
- DO NOT skip any sections, examples, problems, or answers
- Your ONLY job is to add proper formatting/structure

FORMATTING TO ADD:
- Add line breaks between paragraphs
- Add line breaks before/after section headers
- Add line breaks before each bullet point (•, -, *)
- Add line breaks before numbered items (1., 2., Step 1:, Example 1:, etc.)
- Add line breaks before metadata fields (Grade Level:, Subject:, Duration:, etc.)
- Convert [Page X] markers to [Section X] (we use scrolling, not pages)
- Separate distinct sections with blank lines
- Keep all mathematical expressions, formulas, and answers exactly as written

EXAMPLE of what you should do:
INPUT: "[Page 1] Fractions Grade Level: 5th Subject: Math Learning Objectives • Add fractions • Subtract fractions Example 1: 1/2 + 1/4 = 3/4"

OUTPUT (formattedContent):
"[Section 1]

Fractions

Grade Level: 5th
Subject: Math

Learning Objectives
• Add fractions
• Subtract fractions

Example 1: 1/2 + 1/4 = 3/4"

═══════════════════════════════════════════════════════════
TASK 2: EXTRACT METADATA
═══════════════════════════════════════════════════════════

${curriculumGuidance}

DETECTING EXERCISES:
Scan the content for ANY existing practice problems, questions, or activities:
- Math problems: "1/2 × 1/3 = ___", "Solve: 5 + 3 = ?", "Calculate..."
- Fill-in-blanks: "The capital of France is ___"
- Practice questions: numbered lists of questions, "Answer the following..."
- Multiple choice: questions with options A, B, C, D
- True/False statements

For each exercise found, extract it with its location context (e.g., "Set A, Question 3" or "Practice Problem 2").

Return your response in TWO parts, separated by the delimiter ===FORMATTED_CONTENT_START===

PART 1: Return ONLY valid JSON with this structure (do NOT include formattedContent here):
{
  "title": "A concise, engaging title for this lesson",
  "summary": "${isYoung ? 'A 2-3 sentence summary using very simple words' : 'A 3-5 sentence summary that captures the key learning objectives'}",
  "subject": "One of: MATH, SCIENCE, ENGLISH, ARABIC, ISLAMIC_STUDIES, SOCIAL_STUDIES, ART, MUSIC, OTHER",
  "gradeLevel": "Estimated grade level (K, 1, 2, 3, 4, 5, or 6)",
  "chapters": [
    {
      "title": "Section/chapter title if the content has clear sections",
      "keyPoints": ["Main point 1", "Main point 2"]
    }
  ],
  "keyConcepts": ["Important concept 1", "Important concept 2", "...up to 8 key concepts"],
  "vocabulary": [
    {
      "term": "Important vocabulary word",
      "definition": "${isYoung ? 'Very simple definition' : 'Clear, grade-appropriate definition'}",
      "example": "Optional example sentence"
    }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "type": "MATH_PROBLEM | FILL_IN_BLANK | SHORT_ANSWER | MULTIPLE_CHOICE | TRUE_FALSE",
      "questionText": "The exact question/problem text as it appears",
      "expectedAnswer": "The correct answer",
      "acceptableAnswers": ["Alternative correct formats"],
      "hint1": "A helpful hint without giving away the answer",
      "hint2": "A more specific hint",
      "explanation": "${isYoung ? 'Simple explanation of why' : 'Clear explanation of the solution'}",
      "difficulty": "EASY | MEDIUM | HARD",
      "locationInContent": "Where this appears (e.g., 'Practice Set A, #3')"
    }
  ],
  "suggestedQuestions": [
    "Question the student might want to ask Jeffrey about this content",
    "Another curiosity-sparking question"
  ],
  "confidence": 0.8
}

===FORMATTED_CONTENT_START===

PART 2: After the delimiter above, output the COMPLETE formatted content.
This is the full original content with proper line breaks added - include EVERY word, nothing summarized or removed.

LANGUAGE FOR SUMMARIES AND VOCABULARY:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Vocabulary level: ${gradeConfig.vocabularyTier.replace('_', ' ')}

QUALITY GUIDELINES:
- The formatted content after ===FORMATTED_CONTENT_START=== MUST contain ALL original text
- Title should be engaging and descriptive
- Summary should help the student know what they'll learn
- Vocabulary should include terms that might be new or important
- Exercises should capture ALL practice problems found in the content
- If no exercises exist in the content, return an empty array: "exercises": []`;
  }

  /**
   * Build prompt for quiz generation
   * Follows Google AI Studio best practices for educational assessment
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
    const isYoung = context.ageGroup === 'YOUNG';
    const quizType = context.type.toLowerCase();

    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (isYoung ? 1 : 4));
    const curriculumGuidance = getQuizCurriculumGuidance(context.curriculumType);

    // Map quiz types to more descriptive formats
    const quizTypeDescriptions: Record<string, string> = {
      'multiple_choice': 'multiple choice (4 options per question)',
      'true_false': 'true or false',
      'fill_in_blank': 'fill-in-the-blank',
    };
    const quizTypeDesc = quizTypeDescriptions[quizType] || quizType;

    return `You are creating a fun, encouraging ${quizTypeDesc} quiz for ${isYoung
      ? 'a young child aged 4-7 who is still developing reading skills and thrives on positive reinforcement'
      : 'an elementary school student aged 8-12 who enjoys a good challenge and appreciates understanding why answers are correct'}.

LESSON CONTENT TO QUIZ ON:
${content}

YOUR TASK:
Create ${count} quiz questions that feel like a fun game rather than a test. The quiz should help the child feel confident about what they've learned while gently identifying areas for review.

QUIZ DESIGN PHILOSOPHY:
${isYoung
  ? `- Questions should feel like friendly challenges, not tests
- Use encouraging language: "Can you remember...?", "Which one...?", "What's the..."
- Options should be clearly different (no tricky similar answers)
- Wrong answers should be obviously wrong to a child who learned the material
- Feedback should always be warm and encouraging, even for wrong answers`
  : `- Questions should make them think but not frustrate
- Include a mix of recall questions and "why/how" questions
- Wrong answer options should be plausible but clearly incorrect upon reflection
- Explanations should teach, not just confirm the right answer
- Encourage deeper thinking about the material`}

${quizType === 'multiple_choice' ? `MULTIPLE CHOICE SPECIFIC:
- Always provide exactly 4 options (A, B, C, D)
- Correct answer should be randomly distributed across positions
- Distractors should be related to the topic but clearly wrong
- ${isYoung ? 'Keep all options short (1-5 words each)' : 'Options can be phrases but keep them concise'}` : ''}

${quizType === 'true_false' ? `TRUE/FALSE SPECIFIC:
- Statements should be clearly true or clearly false
- Avoid tricky wording or double negatives
- Base statements directly on lesson content
- ${isYoung ? 'Use simple declarative sentences' : 'Can include cause-and-effect statements'}` : ''}

${quizType === 'fill_in_blank' ? `FILL-IN-THE-BLANK SPECIFIC:
- The blank should test a key concept, not random words
- Provide enough context that the answer is clear
- ${isYoung ? 'Use only one blank per question' : 'Can use multiple blanks if they test related concepts'}
- Accept reasonable alternative answers where appropriate` : ''}

LANGUAGE REQUIREMENTS:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Vocabulary level: ${gradeConfig.vocabularyTier.replace('_', ' ')}
${curriculumGuidance}

FEEDBACK TONE:
- Correct answers: ${isYoung ? 'Celebrate with enthusiasm! "Yay!", "You got it!", "Wonderful!"' : 'Affirm confidently: "Excellent!", "Exactly right!", "Perfect!"'}
- Wrong answers: ${isYoung ? 'Gentle and warm: "Not quite, but great try!", "Almost!", "Let\'s learn this together!"' : 'Supportive and educational: "Good thinking, but...", "Close! The answer is... because..."'}
- Explanations: ${isYoung ? 'Super simple - one short sentence explaining why' : 'Clear teaching moment - help them understand the concept'}

Return ONLY valid JSON with this exact structure (no additional text):
{
  "title": "${isYoung ? 'Fun, playful quiz title' : 'Engaging, encouraging quiz title'}",
  "questions": [
    {
      "id": "q1",
      "question": "Clear, ${isYoung ? 'simple' : 'thought-provoking'} question text",
      "type": "${context.type}",
      ${quizType === 'multiple_choice' ? '"options": ["Option A", "Option B", "Option C", "Option D"],' : ''}
      "correctAnswer": "${quizType === 'multiple_choice' ? 'A' : quizType === 'true_false' ? 'true' : 'the correct word/phrase'}",
      "explanation": "Why this is correct (teaches the concept)",
      "encouragement": "${isYoung ? 'Celebratory message with enthusiasm' : 'Affirming message that builds confidence'}"
    }
  ]
}`;
  }

  /**
   * Build prompt for answering questions about selected text
   * Follows Google AI Studio best practices for educational explanations
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
    const isYoung = context.ageGroup === 'YOUNG';
    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (isYoung ? 1 : 4));
    const curriculumGuidance = getCurriculumGuidance(context.curriculumType, context.ageGroup, context.gradeLevel);

    return `You are Jeffrey, a warm and enthusiastic AI learning buddy helping ${isYoung
      ? 'a young child aged 4-7 who is just starting their learning journey and responds best to simple, playful explanations with lots of familiar examples'
      : 'an elementary school student aged 8-12 who is curious and capable of understanding more detailed explanations with reasoning'}.

THE CHILD'S QUESTION:
The child highlighted this part of their lesson: "${selectedText}"

Their question: "${userQuestion || 'Can you explain this?'}"

${context.lessonContext ? `LESSON CONTEXT:
The child is currently studying ${context.lessonContext.subject || 'a topic'} and the lesson is about "${context.lessonContext.title}".
${context.lessonContext.keyConcepts?.length ? `Key concepts in this lesson include: ${context.lessonContext.keyConcepts.join(', ')}.` : ''}
` : ''}

YOUR TASK:
Help the child understand by explaining in a way that connects to things they already know and experience in daily life. ${isYoung
  ? 'Think of how a patient, loving teacher would explain this to a curious 5-year-old - using simple words, familiar comparisons, and a warm, encouraging tone.'
  : 'Explain like a knowledgeable older friend would - clear and informative, but never condescending. Make the child feel smart for asking.'}

HOW TO EXPLAIN:
${isYoung
  ? `- Use very short sentences (5-10 words each)
- Compare to things kids know: toys, animals, family, playing, eating
- Use one simple example they can picture in their mind
- Speak with warmth and excitement about learning
- End with encouragement or a fun fact that sparks curiosity`
  : `- Use clear, grade-appropriate language
- Connect to their world: school, sports, games, nature, technology
- Explain the "why" behind concepts when relevant
- Give a concrete example that makes the abstract tangible
- Encourage them to think deeper with a follow-up thought`}

LANGUAGE GUIDELINES:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Vocabulary: ${gradeConfig.vocabularyTier.replace('_', ' ')} (introduce new words gently with quick explanations)
${curriculumGuidance}

Remember: Your goal is to make this child feel confident and excited about learning. Be their cheerleader and guide!`;
  }

  /**
   * Build prompt for detecting interactive exercises in lesson content
   * Follows Google AI Studio best practices for content analysis
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
    const isYoung = context.ageGroup === 'YOUNG';
    const gradeConfig = getGradeLevelConfig(context.gradeLevel ?? (isYoung ? 1 : 4));

    return `You are analyzing educational content to find practice exercises that students can interact with. This content is designed for ${isYoung
      ? 'young children aged 4-7 who are early learners and need simple, encouraging feedback'
      : 'elementary students aged 8-12 who can handle more complex problems and appreciate understanding the reasoning behind answers'}.

CONTENT TO ANALYZE:
${content}

SUBJECT: ${context.subject || 'Not specified'}

YOUR TASK:
Carefully scan this content for ANY existing practice exercises, problems, or questions that ask students to provide an answer. You are detecting what's already there, not creating new exercises.

WHAT TO LOOK FOR:
- Fill-in-the-blank questions: Look for blanks shown as "___", "_____", or similar placeholders
- Math problems: Equations to solve like "1/2 × 1/4 = ___" or "Solve: 12 ÷ 4 = ?"
- Short answer questions: Questions that ask students to write a brief response
- Multiple choice: Questions with options labeled A, B, C, D or 1, 2, 3, 4
- True/False: Statements where students must determine if they're true or false

FOR EACH EXERCISE YOU FIND:
1. Extract the exact question text as it appears
2. Calculate or identify the correct answer
3. Think of alternative acceptable answers (different formats like "1/8" vs "0.125", minor spelling variations)
4. Note the surrounding context so the exercise makes sense
5. Assess difficulty based on grade level

CREATING HELPFUL HINTS:
Write hints that guide the student's thinking without giving away the answer:
- Hint 1: A gentle nudge in the right direction (${isYoung ? '"Think about what happens when..."' : '"Remember the rule for..."'})
- Hint 2: More specific guidance that still requires thinking (${isYoung ? '"Count on your fingers..."' : '"Try breaking this into smaller steps..."'})

WRITING EXPLANATIONS:
The explanation should teach WHY the answer is correct in a way that ${isYoung
  ? 'a young child can understand - use simple words, familiar comparisons, and an encouraging tone'
  : 'helps the student truly understand the concept - clear reasoning, useful for future problems'}.

LANGUAGE REQUIREMENTS:
- Maximum sentence length: ${gradeConfig.maxSentenceLength} words
- Tone: ${isYoung ? 'Warm, playful, and encouraging like a patient teacher' : 'Friendly and educational like a helpful tutor'}
- Vocabulary: ${isYoung ? 'Very simple, everyday words' : 'Grade-appropriate, introducing terms when needed'}

Return ONLY a valid JSON array with this structure (return [] if no exercises found):
[
  {
    "type": "FILL_IN_BLANK" | "MATH_PROBLEM" | "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "TRUE_FALSE",
    "questionText": "The exact question or problem text as it appears",
    "contextText": "1-2 sentences of surrounding context",
    "originalPosition": "Where this appears (e.g., 'Practice Section, Problem 3')",
    "expectedAnswer": "The correct answer",
    "acceptableAnswers": ["Alternative valid formats"],
    "answerType": "TEXT" | "NUMBER" | "SELECTION",
    "options": ["Only for MULTIPLE_CHOICE"],
    "hint1": "Gentle guidance that points in the right direction",
    "hint2": "More specific help that still requires thinking",
    "explanation": "Clear, ${isYoung ? 'simple' : 'educational'} explanation of why this is correct",
    "difficulty": "EASY" | "MEDIUM" | "HARD"
  }
]

CRITICAL: Only detect exercises that ALREADY EXIST in the content. Do not invent or create new ones.`;
  }

  /**
   * Build prompt for validating a student's answer with AI
   * Follows Google AI Studio best practices for personalized feedback
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

    return `You are Jeffrey, a warm and encouraging AI learning buddy who celebrates effort and learning. A ${isYoung
      ? 'young child aged 4-7 who is still building confidence with learning and needs lots of encouragement'
      : 'student aged 8-12 who appreciates honest feedback and wants to understand their mistakes'} just submitted an answer to a practice exercise.

THE EXERCISE:
Question: "${exercise.questionText}"
Correct Answer: "${exercise.expectedAnswer}"
Also Acceptable: ${exercise.acceptableAnswers.length > 0 ? exercise.acceptableAnswers.join(', ') : 'Only the exact answer'}
Answer Format: ${exercise.answerType}
Exercise Type: ${exercise.type}

STUDENT'S SUBMISSION: "${submittedAnswer}"
ATTEMPT NUMBER: ${attemptNumber} of 3

YOUR TASK:
Determine whether this answer demonstrates understanding of the concept. Be thoughtfully flexible:
- For math: Accept equivalent representations (1/8 = 0.125 = "one eighth" = "1 out of 8")
- For text: Accept minor typos, different capitalizations, reasonable abbreviations
- For numbers: Accept with or without units if the value is clearly correct
- Overall: Recognize genuine understanding rather than penalizing formatting differences

HOW TO RESPOND:
${attemptNumber >= 3
  ? `This is their final attempt. If incorrect, gently reveal the answer: "That's okay - learning takes practice! The answer is ${exercise.expectedAnswer}." Then give a brief, encouraging explanation of why.`
  : `They still have ${3 - attemptNumber} more ${3 - attemptNumber === 1 ? 'try' : 'tries'}. ${isYoung
      ? 'If wrong, be gentle and give a playful hint without revealing the answer.'
      : 'If wrong, acknowledge their thinking and give a helpful nudge toward the right direction.'}`}

${isYoung ? `FOR YOUNG LEARNERS:
- Correct: Celebrate warmly! "Yay, you got it!" or "Amazing work!"
- Incorrect: Be very gentle. "Hmm, not quite - let's think again!" Give a simple hint.
- Keep feedback to 1 short sentence. Use simple, happy words.` :
`FOR OLDER STUDENTS:
- Correct: Affirm confidently. "Excellent!" or "Exactly right!"
- Incorrect: Be supportive and educational. "Good thinking, but..." Guide their reasoning.
- Keep feedback to 1-2 clear sentences. Help them understand.`}

Return ONLY valid JSON:
{
  "isCorrect": true or false,
  "confidence": 0.0 to 1.0,
  "feedback": "Your warm, ${isYoung ? 'simple' : 'helpful'} response to the child (max 2 sentences)"
}`;
  }
}

export const promptBuilder = new PromptBuilder();
