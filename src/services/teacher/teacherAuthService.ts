// Teacher Authentication Service
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../config/database.js';
import { sessionService } from '../auth/sessionService.js';
import { emailService, otpService } from '../email/index.js';
import {
  generateTeacherAccessToken,
  generateTeacherRefreshToken,
  verifyTeacherRefreshToken,
  blacklistToken,
} from '../../middleware/teacherAuth.js';
import { UnauthorizedError, ConflictError, ValidationError, NotFoundError } from '../../middleware/errorHandler.js';
import { TeacherRole, TeacherSubscriptionTier } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { referralService } from '../sharing/index.js';

const SALT_ROUNDS = 12;

// Google OAuth client - initialized lazily to ensure env var is available
let googleClient: OAuth2Client | null = null;

function getGoogleClient(): OAuth2Client {
  if (!googleClient) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID environment variable is not set');
    }
    googleClient = new OAuth2Client(clientId);
    logger.info('Google OAuth client initialized for teacher auth', { clientId: clientId.substring(0, 20) + '...' });
  }
  return googleClient;
}

export interface TeacherSignupParams {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  organizationId?: string; // Optional - for joining an existing org
  referralCode?: string; // Optional - referral code from share link
}

export interface TeacherLoginResult {
  accessToken: string;
  refreshToken: string;
  teacher: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    emailVerified: boolean;
    role: TeacherRole;
    subscriptionTier: TeacherSubscriptionTier;
    organizationId: string | null;
    organizationName: string | null;
  };
  quota: {
    monthlyLimit: bigint;
    used: bigint;
    remaining: bigint;
    resetDate: Date;
  };
}

