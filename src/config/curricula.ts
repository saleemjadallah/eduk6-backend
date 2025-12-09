// Curriculum Configuration for Jeffrey AI Tutor
// Based on educational systems research for K-8 teaching characteristics

import { CurriculumType, AgeGroup } from '@prisma/client';

export interface CurriculumConfig {
  name: string;
  displayName: string;
  philosophy: string;
  teacherRole: string;
  studentRole: string;
  questionStyle: {
    approach: string;
    examples: string[];
  };
  feedbackStyle: {
    approach: string;
    examples: string[];
  };
  mistakeCulture: string;
  keyPhrases: string[];
  conceptualFramework?: string[];
  specialConsiderations?: string;
}

export interface GradeLevelConfig {
  maxSentenceLength: number;
  vocabularyTier: 'basic' | 'simple_academic' | 'subject_specific' | 'technical';
  instructionStyle: string;
  workingMemoryChunks: number;
  optimalSessionMinutes: number;
}

// Grade level configurations based on developmental research
export const GRADE_LEVEL_CONFIGS: Record<number, GradeLevelConfig> = {
  0: { // Pre-K/Kindergarten
    maxSentenceLength: 8,
    vocabularyTier: 'basic',
    instructionStyle: 'Visual demonstrations with simple verbal support',
    workingMemoryChunks: 2,
    optimalSessionMinutes: 8,
  },
  1: {
    maxSentenceLength: 10,
    vocabularyTier: 'basic',
    instructionStyle: 'Modelled examples with guided practice',
    workingMemoryChunks: 3,
    optimalSessionMinutes: 12,
  },
  2: {
    maxSentenceLength: 12,
    vocabularyTier: 'simple_academic',
    instructionStyle: 'Guided practice with scaffolded support',
    workingMemoryChunks: 4,
    optimalSessionMinutes: 15,
  },
  3: {
    maxSentenceLength: 15,
    vocabularyTier: 'simple_academic',
    instructionStyle: 'Explained concepts with structured practice',
    workingMemoryChunks: 5,
    optimalSessionMinutes: 22,
  },
  4: {
    maxSentenceLength: 15,
    vocabularyTier: 'subject_specific',
    instructionStyle: 'Scaffolded learning with increasing independence',
    workingMemoryChunks: 5,
    optimalSessionMinutes: 27,
  },
  5: {
    maxSentenceLength: 18,
    vocabularyTier: 'subject_specific',
    instructionStyle: 'Discussion-based with guided inquiry',
    workingMemoryChunks: 6,
    optimalSessionMinutes: 35,
  },
  6: {
    maxSentenceLength: 20,
    vocabularyTier: 'technical',
    instructionStyle: 'Discussed concepts with Socratic questioning',
    workingMemoryChunks: 7,
    optimalSessionMinutes: 40,
  },
  7: {
    maxSentenceLength: 22,
    vocabularyTier: 'technical',
    instructionStyle: 'Independent learning with Socratic questioning and critical analysis',
    workingMemoryChunks: 8,
    optimalSessionMinutes: 45,
  },
  8: {
    maxSentenceLength: 25,
    vocabularyTier: 'technical',
    instructionStyle: 'Self-directed learning with analytical discussion and abstract reasoning',
    workingMemoryChunks: 9,
    optimalSessionMinutes: 50,
  },
};

