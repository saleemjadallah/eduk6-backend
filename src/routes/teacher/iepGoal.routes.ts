/**
 * IEP Goal Writer Routes
 *
 * API endpoints for generating SMART IEP goals and accommodation suggestions
 * for special education students. Uses Gemini 3 Flash for AI generation.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { iepGoalService } from '../../services/teacher/iepGoalService.js';
import { quotaService } from '../../services/teacher/quotaService.js';
import { authenticateTeacher } from '../../middleware/teacherAuth.js';
import { enforceTokenQuota } from '../../middleware/tokenQuota.js';
import { TokenOperation, DisabilityCategory, IEPSubjectArea } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const router = Router();

// All routes require teacher authentication
router.use(authenticateTeacher);

// ============================================================================
// Validation Schemas
// ============================================================================

const generateGoalsSchema = z.object({
  gradeLevel: z.string().min(1, 'Grade level is required'),
  disabilityCategory: z.nativeEnum(DisabilityCategory),
  subjectArea: z.nativeEnum(IEPSubjectArea),
  presentLevels: z.string().min(10, 'Present levels must be at least 10 characters'),
  studentName: z.string().optional(),
  additionalContext: z.string().optional(),
});

const createSessionSchema = z.object({
  gradeLevel: z.string().min(1, 'Grade level is required'),
  disabilityCategory: z.nativeEnum(DisabilityCategory),
  subjectArea: z.nativeEnum(IEPSubjectArea),
  presentLevels: z.string().min(10, 'Present levels must be at least 10 characters'),
  studentName: z.string().optional(),
  additionalContext: z.string().optional(),
});

const updateSessionSchema = z.object({
  selectedGoals: z.array(z.object({
    id: z.string(),
    goalStatement: z.string(),
    baseline: z.string(),
    target: z.string(),
    measurementMethod: z.string(),
    timeframe: z.string().optional(),
    frequency: z.string().optional(),
    accuracyCriteria: z.string().optional(),
    trials: z.string().optional(),
    shortTermObjectives: z.array(z.string()).optional(),
  })).optional(),
  selectedAccommodations: z.array(z.object({
    category: z.string(),
    accommodation: z.string(),
    description: z.string().optional(),
  })).optional(),
  notes: z.string().optional(),
});

const listSessionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  disabilityCategory: z.nativeEnum(DisabilityCategory).optional(),
  subjectArea: z.nativeEnum(IEPSubjectArea).optional(),
});

const regenerateSchema = z.object({
  additionalContext: z.string().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors,
      });
    }
    req.body = result.data;
    next();
  };
}

function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors,
      });
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}

// ============================================================================
// Reference Data Routes
// ============================================================================

/**
 * GET /api/teacher/iep-goals/disability-categories
 * Get list of available disability categories
 */
router.get('/disability-categories', async (req: Request, res: Response) => {
  try {
    const categories = iepGoalService.getDisabilityCategories();
    res.json({ success: true, data: { categories } });
  } catch (error) {
    logger.error('Error fetching disability categories:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch disability categories' });
  }
});

/**
 * GET /api/teacher/iep-goals/subject-areas
 * Get list of available IEP subject areas
 */
router.get('/subject-areas', async (req: Request, res: Response) => {
  try {
    const subjectAreas = iepGoalService.getSubjectAreas();
    res.json({ success: true, data: { subjectAreas } });
  } catch (error) {
    logger.error('Error fetching subject areas:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch subject areas' });
  }
});

// ============================================================================
// Generation Routes
// ============================================================================

/**
 * POST /api/teacher/iep-goals/generate
 * Generate IEP goals without saving a session (preview mode)
 * Consumes tokens but doesn't create a database record
 */
