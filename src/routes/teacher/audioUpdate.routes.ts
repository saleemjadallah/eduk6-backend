// Teacher Audio Update routes - Podcast-style class updates for parents
import { Router, Request, Response, NextFunction } from 'express';
import { audioUpdateService } from '../../services/teacher/audioUpdateService.js';
import { authenticateTeacher, requireTeacher } from '../../middleware/teacherAuth.js';
import { validateInput } from '../../middleware/validateInput.js';
import { z } from 'zod';
import { AudioStatus } from '@prisma/client';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createAudioUpdateSchema = z.object({
  lessonIds: z.array(z.string().uuid()).min(1, 'At least one lesson is required'),
  title: z.string().max(255).optional(),
  customNotes: z.string().max(2000).optional(),
  weekLabel: z.string().max(100).optional(),
  focusAreas: z.array(z.string().max(200)).max(5).optional(),
  language: z.string().length(2).optional().default('en'),
  duration: z.enum(['short', 'medium', 'long']).optional().default('medium'),
});

const updateAudioUpdateSchema = z.object({
  title: z.string().max(255).optional(),
  script: z.string().max(50000).optional(),
  customNotes: z.string().max(2000).optional(),
  status: z.nativeEnum(AudioStatus).optional(),
});

const generateAudioSchema = z.object({
  voiceId: z.string().max(100).optional(),
  speakingRate: z.number().min(0.5).max(2.0).optional(),
});

const regenerateScriptSchema = z.object({
  customNotes: z.string().max(2000).optional(),
  focusAreas: z.array(z.string().max(200)).max(5).optional(),
  language: z.string().length(2).optional(),
  duration: z.enum(['short', 'medium', 'long']).optional(),
});

const listAudioUpdatesQuerySchema = z.object({
  status: z.nativeEnum(AudioStatus).optional(),
  limit: z.string().transform(Number).optional().default('20'),
  offset: z.string().transform(Number).optional().default('0'),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/teacher/audio-updates/voices
 * Get available voice options for TTS
 */
router.get(
  '/voices',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, _next: NextFunction) => {
    const language = (req.query.language as string) || 'en';
    const voices = audioUpdateService.getVoiceOptions(language);

    res.json({
      success: true,
      data: {
        language,
        voices,
        supportedLanguages: ['en', 'ar', 'es', 'fr'],
      },
    });
  }
);

/**
 * GET /api/teacher/audio-updates
 * List all audio updates for the authenticated teacher
 */
router.get(
  '/',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listAudioUpdatesQuerySchema.parse(req.query);

      const result = await audioUpdateService.listAudioUpdates(
        req.teacher!.id,
        {
          status: query.status,
          limit: Math.min(query.limit, 100),
          offset: query.offset,
        }
      );

      res.json({
        success: true,
        data: result.audioUpdates,
        pagination: {
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/audio-updates
 * Create a new audio update (generates script automatically)
 */
router.post(
  '/',
  authenticateTeacher,
  requireTeacher,
  validateInput(createAudioUpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audioUpdate = await audioUpdateService.createAudioUpdate(
        req.teacher!.id,
        req.body
      );

      res.status(201).json({
        success: true,
        data: audioUpdate,
        message: 'Audio update created successfully. Script generated.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/teacher/audio-updates/:id
 * Get audio update by ID
 */
router.get(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audioUpdate = await audioUpdateService.getAudioUpdate(
        req.params.id,
        req.teacher!.id
      );

      if (!audioUpdate) {
        res.status(404).json({
          success: false,
          error: 'Audio update not found',
        });
        return;
      }

      res.json({
        success: true,
        data: audioUpdate,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/teacher/audio-updates/:id
 * Update audio update (title, script, status)
 */
router.patch(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  validateInput(updateAudioUpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audioUpdate = await audioUpdateService.updateAudioUpdate(
        req.params.id,
        req.teacher!.id,
        req.body
      );

      res.json({
        success: true,
        data: audioUpdate,
        message: 'Audio update updated successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Audio update not found') {
        res.status(404).json({
          success: false,
          error: error.message,
        });
        return;
      }
      next(error);
    }
  }
);

/**
 * DELETE /api/teacher/audio-updates/:id
 * Delete audio update
 */
router.delete(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await audioUpdateService.deleteAudioUpdate(
        req.params.id,
        req.teacher!.id
      );

      res.json({
        success: true,
        message: 'Audio update deleted successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Audio update not found') {
        res.status(404).json({
          success: false,
          error: error.message,
        });
        return;
      }
      next(error);
    }
  }
);

/**
 * POST /api/teacher/audio-updates/:id/regenerate
 * Regenerate the script for an audio update
 */
router.post(
  '/:id/regenerate',
  authenticateTeacher,
  requireTeacher,
  validateInput(regenerateScriptSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audioUpdate = await audioUpdateService.regenerateScript(
        req.params.id,
        req.teacher!.id,
        req.body
      );

      res.json({
        success: true,
        data: audioUpdate,
        message: 'Script regenerated successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Audio update not found') {
        res.status(404).json({
          success: false,
          error: error.message,
        });
        return;
      }
      next(error);
    }
  }
);

/**
 * POST /api/teacher/audio-updates/:id/generate-audio
 * Generate audio from the script
 */
router.post(
  '/:id/generate-audio',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateAudioSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get the audio update to check it exists and get the script
      const existing = await audioUpdateService.getAudioUpdate(
        req.params.id,
        req.teacher!.id
      );

      if (!existing) {
        res.status(404).json({
          success: false,
          error: 'Audio update not found',
        });
        return;
      }

      if (!existing.script) {
        res.status(400).json({
          success: false,
          error: 'No script available. Please generate a script first.',
        });
        return;
      }

      // Generate audio
      await audioUpdateService.generateAudio(
        req.teacher!.id,
        req.params.id,
        {
          script: existing.script,
          language: existing.language,
          voiceId: req.body.voiceId,
          speakingRate: req.body.speakingRate,
        }
      );

      // Fetch the updated audio update to return full object
      const updatedAudioUpdate = await audioUpdateService.getAudioUpdate(
        req.params.id,
        req.teacher!.id
      );

      res.json({
        success: true,
        data: updatedAudioUpdate,
        message: 'Audio generated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/audio-updates/:id/publish
 * Publish an audio update (makes it available to parents)
 */
router.post(
  '/:id/publish',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await audioUpdateService.getAudioUpdate(
        req.params.id,
        req.teacher!.id
      );

      if (!existing) {
        res.status(404).json({
          success: false,
          error: 'Audio update not found',
        });
        return;
      }

      if (!existing.audioUrl) {
        res.status(400).json({
          success: false,
          error: 'Audio must be generated before publishing',
        });
        return;
      }

      const audioUpdate = await audioUpdateService.updateAudioUpdate(
        req.params.id,
        req.teacher!.id,
        { status: 'PUBLISHED' }
      );

      res.json({
        success: true,
        data: audioUpdate,
        message: 'Audio update published successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/audio-updates/:id/unpublish
 * Unpublish an audio update
 */
router.post(
  '/:id/unpublish',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audioUpdate = await audioUpdateService.updateAudioUpdate(
        req.params.id,
        req.teacher!.id,
        { status: 'READY' }
      );

      res.json({
        success: true,
        data: audioUpdate,
        message: 'Audio update unpublished successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Audio update not found') {
        res.status(404).json({
          success: false,
          error: error.message,
        });
        return;
      }
      next(error);
    }
  }
);

export default router;
