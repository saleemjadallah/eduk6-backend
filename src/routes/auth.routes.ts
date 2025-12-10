// Authentication routes
import { Router, Request, Response, NextFunction } from 'express';
import { authService, consentService } from '../services/auth/index.js';
import { prisma } from '../config/database.js';
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
  resetChildPinSchema,
  unlockChildPinSchema,
  resetKBQSchema,
  resetKBQViaCCSchema,
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
 * Verify email with OTP code and return tokens to log user in
 */
router.post(
  '/verify-email',
  authRateLimit,
  validateInput(verifyEmailSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code } = req.body;
      const result = await authService.verifyEmail(email, code);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        message: 'Email verified successfully',
        token: result.accessToken,
        refreshToken: result.refreshToken,
        parent: result.parent,
        children: result.children,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/resend-verification
 * Resend email verification OTP
 */
router.post(
  '/resend-verification',
  emailRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          error: 'Email is required',
        });
        return;
      }

      const result = await authService.resendVerificationOtp(email);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
          waitSeconds: result.waitSeconds,
        });
        return;
      }

      res.json({
        success: true,
        message: 'Verification code sent',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/forgot-password
 * Request password reset OTP
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
        message: 'If an account exists with this email, a reset code will be sent.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/verify-reset-code
 * Verify password reset OTP
 */
router.post(
  '/verify-reset-code',
  authRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        res.status(400).json({
          success: false,
          error: 'Email and code are required',
        });
        return;
      }

      const result = await authService.verifyPasswordResetOtp(email, code);

      if (!result.valid) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        message: 'Code verified. You can now reset your password.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/reset-password
 * Reset password (after verifying OTP)
 */
router.post(
  '/reset-password',
  authRateLimit,
  validateInput(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, newPassword } = req.body;
      const result = await authService.resetPassword(email, newPassword);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        message: 'Password reset successfully. Please log in with your new password.',
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

/**
 * GET /api/auth/me
 * Get current user data with children
 */
router.get(
  '/me',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.getCurrentUser(req.parent!.id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/auth/profile
 * Update parent profile
 */
router.patch(
  '/profile',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { firstName, lastName, phone, country, timezone } = req.body;
      const result = await authService.updateParentProfile(req.parent!.id, {
        firstName,
        lastName,
        phone,
        country,
        timezone,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/auth/delete-account
 * Delete account and all data (COPPA compliance)
 */
router.delete(
  '/delete-account',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.deleteAccount(req.parent!.id);

      res.json({
        success: true,
        message: 'Account and all associated data deleted successfully.',
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
        data: {
          clientSecret: result.clientSecret,
          consentId: result.consentId,
          paymentIntentId: result.paymentIntentId,
        },
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
      const { paymentIntentId, consentId } = req.body;

      // If consentId is provided, use it directly
      // Otherwise, find the pending consent by payment intent ID
      let actualConsentId = consentId;

      if (!actualConsentId) {
        // Find pending consent for this parent with matching paymentIntentId
        const pendingConsent = await prisma.consent.findFirst({
          where: {
            parentId: req.parent!.id,
            status: 'PENDING',
            method: 'CREDIT_CARD',
          },
          orderBy: { createdAt: 'desc' },
        });

        if (!pendingConsent) {
          return res.status(400).json({
            success: false,
            error: 'No pending consent verification found',
          });
        }

        actualConsentId = pendingConsent.id;
      }

      const result = await consentService.verifyCreditCardConsent(
        actualConsentId,
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
 * Returns isSetup=true if user needs to set up security questions first
 */
router.get(
  '/consent/kbq/questions',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await consentService.getKBQQuestions(req.parent!.id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/consent/kbq/setup
 * Setup KBQ security questions (first-time only)
 */
router.post(
  '/consent/kbq/setup',
  authenticate,
  requireParent,
  validateInput(verifyKBQConsentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { answers } = req.body;

      // Setup answers
      await consentService.setupKBQAnswers(req.parent!.id, answers);

      // After setup, automatically verify consent
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
        message: 'Security questions set up and consent verified.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/consent/kbq/verify
 * Verify KBQ answers (for existing security questions)
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

// ============================================
// PIN RECOVERY (Forgot PIN)
// ============================================

/**
 * GET /api/auth/children/:childId/pin-status
 * Get PIN lockout status for a child
 */
router.get(
  '/children/:childId/pin-status',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const status = await authService.getChildPinStatus(req.parent!.id, childId);

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
 * POST /api/auth/children/:childId/reset-pin
 * Reset child PIN (requires parent password)
 */
router.post(
  '/children/:childId/reset-pin',
  authenticate,
  requireParent,
  authRateLimit,
  validateInput(resetChildPinSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const { password, newPin } = req.body;

      await authService.resetChildPin(req.parent!.id, childId, password, newPin);

      res.json({
        success: true,
        message: 'PIN reset successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/children/:childId/unlock-pin
 * Unlock child PIN (clear lockout, requires parent password)
 */
router.post(
  '/children/:childId/unlock-pin',
  authenticate,
  requireParent,
  authRateLimit,
  validateInput(unlockChildPinSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childId } = req.params;
      const { password } = req.body;

      await authService.unlockChildPin(req.parent!.id, childId, password);

      res.json({
        success: true,
        message: 'PIN unlocked successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// KBQ RECOVERY (Forgot Security Questions)
// ============================================

/**
 * GET /api/auth/kbq/status
 * Check if parent has KBQ set up
 */
router.get(
  '/kbq/status',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hasKBQ = await consentService.hasKBQSetup(req.parent!.id);

      res.json({
        success: true,
        data: { hasKBQ },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/auth/kbq/all-questions
 * Get all available KBQ questions (for reset flow)
 */
router.get(
  '/kbq/all-questions',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const questions = consentService.getAllKBQQuestions();

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
 * POST /api/auth/kbq/reset
 * Reset KBQ answers (requires parent password)
 */
router.post(
  '/kbq/reset',
  authenticate,
  requireParent,
  authRateLimit,
  validateInput(resetKBQSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { password, answers } = req.body;

      await consentService.resetKBQAnswers(req.parent!.id, password, answers);

      res.json({
        success: true,
        message: 'Security questions reset successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/kbq/reset/initiate-cc
 * Initiate KBQ reset via credit card (for when password is forgotten)
 */
router.post(
  '/kbq/reset/initiate-cc',
  authenticate,
  requireParent,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await consentService.initiateKBQResetViaCreditCard(
        req.parent!.id,
        req.ip,
        req.headers['user-agent']
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/kbq/reset/complete-cc
 * Complete KBQ reset after credit card verification
 */
router.post(
  '/kbq/reset/complete-cc',
  authenticate,
  requireParent,
  validateInput(resetKBQViaCCSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { paymentIntentId, answers } = req.body;

      await consentService.completeKBQResetViaCreditCard(
        req.parent!.id,
        paymentIntentId,
        answers
      );

      res.json({
        success: true,
        message: 'Security questions reset successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
