// Teacher Authentication routes
import { Router, Request, Response, NextFunction } from 'express';
import { teacherAuthService } from '../../services/teacher/index.js';
import { authenticateTeacher, requireTeacher } from '../../middleware/teacherAuth.js';
import { validateInput } from '../../middleware/validateInput.js';
import { authRateLimit, emailRateLimit } from '../../middleware/rateLimit.js';
import { addContactToBrevo } from '../../services/brevoService.js';
import { z } from 'zod';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const teacherSignupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  organizationId: z.string().uuid().optional(),
});

const teacherLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const googleSignInSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const verifyEmailSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'Code must be 6 digits'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(), // Optional for Google-only users setting password for the first time
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

const deleteAccountSchema = z.object({
  password: z.string().optional(), // Optional for Google-only users who don't have a password
});

// ============================================
// AUTHENTICATION ROUTES
// ============================================

/**
 * POST /api/teacher/auth/signup
 * Teacher signup with email/password
 */
router.post(
  '/signup',
  authRateLimit,
  validateInput(teacherSignupSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherAuthService.signup(req.body);

      // Add contact to Brevo for email marketing (fire-and-forget)
      addContactToBrevo({
        email: req.body.email,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        userType: 'TEACHER',
        subscriptionTier: 'FREE',
      }).catch(() => {}); // Silently ignore errors - don't block signup

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
 * POST /api/teacher/auth/login
 * Teacher login
 */
router.post(
  '/login',
  authRateLimit,
  validateInput(teacherLoginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const deviceInfo = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await teacherAuthService.login(email, password, deviceInfo, ipAddress);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          refreshToken: result.refreshToken,
          teacher: result.teacher,
          quota: {
            monthlyLimit: result.quota.monthlyLimit.toString(),
            used: result.quota.used.toString(),
            remaining: result.quota.remaining.toString(),
            resetDate: result.quota.resetDate,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/auth/google
 * Google Sign-In/Sign-Up for teachers
 * - New users: Creates account with emailVerified=true, returns isNewUser=true
 * - Existing users: Logs them in, returns isNewUser=false
 * - Email-only users: Links Google account to existing account
 */
router.post(
  '/google',
  authRateLimit,
  validateInput(googleSignInSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { idToken } = req.body;
      const deviceInfo = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await teacherAuthService.googleSignIn(idToken, deviceInfo, ipAddress);

      // Add new Google sign-in users to Brevo for email marketing (fire-and-forget)
      if (result.isNewUser) {
        addContactToBrevo({
          email: result.teacher.email,
          firstName: result.teacher.firstName || undefined,
          lastName: result.teacher.lastName || undefined,
          userType: 'TEACHER',
          subscriptionTier: result.teacher.subscriptionTier,
        }).catch(() => {}); // Silently ignore errors - don't block sign-in
      }

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          refreshToken: result.refreshToken,
          teacher: result.teacher,
          quota: {
            monthlyLimit: result.quota.monthlyLimit.toString(),
            used: result.quota.used.toString(),
            remaining: result.quota.remaining.toString(),
            resetDate: result.quota.resetDate,
          },
          isNewUser: result.isNewUser,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  validateInput(refreshTokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const result = await teacherAuthService.refreshTokens(refreshToken);

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
 * POST /api/teacher/auth/logout
 * Invalidate tokens
 */
router.post(
  '/logout',
  authenticateTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const accessToken = authHeader?.substring(7);
      const { refreshToken } = req.body;

      await teacherAuthService.logout(refreshToken, accessToken);

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
 * POST /api/teacher/auth/logout-all
 * Logout from all devices
 */
router.post(
  '/logout-all',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherAuthService.logoutAll(req.teacher!.id);

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

// ============================================
// EMAIL VERIFICATION
// ============================================

/**
 * POST /api/teacher/auth/verify-email
 * Verify email with OTP code
 */
router.post(
  '/verify-email',
  authRateLimit,
  validateInput(verifyEmailSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code } = req.body;
      const result = await teacherAuthService.verifyEmail(email, code);

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
        teacher: result.teacher,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/teacher/auth/resend-verification
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

      const result = await teacherAuthService.sendVerificationOtp(email);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
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

// ============================================
// PASSWORD MANAGEMENT
// ============================================

/**
 * POST /api/teacher/auth/forgot-password
 * Request password reset OTP
 */
router.post(
  '/forgot-password',
  emailRateLimit,
  validateInput(forgotPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      await teacherAuthService.requestPasswordReset(email);

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
 * POST /api/teacher/auth/verify-reset-code
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

      const result = await teacherAuthService.verifyPasswordResetOtp(email, code);

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
 * POST /api/teacher/auth/reset-password
 * Reset password (after verifying OTP)
 */
router.post(
  '/reset-password',
  authRateLimit,
  validateInput(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, newPassword } = req.body;
      const result = await teacherAuthService.resetPassword(email, newPassword);

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
 * POST /api/teacher/auth/change-password
 * Change password (authenticated)
 * - Email users: Requires current password
 * - Google-only users: Can set password with empty currentPassword
 */
router.post(
  '/change-password',
  authenticateTeacher,
  requireTeacher,
  validateInput(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      await teacherAuthService.changePassword(req.teacher!.id, currentPassword || '', newPassword);

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
// PROFILE MANAGEMENT
// ============================================

/**
 * GET /api/teacher/auth/me
 * Get current teacher data
 */
router.get(
  '/me',
  authenticateTeacher,
  requireTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherAuthService.getCurrentTeacher(req.teacher!.id);

      // Convert BigInt to string for JSON serialization
      res.json({
        success: true,
        data: {
          ...result,
          quota: {
            ...result.quota,
            monthlyLimit: result.quota.monthlyLimit.toString(),
            used: result.quota.used.toString(),
            remaining: result.quota.remaining.toString(),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

const updateProfileSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  schoolName: z.string().max(255).optional().nullable(),
  primarySubject: z.enum(['MATH', 'SCIENCE', 'ENGLISH', 'ARABIC', 'ISLAMIC_STUDIES', 'SOCIAL_STUDIES', 'HISTORY', 'GEOGRAPHY', 'PHYSICAL_EDUCATION', 'HEALTH', 'COMPUTER_SCIENCE', 'READING', 'FOREIGN_LANGUAGE', 'ECONOMICS', 'DRAMA', 'ENVIRONMENTAL_STUDIES', 'ART', 'MUSIC', 'OTHER']).optional().nullable(),
  gradeRange: z.enum(['ELEMENTARY', 'MIDDLE', 'HIGH', 'MIXED']).optional().nullable(),
  // Notification preferences
  notifyProductUpdates: z.boolean().optional(),
  notifyTipsAndTutorials: z.boolean().optional(),
  notifyUsageAlerts: z.boolean().optional(),
  notifyWeeklyDigest: z.boolean().optional(),
});

/**
 * PATCH /api/teacher/auth/profile
 * Update teacher profile
 */
router.patch(
  '/profile',
  authenticateTeacher,
  requireTeacher,
  validateInput(updateProfileSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        firstName,
        lastName,
        schoolName,
        primarySubject,
        gradeRange,
        notifyProductUpdates,
        notifyTipsAndTutorials,
        notifyUsageAlerts,
        notifyWeeklyDigest,
      } = req.body;

      const result = await teacherAuthService.updateProfile(req.teacher!.id, {
        firstName,
        lastName,
        schoolName,
        primarySubject,
        gradeRange,
        notifyProductUpdates,
        notifyTipsAndTutorials,
        notifyUsageAlerts,
        notifyWeeklyDigest,
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
 * DELETE /api/teacher/auth/delete-account
 * Delete teacher account and all data
 * - Email users: Requires password confirmation
 * - Google-only users: No password required (authenticated via Google)
 * Cancels any active Stripe subscription immediately
 */
router.delete(
  '/delete-account',
  authenticateTeacher,
  requireTeacher,
  validateInput(deleteAccountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { password } = req.body;
      await teacherAuthService.deleteAccount(req.teacher!.id, password || '');

      res.json({
        success: true,
        message: 'Account and all associated data deleted successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
