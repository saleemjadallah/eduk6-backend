// Public contact form routes (no authentication required)
import { Router } from 'express';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/contact
 * Submit a public contact form (no auth required)
 * For visitors who aren't logged in
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, email, category, subject, message } = req.body;

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required',
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address',
      });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required',
      });
    }

    if (subject.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Subject must be less than 200 characters',
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    if (message.length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Message must be at least 20 characters',
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Message must be less than 5000 characters',
      });
    }

    // Log the contact request
    logger.info('Public contact form submitted', {
      name: name.trim(),
      email: email.trim(),
      category: category || 'general',
      subject: subject.trim(),
      messageLength: message.length,
    });

    // In production, this would:
    // 1. Send an email to the support team
    // 2. Create a ticket in a support system (Zendesk, Freshdesk, etc.)
    // 3. Send a confirmation email to the user
    // 4. Store in database for tracking

    // For now, simulate success with a ticket ID
    const ticketId = `CON-${Date.now().toString(36).toUpperCase()}`;

    res.json({
      success: true,
      ticketId,
      message: 'Thank you for reaching out! We\'ll get back to you within 24-48 hours.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