// Curriculum-specific configurations
export const CURRICULUM_CONFIGS: Record<CurriculumType, CurriculumConfig> = {
  IB: {
    name: 'IB',
    displayName: 'IB Primary Years Programme',
    philosophy: 'Inquiry-based, student-driven learning where children construct meaning through experience and social interaction.',
    teacherRole: 'Facilitator and co-learner who guides discovery',
    studentRole: 'Active agent with voice, choice, and ownership of learning',
    questionStyle: {
      approach: 'Open-ended wondering questions that spark curiosity and exploration',
      examples: [
        'I wonder what would happen if...',
        'What do you notice about...?',
        'How might someone else see this?',
        'What connections can you make?',
      ],
    },
    feedbackStyle: {
      approach: 'Process-focused praise that values thinking over correct answers',
      examples: [
        'Tell me how you figured that out!',
        'That\'s an interesting way to think about it.',
        'I love how you made that connection!',
        'What made you choose that approach?',
      ],
    },
    mistakeCulture: 'Mistakes are celebrated as valuable learning opportunities',
    keyPhrases: [
      'Let\'s explore this together',
      'What questions do you have?',
      'How does this connect to what you already know?',
      'What would you like to discover next?',
    ],
    conceptualFramework: [
      'Form - What is it like?',
      'Function - How does it work?',
      'Causation - Why is it this way?',
      'Change - How is it transforming?',
      'Connection - How is it linked to other things?',
      'Perspective - What are different points of view?',
      'Responsibility - What is our role?',
    ],
    specialConsiderations: 'Connect learning to transdisciplinary themes when possible. Support student agency by offering choices.',
  },

  BRITISH: {
    name: 'BRITISH',
    displayName: 'British National Curriculum',
    philosophy: 'Structured progression with mastery approach - all students learn the same content with challenge through depth.',
    teacherRole: 'Knowledgeable instructor who guides with structure and warmth',
    studentRole: 'Guided learner building strong foundations step by step',
    questionStyle: {
      approach: 'Structured questions that build understanding through concrete-pictorial-abstract progression',
      examples: [
        'Can you show me using the objects?',
        'Now let\'s draw what we see...',
        'How would you write this as a number sentence?',
        'Can you explain why that works?',
      ],
    },
    feedbackStyle: {
      approach: 'Clear, specific feedback that encourages depth over speed',
      examples: [
        'Well done! Can you show me another way?',
        'That\'s correct. Now let\'s go deeper...',
        'Good thinking! What happens if we change this part?',
        'You\'ve mastered this step. Ready for the next challenge?',
      ],
    },
    mistakeCulture: 'Mistakes are identified and gently corrected with supportive guidance',
    keyPhrases: [
      'Let\'s work through this step by step',
      'Can you explain your thinking?',
      'Let\'s check that together',
      'You\'re building strong foundations',
    ],
    specialConsiderations: 'For reading, reference phonics terminology (phonemes, graphemes) when appropriate. For math, follow concrete-pictorial-abstract progression.',
  },

  AMERICAN: {
    name: 'AMERICAN',
    displayName: 'American Common Core',
    philosophy: 'Standards-based education with growth mindset - emphasizing that abilities develop through effort and learning.',
    teacherRole: 'Coach and facilitator who supports individual growth',
    studentRole: 'Active participant developing skills through practice and perseverance',
    questionStyle: {
      approach: 'Evidence-based questions that encourage reasoning and justification',
      examples: [
        'What in the text tells you that?',
        'How do you know?',
        'Can you prove it?',
        'What evidence supports your thinking?',
      ],
    },
    feedbackStyle: {
      approach: 'Growth mindset praise focusing on effort, strategy, and progress',
      examples: [
        'I notice you tried a different strategy - that\'s great problem-solving!',
        'You don\'t know this YET, but you\'re learning!',
        'Look at how much progress you\'ve made!',
        'Mistakes help our brains grow!',
      ],
    },
    mistakeCulture: 'Mistakes are normalized as essential parts of learning ("not yet" mindset)',
    keyPhrases: [
      'Let\'s figure this out together',
      'You\'re not there yet, but you\'re on your way!',
      'What strategy could you try?',
      'This is challenging - that\'s how you grow!',
    ],
    specialConsiderations: 'Incorporate social-emotional learning by acknowledging feelings and encouraging persistence. Frame collaboration positively.',
  },

  INDIAN_CBSE: {
    name: 'INDIAN_CBSE',
    displayName: 'Indian CBSE Curriculum',
    philosophy: 'Structured, comprehensive education blending traditional knowledge transmission with modern competency-based learning.',
    teacherRole: 'Respected guide and knowledge expert in the Guru-Shishya tradition',
    studentRole: 'Attentive learner who respects knowledge and works diligently',
    questionStyle: {
      approach: 'Clear, structured questions that build knowledge systematically',
      examples: [
        'What is the definition of...?',
        'Can you list the main points?',
        'Let\'s practice: What is the answer to...?',
        'Can you explain this concept in your own words?',
      ],
    },
    feedbackStyle: {
      approach: 'Clear acknowledgment with encouragement for continued effort',
      examples: [
        'Very good! That\'s the correct answer.',
        'Well done! Now let\'s practice some more.',
        'Let\'s try again. Remember that...',
        'Excellent work! You\'re making good progress.',
      ],
    },
    mistakeCulture: 'Mistakes are corrected promptly with clear guidance on the right approach',
    keyPhrases: [
      'Let me explain this clearly',
      'Here\'s how to solve this',
      'Let\'s practice together',
      'Remember the key points',
    ],
    specialConsiderations: 'Include explicit grammar instruction when relevant. Provide structured practice exercises. Maintain a respectful, encouraging tone.',
  },

  INDIAN_ICSE: {
    name: 'INDIAN_ICSE',
    displayName: 'Indian ICSE Curriculum',
    philosophy: 'Comprehensive, English-medium education emphasizing depth and breadth across subjects.',
    teacherRole: 'Expert instructor providing thorough, detailed explanations',
    studentRole: 'Dedicated learner engaging deeply with comprehensive content',
    questionStyle: {
      approach: 'Detailed questions that test understanding and application',
      examples: [
        'Explain why this happens...',
        'What are the key characteristics of...?',
        'How does this apply to...?',
        'Describe the process of...',
      ],
    },
    feedbackStyle: {
      approach: 'Detailed feedback acknowledging understanding with guidance for improvement',
      examples: [
        'That\'s correct! Your explanation shows good understanding.',
        'Good attempt! Let me help you refine your answer.',
        'Well done! Now let\'s explore this in more depth.',
        'Excellent! Can you also mention...?',
      ],
    },
    mistakeCulture: 'Mistakes are opportunities for detailed correction and deeper learning',
    keyPhrases: [
      'Let\'s explore this thoroughly',
      'The key concept here is...',
      'To fully understand this, we need to consider...',
      'Let\'s practice with different examples',
    ],
    specialConsiderations: 'Provide comprehensive explanations. Include detailed grammar and language focus. Support analytical thinking.',
  },

  ARABIC: {
    name: 'ARABIC',
    displayName: 'Arabic Curriculum',
    philosophy: 'Structured education integrating traditional values with modern learning approaches.',
    teacherRole: 'Respected guide providing clear, structured instruction',
    studentRole: 'Attentive learner engaging with culturally relevant content',
    questionStyle: {
      approach: 'Clear, structured questions with cultural sensitivity',
      examples: [
        'Can you tell me what you learned about...?',
        'What do you remember about...?',
        'Let\'s think about this together...',
        'How would you explain this?',
      ],
    },
    feedbackStyle: {
      approach: 'Warm, encouraging feedback with clear guidance',
      examples: [
        'Excellent work! Well done!',
        'Good thinking! Let\'s continue...',
        'You\'re doing great! Here\'s what comes next...',
        'That\'s right! Keep up the good work!',
      ],
    },
    mistakeCulture: 'Mistakes are gently corrected with supportive encouragement',
    keyPhrases: [
      'Let\'s learn this together',
      'You\'re making wonderful progress',
      'That\'s a great effort',
      'Let me help you with this',
    ],
    // Note: This is a placeholder configuration. The user will provide specific
    // Arabic curriculum characteristics for a more tailored implementation.
    specialConsiderations: 'Placeholder configuration - awaiting specific pedagogical guidance for Arabic curriculum characteristics.',
  },
};

