/**
 * Lead capture routes for email marketing
 * Handles exit-intent popup submissions and lead magnet delivery
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateInput } from '../middleware/validateInput.js';
import { addContactToBrevo } from '../services/brevoService.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Validation schema for lead capture
const leadCaptureSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  firstName: z.string().optional(),
  source: z.enum(['exit_intent', 'footer', 'landing_page']).default('exit_intent'),
  leadMagnet: z.enum(['curriculum_guide']).default('curriculum_guide'),
});

// Lead magnet download URLs
const LEAD_MAGNETS = {
  curriculum_guide: {
    title: 'Complete Parent\'s Curriculum Guide',
    url: 'https://cdn.orbitlearn.app/static/downloads/Orbit-Learn-Curriculum-Guide.pdf',
    filename: 'Orbit-Learn-Curriculum-Guide.pdf',
  },
} as const;

/**
 * POST /api/leads/capture
 * Capture email lead and return download link
 */
router.post(
  '/capture',
  validateInput(leadCaptureSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, firstName, source, leadMagnet } = req.body;

      // Get the lead magnet info
      const magnet = LEAD_MAGNETS[leadMagnet as keyof typeof LEAD_MAGNETS];
      if (!magnet) {
        return res.status(400).json({
          success: false,
          error: 'Invalid lead magnet',
        });
      }

      // Add contact to Brevo (fire-and-forget but we wait for response)
      const brevoSuccess = await addContactToBrevo({
        email,
        firstName,
        userType: 'PARENT', // Leads from exit-intent are potential parents
        subscriptionTier: 'LEAD', // Mark as lead, not signed up yet
      });

      // Log the lead capture
      logger.info(`Lead captured: ${email} (source: ${source}, magnet: ${leadMagnet})`);

      // Return success with download URL regardless of Brevo status
      // We don't want to block the user experience if Brevo fails
      res.json({
        success: true,
        data: {
          downloadUrl: magnet.url,
          filename: magnet.filename,
          title: magnet.title,
        },
        message: 'Thank you! Your guide is ready to download.',
      });
    } catch (error) {
      logger.error('Lead capture error:', error);
      next(error);
    }
  }
);

/**
 * GET /api/leads/magnets
 * Get available lead magnets (for frontend reference)
 */
router.get('/magnets', (req: Request, res: Response) => {
  const magnets = Object.entries(LEAD_MAGNETS).map(([key, value]) => ({
    id: key,
    title: value.title,
  }));

  res.json({
    success: true,
    data: magnets,
  });
});

export default router;
