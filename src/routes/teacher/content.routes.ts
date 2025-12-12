// Teacher Content routes - CRUD operations for lessons, quizzes, flashcards
import { Router, Request, Response, NextFunction } from 'express';
import { contentService, quotaService } from '../../services/teacher/index.js';
import { contentGenerationService } from '../../services/teacher/contentGenerationService.js';
import { geminiService } from '../../services/ai/geminiService.js';
import { authenticateTeacher, requireTeacher } from '../../middleware/teacherAuth.js';
import { validateInput } from '../../middleware/validateInput.js';
import { z } from 'zod';
import { TeacherContentType, ContentStatus, Subject, SourceType, TokenOperation } from '@prisma/client';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createContentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional(),
  subject: z.nativeEnum(Subject).optional(),
  gradeLevel: z.string().max(20).optional(),
  contentType: z.nativeEnum(TeacherContentType),
  sourceType: z.nativeEnum(SourceType).optional(),
  originalFileUrl: z.string().url().optional(),
  originalFileName: z.string().max(255).optional(),
  extractedText: z.string().optional(),
  templateId: z.string().uuid().optional(),
  // Allow passing generated content during creation
  lessonContent: z.record(z.unknown()).optional(),
  quizContent: z.record(z.unknown()).optional(),
  flashcardContent: z.record(z.unknown()).optional(),
  // Allow setting status directly (defaults to DRAFT if not provided)
  status: z.nativeEnum(ContentStatus).optional(),
});

const updateContentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  subject: z.nativeEnum(Subject).optional().nullable(),
  gradeLevel: z.string().max(20).optional().nullable(),
  lessonContent: z.record(z.unknown()).optional(),
  quizContent: z.record(z.unknown()).optional(),
  flashcardContent: z.record(z.unknown()).optional(),
  infographicUrl: z.string().url().optional().nullable(),
  status: z.nativeEnum(ContentStatus).optional(),
  isPublic: z.boolean().optional(),
});