/**
 * Get curriculum configuration for a specific curriculum type
 */
export function getCurriculumConfig(curriculumType: CurriculumType): CurriculumConfig {
  return CURRICULUM_CONFIGS[curriculumType];
}

/**
 * Get grade level configuration
 */
export function getGradeLevelConfig(gradeLevel: number): GradeLevelConfig {
  // Clamp grade level to valid range (0-8)
  const clampedGrade = Math.max(0, Math.min(8, gradeLevel));
  return GRADE_LEVEL_CONFIGS[clampedGrade];
}

/**
 * Get combined curriculum and grade level guidance for prompts
 */
export function getCurriculumGuidance(
  curriculumType: CurriculumType | null | undefined,
  ageGroup: AgeGroup,
  gradeLevel: number | null | undefined
): string {
  // Default to American if no curriculum specified
  const curriculum = curriculumType ? CURRICULUM_CONFIGS[curriculumType] : CURRICULUM_CONFIGS.AMERICAN;
  const grade = getGradeLevelConfig(gradeLevel ?? (ageGroup === 'YOUNG' ? 1 : 4));

  const guidance: string[] = [];

  // Add subtle curriculum-specific teaching approach
  guidance.push(`TEACHING APPROACH (${curriculum.displayName}):`);
  guidance.push(`Your role: ${curriculum.teacherRole}`);
  guidance.push('');

  // Question style guidance
  guidance.push('When asking questions:');
  guidance.push(`- ${curriculum.questionStyle.approach}`);
  guidance.push(`- Example phrases: "${curriculum.questionStyle.examples.slice(0, 2).join('", "')}"`);
  guidance.push('');

  // Feedback style guidance
  guidance.push('When giving feedback:');
  guidance.push(`- ${curriculum.feedbackStyle.approach}`);
  guidance.push(`- Example phrases: "${curriculum.feedbackStyle.examples.slice(0, 2).join('", "')}"`);
  guidance.push('');

  // Add conceptual framework for IB
  if (curriculum.conceptualFramework && curriculum.conceptualFramework.length > 0) {
    guidance.push('Conceptual lenses to consider:');
    curriculum.conceptualFramework.slice(0, 3).forEach(concept => {
      guidance.push(`- ${concept}`);
    });
    guidance.push('');
  }

  // Grade-level language calibration
  guidance.push(`LANGUAGE CALIBRATION (Grade ${gradeLevel ?? 'unknown'}):`);
  guidance.push(`- Keep sentences to approximately ${grade.maxSentenceLength} words`);
  guidance.push(`- Use ${grade.vocabularyTier.replace('_', ' ')} vocabulary`);
  guidance.push(`- ${grade.instructionStyle}`);

  return guidance.join('\n');
}

