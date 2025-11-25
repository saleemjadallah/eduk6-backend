// Flashcard service for CRUD and spaced repetition
import { prisma } from '../../config/database.js';
import { FlashcardDeck, Flashcard, Subject } from '@prisma/client';
import { geminiService } from '../ai/geminiService.js';
import { lessonService } from './lessonService.js';
import { NotFoundError, ForbiddenError } from '../../middleware/errorHandler.js';

export interface CreateDeckParams {
  childId: string;
  title: string;
  description?: string;
  subject?: Subject;
  lessonId?: string;
}

export interface CreateFlashcardParams {
  deckId: string;
  front: string;
  back: string;
  imageUrl?: string;
  audioUrl?: string;
}

// SM-2 Spaced Repetition Algorithm
function calculateNextReview(
  quality: number, // 0-5 rating
  easeFactor: number,
  interval: number,
  repetitions: number
): { easeFactor: number; interval: number; repetitions: number; nextReviewAt: Date } {
  // Quality: 0=complete blackout, 5=perfect response
  let newEaseFactor = easeFactor;
  let newInterval = interval;
  let newRepetitions = repetitions;

  if (quality < 3) {
    // Failed review - reset
    newRepetitions = 0;
    newInterval = 1;
  } else {
    // Successful review
    if (newRepetitions === 0) {
      newInterval = 1;
    } else if (newRepetitions === 1) {
      newInterval = 6;
    } else {
      newInterval = Math.round(interval * easeFactor);
    }
    newRepetitions += 1;
  }

  // Update ease factor
  newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEaseFactor < 1.3) newEaseFactor = 1.3;

  // Calculate next review date
  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);

  return {
    easeFactor: newEaseFactor,
    interval: newInterval,
    repetitions: newRepetitions,
    nextReviewAt,
  };
}

