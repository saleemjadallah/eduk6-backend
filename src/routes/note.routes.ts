// Note routes for notebook feature
import { Router } from 'express';
import { authenticate, requireChild, authorizeChildAccess } from '../middleware/auth.js';
import { noteService } from '../services/notes/noteService.js';
import { prisma } from '../config/database.js';
import type { Subject } from '@prisma/client';

const router = Router();

/**
 * Helper to get childId from request
 * Works with both child sessions and parent sessions with childId in body/query
 */
async function getChildIdFromRequest(req: any): Promise<string | null> {
  // If authenticated as child, use child's id
  if (req.child?.id) {
    return req.child.id;
  }

  // If authenticated as parent, get childId from body or query
  if (req.parent?.id) {
    const childId = req.body?.childId || req.query?.childId;
    if (!childId) return null;

    // Verify parent has access to this child
    const child = await prisma.child.findFirst({
      where: {
        id: childId,
        parentId: req.parent.id,
      },
    });

    if (child) {
      return child.id;
    }
  }

  return null;
}

// ============================================
// CHILD ENDPOINTS (works with child OR parent auth)
// ============================================

/**
 * POST /api/notes
 * Create a new note
 */
router.post(
  '/',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId',
        });
      }

      const {
        title,
        content,
        originalText,
        lessonId,
        subject,
        contentFormat,
        coverColor,
        coverStickers,
        coverPattern,
      } = req.body;

      // Validate required fields
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Title is required',
        });
      }

      if (!content || typeof content !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Content is required',
        });
      }

      if (title.length > 255) {
        return res.status(400).json({
          success: false,
          error: 'Title must be 255 characters or less',
        });
      }

      const result = await noteService.createNote({
        childId,
        title: title.trim(),
        content,
        originalText,
        lessonId,
        subject,
        contentFormat,
        coverColor,
        coverStickers,
        coverPattern,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/notes/me
 * Get all notes for the current child
 */
router.get(
  '/me',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId query param',
        });
      }

      const { subject, lessonId, grouped } = req.query;

      if (grouped === 'true') {
        const notesBySubject = await noteService.getNotesGroupedBySubject(childId);
        return res.json({
          success: true,
          data: { notesBySubject },
        });
      }

      const notes = await noteService.getNotesForChild(childId, {
        subject: subject as Subject | undefined,
        lessonId: lessonId as string | undefined,
      });

      res.json({
        success: true,
        data: { notes },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/notes/me/stats
 * Get note statistics for the current child
 */
router.get(
  '/me/stats',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId query param',
        });
      }

      const stats = await noteService.getNoteStats(childId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/notes/me/subject/:subject
 * Get notes for a specific subject
 */
router.get(
  '/me/subject/:subject',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId query param',
        });
      }

      const { subject } = req.params;

      const notes = await noteService.getNotesForChild(childId, {
        subject: subject as Subject,
      });

      res.json({
        success: true,
        data: { notes },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/notes/:noteId
 * Get a specific note
 */
router.get(
  '/:noteId',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId query param',
        });
      }

      const { noteId } = req.params;

      const note = await noteService.getNoteById(noteId, childId);

      if (!note) {
        return res.status(404).json({
          success: false,
          error: 'Note not found',
        });
      }

      res.json({
        success: true,
        data: { note },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/notes/:noteId
 * Update a note
 */
router.patch(
  '/:noteId',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId',
        });
      }

      const { noteId } = req.params;
      const { title, content, contentFormat, isPinned } = req.body;

      if (title && title.length > 255) {
        return res.status(400).json({
          success: false,
          error: 'Title must be 255 characters or less',
        });
      }

      const result = await noteService.updateNote(noteId, childId, {
        title,
        content,
        contentFormat,
        isPinned,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      if (error.message === 'Note not found or unauthorized') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * PATCH /api/notes/:noteId/cover
 * Update note cover personalization
 */
router.patch(
  '/:noteId/cover',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId',
        });
      }

      const { noteId } = req.params;
      const { coverColor, coverStickers, coverPattern } = req.body;

      const note = await noteService.updateNoteCover(noteId, childId, {
        coverColor,
        coverStickers,
        coverPattern,
      });

      res.json({
        success: true,
        data: { note },
      });
    } catch (error: any) {
      if (error.message === 'Note not found or unauthorized') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * POST /api/notes/:noteId/pin
 * Toggle pin status for a note
 */
router.post(
  '/:noteId/pin',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId',
        });
      }

      const { noteId } = req.params;

      const note = await noteService.toggleNotePin(noteId, childId);

      res.json({
        success: true,
        data: { note },
      });
    } catch (error: any) {
      if (error.message === 'Note not found or unauthorized') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * PATCH /api/notes/reorder
 * Reorder notes within a subject
 */
router.patch(
  '/reorder',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId',
        });
      }

      const { noteIds } = req.body;

      if (!Array.isArray(noteIds)) {
        return res.status(400).json({
          success: false,
          error: 'noteIds must be an array',
        });
      }

      await noteService.reorderNotes(childId, noteIds);

      res.json({
        success: true,
        data: { message: 'Notes reordered successfully' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/notes/:noteId
 * Delete a note
 */
router.delete(
  '/:noteId',
  authenticate,
  async (req, res, next) => {
    try {
      const childId = await getChildIdFromRequest(req);

      if (!childId) {
        return res.status(403).json({
          success: false,
          error: 'Child session required or provide childId',
        });
      }

      const { noteId } = req.params;

      await noteService.deleteNote(noteId, childId);

      res.json({
        success: true,
        data: { message: 'Note deleted successfully' },
      });
    } catch (error: any) {
      if (error.message === 'Note not found or unauthorized') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

// ============================================
// PARENT ENDPOINTS (requires parent authentication with child access)
// ============================================

/**
 * GET /api/notes/child/:childId
 * Get all notes for a specific child (parent view)
 */
router.get(
  '/child/:childId',
  authenticate,
  authorizeChildAccess(),
  async (req, res, next) => {
    try {
      const { childId } = req.params;
      const { subject, grouped } = req.query;

      if (grouped === 'true') {
        const notesBySubject = await noteService.getNotesGroupedBySubject(childId);
        return res.json({
          success: true,
          data: { notesBySubject },
        });
      }

      const notes = await noteService.getNotesForChild(childId, {
        subject: subject as Subject | undefined,
      });

      res.json({
        success: true,
        data: { notes },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/notes/child/:childId/stats
 * Get note statistics for a specific child (parent view)
 */
router.get(
  '/child/:childId/stats',
  authenticate,
  authorizeChildAccess(),
  async (req, res, next) => {
    try {
      const { childId } = req.params;
      const stats = await noteService.getNoteStats(childId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/notes/:noteId/parent
 * Get a specific note (parent view - includes all comments)
 */
router.get(
  '/:noteId/parent',
  authenticate,
  async (req, res, next) => {
    try {
      const parentId = req.parent?.id || req.user?.id;
      const { noteId } = req.params;

      if (!parentId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Get the note and verify parent has access
      const note = await prisma.note.findUnique({
        where: { id: noteId },
        include: {
          child: {
            select: { parentId: true, displayName: true },
          },
          lesson: {
            select: { id: true, title: true, subject: true },
          },
          parentComments: {
            include: {
              parent: {
                select: { id: true, firstName: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!note) {
        return res.status(404).json({
          success: false,
          error: 'Note not found',
        });
      }

      if (note.child.parentId !== parentId) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized to view this note',
        });
      }

      res.json({
        success: true,
        data: note,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/notes/:noteId/comments
 * Add a parent comment to a note
 */
router.post(
  '/:noteId/comments',
  authenticate,
  async (req, res, next) => {
    try {
      const parentId = req.parent?.id || req.user?.id;
      const { noteId } = req.params;
      const { content, emoji } = req.body;

      if (!parentId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Comment content is required',
        });
      }

      const comment = await noteService.addComment({
        noteId,
        parentId,
        content: content.trim(),
        emoji,
      });

      res.status(201).json({
        success: true,
        data: comment,
      });
    } catch (error: any) {
      if (error.message === 'Note not found' || error.message === 'Unauthorized to comment on this note') {
        return res.status(error.message === 'Note not found' ? 404 : 403).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

/**
 * GET /api/notes/:noteId/comments
 * Get all comments for a note
 */
router.get(
  '/:noteId/comments',
  authenticate,
  async (req, res, next) => {
    try {
      const { noteId } = req.params;

      const comments = await noteService.getCommentsForNote(noteId);

      res.json({
        success: true,
        data: { comments },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/notes/:noteId/comments/:commentId
 * Delete a parent comment
 */
router.delete(
  '/:noteId/comments/:commentId',
  authenticate,
  async (req, res, next) => {
    try {
      const parentId = req.parent?.id || req.user?.id;
      const { commentId } = req.params;

      if (!parentId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      await noteService.deleteComment(commentId, parentId);

      res.json({
        success: true,
        data: { message: 'Comment deleted successfully' },
      });
    } catch (error: any) {
      if (error.message === 'Comment not found or unauthorized') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }
      next(error);
    }
  }
);

export default router;