const listContentQuerySchema = z.object({
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('20'),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  contentType: z.nativeEnum(TeacherContentType).optional(),
  subject: z.nativeEnum(Subject).optional(),
  gradeLevel: z.string().optional(),
  status: z.nativeEnum(ContentStatus).optional(),
  search: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.nativeEnum(ContentStatus),
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/teacher/content
 * List all content for the authenticated teacher
 */
router.get(
  '/',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Parse query params
      const query = listContentQuerySchema.parse(req.query);

      const result = await contentService.listContent(
        req.teacher!.id,
        {
          contentType: query.contentType,
          subject: query.subject,
          gradeLevel: query.gradeLevel,
          status: query.status,
          search: query.search,
        },
        {
          page: query.page,
          limit: Math.min(query.limit, 100), // Max 100 per page
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
        }
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/teacher/content/stats
 * Get content statistics for the teacher
 */
router.get(
  '/stats',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await contentService.getContentStats(req.teacher!.id);

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
 * GET /api/teacher/content/recent
 * Get recently updated content
 */
router.get(
  '/recent',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const content = await contentService.getRecentContent(
        req.teacher!.id,
        Math.min(limit, 20)
      );

      res.json({
        success: true,
        data: content,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content
 * Create new content
 */
router.post(
  '/',
  authenticateTeacher,
  requireTeacher,
  validateInput(createContentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const content = await contentService.createContent(
        req.teacher!.id,
        req.body
      );

      res.status(201).json({
        success: true,
        data: content,
        message: 'Content created successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/teacher/content/:id
 * Get content by ID
 */
router.get(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const content = await contentService.getContentById(
        req.params.id,
        req.teacher!.id
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      res.json({
        success: true,
        data: content,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/teacher/content/:id
 * Update content
 */
router.patch(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  validateInput(updateContentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const content = await contentService.updateContent(
        req.params.id,
        req.teacher!.id,
        req.body
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      res.json({
        success: true,
        data: content,
        message: 'Content updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/teacher/content/:id
 * Delete content
 */
router.delete(
  '/:id',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await contentService.deleteContent(
        req.params.id,
        req.teacher!.id
      );

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Content deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content/:id/duplicate
 * Duplicate content
 */
router.post(
  '/:id/duplicate',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const content = await contentService.duplicateContent(
        req.params.id,
        req.teacher!.id
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      res.status(201).json({
        success: true,
        data: content,
        message: 'Content duplicated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/teacher/content/:id/status
 * Update content status
 */
router.patch(
  '/:id/status',
  authenticateTeacher,
  requireTeacher,
  validateInput(updateStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const content = await contentService.updateStatus(
        req.params.id,
        req.teacher!.id,
        req.body.status
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      res.json({
        success: true,
        data: content,
        message: `Content ${req.body.status.toLowerCase()} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// AI GENERATION SCHEMAS
// ============================================

const generateLessonSchema = z.object({
  topic: z.string().min(1, 'Topic is required').max(500),
  subject: z.nativeEnum(Subject).optional(),
  gradeLevel: z.string().max(20).optional(),
  curriculum: z.string().max(50).optional(), // e.g., COMMON_CORE, UK_NATIONAL, IB_PYP
  objectives: z.array(z.string()).optional(),
  duration: z.number().min(5).max(180).optional(),
  lessonType: z.enum(['guide', 'full']).optional().default('guide'), // 'guide' = teacher guide, 'full' = comprehensive lesson
  includeActivities: z.boolean().optional(),
  includeAssessment: z.boolean().optional(),
  additionalContext: z.string().max(2000).optional(), // Extra notes from teacher
});

// Schema for split generation with all components
const generateFullLessonSchema = z.object({
  topic: z.string().min(1, 'Topic is required').max(500),
  subject: z.nativeEnum(Subject).optional(),
  gradeLevel: z.string().max(20).optional(),
  curriculum: z.string().max(50).optional(),
  objectives: z.array(z.string()).optional(),
  duration: z.number().min(5).max(180).optional(),
  lessonType: z.enum(['guide', 'full']).optional().default('full'),
  includeActivities: z.boolean().optional().default(true),
  includeAssessment: z.boolean().optional().default(true),
  additionalContext: z.string().max(2000).optional(),
  // Split generation options
  includeQuiz: z.boolean().optional().default(true),
  includeFlashcards: z.boolean().optional().default(true),
  includeInfographic: z.boolean().optional().default(false),
  quizQuestionCount: z.number().min(5).max(20).optional().default(10),
  flashcardCount: z.number().min(5).max(30).optional().default(15),
  infographicStyle: z.enum(['educational', 'colorful', 'minimalist', 'professional']).optional(),
});

const generateQuizSchema = z.object({
  content: z.string().min(50, 'Content must be at least 50 characters'),
  title: z.string().max(255).optional(),
  questionCount: z.number().min(1).max(50).optional(),
  questionTypes: z.array(z.enum(['multiple_choice', 'true_false', 'fill_blank', 'short_answer'])).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).optional(),
  gradeLevel: z.string().max(20).optional(),
});

const generateFlashcardsSchema = z.object({
  content: z.string().min(50, 'Content must be at least 50 characters'),
  title: z.string().max(255).optional(),
  cardCount: z.number().min(5).max(100).optional(),
  includeHints: z.boolean().optional(),
  gradeLevel: z.string().max(20).optional(),
});

const generateStudyGuideSchema = z.object({
  content: z.string().min(50, 'Content must be at least 50 characters'),
  title: z.string().max(255).optional(),
  format: z.enum(['outline', 'detailed', 'summary']).optional(),
  includeKeyTerms: z.boolean().optional(),
  includeReviewQuestions: z.boolean().optional(),
  gradeLevel: z.string().max(20).optional(),
});

const analyzeContentSchema = z.object({
  content: z.string().min(50, 'Content must be at least 50 characters'),
  detectSubject: z.boolean().optional(),
  detectGradeLevel: z.boolean().optional(),
  extractKeyTerms: z.boolean().optional(),
});

const generateInfographicSchema = z.object({
  topic: z.string().min(1, 'Topic is required').max(255),
  keyPoints: z.array(z.string()).min(3, 'At least 3 key points required').max(10),
  style: z.enum(['educational', 'colorful', 'minimalist', 'professional']).optional(),
  gradeLevel: z.string().max(20).optional(),
  subject: z.string().max(50).optional(),
});

// ============================================
// PDF ANALYSIS ROUTES
// ============================================

const analyzePDFSchema = z.object({
  pdfBase64: z.string().min(100, 'PDF data is required'),
  filename: z.string().max(255).optional(),
});

/**
 * POST /api/teacher/content/analyze-pdf
 * Analyze a PDF document and extract educational content
 * Uses Gemini's native PDF processing capabilities
 */
router.post(
  '/analyze-pdf',
  authenticateTeacher,
  requireTeacher,
  validateInput(analyzePDFSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pdfBase64, filename } = req.body;

      // Check file size (base64 is ~33% larger than original)
      // 10MB PDF = ~13.3MB base64
      const maxBase64Size = 14 * 1024 * 1024; // ~14MB base64 = ~10MB PDF
      if (pdfBase64.length > maxBase64Size) {
        res.status(400).json({
          success: false,
          error: 'PDF file too large',
          message: 'PDF files must be under 10MB. Please compress your PDF or split it into smaller files.',
        });
        return;
      }

      // Check quota before processing
      const estimatedTokens = 4000; // PDF analysis uses roughly 4000 tokens
      await quotaService.enforceQuota(
        req.teacher!.id,
        TokenOperation.CONTENT_ANALYSIS,
        estimatedTokens
      );

      // Analyze the PDF
      const result = await geminiService.analyzePDF(pdfBase64);

      // Record usage
      await quotaService.recordUsage({
        teacherId: req.teacher!.id,
        operation: TokenOperation.CONTENT_ANALYSIS,
        tokensUsed: result.tokensUsed,
        modelUsed: 'gemini-2.5-flash',
        resourceType: 'pdf_analysis',
      });

      res.json({
        success: true,
        data: {
          extractedText: result.extractedText,
          suggestedTitle: result.suggestedTitle,
          summary: result.summary,
          detectedSubject: result.detectedSubject,
          detectedGradeLevel: result.detectedGradeLevel,
          keyTopics: result.keyTopics,
          vocabulary: result.vocabulary,
          tokensUsed: result.tokensUsed,
          filename: filename || 'document.pdf',
        },
        message: 'PDF analyzed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PPT ANALYSIS ROUTES
// ============================================

const analyzePPTSchema = z.object({
  pptBase64: z.string().min(100, 'PowerPoint data is required'),
  filename: z.string().max(255).optional(),
  mimeType: z.enum([
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]),
});

/**
 * POST /api/teacher/content/analyze-ppt
 * Analyze a PowerPoint document and extract educational content
 * Converts PPT to PDF via LibreOffice, then uses Gemini for analysis
 */
router.post(
  '/analyze-ppt',
  authenticateTeacher,
  requireTeacher,
  validateInput(analyzePPTSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pptBase64, filename, mimeType } = req.body;

      // Check file size (base64 is ~33% larger than original)
      // 10MB PPT = ~13.3MB base64
      const maxBase64Size = 14 * 1024 * 1024; // ~14MB base64 = ~10MB PPT
      if (pptBase64.length > maxBase64Size) {
        res.status(400).json({
          success: false,
          error: 'PowerPoint file too large',
          message: 'PowerPoint files must be under 10MB. Please compress your file or split it into smaller presentations.',
        });
        return;
      }

      // Check quota before processing (PPT uses more tokens due to conversion)
      const estimatedTokens = 5000; // PPT analysis uses ~5000 tokens
      await quotaService.enforceQuota(
        req.teacher!.id,
        TokenOperation.CONTENT_ANALYSIS,
        estimatedTokens
      );

      // Import PPT processor dynamically to avoid startup issues if LibreOffice not installed
      const { analyzePPT } = await import('../../services/learning/pptProcessor.js');

      // Analyze the PPT
      const result = await analyzePPT(
        pptBase64,
        mimeType,
        filename || 'presentation.pptx'
      );

      // Record usage
      await quotaService.recordUsage({
        teacherId: req.teacher!.id,
        operation: TokenOperation.CONTENT_ANALYSIS,
        tokensUsed: result.tokensUsed,
        modelUsed: 'gemini-2.5-flash',
        resourceType: 'ppt_analysis',
      });

      res.json({
        success: true,
        data: {
          extractedText: result.extractedText,
          suggestedTitle: result.suggestedTitle,
          summary: result.summary,
          detectedSubject: result.detectedSubject,
          detectedGradeLevel: result.detectedGradeLevel,
          keyTopics: result.keyTopics,
          vocabulary: result.vocabulary,
          slideCount: result.slideCount,
          originalFormat: result.originalFormat,
          tokensUsed: result.tokensUsed,
          filename: filename || 'presentation.pptx',
        },
        message: 'PowerPoint analyzed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// AI GENERATION ROUTES
// ============================================

/**
 * POST /api/teacher/content/generate/lesson
 * Generate a lesson plan from a topic
 */
router.post(
  '/generate/lesson',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateLessonSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await contentGenerationService.generateLesson(
        req.teacher!.id,
        req.body
      );

      res.json({
        success: true,
        data: result,
        message: 'Lesson generated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content/generate/full-lesson
 * Generate a complete lesson with quiz, flashcards, and optional infographic
 * Uses Server-Sent Events (SSE) for real-time progress updates
 *
 * This endpoint uses split generation - each component is generated separately
 * for better reliability and allows the frontend to show progress updates
 */
router.post(
  '/generate/full-lesson',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateFullLessonSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    // Set up SSE headers for streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Helper to send SSE events
    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial connection event
    sendEvent('connected', { message: 'Connected to lesson generator' });

    try {
      const result = await contentGenerationService.generateFullLessonWithProgress(
        req.teacher!.id,
        req.body,
        (progress) => {
          // Send progress updates via SSE
          sendEvent('progress', progress);
        }
      );

      // Send final result
      sendEvent('complete', {
        success: true,
        data: result,
        message: 'Full lesson generated successfully',
      });

      // End the stream
      res.write('event: done\ndata: {}\n\n');
      res.end();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Send error event
      sendEvent('error', {
        success: false,
        error: errorMessage,
        message: 'Failed to generate lesson',
      });

      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }
);

/**
 * POST /api/teacher/content/generate/full-lesson-sync
 * Same as full-lesson but returns a single JSON response (no streaming)
 * Use this if your client doesn't support SSE
 */
router.post(
  '/generate/full-lesson-sync',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateFullLessonSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await contentGenerationService.generateFullLessonWithProgress(
        req.teacher!.id,
        req.body
        // No progress callback - just wait for the result
      );

      res.json({
        success: true,
        data: result,
        message: 'Full lesson generated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content/:id/generate/quiz
 * Generate a quiz from content
 */
router.post(
  '/:id/generate/quiz',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateQuizSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Verify content ownership
      const content = await contentService.getContentById(
        req.params.id,
        req.teacher!.id
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      const result = await contentGenerationService.generateQuiz(
        req.teacher!.id,
        req.params.id,
        req.body
      );

      // Optionally save quiz to content
      if (req.query.save === 'true') {
        await contentService.updateContent(req.params.id, req.teacher!.id, {
          quizContent: result as unknown as Record<string, unknown>,
        });
      }

      res.json({
        success: true,
        data: result,
        message: 'Quiz generated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content/:id/generate/flashcards
 * Generate flashcards from content
 */
router.post(
  '/:id/generate/flashcards',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateFlashcardsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Verify content ownership
      const content = await contentService.getContentById(
        req.params.id,
        req.teacher!.id
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      const result = await contentGenerationService.generateFlashcards(
        req.teacher!.id,
        req.params.id,
        req.body
      );

      // Optionally save flashcards to content
      if (req.query.save === 'true') {
        await contentService.updateContent(req.params.id, req.teacher!.id, {
          flashcardContent: result as unknown as Record<string, unknown>,
        });
      }

      res.json({
        success: true,
        data: result,
        message: 'Flashcards generated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content/:id/generate/study-guide
 * Generate a study guide from content
 */
router.post(
  '/:id/generate/study-guide',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateStudyGuideSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Verify content ownership
      const content = await contentService.getContentById(
        req.params.id,
        req.teacher!.id
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      const result = await contentGenerationService.generateStudyGuide(
        req.teacher!.id,
        req.params.id,
        req.body
      );

      res.json({
        success: true,
        data: result,
        message: 'Study guide generated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content/analyze
 * Analyze content and extract metadata
 */
router.post(
  '/analyze',
  authenticateTeacher,
  requireTeacher,
  validateInput(analyzeContentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await contentGenerationService.analyzeContent(
        req.teacher!.id,
        req.body.content,
        {
          detectSubject: req.body.detectSubject,
          detectGradeLevel: req.body.detectGradeLevel,
          extractKeyTerms: req.body.extractKeyTerms,
        }
      );

      res.json({
        success: true,
        data: result,
        message: 'Content analyzed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/content/:id/generate/infographic
 * Generate an infographic from content
 */
router.post(
  '/:id/generate/infographic',
  authenticateTeacher,
  requireTeacher,
  validateInput(generateInfographicSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Verify content ownership
      const content = await contentService.getContentById(
        req.params.id,
        req.teacher!.id
      );

      if (!content) {
        res.status(404).json({
          success: false,
          error: 'Content not found',
        });
        return;
      }

      const result = await contentGenerationService.generateInfographic(
        req.teacher!.id,
        req.params.id,
        req.body
      );

      res.json({
        success: true,
        data: result,
        message: 'Infographic generated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