export const flashcardService = {
  // ============================================
  // DECK OPERATIONS
  // ============================================

  /**
   * Create a new flashcard deck
   */
  async createDeck(params: CreateDeckParams): Promise<FlashcardDeck> {
    return prisma.flashcardDeck.create({
      data: {
        childId: params.childId,
        title: params.title,
        description: params.description,
        subject: params.subject,
        lessonId: params.lessonId,
      },
    });
  },

  /**
   * Get all decks for a child
   */
  async getDecksForChild(childId: string): Promise<FlashcardDeck[]> {
    return prisma.flashcardDeck.findMany({
      where: { childId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { flashcards: true },
        },
      },
    });
  },

  /**
   * Get a deck by ID with ownership verification
   */
  async getDeckForChild(deckId: string, childId: string): Promise<FlashcardDeck & { flashcards: Flashcard[] }> {
    const deck = await prisma.flashcardDeck.findUnique({
      where: { id: deckId },
      include: { flashcards: { orderBy: { orderIndex: 'asc' } } },
    });

    if (!deck) {
      throw new NotFoundError('Deck not found');
    }

    if (deck.childId !== childId) {
      throw new ForbiddenError('Access denied');
    }

    return deck;
  },

  /**
   * Delete a deck
   */
  async deleteDeck(deckId: string, childId: string): Promise<void> {
    await this.getDeckForChild(deckId, childId);

    await prisma.flashcardDeck.delete({
      where: { id: deckId },
    });
  },

  /**
   * Update deck mastery level
   */
  async updateDeckMastery(deckId: string): Promise<void> {
    const deck = await prisma.flashcardDeck.findUnique({
      where: { id: deckId },
      include: { flashcards: true },
    });

    if (!deck || deck.flashcards.length === 0) return;

    // Calculate mastery as average of card mastery
    // Card mastery is based on repetitions and correct rate
    const totalMastery = deck.flashcards.reduce((sum, card) => {
      const correctRate = card.timesReviewed > 0
        ? card.timesCorrect / card.timesReviewed
        : 0;
      const repBonus = Math.min(card.repetitions * 10, 50);
      return sum + (correctRate * 50 + repBonus);
    }, 0);

    const masteryLevel = totalMastery / deck.flashcards.length;

    await prisma.flashcardDeck.update({
      where: { id: deckId },
      data: {
        masteryLevel,
        lastStudiedAt: new Date(),
      },
    });
  },

  // ============================================
  // FLASHCARD OPERATIONS
  // ============================================

  /**
   * Create a flashcard
   */
  async createFlashcard(params: CreateFlashcardParams): Promise<Flashcard> {
    // Get max order index
    const maxOrder = await prisma.flashcard.aggregate({
      where: { deckId: params.deckId },
      _max: { orderIndex: true },
    });

    return prisma.flashcard.create({
      data: {
        deckId: params.deckId,
        front: params.front,
        back: params.back,
        imageUrl: params.imageUrl,
        audioUrl: params.audioUrl,
        orderIndex: (maxOrder._max.orderIndex || 0) + 1,
      },
    });
  },

  /**
   * Generate flashcards from a lesson using AI
   */
  async generateFromLesson(
    lessonId: string,
    childId: string,
    count: number = 10
  ): Promise<{ deck: FlashcardDeck; flashcards: Flashcard[] }> {
    const lesson = await lessonService.getByIdForChild(lessonId, childId);

    if (!lesson.extractedText) {
      throw new Error('Lesson has no content to generate flashcards from');
    }

    // Get child's age group
    const child = await prisma.child.findUnique({
      where: { id: childId },
      select: { ageGroup: true },
    });

    if (!child) {
      throw new NotFoundError('Child not found');
    }

    // Generate flashcards with AI
    const generatedCards = await geminiService.generateFlashcards(
      lesson.extractedText,
      {
        ageGroup: child.ageGroup,
        subject: lesson.subject,
        count,
      }
    );

    // Create deck
    const deck = await this.createDeck({
      childId,
      title: `${lesson.title} - Flashcards`,
      subject: lesson.subject || undefined,
      lessonId,
    });

    // Create flashcards
    const flashcards = await Promise.all(
      generatedCards.map((card, index) =>
        prisma.flashcard.create({
          data: {
            deckId: deck.id,
            front: card.front,
            back: card.back,
            orderIndex: index,
          },
        })
      )
    );

    // Mark deck as AI generated
    await prisma.flashcardDeck.update({
      where: { id: deck.id },
      data: { isAIGenerated: true },
    });

    return { deck, flashcards };
  },

  /**
   * Get cards due for review
   */
  async getDueCards(
    childId: string,
    options?: { deckId?: string; limit?: number }
  ): Promise<Flashcard[]> {
    const where: any = {
      deck: { childId },
      nextReviewAt: { lte: new Date() },
    };

    if (options?.deckId) {
      where.deckId = options.deckId;
    }

    return prisma.flashcard.findMany({
      where,
      orderBy: { nextReviewAt: 'asc' },
      take: options?.limit || 20,
    });
  },

  /**
   * Submit a flashcard review
   */
  async submitReview(
    cardId: string,
    childId: string,
    quality: number // 0-5 rating
  ): Promise<{ nextReviewAt: Date; wasCorrect: boolean }> {
    // Get card with deck to verify ownership
    const card = await prisma.flashcard.findUnique({
      where: { id: cardId },
      include: { deck: true },
    });

    if (!card) {
      throw new NotFoundError('Flashcard not found');
    }

    if (card.deck.childId !== childId) {
      throw new ForbiddenError('Access denied');
    }

    // Calculate next review using SM-2
    const { easeFactor, interval, repetitions, nextReviewAt } = calculateNextReview(
      quality,
      card.easeFactor,
      card.interval,
      card.repetitions
    );

    const wasCorrect = quality >= 3;

    // Update card
    await prisma.flashcard.update({
      where: { id: cardId },
      data: {
        easeFactor,
        interval,
        repetitions,
        nextReviewAt,
        timesReviewed: { increment: 1 },
        timesCorrect: wasCorrect ? { increment: 1 } : undefined,
      },
    });

    // Update deck mastery
    await this.updateDeckMastery(card.deckId);

    return { nextReviewAt, wasCorrect };
  },

  /**
   * Delete a flashcard
   */
  async deleteFlashcard(cardId: string, childId: string): Promise<void> {
    const card = await prisma.flashcard.findUnique({
      where: { id: cardId },
      include: { deck: true },
    });

    if (!card) {
      throw new NotFoundError('Flashcard not found');
    }

    if (card.deck.childId !== childId) {
      throw new ForbiddenError('Access denied');
    }

    await prisma.flashcard.delete({
      where: { id: cardId },
    });
  },
};
