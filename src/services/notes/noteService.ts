// Note service for managing child notes and parent comments
import { prisma } from '../../config/database.js';
import { xpEngine } from '../gamification/xpEngine.js';
import type { Subject, NoteContentFormat } from '@prisma/client';

// XP rewards for note actions
const XP_REWARDS = {
  NOTE_CREATED: 5,
  NOTE_EDITED: 2,
};

export interface CreateNoteInput {
  childId: string;
  title: string;
  content: string;
  originalText?: string;
  lessonId?: string;
  subject?: Subject;
  contentFormat?: NoteContentFormat;
  coverColor?: string;
  coverStickers?: string[];
  coverPattern?: string;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  contentFormat?: NoteContentFormat;
  isPinned?: boolean;
}

export interface UpdateNoteCoverInput {
  coverColor?: string;
  coverStickers?: string[];
  coverPattern?: string;
}

export interface CreateCommentInput {
  noteId: string;
  parentId: string;
  content: string;
  emoji?: string;
}

class NoteService {
  /**
   * Create a new note for a child
   */
  async createNote(input: CreateNoteInput) {
    const {
      childId,
      title,
      content,
      originalText,
      lessonId,
      subject,
      contentFormat = 'RICH_TEXT',
      coverColor = '#FFD93D',
      coverStickers = [],
      coverPattern = 'dots',
    } = input;

    // If lessonId is provided and subject is not, get subject from lesson
    let noteSubject = subject;
    if (lessonId && !noteSubject) {
      const lesson = await prisma.lesson.findUnique({
        where: { id: lessonId },
        select: { subject: true },
      });
      noteSubject = lesson?.subject || undefined;
    }

    // Create the note
    const note = await prisma.note.create({
      data: {
        childId,
        title,
        content,
        originalText,
        lessonId,
        subject: noteSubject,
        contentFormat,
        coverColor,
        coverStickers,
        coverPattern,
      },
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            subject: true,
          },
        },
        parentComments: {
          include: {
            parent: {
              select: {
                id: true,
                firstName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    // Award XP for creating a note
    const xpResult = await xpEngine.awardXP(childId, {
      amount: XP_REWARDS.NOTE_CREATED,
      reason: 'NOTE_CREATED',
      sourceType: 'note',
      sourceId: note.id,
    });

    return {
      note,
      xpAwarded: xpResult.xpAwarded,
      leveledUp: xpResult.leveledUp,
      newBadges: xpResult.newBadges,
    };
  }

  /**
   * Get all notes for a child
   */
  async getNotesForChild(childId: string, options?: { subject?: Subject; lessonId?: string }) {
    const where: any = { childId };

    if (options?.subject) {
      where.subject = options.subject;
    }

    if (options?.lessonId) {
      where.lessonId = options.lessonId;
    }

    const notes = await prisma.note.findMany({
      where,
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            subject: true,
          },
        },
        parentComments: {
          include: {
            parent: {
              select: {
                id: true,
                firstName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 3, // Only include latest 3 comments in list view
        },
        _count: {
          select: {
            parentComments: true,
          },
        },
      },
      orderBy: [
        { isPinned: 'desc' },
        { orderIndex: 'asc' },
        { updatedAt: 'desc' },
      ],
    });

    return notes;
  }

  /**
   * Get notes grouped by subject
   */
  async getNotesGroupedBySubject(childId: string) {
    const notes = await this.getNotesForChild(childId);

    const grouped: Record<string, typeof notes> = {};

    for (const note of notes) {
      const key = note.subject || 'OTHER';
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(note);
    }

    return grouped;
  }

  /**
   * Get a specific note by ID
   */
  async getNoteById(noteId: string, childId?: string) {
    const where: any = { id: noteId };

    if (childId) {
      where.childId = childId;
    }

    const note = await prisma.note.findFirst({
      where,
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            subject: true,
          },
        },
        parentComments: {
          include: {
            parent: {
              select: {
                id: true,
                firstName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    return note;
  }

  /**
   * Update a note
   */
  async updateNote(noteId: string, childId: string, input: UpdateNoteInput) {
    // Verify ownership
    const existingNote = await prisma.note.findFirst({
      where: { id: noteId, childId },
    });

    if (!existingNote) {
      throw new Error('Note not found or unauthorized');
    }

    const note = await prisma.note.update({
      where: { id: noteId },
      data: {
        ...input,
        updatedAt: new Date(),
      },
      include: {
        lesson: {
          select: {
            id: true,
            title: true,
            subject: true,
          },
        },
        parentComments: {
          include: {
            parent: {
              select: {
                id: true,
                firstName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    // Award XP for editing (only if content was changed)
    let xpAwarded = 0;
    if (input.content || input.title) {
      const xpResult = await xpEngine.awardXP(childId, {
        amount: XP_REWARDS.NOTE_EDITED,
        reason: 'NOTE_EDITED',
        sourceType: 'note',
        sourceId: noteId,
      });
      xpAwarded = xpResult.xpAwarded;
    }

    return { note, xpAwarded };
  }

  /**
   * Update note cover personalization
   */
  async updateNoteCover(noteId: string, childId: string, input: UpdateNoteCoverInput) {
    // Verify ownership
    const existingNote = await prisma.note.findFirst({
      where: { id: noteId, childId },
    });

    if (!existingNote) {
      throw new Error('Note not found or unauthorized');
    }

    const note = await prisma.note.update({
      where: { id: noteId },
      data: input,
    });

    return note;
  }

  /**
   * Delete a note
   */
  async deleteNote(noteId: string, childId: string) {
    // Verify ownership
    const existingNote = await prisma.note.findFirst({
      where: { id: noteId, childId },
    });

    if (!existingNote) {
      throw new Error('Note not found or unauthorized');
    }

    await prisma.note.delete({
      where: { id: noteId },
    });

    return { success: true };
  }

  /**
   * Toggle pin status for a note
   */
  async toggleNotePin(noteId: string, childId: string) {
    const existingNote = await prisma.note.findFirst({
      where: { id: noteId, childId },
    });

    if (!existingNote) {
      throw new Error('Note not found or unauthorized');
    }

    const note = await prisma.note.update({
      where: { id: noteId },
      data: {
        isPinned: !existingNote.isPinned,
      },
    });

    return note;
  }

  /**
   * Reorder notes within a subject
   */
  async reorderNotes(childId: string, noteIds: string[]) {
    const updates = noteIds.map((id, index) =>
      prisma.note.updateMany({
        where: { id, childId },
        data: { orderIndex: index },
      })
    );

    await prisma.$transaction(updates);

    return { success: true };
  }

  // ==========================================
  // Parent Comment Methods
  // ==========================================

  /**
   * Add a parent comment to a note
   */
  async addComment(input: CreateCommentInput) {
    const { noteId, parentId, content, emoji } = input;

    // Verify the note exists and parent has access to the child
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      include: {
        child: {
          select: { parentId: true },
        },
      },
    });

    if (!note) {
      throw new Error('Note not found');
    }

    if (note.child.parentId !== parentId) {
      throw new Error('Unauthorized to comment on this note');
    }

    const comment = await prisma.noteComment.create({
      data: {
        noteId,
        parentId,
        content,
        emoji,
      },
      include: {
        parent: {
          select: {
            id: true,
            firstName: true,
          },
        },
      },
    });

    return comment;
  }

  /**
   * Get comments for a note
   */
  async getCommentsForNote(noteId: string) {
    const comments = await prisma.noteComment.findMany({
      where: { noteId },
      include: {
        parent: {
          select: {
            id: true,
            firstName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return comments;
  }

  /**
   * Delete a parent comment
   */
  async deleteComment(commentId: string, parentId: string) {
    // Verify ownership
    const comment = await prisma.noteComment.findFirst({
      where: { id: commentId, parentId },
    });

    if (!comment) {
      throw new Error('Comment not found or unauthorized');
    }

    await prisma.noteComment.delete({
      where: { id: commentId },
    });

    return { success: true };
  }

  /**
   * Get note statistics for a child
   */
  async getNoteStats(childId: string) {
    const [totalNotes, notesBySubject, recentNotes] = await Promise.all([
      prisma.note.count({ where: { childId } }),
      prisma.note.groupBy({
        by: ['subject'],
        where: { childId },
        _count: { id: true },
      }),
      prisma.note.findMany({
        where: { childId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          subject: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      totalNotes,
      notesBySubject: notesBySubject.reduce((acc, item) => {
        acc[item.subject || 'OTHER'] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      recentNotes,
    };
  }
}

export const noteService = new NoteService();
