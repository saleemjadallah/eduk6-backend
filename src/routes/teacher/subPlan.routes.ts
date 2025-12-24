// Substitute Teacher Plan routes - Emergency sub plan generation
import { Router, Request, Response, NextFunction } from 'express';
import { subPlanService } from '../../services/teacher/subPlanService.js';
import { authenticateTeacher, requireTeacher } from '../../middleware/teacherAuth.js';
import { validateInput } from '../../middleware/validateInput.js';
import { z } from 'zod';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const scheduleBlockSchema = z.object({
  startTime: z.string().regex(/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)?$/, 'Invalid time format'),
  endTime: z.string().regex(/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)?$/, 'Invalid time format'),
  activity: z.string().min(1).max(200),
});

const classroomInfoSchema = z.object({
  attentionSignal: z.string().max(200).optional(),
  bathroomPolicy: z.string().max(500).optional(),
  transitionProcedures: z.string().max(500).optional(),
  seatingChartLocation: z.string().max(200).optional(),
  lineUpProcedure: z.string().max(500).optional(),
  dismissalProcedure: z.string().max(500).optional(),
}).optional();

const studentNoteSchema = z.object({
  type: z.enum(['helper', 'medical', 'behavior', 'accommodation']),
  description: z.string().max(500),
});

const emergencyInfoSchema = z.object({
  officePhone: z.string().max(50).optional(),
  nurseLocation: z.string().max(200).optional(),
  nearestTeacher: z.string().max(200).optional(),
  fireDrillProcedure: z.string().max(500).optional(),
  lockdownProcedure: z.string().max(500).optional(),
}).optional();

// Schema for uploaded file content
const uploadedContentSchema = z.object({
  text: z.string().max(100000), // Allow up to 100k characters
  title: z.string().max(255).optional(),
  sourceType: z.enum(['pdf', 'ppt', 'image', 'text']).optional(),
  summary: z.string().max(2000).optional(),
}).optional();

const createSubPlanSchema = z.object({
  // Lessons are optional - AI can generate generic activities if none provided
  lessonIds: z.array(z.string().uuid()).max(5).optional().default([]),
  date: z.string().refine(val => !isNaN(Date.parse(val)), 'Invalid date'),
  title: z.string().min(1, 'Title is required').max(255),
  gradeLevel: z.string().max(50).optional(),
  subject: z.string().max(100).optional(),
  timePeriod: z.enum(['morning', 'afternoon', 'full_day']).optional().default('full_day'),
  // Schedule is optional - AI will generate if not provided
  schedule: z.array(scheduleBlockSchema).max(15).optional(),
  classroomInfo: classroomInfoSchema,
  classroomNotes: z.string().max(2000).optional(),
  studentNotes: z.array(studentNoteSchema).max(20).optional(),
  emergencyInfo: emergencyInfoSchema,
  emergencyProcedures: z.string().max(2000).optional(),
  helpfulStudents: z.string().max(500).optional(),
  includeBackupActivities: z.boolean().optional().default(true),
  additionalNotes: z.string().max(2000).optional(),
  // Uploaded file content for better activity generation
  uploadedContent: uploadedContentSchema,
});

const updateSubPlanSchema = z.object({
  title: z.string().max(255).optional(),
  date: z.string().refine(val => !isNaN(Date.parse(val)), 'Invalid date').optional(),
  gradeLevel: z.string().max(50).optional().nullable(),
  schedule: z.unknown().optional(),
  classroomInfo: z.unknown().optional().nullable(),
  activities: z.unknown().optional(),
  materials: z.unknown().optional().nullable(),
  emergencyInfo: z.unknown().optional().nullable(),
  studentNotes: z.unknown().optional().nullable(),
  backupActivities: z.unknown().optional().nullable(),
});

const duplicateSubPlanSchema = z.object({
  newDate: z.string().refine(val => !isNaN(Date.parse(val)), 'Invalid date'),
});

const listSubPlansQuerySchema = z.object({
  limit: z.string().transform(Number).optional().default('20'),
  offset: z.string().transform(Number).optional().default('0'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/teacher/sub-plans
 * List all substitute plans for the authenticated teacher
 */
router.get(
  '/',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listSubPlansQuerySchema.parse(req.query);

      const result = await subPlanService.listSubPlans(
        req.teacher!.id,
        {
          limit: Math.min(query.limit, 100),
          offset: query.offset,
          startDate: query.startDate ? new Date(query.startDate) : undefined,
          endDate: query.endDate ? new Date(query.endDate) : undefined,
        }
      );

      res.json({
        success: true,
        data: result.subPlans,
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
 * POST /api/teacher/sub-plans
 * Create a new substitute plan (generates content automatically)
 */
router.post(
  '/',
  authenticateTeacher,
  requireTeacher,
  validateInput(createSubPlanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subPlan = await subPlanService.createSubPlan(
        req.teacher!.id,
        {
          ...req.body,
          date: new Date(req.body.date),
        }
      );

      res.status(201).json({
        success: true,
        data: subPlan,
        message: 'Substitute plan created successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/teacher/sub-plans/:id
 * Get substitute plan by ID
 */
router.get(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subPlan = await subPlanService.getSubPlan(
        req.params.id,
        req.teacher!.id
      );

      if (!subPlan) {
        res.status(404).json({
          success: false,
          error: 'Substitute plan not found',
        });
        return;
      }

      res.json({
        success: true,
        data: subPlan,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/teacher/sub-plans/:id
 * Update substitute plan
 */
router.patch(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  validateInput(updateSubPlanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subPlan = await subPlanService.updateSubPlan(
        req.params.id,
        req.teacher!.id,
        req.body
      );

      res.json({
        success: true,
        data: subPlan,
        message: 'Substitute plan updated successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Substitute plan not found') {
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
 * DELETE /api/teacher/sub-plans/:id
 * Delete substitute plan
 */
router.delete(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await subPlanService.deleteSubPlan(
        req.params.id,
        req.teacher!.id
      );

      res.json({
        success: true,
        message: 'Substitute plan deleted successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Substitute plan not found') {
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
 * POST /api/teacher/sub-plans/:id/duplicate
 * Duplicate a substitute plan for a new date
 */
router.post(
  '/:id/duplicate',
  authenticateTeacher,
  requireTeacher,
  validateInput(duplicateSubPlanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subPlan = await subPlanService.duplicateSubPlan(
        req.params.id,
        req.teacher!.id,
        new Date(req.body.newDate)
      );

      res.status(201).json({
        success: true,
        data: subPlan,
        message: 'Substitute plan duplicated successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Substitute plan not found') {
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
 * POST /api/teacher/sub-plans/:id/regenerate
 * Regenerate activities for an existing sub plan
 */
router.post(
  '/:id/regenerate',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subPlan = await subPlanService.regenerateActivities(
        req.params.id,
        req.teacher!.id
      );

      res.json({
        success: true,
        data: subPlan,
        message: 'Activities regenerated successfully',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Substitute plan not found') {
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
