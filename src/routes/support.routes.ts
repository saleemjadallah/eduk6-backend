// Support routes for parent dashboard and suggestion box
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireParent } from '../middleware/auth.js';
import { authenticateTeacher } from '../middleware/teacherAuth.js';
import { emailService } from '../services/email/emailService.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

const router = Router();

/**
 * POST /api/support/contact
 * Submit a support contact form
 */
router.post('/contact', authenticate, requireParent, async (req, res, next) => {
  try {
    const parentId = req.parent!.id;
    const parentEmail = req.parent!.email;
    const { subject, category, message } = req.body;

    // Validate required fields
    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'Subject and message are required',
      });
    }

    if (subject.length > 200) {
      return res.status(400).json({
        success: false,
        error: 'Subject must be less than 200 characters',
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        error: 'Message must be less than 5000 characters',
      });
    }

    // Log the support request (in production, this would send an email or create a ticket)
    logger.info('Support contact form submitted', {
      parentId,
      parentEmail,
      subject,
      category: category || 'general',
      messageLength: message.length,
    });

    // In production, this would:
    // 1. Send an email to the support team
    // 2. Create a ticket in a support system (Zendesk, etc.)
    // 3. Send a confirmation email to the parent

    // For now, simulate success
    const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;

    res.json({
      success: true,
      data: {
        ticketId,
        message: 'Your message has been received. We\'ll get back to you within 24-48 hours.',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/support/faq
 * Get FAQ content
 */
router.get('/faq', async (_req, res) => {
  // Static FAQ content - could be moved to database or CMS in production
  const faq = [
    {
      category: 'Getting Started',
      questions: [
        {
          q: 'How do I add a child profile?',
          a: 'From the Parent Dashboard, click on "My Children" in the sidebar, then click "Add Child". Follow the setup wizard to create a profile with their age-appropriate settings.',
        },
        {
          q: 'What age groups does Orbit Learn support?',
          a: 'Orbit Learn is designed for children ages 4-12 (K-6). Content is automatically adjusted based on your child\'s age group: Young learners (4-7) and Older learners (8-12).',
        },
        {
          q: 'How does my child access their lessons?',
          a: 'Children can log in using their profile PIN. From the home page, select their profile and enter their 4-digit PIN to access their personalized learning dashboard.',
        },
      ],
    },
    {
      category: 'Safety & Privacy',
      questions: [
        {
          q: 'How does Orbit Learn protect my child\'s privacy?',
          a: 'We are COPPA compliant and take children\'s privacy seriously. We collect minimal data needed for learning, never share personal information with third parties, and give you full control over your family\'s data.',
        },
        {
          q: 'What safety features are in place?',
          a: 'Our AI tutor includes content filtering, profanity detection, PII protection, and inappropriate topic blocking. All interactions are logged and you can review safety incidents from your Parent Dashboard.',
        },
        {
          q: 'How can I export or delete my data?',
          a: 'Go to Privacy Controls in your Parent Dashboard. You can export all your family\'s data or request account deletion at any time.',
        },
      ],
    },
    {
      category: 'Learning Features',
      questions: [
        {
          q: 'How does the AI tutor work?',
          a: 'Our AI tutor (Cosmo) provides personalized explanations, answers questions, and creates interactive exercises based on uploaded learning materials. It adapts to your child\'s learning style and pace.',
        },
        {
          q: 'What types of content can I upload?',
          a: 'You can upload PDFs, images, and provide YouTube video links. Our AI processes the content and creates age-appropriate lessons with interactive exercises and flashcards.',
        },
        {
          q: 'What are streaks and XP?',
          a: 'Streaks track consecutive days of learning, while XP (experience points) are earned by completing lessons and exercises. These gamification features help motivate consistent learning habits.',
        },
      ],
    },
    {
      category: 'Account & Billing',
      questions: [
        {
          q: 'How do I change my password?',
          a: 'Go to Settings in your Parent Dashboard, select the Security tab, and click "Change Password". You\'ll need to enter your current password to confirm the change.',
        },
        {
          q: 'Can I have multiple children on one account?',
          a: 'Yes! You can add up to 5 child profiles per parent account. Each child gets their own personalized learning experience with separate progress tracking.',
        },
        {
          q: 'How do I cancel my subscription?',
          a: 'You can manage or cancel your subscription from the Subscription section in your Parent Dashboard. Cancelled subscriptions remain active until the end of the billing period.',
        },
      ],
    },
  ];

  res.json({
    success: true,
    data: faq,
  });
});

// =================================================================
// SUGGESTION BOX ENDPOINT (For Student and Teacher Portals)
// =================================================================

// Validation schema for suggestions
const suggestionSchema = z.object({
  message: z.string().min(10, 'Message must be at least 10 characters').max(1000, 'Message must be less than 1000 characters'),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  portal: z.enum(['student', 'teacher']),
  metadata: z.object({
    page: z.string().optional(),
    browser: z.string().optional(),
  }).optional(),
});

/**
 * POST /api/support/suggestion
 * Submit a suggestion from the suggestion box (student or teacher portal)
 * Accepts both parent/child authentication and teacher authentication
 */
router.post('/suggestion', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Try to authenticate as parent/child first, then teacher
    let userId: string | undefined;
    let userType: string | undefined;

    // Check for parent/child auth token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      // Try to decode without full validation for metadata purposes only
      try {
        const jwt = await import('jsonwebtoken');
        const { config } = await import('../config/index.js');
        const decoded = jwt.default.verify(token, config.jwtSecret) as any;

        if (decoded.parentId) {
          userId = decoded.parentId;
          userType = 'parent';
        } else if (decoded.childId) {
          userId = decoded.childId;
          userType = 'child';
        } else if (decoded.teacherId) {
          userId = decoded.teacherId;
          userType = 'teacher';
        }
      } catch {
        // Token invalid or expired - proceed without user context
      }
    }

    // Validate request body
    const validationResult = suggestionSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationResult.error.errors,
      });
    }

    const { message, email, portal, metadata } = validationResult.data;

    // Log the suggestion
    logger.info('Suggestion received', {
      portal,
      userId,
      userType,
      hasEmail: !!email,
      messageLength: message.length,
      page: metadata?.page,
    });

    // Send email to support
    const emailSent = await emailService.sendSuggestionEmail(
      message,
      email || null,
      portal,
      {
        userId,
        userType,
        page: metadata?.page,
        browser: metadata?.browser,
      }
    );

    if (!emailSent) {
      logger.error('Failed to send suggestion email');
      // Still return success to user - we don't want to discourage feedback
      // In production, we might queue this for retry
    }

    res.json({
      success: true,
      data: {
        message: 'Thank you for your suggestion! We appreciate your feedback.',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
