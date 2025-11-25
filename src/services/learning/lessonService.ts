// Lesson service for CRUD operations
import { prisma } from '../../config/database.js';
import { Lesson, Subject, SourceType, ProcessingStatus, AgeGroup, Prisma } from '@prisma/client';
import { NotFoundError, ForbiddenError } from '../../middleware/errorHandler.js';

export interface CreateLessonParams {
  childId: string;
  title: string;
  sourceType: SourceType;
  subject?: Subject;
  originalFileUrl?: string;
  originalFileName?: string;
  originalFileSize?: number;
  youtubeUrl?: string;
  youtubeVideoId?: string;
}

export interface UpdateLessonParams {
  title?: string;
  subject?: Subject;
  summary?: string;
  extractedText?: string;
  chapters?: Prisma.InputJsonValue;
  keyConcepts?: string[];
  vocabulary?: Prisma.InputJsonValue;
  suggestedQuestions?: string[];
  gradeLevel?: string;
  processingStatus?: ProcessingStatus;
  processingError?: string | null;
  aiConfidence?: number;
  safetyReviewed?: boolean;
  safetyFlags?: string[];
}

export interface LessonWithProgress extends Lesson {
  percentComplete: number;
  timeSpentSeconds: number;
  lastAccessedAt: Date | null;
}

export const lessonService = {
  /**
   * Create a new lesson
   */
  async create(params: CreateLessonParams): Promise<Lesson> {
    return prisma.lesson.create({
      data: {
        childId: params.childId,
        title: params.title,
        sourceType: params.sourceType,
        subject: params.subject,
        originalFileUrl: params.originalFileUrl,
        originalFileName: params.originalFileName,
        originalFileSize: params.originalFileSize,
        youtubeUrl: params.youtubeUrl,
        youtubeVideoId: params.youtubeVideoId,
        processingStatus: 'PENDING',
      },
    });
  },

  /**
   * Get a lesson by ID
   */
  async getById(lessonId: string): Promise<Lesson | null> {
    return prisma.lesson.findUnique({
      where: { id: lessonId },
    });
  },

  /**
   * Get a lesson by ID with ownership verification
   */
  async getByIdForChild(lessonId: string, childId: string): Promise<Lesson> {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
    });

    if (!lesson) {
      throw new NotFoundError('Lesson not found');
    }

    if (lesson.childId !== childId) {
      throw new ForbiddenError('Access denied');
    }

    return lesson;
  },

  /**
   * Get all lessons for a child
   */
  async getForChild(
    childId: string,
    options?: {
      subject?: Subject;
      status?: ProcessingStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ lessons: Lesson[]; total: number }> {
    const where = {
      childId,
      ...(options?.subject && { subject: options.subject }),
      ...(options?.status && { processingStatus: options.status }),
    };

    const [lessons, total] = await Promise.all([
      prisma.lesson.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options?.limit || 20,
        skip: options?.offset || 0,
      }),
      prisma.lesson.count({ where }),
    ]);

    return { lessons, total };
  },

  /**
   * Update a lesson
   */
  async update(lessonId: string, params: UpdateLessonParams): Promise<Lesson> {
    // Build the data object, filtering out undefined values
    const data: Prisma.LessonUpdateInput = {};

    if (params.title !== undefined) data.title = params.title;
    if (params.subject !== undefined) data.subject = params.subject;
    if (params.summary !== undefined) data.summary = params.summary;
    if (params.extractedText !== undefined) data.extractedText = params.extractedText;
    if (params.chapters !== undefined) data.chapters = params.chapters;
    if (params.keyConcepts !== undefined) data.keyConcepts = params.keyConcepts;
    if (params.vocabulary !== undefined) data.vocabulary = params.vocabulary;
    if (params.suggestedQuestions !== undefined) data.suggestedQuestions = params.suggestedQuestions;
    if (params.gradeLevel !== undefined) data.gradeLevel = params.gradeLevel;
    if (params.processingStatus !== undefined) data.processingStatus = params.processingStatus;
    if (params.processingError !== undefined) data.processingError = params.processingError;
    if (params.aiConfidence !== undefined) data.aiConfidence = params.aiConfidence;
    if (params.safetyReviewed !== undefined) data.safetyReviewed = params.safetyReviewed;
    if (params.safetyFlags !== undefined) data.safetyFlags = params.safetyFlags;

    return prisma.lesson.update({
      where: { id: lessonId },
      data,
    });
  },

  /**
   * Update lesson processing status
   */
  async updateProcessingStatus(
    lessonId: string,
    status: ProcessingStatus,
    error?: string
  ): Promise<Lesson> {
    return prisma.lesson.update({
      where: { id: lessonId },
      data: {
        processingStatus: status,
        processingError: error,
      },
    });
  },

  /**
   * Update lesson progress
   */
  async updateProgress(
    lessonId: string,
    childId: string,
    progress: { percentComplete?: number; timeSpentSeconds?: number }
  ): Promise<Lesson> {
    // Verify ownership
    const lesson = await this.getByIdForChild(lessonId, childId);

    // Calculate new values
    const newPercentComplete = Math.min(
      100,
      Math.max(lesson.percentComplete, progress.percentComplete || 0)
    );
    const newTimeSpent = lesson.timeSpentSeconds + (progress.timeSpentSeconds || 0);

    return prisma.lesson.update({
      where: { id: lessonId },
      data: {
        percentComplete: newPercentComplete,
        timeSpentSeconds: newTimeSpent,
        lastAccessedAt: new Date(),
      },
    });
  },

  /**
   * Delete a lesson
   */
  async delete(lessonId: string, childId: string): Promise<void> {
    // Verify ownership
    await this.getByIdForChild(lessonId, childId);

    await prisma.lesson.delete({
      where: { id: lessonId },
    });
  },

  /**
   * Get recent lessons for a child
   */
  async getRecent(childId: string, limit: number = 5): Promise<Lesson[]> {
    return prisma.lesson.findMany({
      where: {
        childId,
        processingStatus: 'COMPLETED',
      },
      orderBy: { lastAccessedAt: 'desc' },
      take: limit,
    });
  },

  /**
   * Get lessons by subject
   */
  async getBySubject(childId: string, subject: Subject): Promise<Lesson[]> {
    return prisma.lesson.findMany({
      where: {
        childId,
        subject,
        processingStatus: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Get lesson statistics for a child
   */
  async getStats(childId: string): Promise<{
    total: number;
    completed: number;
    totalStudyTime: number;
    bySubject: Record<Subject, number>;
  }> {
    const lessons = await prisma.lesson.findMany({
      where: { childId },
      select: {
        subject: true,
        percentComplete: true,
        timeSpentSeconds: true,
      },
    });

    const total = lessons.length;
    const completed = lessons.filter((l) => l.percentComplete >= 100).length;
    const totalStudyTime = lessons.reduce((sum, l) => sum + l.timeSpentSeconds, 0);

    const bySubject = {} as Record<Subject, number>;
    for (const lesson of lessons) {
      if (lesson.subject) {
        bySubject[lesson.subject] = (bySubject[lesson.subject] || 0) + 1;
      }
    }

    return { total, completed, totalStudyTime, bySubject };
  },
};
