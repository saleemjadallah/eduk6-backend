// Exercise service for interactive lesson exercises
import { prisma } from '../../config/database.js';
import {
  InteractiveExercise,
  ExerciseAttempt,
  ExerciseType,
  AnswerType,
  ExerciseDifficulty,
  AgeGroup,
  XPReason,
} from '@prisma/client';
import { geminiService } from '../ai/geminiService.js';
import { NotFoundError, ForbiddenError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

// Type for exercises detected by AI
export interface DetectedExercise {
  type: ExerciseType;
  questionText: string;
  contextText?: string;
  originalPosition?: string;
  expectedAnswer: string;
  acceptableAnswers?: string[];
  answerType?: AnswerType;
  options?: string[];
  hint1?: string;
  hint2?: string;
  explanation?: string;
  difficulty?: ExerciseDifficulty;
}

// Type for exercise with completion status
export interface ExerciseWithStatus extends InteractiveExercise {
  isCompleted: boolean;
  lastAttempt?: ExerciseAttempt | null;
  attemptCount: number;
}

// Result from submitting an answer
export interface SubmitAnswerResult {
  isCorrect: boolean;
  feedback: string;
  showHint: 1 | 2 | null;
  correctAnswer?: string;
  explanation?: string;
  xpAwarded: number;
  attemptNumber: number;
}

// XP calculation constants
const XP_BONUS_FIRST_TRY = 5;
const XP_MULTIPLIER_SECOND_TRY = 1.0;
const XP_MULTIPLIER_THIRD_TRY = 0.5;
const XP_MULTIPLIER_FOURTH_PLUS = 0.25;
const MAX_ATTEMPTS = 3;

export const exerciseService = {
  /**
   * Create exercises from AI detection results
   */
  async createExercisesForLesson(
    lessonId: string,
    exercises: DetectedExercise[]
  ): Promise<InteractiveExercise[]> {
    logger.info(`Creating ${exercises.length} exercises for lesson ${lessonId}`);

    const createdExercises = await Promise.all(
      exercises.map((exercise, index) =>
        prisma.interactiveExercise.create({
          data: {
            lessonId,
            type: exercise.type,
            orderIndex: index,
            questionText: exercise.questionText,
            contextText: exercise.contextText,
            originalPosition: exercise.originalPosition,
            expectedAnswer: exercise.expectedAnswer,
            acceptableAnswers: exercise.acceptableAnswers || [],
            answerType: exercise.answerType || 'TEXT',
            options: exercise.options,
            hint1: exercise.hint1,
            hint2: exercise.hint2,
            explanation: exercise.explanation,
            difficulty: exercise.difficulty || 'MEDIUM',
            xpReward: this.calculateXpReward(exercise.difficulty || 'MEDIUM'),
          },
        })
      )
    );

    logger.info(`Successfully created ${createdExercises.length} exercises`);
    return createdExercises;
  },

  /**
   * Calculate XP reward based on difficulty
   */
  calculateXpReward(difficulty: ExerciseDifficulty): number {
    switch (difficulty) {
      case 'EASY':
        return 5;
      case 'MEDIUM':
        return 10;
      case 'HARD':
        return 15;
      default:
        return 10;
    }
  },

  /**
   * Get all exercises for a lesson with completion status for a child
   * If childId is null, returns exercises without completion tracking (parent preview)
   */
  async getExercisesForLesson(
    lessonId: string,
    childId: string | null
  ): Promise<ExerciseWithStatus[]> {
    // Verify lesson exists
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
    });

    if (!lesson) {
      throw new NotFoundError('Lesson not found');
    }

    // If childId provided, verify it matches the lesson owner
    if (childId && lesson.childId !== childId) {
      throw new ForbiddenError('Access denied to this lesson');
    }

    // Get exercises with attempts if childId provided
    const exercises = await prisma.interactiveExercise.findMany({
      where: { lessonId },
      orderBy: { orderIndex: 'asc' },
      include: childId ? {
        attempts: {
          where: { childId },
          orderBy: { createdAt: 'desc' },
        },
      } : undefined,
    });

    return exercises.map((exercise) => {
      // For parent preview (no childId), return exercises without completion data
      if (!childId) {
        return {
          ...exercise,
          attempts: [],
          isCompleted: false,
          lastAttempt: null,
          attemptCount: 0,
          // Hide answers in preview mode
          expectedAnswer: '',
          acceptableAnswers: [],
        };
      }

      // For child session, include completion status
      const attempts = (exercise as any).attempts || [];
      const correctAttempt = attempts.find((a: ExerciseAttempt) => a.isCorrect);
      const lastAttempt = attempts[0] || null;

      return {
        ...exercise,
        isCompleted: !!correctAttempt,
        lastAttempt,
        attemptCount: attempts.length,
        // Hide the answer unless completed
        expectedAnswer: correctAttempt ? exercise.expectedAnswer : '',
        acceptableAnswers: correctAttempt ? exercise.acceptableAnswers : [],
      };
    });
  },

  /**
   * Get a single exercise by ID (hides answer until completed)
   */
  async getExerciseForChild(
    exerciseId: string,
    childId: string
  ): Promise<ExerciseWithStatus> {
    const exercise = await prisma.interactiveExercise.findUnique({
      where: { id: exerciseId },
      include: {
        lesson: true,
        attempts: {
          where: { childId },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!exercise) {
      throw new NotFoundError('Exercise not found');
    }

    if (exercise.lesson.childId !== childId) {
      throw new ForbiddenError('Access denied to this exercise');
    }

    const correctAttempt = exercise.attempts.find((a) => a.isCorrect);
    const lastAttempt = exercise.attempts[0] || null;

    return {
      ...exercise,
      isCompleted: !!correctAttempt,
      lastAttempt,
      attemptCount: exercise.attempts.length,
      // Hide the answer unless completed
      expectedAnswer: correctAttempt ? exercise.expectedAnswer : '',
      acceptableAnswers: correctAttempt ? exercise.acceptableAnswers : [],
    };
  },

  /**
   * Submit an answer for validation
   */
  async submitAnswer(
    exerciseId: string,
    childId: string,
    submittedAnswer: string,
    ageGroup: AgeGroup
  ): Promise<SubmitAnswerResult> {
    // Get exercise with existing attempts
    const exercise = await prisma.interactiveExercise.findUnique({
      where: { id: exerciseId },
      include: {
        lesson: true,
        attempts: {
          where: { childId },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!exercise) {
      throw new NotFoundError('Exercise not found');
    }

    if (exercise.lesson.childId !== childId) {
      throw new ForbiddenError('Access denied to this exercise');
    }

    // Check if already completed
    const existingCorrect = exercise.attempts.find((a) => a.isCorrect);
    if (existingCorrect) {
      return {
        isCorrect: true,
        feedback: "You've already completed this exercise!",
        showHint: null,
        xpAwarded: 0,
        attemptNumber: exercise.attempts.length,
      };
    }

    const attemptNumber = exercise.attempts.length + 1;

    // Validate the answer using AI
    const validation = await geminiService.validateExerciseAnswer(
      {
        questionText: exercise.questionText,
        expectedAnswer: exercise.expectedAnswer,
        acceptableAnswers: exercise.acceptableAnswers,
        answerType: exercise.answerType,
        type: exercise.type,
      },
      submittedAnswer,
      attemptNumber,
      ageGroup
    );

    let xpAwarded = 0;
    let showHint: 1 | 2 | null = null;
    let correctAnswer: string | undefined;
    let explanation: string | undefined;

    if (validation.isCorrect) {
      // Calculate XP based on attempt number
      xpAwarded = this.calculateXpForAttempt(exercise.xpReward, attemptNumber);

      // Award XP
      await this.awardXP(childId, exerciseId, xpAwarded, attemptNumber === 1);

      explanation = exercise.explanation || undefined;
    } else {
      // Determine what to show based on attempt number
      if (attemptNumber >= MAX_ATTEMPTS) {
        // Max attempts reached - reveal answer
        correctAnswer = exercise.expectedAnswer;
        explanation = exercise.explanation || undefined;
      } else if (attemptNumber === 1 && exercise.hint1) {
        showHint = 1;
      } else if (attemptNumber === 2 && exercise.hint2) {
        showHint = 2;
      } else if (attemptNumber === 1 && exercise.hint2) {
        // No hint1, show hint2 on first wrong attempt
        showHint = 2;
      }
    }

    // Record the attempt
    await prisma.exerciseAttempt.create({
      data: {
        exerciseId,
        childId,
        submittedAnswer,
        isCorrect: validation.isCorrect,
        attemptNumber,
        aiFeedback: validation.feedback,
        xpAwarded,
      },
    });

    return {
      isCorrect: validation.isCorrect,
      feedback: validation.feedback,
      showHint,
      correctAnswer,
      explanation,
      xpAwarded,
      attemptNumber,
    };
  },

  /**
   * Calculate XP based on attempt number
   */
  calculateXpForAttempt(baseXp: number, attemptNumber: number): number {
    if (attemptNumber === 1) {
      return baseXp + XP_BONUS_FIRST_TRY;
    } else if (attemptNumber === 2) {
      return Math.floor(baseXp * XP_MULTIPLIER_SECOND_TRY);
    } else if (attemptNumber === 3) {
      return Math.floor(baseXp * XP_MULTIPLIER_THIRD_TRY);
    } else {
      return Math.floor(baseXp * XP_MULTIPLIER_FOURTH_PLUS);
    }
  },

  /**
   * Award XP to a child for completing an exercise
   */
  async awardXP(
    childId: string,
    exerciseId: string,
    amount: number,
    isPerfect: boolean
  ): Promise<void> {
    // Create XP transaction
    await prisma.xPTransaction.create({
      data: {
        childId,
        amount,
        reason: isPerfect ? XPReason.EXERCISE_PERFECT : XPReason.EXERCISE_CORRECT,
        sourceType: 'exercise',
        sourceId: exerciseId,
        wasBonus: isPerfect,
        bonusMultiplier: isPerfect ? 1.5 : undefined,
        bonusReason: isPerfect ? 'first_try_correct' : undefined,
      },
    });

    // Update user progress
    await prisma.userProgress.upsert({
      where: { childId },
      create: {
        childId,
        currentXP: amount,
        totalXP: amount,
        questionsAnswered: 1,
      },
      update: {
        currentXP: { increment: amount },
        totalXP: { increment: amount },
        questionsAnswered: { increment: 1 },
        perfectScores: isPerfect ? { increment: 1 } : undefined,
      },
    });

    logger.info(`Awarded ${amount} XP to child ${childId} for exercise ${exerciseId}`);
  },

  /**
   * Get a specific hint for an exercise
   */
  async getHint(
    exerciseId: string,
    childId: string,
    hintNumber: 1 | 2
  ): Promise<string | null> {
    const exercise = await this.getExerciseForChild(exerciseId, childId);

    if (hintNumber === 1) {
      return exercise.hint1;
    } else if (hintNumber === 2) {
      return exercise.hint2;
    }

    return null;
  },

  /**
   * Get exercise statistics for a child
   */
  async getStatsForChild(childId: string): Promise<{
    totalExercises: number;
    completedExercises: number;
    totalAttempts: number;
    correctFirstTry: number;
    totalXpEarned: number;
  }> {
    const attempts = await prisma.exerciseAttempt.findMany({
      where: { childId },
      include: { exercise: true },
    });

    const exerciseIds = new Set(attempts.map((a) => a.exerciseId));
    const completedExerciseIds = new Set(
      attempts.filter((a) => a.isCorrect).map((a) => a.exerciseId)
    );

    const correctFirstTry = attempts.filter(
      (a) => a.isCorrect && a.attemptNumber === 1
    ).length;

    const totalXpEarned = attempts.reduce((sum, a) => sum + a.xpAwarded, 0);

    // Get total exercises from child's lessons
    const totalExercises = await prisma.interactiveExercise.count({
      where: {
        lesson: { childId },
      },
    });

    return {
      totalExercises,
      completedExercises: completedExerciseIds.size,
      totalAttempts: attempts.length,
      correctFirstTry,
      totalXpEarned,
    };
  },

  /**
   * Delete all exercises for a lesson
   */
  async deleteExercisesForLesson(lessonId: string): Promise<void> {
    await prisma.interactiveExercise.deleteMany({
      where: { lessonId },
    });
  },
};
