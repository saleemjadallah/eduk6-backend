// Rate limiting middleware configurations
import rateLimit from 'express-rate-limit';
import { RateLimitError } from './errorHandler.js';

// Standard rate limit for most endpoints
export const standardRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError('Too many requests, please try again later'));
  },
});

// Strict rate limit for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { success: false, error: 'Too many authentication attempts' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError('Too many authentication attempts, please try again later'));
  },
});

// Rate limit for AI chat (to prevent abuse)
export const chatRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 messages per minute
  message: { success: false, error: 'Slow down! Let me think about your question.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError('Slow down! Let me think about your question.'));
  },
});

// Rate limit for uploads
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads per hour
  message: { success: false, error: 'Upload limit reached' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError('Upload limit reached, please try again later'));
  },
});

// Rate limit for email sending (signup, password reset)
export const emailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 emails per hour
  message: { success: false, error: 'Too many email requests' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new RateLimitError('Too many email requests, please try again later'));
  },
});
