// Teacher Authentication Service
import bcrypt from 'bcrypt';
import crypto from 'crypto';
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

const SALT_ROUNDS = 12;

export interface TeacherSignupParams {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  organizationId?: string; // Optional - for joining an existing org
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
   */
  async signup(params: TeacherSignupParams): Promise<{ teacherId: string }> {
    const { email, password, firstName, lastName, organizationId } = params;

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

    // Send welcome email (async, don't block signup) - using teacher-specific green theme
    emailService.sendTeacherWelcomeEmail(
      teacher.email,
      teacher.firstName || 'Teacher'
    ).catch(err => {
      logger.error('Failed to send teacher welcome email', { error: err, teacherId: teacher.id });
    });

    // Send email verification OTP - using teacher-specific green theme
    otpService.createAndSendForTeacher(teacher.email, 'verify_email').catch(err => {
      logger.error('Failed to send teacher verification OTP', { error: err, teacherId: teacher.id });
    });

    logger.info(`Teacher account created: ${teacher.email}`);

    return { teacherId: teacher.id };
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

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, teacher.passwordHash);

    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
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
    }
  ) {
    const updateData: Record<string, string> = {};
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;

    const teacher = await prisma.teacher.update({
      where: { id: teacherId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    return teacher;
  },

  /**
   * Delete teacher account
   */
  async deleteAccount(teacherId: string): Promise<void> {
    // Invalidate all sessions first
    await sessionService.invalidateAllSessions(teacherId);

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
