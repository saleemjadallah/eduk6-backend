// Authentication routes
import { Router, Request, Response, NextFunction } from 'express';
import { authService, consentService } from '../services/auth/index.js';
import { authenticate, requireParent } from '../middleware/auth.js';
import { validateInput } from '../middleware/validateInput.js';
import { authRateLimit, emailRateLimit } from '../middleware/rateLimit.js';
import {
  signupSchema,
  loginSchema,
  refreshTokenSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  switchToChildSchema,
  verifyCCConsentSchema,
  verifyKBQConsentSchema,
} from '../schemas/auth.schema.js';

const router = Router();

// ============================================
// AUTHENTICATION
// ============================================

/**
 * POST /api/auth/signup
 * Parent signup with email/password
 */
router.post(
  '/signup',
  authRateLimit,
  validateInput(signupSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.signup(req.body);
      res.status(201).json({
        success: true,
        data: result,
        message: 'Account created. Please verify your email.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/login
 * Parent login
 */
router.post(
  '/login',
  authRateLimit,
  validateInput(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const deviceInfo = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await authService.login(email, password, deviceInfo, ipAddress);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          refreshToken: result.refreshToken,
          parent: result.parent,
          children: result.children,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  validateInput(refreshTokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refreshTokens(refreshToken);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/logout
 * Invalidate tokens
 */
router.post(
  '/logout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const accessToken = authHeader?.substring(7);
      const { refreshToken } = req.body;

      await authService.logout(refreshToken, accessToken);

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/logout-all
 * Logout from all devices
 */
router.post(
  '/logout-all',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.logoutAll(req.parent!.id);

      res.json({
        success: true,
        message: `Logged out from ${result.sessionsInvalidated} sessions`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/verify-email
 * Verify email with code
 */
router.post(
  '/verify-email',
  authenticate,
  requireParent,
  validateInput(verifyEmailSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body;
      await authService.verifyEmail(req.parent!.id, code);

      res.json({
        success: true,
        message: 'Email verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/forgot-password
 * Request password reset
 */
router.post(
  '/forgot-password',
  emailRateLimit,
  validateInput(forgotPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      await authService.requestPasswordReset(email);

      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If an account exists with this email, a reset link will be sent.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post(
  '/reset-password',
  authRateLimit,
  validateInput(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, newPassword } = req.body;
      await authService.resetPassword(token, newPassword);

      res.json({
        success: true,
        message: 'Password reset successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/change-password
 * Change password (authenticated)
 */
router.post(
  '/change-password',
  authenticate,
  requireParent,
  validateInput(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      await authService.changePassword(req.parent!.id, currentPassword, newPassword);

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// CHILD SESSION
// ============================================

/**
 * POST /api/auth/children/:childId/switch
 * Switch to child session (requires PIN)
 */
router.post(
  '/children/:childId/switch',
  authenticate,
  requireParent,
  validateInput(switchToChildSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const { pin } = req.body;

      const result = await authService.switchToChild(req.parent!.id, childId, pin);

      res.json({
        success: true,
        data: {
          childToken: result.childToken,
          child: {
            id: result.child.id,
            displayName: result.child.displayName,
            avatarUrl: result.child.avatarUrl,
            ageGroup: result.child.ageGroup,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PARENTAL CONSENT (COPPA)
// ============================================

/**
 * GET /api/auth/consent/status
 * Check consent status
 */
router.get(
  '/consent/status',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await consentService.getConsentStatus(req.parent!.id);

      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/consent/initiate-cc
 * Start credit card verification
 */
router.post(
  '/consent/initiate-cc',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await consentService.initiateCreditCardConsent(
        req.parent!.id,
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        data: { clientSecret: result.clientSecret },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/consent/verify-cc
 * Complete credit card verification
 */
router.post(
  '/consent/verify-cc',
  authenticate,
  requireParent,
  validateInput(verifyCCConsentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get pending consent for this parent
      const { paymentIntentId } = req.body;

      // Find the pending consent
      const pendingConsent = await consentService.getConsentStatus(req.parent!.id);

      // For now, use a simplified flow
      const result = await consentService.verifyCreditCardConsent(
        'placeholder', // Would be actual consent ID
        paymentIntentId
      );

      res.json({
        success: true,
        data: { consentId: result.consentId },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/auth/consent/kbq/questions
 * Get knowledge-based questions
 */
router.get(
  '/consent/kbq/questions',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const questions = await consentService.getKBQQuestions();

      res.json({
        success: true,
        data: { questions },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/consent/kbq/verify
 * Verify KBQ answers
 */
router.post(
  '/consent/kbq/verify',
  authenticate,
  requireParent,
  validateInput(verifyKBQConsentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { answers } = req.body;

      const result = await consentService.verifyKBQConsent(
        req.parent!.id,
        answers,
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        data: {
          passed: result.success,
          consentId: result.consentId,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
