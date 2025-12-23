// Teacher Content Service - CRUD operations for lessons, quizzes, flashcards
import { prisma } from '../../config/database.js';
import { TeacherContentType, ContentStatus, Subject, TokenOperation, SourceType } from '@prisma/client';
import { quotaService } from './quotaService.js';
import { logger } from '../../utils/logger.js';

// ============================================
// TYPES
// ============================================

export interface CreateContentInput {
  title: string;
  description?: string;
  subject?: Subject;
  gradeLevel?: string;
  contentType: TeacherContentType;
  sourceType?: SourceType;
  originalFileUrl?: string;
  originalFileName?: string;
  extractedText?: string;
  templateId?: string;
  // Allow passing generated content during creation
  lessonContent?: unknown;
  quizContent?: unknown;
  flashcardContent?: unknown;
  infographicUrl?: string;
  // Allow setting status directly (defaults to DRAFT if not provided)
  status?: ContentStatus;
}

export interface UpdateContentInput {
  title?: string;
  description?: string;
  subject?: Subject | null;
  gradeLevel?: string | null;
  lessonContent?: unknown;
  quizContent?: unknown;
  flashcardContent?: unknown;
  infographicUrl?: string | null;
  status?: ContentStatus;
  isPublic?: boolean;
}

export interface ContentFilters {
  contentType?: TeacherContentType;
  subject?: Subject;
  gradeLevel?: string;
  status?: ContentStatus;
  search?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ============================================
// SERVICE
// ============================================

export const contentService = {
  /**
   * Create new content
   */
  async createContent(
    teacherId: string,
    input: CreateContentInput
  ) {
    const content = await prisma.teacherContent.create({
      data: {
        teacherId,
        title: input.title,
        description: input.description,
        subject: input.subject,
        gradeLevel: input.gradeLevel,
        contentType: input.contentType,
        sourceType: input.sourceType,
        originalFileUrl: input.originalFileUrl,
        originalFileName: input.originalFileName,
        extractedText: input.extractedText,
        templateId: input.templateId,
        // Include generated content if provided during creation
        lessonContent: input.lessonContent as Parameters<typeof prisma.teacherContent.create>[0]['data']['lessonContent'],
        quizContent: input.quizContent as Parameters<typeof prisma.teacherContent.create>[0]['data']['quizContent'],
        flashcardContent: input.flashcardContent as Parameters<typeof prisma.teacherContent.create>[0]['data']['flashcardContent'],
        infographicUrl: input.infographicUrl,
        // Use provided status or default to DRAFT
        status: input.status || 'DRAFT',
      },
    });

    logger.info('Content created', {
      contentId: content.id,
      teacherId,
      contentType: input.contentType,
      hasInfographicUrl: !!input.infographicUrl,
      infographicUrl: input.infographicUrl?.substring(0, 100), // Log first 100 chars
    });

    return content;
  },

  /**
   * Get content by ID
   */
  async getContentById(contentId: string, teacherId: string) {
    const content = await prisma.teacherContent.findFirst({
      where: {
        id: contentId,
        teacherId, // Ensure teacher owns this content
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!content) {
      return null;
    }

    return content;
  },

  /**
   * List content with filters and pagination
   */
  async listContent(
    teacherId: string,
    filters: ContentFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<PaginatedResult<Awaited<ReturnType<typeof prisma.teacherContent.findFirst>>>> {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {
      teacherId,
    };

    if (filters.contentType) {
      where.contentType = filters.contentType;
    }
    if (filters.subject) {
      where.subject = filters.subject;
    }
    if (filters.gradeLevel) {
      where.gradeLevel = filters.gradeLevel;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Execute query
    const [data, total] = await Promise.all([
      prisma.teacherContent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          template: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.teacherContent.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },

  /**
   * Update content
   */
  async updateContent(
    contentId: string,
    teacherId: string,
    input: UpdateContentInput
  ) {
    // Verify ownership
    const existing = await prisma.teacherContent.findFirst({
      where: { id: contentId, teacherId },
    });

    if (!existing) {
      return null;
    }

    // Build update data with proper type handling
    const updateData: Parameters<typeof prisma.teacherContent.update>[0]['data'] = {};

    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.subject !== undefined) updateData.subject = input.subject;
    if (input.gradeLevel !== undefined) updateData.gradeLevel = input.gradeLevel;
    if (input.infographicUrl !== undefined) updateData.infographicUrl = input.infographicUrl;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.isPublic !== undefined) updateData.isPublic = input.isPublic;

    // Handle JSON fields - Prisma expects InputJsonValue
    if (input.lessonContent !== undefined) {
      updateData.lessonContent = input.lessonContent as Parameters<typeof prisma.teacherContent.update>[0]['data']['lessonContent'];
    }
    if (input.quizContent !== undefined) {
      updateData.quizContent = input.quizContent as Parameters<typeof prisma.teacherContent.update>[0]['data']['quizContent'];
    }
    if (input.flashcardContent !== undefined) {
      updateData.flashcardContent = input.flashcardContent as Parameters<typeof prisma.teacherContent.update>[0]['data']['flashcardContent'];
    }

    // Set publishedAt if publishing for the first time
    if (input.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
      updateData.publishedAt = new Date();
    }

    const content = await prisma.teacherContent.update({
      where: { id: contentId },
      data: updateData,
    });

    logger.info('Content updated', {
      contentId,
      teacherId,
      fields: Object.keys(input),
    });

    return content;
  },

  /**
   * Delete content
   */
  async deleteContent(contentId: string, teacherId: string): Promise<boolean> {
    // Verify ownership
    const existing = await prisma.teacherContent.findFirst({
      where: { id: contentId, teacherId },
    });

    if (!existing) {
      return false;
    }

    await prisma.teacherContent.delete({
      where: { id: contentId },
    });

    logger.info('Content deleted', { contentId, teacherId });
    return true;
  },

  /**
   * Duplicate content
   */
  async duplicateContent(contentId: string, teacherId: string) {
    const original = await prisma.teacherContent.findFirst({
      where: { id: contentId, teacherId },
    });

    if (!original) {
      return null;
    }

    // Create copy with "Copy of" prefix
    const copy = await prisma.teacherContent.create({
      data: {
        teacherId,
        title: `Copy of ${original.title}`,
        description: original.description,
        subject: original.subject,
        gradeLevel: original.gradeLevel,
        contentType: original.contentType,
        sourceType: original.sourceType,
        extractedText: original.extractedText,
        lessonContent: original.lessonContent ?? undefined,
        quizContent: original.quizContent ?? undefined,
        flashcardContent: original.flashcardContent ?? undefined,
        infographicUrl: original.infographicUrl,
        templateId: original.templateId,
        status: 'DRAFT',
        isPublic: false,
      },
    });

    logger.info('Content duplicated', {
      originalId: contentId,
      newId: copy.id,
      teacherId,
    });

    return copy;
  },

  /**
   * Update content status
   */
  async updateStatus(
    contentId: string,
    teacherId: string,
    status: ContentStatus
  ) {
    const existing = await prisma.teacherContent.findFirst({
      where: { id: contentId, teacherId },
    });

    if (!existing) {
      return null;
    }

    const content = await prisma.teacherContent.update({
      where: { id: contentId },
      data: {
        status,
        publishedAt: status === 'PUBLISHED' && existing.status !== 'PUBLISHED'
          ? new Date()
          : existing.publishedAt,
      },
    });

    logger.info('Content status updated', {
      contentId,
      teacherId,
      oldStatus: existing.status,
      newStatus: status,
    });

    return content;
  },

  /**
   * Record AI generation usage
   */
  async recordAIUsage(
    contentId: string,
    teacherId: string,
    tokensUsed: number,
    modelUsed: string,
    operation: TokenOperation
  ) {
    // Update content with AI metadata
    await prisma.teacherContent.update({
      where: { id: contentId },
      data: {
        tokensUsed: { increment: tokensUsed },
        aiModelUsed: modelUsed,
      },
    });

    // Record in quota system
    await quotaService.recordUsage({
      teacherId,
      operation,
      tokensUsed,
      modelUsed,
      resourceType: 'content',
      resourceId: contentId,
    });
  },

  /**
   * Get content statistics for teacher
   */
  async getContentStats(teacherId: string) {
    const [byType, byStatus, totalTokens] = await Promise.all([
      // Count by content type
      prisma.teacherContent.groupBy({
        by: ['contentType'],
        where: { teacherId },
        _count: true,
      }),
      // Count by status
      prisma.teacherContent.groupBy({
        by: ['status'],
        where: { teacherId },
        _count: true,
      }),
      // Total tokens used
      prisma.teacherContent.aggregate({
        where: { teacherId },
        _sum: { tokensUsed: true },
      }),
    ]);

    return {
      byType: byType.reduce((acc, item) => {
        acc[item.contentType] = item._count;
        return acc;
      }, {} as Record<TeacherContentType, number>),
      byStatus: byStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<ContentStatus, number>),
      totalTokensUsed: totalTokens._sum.tokensUsed || 0,
    };
  },

  /**
   * Get recently accessed content
   */
  async getRecentContent(teacherId: string, limit = 5) {
    return prisma.teacherContent.findMany({
      where: { teacherId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        contentType: true,
        status: true,
        subject: true,
        updatedAt: true,
      },
    });
  },
};

export default contentService;