/**
 * Hash a refresh token for secure storage
 */
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const teacherAuthService = {
  /**
   * Create a new teacher account
   * Returns tokens immediately so teachers can start using FREE tier
   * Email verification is handled later via link (not blocking signup)
   */
  async signup(
    params: TeacherSignupParams,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<TeacherLoginResult> {
    const { email, password, firstName, lastName, organizationId, referralCode } = params;

    // Check if email already exists (for teachers)
    const existingTeacher = await prisma.teacher.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingTeacher) {
      throw new ConflictError('An account with this email already exists');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // If organizationId provided, verify it exists
    let organization = null;
    if (organizationId) {
      organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new NotFoundError('Organization not found');
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create teacher account
    const teacher = await prisma.teacher.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        organizationId: organizationId || null,
        role: organizationId ? 'TEACHER' : 'TEACHER', // Default role
        subscriptionTier: organizationId ? 'FREE' : 'FREE', // Free tier for individual teachers
        quotaResetDate: getNextMonthStart(),
      },
    });

    // Generate tokens immediately (low-friction signup)
    const accessToken = generateTeacherAccessToken(teacher);
    const { token: refreshToken, jti, fid } = generateTeacherRefreshToken(teacher.id);

    // Create session with hashed token
    await sessionService.createSession({
      userId: teacher.id,
      type: 'teacher',
      refreshTokenId: jti,
      refreshTokenHash: hashRefreshToken(refreshToken),
      tokenFamilyId: fid,
      deviceInfo,
      ipAddress,
    });

    // Send welcome email (async, don't block signup) - using teacher-specific green theme
    emailService.sendTeacherWelcomeEmail(
      teacher.email,
      teacher.firstName || 'Teacher'
    ).catch(err => {
      logger.error('Failed to send teacher welcome email', { error: err, teacherId: teacher.id });
    });

    // Send email verification link (not OTP - lower friction)
    this.sendVerificationLink(teacher.email, teacher.id).catch(err => {
      logger.error('Failed to send teacher verification link', { error: err, teacherId: teacher.id });
    });

    // Track referral if code was provided
    let referralApplied = false;
    if (referralCode) {
      try {
        const validation = await referralService.validateCode(referralCode);
        if (validation.isValid && validation.referralCodeId) {
          await referralService.createReferral(
            validation.referralCodeId,
            teacher.id,
            'teacher',
            'OTHER' // Default channel - could be enhanced via URL params
          );
          referralApplied = true;
          logger.info('Teacher referral tracked successfully', {
            teacherId: teacher.id,
            referralCode,
            referralCodeId: validation.referralCodeId,
          });
        }
      } catch (referralError) {
        // Don't fail signup if referral tracking fails
        logger.error('Failed to track teacher referral', {
          teacherId: teacher.id,
          referralCode,
          error: referralError instanceof Error ? referralError.message : referralError,
        });
      }
    }

    logger.info(`Teacher account created and logged in: ${teacher.email}${referralApplied ? ' (with referral)' : ''}`);

    // Calculate quota info (same as login)
    const monthlyLimit = teacher.monthlyTokenQuota;
    const used = teacher.currentMonthUsage;
    const resetDate = teacher.quotaResetDate;

    return {
      accessToken,
      refreshToken,
      teacher: {
        id: teacher.id,
        email: teacher.email,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        emailVerified: teacher.emailVerified,
        role: teacher.role,
        subscriptionTier: teacher.subscriptionTier,
        organizationId: teacher.organizationId,
        organizationName: null, // New account, no org name
      },
      quota: {
        monthlyLimit,
        used,
        remaining: monthlyLimit - used,
        resetDate,
      },
    };
  },

  /**
   * Login a teacher
   */
  async login(
    email: string,
    password: string,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<TeacherLoginResult> {
    // Find teacher with organization info
    const teacher = await prisma.teacher.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            monthlyTokenQuota: true,
            currentMonthUsage: true,
            quotaResetDate: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check if teacher signed up via Google and has no password
    if (!teacher.passwordHash) {
      throw new UnauthorizedError('This account uses Google Sign-In. Please sign in with Google.');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, teacher.passwordHash);

    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate tokens
    const accessToken = generateTeacherAccessToken(teacher);
    const { token: refreshToken, jti, fid } = generateTeacherRefreshToken(teacher.id);

    // Create session with hashed token
    await sessionService.createSession({
      userId: teacher.id,
      type: 'teacher',
      refreshTokenId: jti,
      refreshTokenHash: hashRefreshToken(refreshToken),
      tokenFamilyId: fid,
      deviceInfo,
      ipAddress,
    });

    // Update last login
    await prisma.teacher.update({
      where: { id: teacher.id },
      data: { lastLoginAt: new Date() },
    });

    // Calculate quota info
    const monthlyLimit = teacher.organization
      ? teacher.organization.monthlyTokenQuota
      : teacher.monthlyTokenQuota;
    const used = teacher.organization
      ? teacher.organization.currentMonthUsage
      : teacher.currentMonthUsage;
    const resetDate = teacher.organization
      ? teacher.organization.quotaResetDate
      : teacher.quotaResetDate;

    return {
      accessToken,
      refreshToken,
      teacher: {
        id: teacher.id,
        email: teacher.email,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        emailVerified: teacher.emailVerified,
        role: teacher.role,
        subscriptionTier: teacher.subscriptionTier,
        organizationId: teacher.organizationId,
        organizationName: teacher.organization?.name || null,
      },
      quota: {
        monthlyLimit,
        used,
        remaining: monthlyLimit - used,
        resetDate,
      },
    };
  },

  /**
   * Google Sign-In - handles both new teachers and returning teachers
   * For new teachers: creates account with emailVerified=true, isNewUser=true
   * For returning teachers: logs them in, isNewUser=false
   */
  async googleSignIn(
    idToken: string,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<TeacherLoginResult & { isNewUser: boolean }> {
    // Verify the Google ID token
    let ticket;
    try {
      const client = getGoogleClient();
      const clientId = process.env.GOOGLE_CLIENT_ID;
      logger.info('Verifying Google ID token for teacher', { audience: clientId?.substring(0, 20) + '...' });
      ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
    } catch (error: any) {
      logger.error('Google ID token verification failed for teacher', {
        error: error?.message || error,
        stack: error?.stack,
        clientId: process.env.GOOGLE_CLIENT_ID?.substring(0, 30),
      });
      throw new UnauthorizedError('Invalid Google credentials');
    }

    const payload = ticket.getPayload();
    if (!payload) {
      throw new UnauthorizedError('Invalid Google credentials');
    }

    const { sub: googleId, email, given_name: firstName, family_name: lastName, email_verified } = payload;

    if (!email) {
      throw new ValidationError('Google account must have an email address');
    }

    // Check if teacher exists by googleId or email
    let teacher = await prisma.teacher.findFirst({
      where: {
        OR: [
          { googleId },
          { email: email.toLowerCase() },
        ],
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            monthlyTokenQuota: true,
            currentMonthUsage: true,
            quotaResetDate: true,
          },
        },
      },
    });

    let isNewUser = false;

    if (!teacher) {
      // New teacher - create account
      isNewUser = true;
      teacher = await prisma.teacher.create({
        data: {
          email: email.toLowerCase(),
          googleId,
          authProvider: 'google',
          firstName: firstName || null,
          lastName: lastName || null,
          emailVerified: email_verified ?? true, // Google verifies emails
          emailVerifiedAt: email_verified ? new Date() : null,
          subscriptionTier: 'FREE',
          quotaResetDate: getNextMonthStart(),
        },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              monthlyTokenQuota: true,
              currentMonthUsage: true,
              quotaResetDate: true,
            },
          },
        },
      });

      // Send welcome email for new teachers
      logger.info(`Sending welcome email for new Google teacher: ${teacher.email}`);
      emailService.sendTeacherWelcomeEmail(
        teacher.email,
        teacher.firstName || 'Teacher'
      ).catch(err => {
        logger.error('Failed to send teacher welcome email for Google signup', { error: err, teacherId: teacher!.id });
      });
    } else if (!teacher.googleId) {
      // Existing teacher with email - link Google account
      teacher = await prisma.teacher.update({
        where: { id: teacher.id },
        data: {
          googleId,
          authProvider: teacher.authProvider === 'email' ? 'google' : teacher.authProvider,
          emailVerified: true,
          emailVerifiedAt: teacher.emailVerifiedAt || new Date(),
        },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              monthlyTokenQuota: true,
              currentMonthUsage: true,
              quotaResetDate: true,
            },
          },
        },
      });
      logger.info(`Linked Google account to existing teacher: ${teacher.email}`);
    }

    // Generate tokens
    const accessToken = generateTeacherAccessToken(teacher);
    const { token: refreshToken, jti, fid } = generateTeacherRefreshToken(teacher.id);

    // Create session with hashed token
    await sessionService.createSession({
      userId: teacher.id,
      type: 'teacher',
      refreshTokenId: jti,
      refreshTokenHash: hashRefreshToken(refreshToken),
      tokenFamilyId: fid,
      deviceInfo,
      ipAddress,
    });

    // Update last login
    await prisma.teacher.update({
      where: { id: teacher.id },
      data: { lastLoginAt: new Date() },
    });

    // Calculate quota info
    const monthlyLimit = teacher.organization
      ? teacher.organization.monthlyTokenQuota
      : teacher.monthlyTokenQuota;
    const used = teacher.organization
      ? teacher.organization.currentMonthUsage
      : teacher.currentMonthUsage;
    const resetDate = teacher.organization
      ? teacher.organization.quotaResetDate
      : teacher.quotaResetDate;

    logger.info(`Teacher Google sign-in successful: ${teacher.email}`, { isNewUser });

    return {
      accessToken,
      refreshToken,
      teacher: {
        id: teacher.id,
        email: teacher.email,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        emailVerified: teacher.emailVerified,
        role: teacher.role,
        subscriptionTier: teacher.subscriptionTier,
        organizationId: teacher.organizationId,
        organizationName: teacher.organization?.name || null,
      },
      quota: {
        monthlyLimit,
        used,
        remaining: monthlyLimit - used,
        resetDate,
      },
      isNewUser,
    };
  },

  /**
   * Refresh access token
   */
  async refreshTokens(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify refresh token
    let payload;
    try {
      payload = verifyTeacherRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if session exists
    const session = await sessionService.getSession(payload.jti);

    if (!session) {
      throw new UnauthorizedError('Session expired or revoked');
    }

    // Verify the refresh token hash matches
    const tokenHash = hashRefreshToken(refreshToken);
    if (session.refreshTokenHash && session.refreshTokenHash !== tokenHash) {
      logger.warn(`Refresh token hash mismatch for teacher ${session.userId}`);
      await sessionService.invalidateTokenFamily(payload.fid, session.userId);
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Get teacher data for new access token
    const teacher = await prisma.teacher.findUnique({
      where: { id: payload.sub },
    });

    if (!teacher) {
      throw new UnauthorizedError('Teacher not found');
    }

    // Generate new tokens
    const newAccessToken = generateTeacherAccessToken(teacher);
    const { token: newRefreshToken, jti: newJti, fid: newFid } = generateTeacherRefreshToken(teacher.id);

    // Rotate the session
    const newSession = await sessionService.rotateSession(
      payload.jti,
      newJti,
      hashRefreshToken(newRefreshToken),
      newFid
    );

    if (!newSession) {
      throw new UnauthorizedError('Session compromised. Please log in again.');
    }

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  },

  /**
   * Logout (invalidate current session)
   */
  async logout(refreshToken: string, accessToken?: string): Promise<void> {
    try {
      const payload = verifyTeacherRefreshToken(refreshToken);
      await sessionService.invalidateSession(payload.jti);
    } catch {
      // Token might be invalid/expired, that's okay for logout
    }

    // Blacklist access token if provided
    if (accessToken) {
      try {
        // Get remaining time from token
        const decoded = JSON.parse(
          Buffer.from(accessToken.split('.')[1], 'base64').toString()
        );
        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
        if (expiresIn > 0) {
          await blacklistToken(accessToken, expiresIn);
        }
      } catch {
        // Token might be invalid/expired, that's okay
      }
    }
  },

  /**
   * Logout from all devices
   */
  async logoutAll(teacherId: string): Promise<{ sessionsInvalidated: number }> {
    const count = await sessionService.invalidateAllSessions(teacherId);
    return { sessionsInvalidated: count };
  },

  /**
   * Send email verification OTP (teacher-specific green theme)
   */
  async sendVerificationOtp(email: string): Promise<{ success: boolean; error?: string }> {
    const teacher = await prisma.teacher.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!teacher) {
      // Don't reveal if email exists
      return { success: true };
    }

    if (teacher.emailVerified) {
      return { success: false, error: 'Email is already verified' };
    }

    return otpService.createAndSendForTeacher(email, 'verify_email');
  },

  /**
   * Verify email with OTP code
   */
  async verifyEmail(email: string, code: string): Promise<{
    success: boolean;
    error?: string;
    accessToken?: string;
    refreshToken?: string;
    teacher?: any;
  }> {
    // Verify OTP
    const result = await otpService.verify(email, code, 'verify_email');

    if (!result.valid) {
      return { success: false, error: result.error };
    }

    // Mark email as verified and get teacher data
    const teacher = await prisma.teacher.update({
      where: { email: email.toLowerCase() },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Generate tokens
    const accessToken = generateTeacherAccessToken(teacher);
    const { token: refreshToken, jti, fid } = generateTeacherRefreshToken(teacher.id);

    // Store refresh token session
    await sessionService.createSession({
      userId: teacher.id,
      type: 'teacher',
      refreshTokenId: jti,
      refreshTokenHash: hashRefreshToken(refreshToken),
      tokenFamilyId: fid,
    });

    logger.info(`Teacher email verified: ${email}`);

    return {
      success: true,
      accessToken,
      refreshToken,
      teacher: {
        id: teacher.id,
        email: teacher.email,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        emailVerified: teacher.emailVerified,
        role: teacher.role,
        subscriptionTier: teacher.subscriptionTier,
        organizationId: teacher.organizationId,
        organizationName: teacher.organization?.name || null,
      },
    };
  },

  /**
   * Generate and send a verification link via email
   * This is lower friction than OTP - just click the link
   */
  async sendVerificationLink(email: string, teacherId?: string): Promise<{ success: boolean; error?: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Get teacher if not provided
    let teacher;
    if (teacherId) {
      teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
    } else {
      teacher = await prisma.teacher.findUnique({ where: { email: normalizedEmail } });
    }

    if (!teacher) {
      // Don't reveal if email exists
      return { success: true };
    }

    if (teacher.emailVerified) {
      return { success: false, error: 'Email is already verified' };
    }

    // Generate a signed verification token (expires in 24 hours)
    const jwt = await import('jsonwebtoken');
    const verificationToken = jwt.default.sign(
      {
        sub: teacher.id,
        email: teacher.email,
        purpose: 'verify_email',
        type: 'teacher',
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    // Build the verification URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verificationUrl = `${frontendUrl}/teacher/verify-email-link?token=${verificationToken}`;

    // Send the verification email with link
    const sent = await emailService.sendTeacherVerificationLinkEmail(
      teacher.email,
      teacher.firstName || 'Teacher',
      verificationUrl
    );

    if (!sent) {
      // Fall back to OTP if link email fails
      logger.warn(`Verification link email failed, falling back to OTP for ${normalizedEmail}`);
      return otpService.createAndSendForTeacher(normalizedEmail, 'verify_email');
    }

    logger.info(`Verification link sent to teacher: ${normalizedEmail}`);
    return { success: true };
  },

  /**
   * Verify email using a signed token from verification link
   * No OTP needed - just validates the JWT
   */
  async verifyEmailLink(token: string): Promise<{
    success: boolean;
    error?: string;
    teacher?: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      emailVerified: boolean;
    };
  }> {
    try {
      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.verify(token, process.env.JWT_SECRET || 'fallback-secret') as {
        sub: string;
        email: string;
        purpose: string;
        type: string;
      };

      // Validate token purpose and type
      if (payload.purpose !== 'verify_email' || payload.type !== 'teacher') {
        return { success: false, error: 'Invalid verification token' };
      }

      // Find and update teacher
      const teacher = await prisma.teacher.findUnique({
        where: { id: payload.sub },
      });

      if (!teacher) {
        return { success: false, error: 'Account not found' };
      }

      if (teacher.emailVerified) {
        // Already verified - that's fine, just return success
        return {
          success: true,
          teacher: {
            id: teacher.id,
            email: teacher.email,
            firstName: teacher.firstName,
            lastName: teacher.lastName,
            emailVerified: true,
          },
        };
      }

      // Mark as verified
      const updatedTeacher = await prisma.teacher.update({
        where: { id: teacher.id },
        data: {
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });

      logger.info(`Teacher email verified via link: ${teacher.email}`);

      return {
        success: true,
        teacher: {
          id: updatedTeacher.id,
          email: updatedTeacher.email,
          firstName: updatedTeacher.firstName,
          lastName: updatedTeacher.lastName,
          emailVerified: updatedTeacher.emailVerified,
        },
      };
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        return { success: false, error: 'Verification link has expired. Please request a new one.' };
      }
      if (error.name === 'JsonWebTokenError') {
        return { success: false, error: 'Invalid verification link' };
      }
      logger.error('Email link verification failed', { error });
      return { success: false, error: 'Verification failed. Please try again.' };
    }
  },

  /**
   * Request password reset (teacher-specific green theme)
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const teacher = await prisma.teacher.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!teacher) {
      // Don't reveal if email exists
      return { success: true };
    }

    return otpService.createAndSendForTeacher(email, 'reset_password');
  },

  /**
   * Verify password reset OTP
   */
  async verifyPasswordResetOtp(email: string, code: string): Promise<{ valid: boolean; error?: string }> {
    return otpService.verify(email, code, 'reset_password');
  },

  /**
   * Reset password with verified OTP
   */
  async resetPassword(email: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    const teacher = await prisma.teacher.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!teacher) {
      return { success: false, error: 'Account not found' };
    }

    // Hash and update password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.teacher.update({
      where: { id: teacher.id },
      data: { passwordHash },
    });

    // Invalidate all sessions
    await sessionService.invalidateAllSessions(teacher.id);

    logger.info(`Teacher password reset: ${email}`);

    return { success: true };
  },

  /**
   * Change password (authenticated)
   * Note: Google-only users can use this to set a password for the first time
   */
  async changePassword(
    teacherId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
    });

    if (!teacher) {
      throw new NotFoundError('Account not found');
    }

    // If teacher has a password, verify it
    if (teacher.passwordHash) {
      const isValid = await bcrypt.compare(currentPassword, teacher.passwordHash);
      if (!isValid) {
        throw new UnauthorizedError('Current password is incorrect');
      }
    } else {
      // Google-only user - they're setting a password for the first time
      // Just validate that currentPassword is empty or they acknowledge they don't have one
      if (currentPassword && currentPassword.length > 0) {
        throw new ValidationError('This account uses Google Sign-In and has no current password. Leave current password empty to set one.');
      }
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.teacher.update({
      where: { id: teacherId },
      data: { passwordHash },
    });

    // Invalidate all sessions
    await sessionService.invalidateAllSessions(teacherId);
  },

  /**
   * Get current teacher data
   */
  async getCurrentTeacher(teacherId: string) {
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
            subscriptionTier: true,
            subscriptionStatus: true,
            monthlyTokenQuota: true,
            currentMonthUsage: true,
            quotaResetDate: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new NotFoundError('Account not found');
    }

    // Calculate quota
    const monthlyLimit = teacher.organization
      ? teacher.organization.monthlyTokenQuota
      : teacher.monthlyTokenQuota;
    const used = teacher.organization
      ? teacher.organization.currentMonthUsage
      : teacher.currentMonthUsage;
    const resetDate = teacher.organization
      ? teacher.organization.quotaResetDate
      : teacher.quotaResetDate;

    return {
      teacher: {
        id: teacher.id,
        email: teacher.email,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        emailVerified: teacher.emailVerified,
        role: teacher.role,
        subscriptionTier: teacher.subscriptionTier,
        subscriptionStatus: teacher.subscriptionStatus,
        // Profile details
        schoolName: teacher.schoolName,
        primarySubject: teacher.primarySubject,
        gradeRange: teacher.gradeRange,
        // Notification preferences
        notifyProductUpdates: teacher.notifyProductUpdates,
        notifyTipsAndTutorials: teacher.notifyTipsAndTutorials,
        notifyUsageAlerts: teacher.notifyUsageAlerts,
        notifyWeeklyDigest: teacher.notifyWeeklyDigest,
      },
      organization: teacher.organization,
      quota: {
        monthlyLimit,
        used,
        remaining: monthlyLimit - used,
        resetDate,
        percentUsed: Number((used * BigInt(100)) / monthlyLimit),
      },
    };
  },

  /**
   * Update teacher profile
   */
  async updateProfile(
    teacherId: string,
    data: {
      firstName?: string;
      lastName?: string;
      schoolName?: string | null;
      primarySubject?: string | null;
      gradeRange?: string | null;
      notifyProductUpdates?: boolean;
      notifyTipsAndTutorials?: boolean;
      notifyUsageAlerts?: boolean;
      notifyWeeklyDigest?: boolean;
    }
  ) {
    const updateData: Record<string, unknown> = {};

    // Profile fields
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.schoolName !== undefined) updateData.schoolName = data.schoolName;
    if (data.primarySubject !== undefined) updateData.primarySubject = data.primarySubject;
    if (data.gradeRange !== undefined) updateData.gradeRange = data.gradeRange;

    // Notification preferences
    if (data.notifyProductUpdates !== undefined) updateData.notifyProductUpdates = data.notifyProductUpdates;
    if (data.notifyTipsAndTutorials !== undefined) updateData.notifyTipsAndTutorials = data.notifyTipsAndTutorials;
    if (data.notifyUsageAlerts !== undefined) updateData.notifyUsageAlerts = data.notifyUsageAlerts;
    if (data.notifyWeeklyDigest !== undefined) updateData.notifyWeeklyDigest = data.notifyWeeklyDigest;

    const teacher = await prisma.teacher.update({
      where: { id: teacherId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        schoolName: true,
        primarySubject: true,
        gradeRange: true,
        notifyProductUpdates: true,
        notifyTipsAndTutorials: true,
        notifyUsageAlerts: true,
        notifyWeeklyDigest: true,
      },
    });

    return teacher;
  },

  /**
   * Delete teacher account
   * Cancels any active Stripe subscription and deletes all associated data
   * For email users: requires password verification
   * For Google-only users: password can be empty (they don't have one)
   */
  async deleteAccount(teacherId: string, password: string): Promise<void> {
    // Get teacher data including subscription info
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        authProvider: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
      },
    });

    if (!teacher) {
      throw new NotFoundError('Account not found');
    }

    // Verify password for users who have one
    if (teacher.passwordHash) {
      const isValid = await bcrypt.compare(password, teacher.passwordHash);
      if (!isValid) {
        throw new UnauthorizedError('Invalid password');
      }
    }
    // For Google-only users (no passwordHash), deletion is allowed since they're already authenticated

    // Cancel active Stripe subscription if exists
    if (teacher.stripeSubscriptionId) {
      try {
        const { subscriptionService } = await import('../stripe/subscriptionService.js');
        if (subscriptionService.isConfigured()) {
          const stripe = (await import('stripe')).default;
          const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY || '', {
            apiVersion: '2025-11-17.clover',
          });
          // Cancel immediately, not at period end
          await stripeClient.subscriptions.cancel(teacher.stripeSubscriptionId);
          logger.info(`Cancelled Stripe subscription for deleted teacher`, {
            teacherId,
            subscriptionId: teacher.stripeSubscriptionId,
          });
        }
      } catch (error) {
        // Log but don't block deletion - subscription will eventually fail/expire
        logger.error('Failed to cancel Stripe subscription during account deletion', {
          error,
          teacherId,
          subscriptionId: teacher.stripeSubscriptionId,
        });
      }
    }

    // Invalidate all sessions
    await sessionService.invalidateAllSessions(teacherId);

    // Clean up any pending OTPs (best-effort, they auto-expire anyway)
    try {
      await otpService.cancel(teacher.email, 'verify_email');
      await otpService.cancel(teacher.email, 'reset_password');
    } catch {
      // OTP cleanup is best-effort - OTPs auto-expire after 10 minutes
    }

    // Delete the teacher account (cascades to content, rubrics, etc.)
    await prisma.teacher.delete({
      where: { id: teacherId },
    });

    logger.info(`Teacher account deleted: ${teacherId}`);
  },
};

/**
 * Get the start of next month for quota reset
 */
function getNextMonthStart(): Date {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth;
}
