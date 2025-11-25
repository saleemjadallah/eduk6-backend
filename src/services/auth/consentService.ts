// COPPA Parental Consent Service
import { prisma } from '../../config/database.js';
import { ConsentMethod, ConsentStatus } from '@prisma/client';
import { ValidationError, ForbiddenError } from '../../middleware/errorHandler.js';

export interface ConsentVerificationResult {
  success: boolean;
  consentId: string;
  method: ConsentMethod;
  status: ConsentStatus;
}

// Knowledge-based questions for consent verification
const KBQ_QUESTIONS = [
  {
    id: 'last_4_ssn',
    question: 'What are the last 4 digits of your Social Security Number?',
    type: 'text',
    validation: /^\d{4}$/,
  },
  {
    id: 'birth_year',
    question: 'What year were you born?',
    type: 'text',
    validation: /^(19|20)\d{2}$/,
  },
  {
    id: 'mother_maiden',
    question: "What is your mother's maiden name?",
    type: 'text',
    validation: /^[a-zA-Z]{2,}$/,
  },
  {
    id: 'street_lived',
    question: 'What street did you grow up on?',
    type: 'text',
    validation: /^.{3,}$/,
  },
  {
    id: 'first_car',
    question: 'What was the make of your first car?',
    type: 'text',
    validation: /^.{2,}$/,
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
   */
  async getKBQQuestions(): Promise<Array<{
    id: string;
    question: string;
    options?: string[];
  }>> {
    // Return a random selection of 3 questions
    const shuffled = KBQ_QUESTIONS.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3).map(q => ({
      id: q.id,
      question: q.question,
    }));
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
    // In a real implementation, this would verify against a third-party
    // identity verification service. For now, we just check format.

    for (const { questionId, answer } of answers) {
      const question = KBQ_QUESTIONS.find(q => q.id === questionId);
      if (!question) {
        throw new ValidationError(`Unknown question: ${questionId}`);
      }

      if (!question.validation.test(answer)) {
        throw new ValidationError('Invalid answer format');
      }
    }

    // Create verified consent
    const consent = await prisma.consent.create({
      data: {
        parentId,
        method: 'KBQ',
        status: 'VERIFIED',
        verificationData: { questionIds: answers.map(a => a.questionId) },
        ipAddress,
        userAgent,
        consentGivenAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

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