router.post(
  '/generate',
  enforceTokenQuota(TokenOperation.IEP_GOAL_GENERATION),
  validateBody(generateGoalsSchema),
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.teacher!.id;
      const input = req.body;

      logger.info(`Teacher ${teacherId} generating IEP goals preview`);

      const result = await iepGoalService.generateIEPGoals(teacherId, input);

      // Record token usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.IEP_GOAL_GENERATION,
        tokensUsed: 5000, // Estimated tokens
        modelUsed: 'gemini-2.0-flash',
        resourceType: 'iep_goal_preview',
      });

      res.json({
        message: 'IEP goals generated successfully',
        data: result,
      });
    } catch (error) {
      logger.error('Error generating IEP goals:', error);
      res.status(500).json({
        error: 'Failed to generate IEP goals',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * POST /api/teacher/iep-goals/sessions
 * Create a new IEP goal session (generates goals and saves to database)
 */
router.post(
  '/sessions',
  enforceTokenQuota(TokenOperation.IEP_GOAL_GENERATION),
  validateBody(createSessionSchema),
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.teacher!.id;
      // Map studentName to studentIdentifier for backward compatibility
      const { studentName, ...rest } = req.body;
      const input = {
        ...rest,
        studentIdentifier: studentName, // Service uses studentIdentifier
      };

      logger.info(`Teacher ${teacherId} creating IEP goal session`);

      const session = await iepGoalService.createIEPSession(teacherId, input);

      // Record token usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.IEP_GOAL_GENERATION,
        tokensUsed: 5000, // Estimated tokens
        modelUsed: 'gemini-2.0-flash',
        resourceType: 'iep_goal_session',
        resourceId: session.id,
      });

      res.status(201).json({
        success: true,
        message: 'IEP goal session created successfully',
        data: { session },
      });
    } catch (error) {
      logger.error('Error creating IEP goal session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create IEP goal session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

// ============================================================================
// CRUD Routes
// ============================================================================

/**
 * GET /api/teacher/iep-goals/sessions
 * List teacher's IEP goal sessions with pagination and filtering
 */
router.get(
  '/sessions',
  validateQuery(listSessionsSchema),
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.teacher!.id;
      const { page, limit, disabilityCategory, subjectArea } = (req as any).validatedQuery;
      const offset = (page - 1) * limit;

      const result = await iepGoalService.listIEPSessions(teacherId, {
        offset,
        limit,
        disabilityCategory,
        subjectArea,
      });

      res.json({
        success: true,
        data: {
          sessions: result.sessions,
        },
        pagination: {
          total: result.total,
          page,
          limit,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (error) {
      logger.error('Error listing IEP goal sessions:', error);
      res.status(500).json({ success: false, error: 'Failed to list IEP goal sessions' });
    }
  }
);

/**
 * GET /api/teacher/iep-goals/sessions/:id
 * Get a specific IEP goal session
 */
router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const { id } = req.params;

    const session = await iepGoalService.getIEPSession(id, teacherId);

    if (!session) {
      return res.status(404).json({ error: 'IEP goal session not found' });
    }

    res.json({ session });
  } catch (error) {
    logger.error('Error fetching IEP goal session:', error);
    res.status(500).json({ error: 'Failed to fetch IEP goal session' });
  }
});

/**
 * PATCH /api/teacher/iep-goals/sessions/:id
 * Update an IEP goal session (e.g., save selected goals/accommodations)
 */
router.patch(
  '/sessions/:id',
  validateBody(updateSessionSchema),
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.teacher!.id;
      const { id } = req.params;
      const updates = req.body;

      const session = await iepGoalService.updateIEPSession(id, teacherId, updates);

      res.json({
        success: true,
        message: 'IEP goal session updated successfully',
        data: { session },
      });
    } catch (error) {
      logger.error('Error updating IEP goal session:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ success: false, error: 'IEP goal session not found' });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update IEP goal session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * DELETE /api/teacher/iep-goals/sessions/:id
 * Delete an IEP goal session
 */
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const teacherId = req.teacher!.id;
    const { id } = req.params;

    await iepGoalService.deleteIEPSession(id, teacherId);

    res.json({ message: 'IEP goal session deleted successfully' });
  } catch (error) {
    logger.error('Error deleting IEP goal session:', error);

    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: 'IEP goal session not found' });
    }

    res.status(500).json({ error: 'Failed to delete IEP goal session' });
  }
});

// ============================================================================
// Regeneration Routes
// ============================================================================

/**
 * POST /api/teacher/iep-goals/sessions/:id/regenerate
 * Regenerate goals for an existing session with optional additional context
 */
router.post(
  '/sessions/:id/regenerate',
  enforceTokenQuota(TokenOperation.IEP_GOAL_GENERATION),
  validateBody(regenerateSchema),
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.teacher!.id;
      const { id } = req.params;
      const { additionalContext } = req.body;

      logger.info(`Teacher ${teacherId} regenerating IEP goals for session ${id}`);

      const session = await iepGoalService.regenerateGoals(id, teacherId, additionalContext);

      // Record token usage
      await quotaService.recordUsage({
        teacherId,
        operation: TokenOperation.IEP_GOAL_GENERATION,
        tokensUsed: 5000, // Estimated tokens
        modelUsed: 'gemini-2.0-flash',
        resourceType: 'iep_goal_regeneration',
        resourceId: session.id,
      });

      res.json({
        success: true,
        message: 'IEP goals regenerated successfully',
        data: { session },
      });
    } catch (error) {
      logger.error('Error regenerating IEP goals:', error);

      if (error instanceof Error && error.message.includes('not found')) {
        return res.status(404).json({ success: false, error: 'IEP goal session not found' });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to regenerate IEP goals',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default router;