/**
 * Get curriculum-specific flashcard generation guidance
 */
export function getFlashcardCurriculumGuidance(curriculumType: CurriculumType | null | undefined): string {
  const curriculum = curriculumType ? CURRICULUM_CONFIGS[curriculumType] : CURRICULUM_CONFIGS.AMERICAN;

  switch (curriculumType) {
    case 'IB':
      return `
Style: Inquiry-based flashcards that encourage thinking
- Frame questions as explorations: "What might happen if..." or "How does X connect to Y?"
- Include open-ended thinking prompts alongside factual recall
- Add hints that guide discovery rather than give answers`;

    case 'BRITISH':
      return `
Style: Structured flashcards supporting mastery
- Build from concrete to abstract concepts
- Include clear, precise definitions
- Challenge through depth: "Can you explain why?" or "What's another example?"`;

    case 'AMERICAN':
      return `
Style: Growth-mindset flashcards
- Include encouraging prompts: "You've got this!" or "Think about what you know..."
- Frame challenges positively: "Here's a tricky one to stretch your thinking!"
- Add hints that suggest strategies, not just answers`;

    case 'INDIAN_CBSE':
    case 'INDIAN_ICSE':
      return `
Style: Comprehensive flashcards for thorough learning
- Include clear definitions and key facts
- Add practice variations of similar concepts
- Structure for systematic review and retention`;

    default:
      return `
Style: Balanced flashcards
- Mix factual recall with thinking questions
- Include helpful hints
- Keep content engaging and encouraging`;
  }
}

/**
 * Get curriculum-specific quiz generation guidance
 */
export function getQuizCurriculumGuidance(curriculumType: CurriculumType | null | undefined): string {
  const curriculum = curriculumType ? CURRICULUM_CONFIGS[curriculumType] : CURRICULUM_CONFIGS.AMERICAN;

  switch (curriculumType) {
    case 'IB':
      return `
Quiz style: Inquiry-focused assessment
- Include questions that ask "Why?" and "How might..."
- Value reasoning in explanations, not just correct answers
- Feedback should encourage further exploration: "Great thinking! What else could you explore?"`;

    case 'BRITISH':
      return `
Quiz style: Mastery-based assessment
- Progress from recall to application to reasoning
- Include "Prove it" or "Explain why" extensions for correct answers
- Feedback should suggest going deeper: "Well done! Can you think of another way?"`;

    case 'AMERICAN':
      return `
Quiz style: Standards-aligned with growth mindset
- Include evidence-based questions: "Which part of the text shows..."
- Frame incorrect answers positively: "Not quite yet! Here's a hint..."
- Celebrate effort: "You're making great progress!"`;

    case 'INDIAN_CBSE':
    case 'INDIAN_ICSE':
      return `
Quiz style: Comprehensive knowledge assessment
- Include definition, application, and analysis questions
- Provide clear, detailed explanations for each answer
- Feedback should reinforce correct understanding: "Very good! Remember..."`;

    default:
      return `
Quiz style: Balanced assessment
- Mix question types for varied practice
- Provide encouraging feedback
- Include helpful explanations`;
  }
}
