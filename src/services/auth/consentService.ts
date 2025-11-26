// COPPA Parental Consent Service
import bcrypt from 'bcrypt';
import { prisma } from '../../config/database.js';
import { ConsentMethod, ConsentStatus } from '@prisma/client';
import { ValidationError, ForbiddenError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

const KBQ_SALT_ROUNDS = 10;

export interface ConsentVerificationResult {
  success: boolean;
  consentId: string;
  method: ConsentMethod;
  status: ConsentStatus;
}

// Knowledge-based questions for consent verification
const KBQ_QUESTIONS = [
  {
    id: 'birth_year',
    question: 'What year were you born?',
    type: 'text',
    validation: /^(19|20)\d{2}$/,
    hint: 'Enter a 4-digit year (e.g., 1985)',
  },
  {
    id: 'mother_maiden',
    question: "What is your mother's maiden name?",
    type: 'text',
    validation: /^[a-zA-Z\s]{2,}$/,
    hint: 'Letters only, at least 2 characters',
  },
  {
    id: 'street_lived',
    question: 'What street did you grow up on?',
    type: 'text',
    validation: /^.{3,}$/,
    hint: 'At least 3 characters',
  },
  {
    id: 'first_car',
    question: 'What was the make of your first car?',
    type: 'text',
    validation: /^.{2,}$/,
    hint: 'e.g., Toyota, Honda, Ford',
  },
  {
    id: 'pet_name',
    question: 'What was the name of your first pet?',
    type: 'text',
    validation: /^.{2,}$/,
    hint: 'At least 2 characters',
  },
  {
    id: 'birth_city',
    question: 'In what city were you born?',
    type: 'text',
    validation: /^.{2,}$/,
    hint: 'At least 2 characters',
  },
];

export const consentService = {
  /**
   * Get current consent status for a parent
   */
  async getConsentStatus(parentId: string): Promise<{
    status: ConsentStatus;
    method?: ConsentMethod;
    expiresAt?: Date | null;
  }> {
    const consent = await prisma.consent.findFirst({
      where: {
        parentId,
        status: 'VERIFIED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!consent) {
      return { status: 'PENDING' };
    }

    // Check if expired
    if (consent.expiresAt && consent.expiresAt < new Date()) {
      return { status: 'EXPIRED', method: consent.method };
    }

    return {
      status: consent.status,
      method: consent.method,
      expiresAt: consent.expiresAt,
    };
  },

  /**
   * Initiate credit card verification for consent
   * Returns Stripe PaymentIntent client secret
   */
  async initiateCreditCardConsent(
    parentId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ clientSecret: string; consentId: string }> {
    // Create pending consent record
    const consent = await prisma.consent.create({
      data: {
        parentId,
        method: 'CREDIT_CARD',
        status: 'PENDING',
        ipAddress,
        userAgent,
      },
    });

    // TODO: Create Stripe PaymentIntent for $0.50 charge
    // For now, return placeholder
    const clientSecret = `pi_placeholder_${consent.id}`;

    return { clientSecret, consentId: consent.id };
  },

  /**
   * Complete credit card consent verification
   */
  async verifyCreditCardConsent(
    consentId: string,
    paymentIntentId: string
  ): Promise<ConsentVerificationResult> {
    const consent = await prisma.consent.findUnique({
      where: { id: consentId },
    });

    if (!consent) {
      throw new ValidationError('Consent record not found');
    }

    if (consent.status !== 'PENDING') {
      throw new ForbiddenError('Consent already processed');
    }

    // TODO: Verify payment intent with Stripe
    // For now, just mark as verified

    const updatedConsent = await prisma.consent.update({
      where: { id: consentId },
      data: {
        status: 'VERIFIED',
        verificationData: { paymentIntentId },
        consentGivenAt: new Date(),
        // Consent is valid for 1 year
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      success: true,
      consentId: updatedConsent.id,
      method: updatedConsent.method,
      status: updatedConsent.status,
    };
  },

  /**
   * Get knowledge-based questions for consent
   * If parent already has stored answers, return the same questions for verification
   * Otherwise return questions for initial setup
   */
  async getKBQQuestions(parentId: string): Promise<{
    questions: Array<{
      id: string;
      question: string;
      hint?: string;
    }>;
    isSetup: boolean;
  }> {
    // Check if parent already has KBQ answers stored
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { kbqAnswers: true },
    });

    if (parent?.kbqAnswers && typeof parent.kbqAnswers === 'object') {
      // Parent has stored answers - return those specific questions for verification
      const storedAnswers = parent.kbqAnswers as Record<string, string>;
      const questionIds = Object.keys(storedAnswers);
      const questions = KBQ_QUESTIONS.filter(q => questionIds.includes(q.id));

      return {
        questions: questions.map(q => ({
          id: q.id,
          question: q.question,
        })),
        isSetup: false, // Verification mode
      };
    }

    // No stored answers - return random selection for initial setup
    const shuffled = [...KBQ_QUESTIONS].sort(() => Math.random() - 0.5);
    return {
      questions: shuffled.slice(0, 3).map(q => ({
        id: q.id,
        question: q.question,
        hint: q.hint,
      })),
      isSetup: true, // Setup mode
    };
  },

  /**
   * Setup KBQ answers for a parent (first-time setup)
   */
  async setupKBQAnswers(
    parentId: string,
    answers: Array<{ questionId: string; answer: string }>
  ): Promise<{ success: boolean }> {
    // Validate answers
    if (answers.length < 3) {
      throw new ValidationError('At least 3 security questions are required');
    }

    const hashedAnswers: Record<string, string> = {};

    for (const { questionId, answer } of answers) {
      const question = KBQ_QUESTIONS.find(q => q.id === questionId);
      if (!question) {
        throw new ValidationError(`Unknown question: ${questionId}`);
      }

      if (!question.validation.test(answer)) {
        throw new ValidationError(`Invalid answer format for: ${question.question}`);
      }

      // Hash the answer (case-insensitive, trimmed)
      const normalizedAnswer = answer.toLowerCase().trim();
      hashedAnswers[questionId] = await bcrypt.hash(normalizedAnswer, KBQ_SALT_ROUNDS);
    }

    // Store hashed answers
    await prisma.parent.update({
      where: { id: parentId },
      data: { kbqAnswers: hashedAnswers },
    });

    logger.info(`KBQ answers setup for parent ${parentId}`);

    return { success: true };
  },

  /**
   * Verify KBQ answers for consent
   */
  async verifyKBQConsent(
    parentId: string,
    answers: Array<{ questionId: string; answer: string }>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<ConsentVerificationResult> {
    // Get stored answers
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { kbqAnswers: true },
    });

    if (!parent?.kbqAnswers || typeof parent.kbqAnswers !== 'object') {
      throw new ValidationError('Security questions not set up. Please set up your security questions first.');
    }

    const storedAnswers = parent.kbqAnswers as Record<string, string>;

    // Verify each answer
    let correctCount = 0;
    const totalQuestions = Object.keys(storedAnswers).length;

    for (const { questionId, answer } of answers) {
      const hashedAnswer = storedAnswers[questionId];
      if (!hashedAnswer) {
        continue; // Skip unknown questions
      }

      // Compare with stored hash (case-insensitive)
      const normalizedAnswer = answer.toLowerCase().trim();
      const isCorrect = await bcrypt.compare(normalizedAnswer, hashedAnswer);

      if (isCorrect) {
        correctCount++;
      }
    }

    // Require at least 2 out of 3 correct answers (or 66% for other amounts)
    const requiredCorrect = Math.max(2, Math.ceil(totalQuestions * 0.66));

    if (correctCount < requiredCorrect) {
      logger.warn(`KBQ verification failed for parent ${parentId}: ${correctCount}/${totalQuestions} correct`);
      throw new ValidationError(`Verification failed. Please check your answers and try again.`);
    }

    // Create verified consent
    const consent = await prisma.consent.create({
      data: {
        parentId,
        method: 'KBQ',
        status: 'VERIFIED',
        verificationData: {
          questionIds: answers.map(a => a.questionId),
          correctCount,
          totalQuestions,
        },
        ipAddress,
        userAgent,
        consentGivenAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    logger.info(`KBQ consent verified for parent ${parentId}`);

    return {
      success: true,
      consentId: consent.id,
      method: consent.method,
      status: consent.status,
    };
  },

  /**
   * Revoke consent (parent-initiated)
   */
  async revokeConsent(parentId: string): Promise<void> {
    await prisma.consent.updateMany({
      where: { parentId, status: 'VERIFIED' },
      data: { status: 'EXPIRED' },
    });
  },

  /**
   * Check if parent has verified consent
   */
  async hasVerifiedConsent(parentId: string): Promise<boolean> {
    const consent = await prisma.consent.findFirst({
      where: {
        parentId,
        status: 'VERIFIED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    return consent !== null;
  },
};
