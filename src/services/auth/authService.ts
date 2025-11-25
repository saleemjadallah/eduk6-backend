// Main authentication service
import bcrypt from 'bcrypt';
import { prisma } from '../../config/database.js';
import { tokenService } from './tokenService.js';
import { sessionService } from './sessionService.js';
import { emailService, otpService } from '../email/index.js';
import { UnauthorizedError, ConflictError, ValidationError, NotFoundError } from '../../middleware/errorHandler.js';
import { AgeGroup, Child, Parent } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const SALT_ROUNDS = 12;

export interface SignupParams {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  country?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  parent: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    emailVerified: boolean;
  };
  children: Array<{
    id: string;
    displayName: string;
    avatarUrl: string | null;
    ageGroup: AgeGroup;
  }>;
}

export const authService = {
  /**
   * Create a new parent account
   */
  async signup(params: SignupParams): Promise<{ parentId: string }> {
    const { email, password, firstName, lastName, country } = params;

    // Check if email already exists
    const existing = await prisma.parent.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create parent account
    const parent = await prisma.parent.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        country: country || 'AE',
      },
    });

    // Send welcome email (async, don't block signup)
    emailService.sendWelcomeEmail(
      parent.email,
      parent.firstName || 'there'
    ).catch(err => {
      logger.error('Failed to send welcome email', { error: err, parentId: parent.id });
    });

    // Send email verification OTP
    otpService.createAndSend(parent.email, 'verify_email').catch(err => {
      logger.error('Failed to send verification OTP', { error: err, parentId: parent.id });
    });

    return { parentId: parent.id };
  },

  /**
   * Login a parent
   */
  async login(
    email: string,
    password: string,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<LoginResult> {
    // Find parent
    const parent = await prisma.parent.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        children: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            ageGroup: true,
          },
        },
      },
    });

    if (!parent) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, parent.passwordHash);

    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate tokens
    const { accessToken, refreshToken, refreshTokenId } = tokenService.generateParentTokens(parent.id);

    // Create session
    await sessionService.createSession({
      userId: parent.id,
      type: 'parent',
      refreshTokenId,
      deviceInfo,
      ipAddress,
    });

    // Update last login
    await prisma.parent.update({
      where: { id: parent.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      parent: {
        id: parent.id,
        email: parent.email,
        firstName: parent.firstName,
        lastName: parent.lastName,
        emailVerified: parent.emailVerified,
      },
      children: parent.children,
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
      payload = tokenService.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if session exists
    const session = await sessionService.getSession(payload.jti);

    if (!session) {
      throw new UnauthorizedError('Session expired or revoked');
    }

    // Invalidate old session
    await sessionService.invalidateSession(payload.jti);

    // Generate new tokens
    const tokens = tokenService.generateParentTokens(payload.sub);

    // Create new session
    await sessionService.createSession({
      userId: session.userId,
      type: session.type,
      parentId: session.parentId,
      refreshTokenId: tokens.refreshTokenId,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  },

  /**
   * Logout (invalidate current session)
   */
  async logout(refreshToken: string, accessToken?: string): Promise<void> {
    try {
      const payload = tokenService.verifyRefreshToken(refreshToken);
      await sessionService.invalidateSession(payload.jti);
    } catch {
      // Token might be invalid/expired, that's okay for logout
    }

    // Blacklist access token if provided
    if (accessToken) {
      try {
        const payload = tokenService.verifyAccessToken(accessToken);
        const expiresIn = payload.exp - Math.floor(Date.now() / 1000);
        if (expiresIn > 0) {
          await sessionService.blacklistToken(accessToken, expiresIn);
        }
      } catch {
        // Token might be invalid/expired, that's okay
      }
    }
  },

  /**
   * Logout from all devices
   */
  async logoutAll(parentId: string): Promise<{ sessionsInvalidated: number }> {
    const count = await sessionService.invalidateAllSessions(parentId);
    return { sessionsInvalidated: count };
  },

  /**
   * Switch to child profile (requires PIN)
   */
  async switchToChild(
    parentId: string,
    childId: string,
    pin: string
  ): Promise<{ childToken: string; child: Child }> {
    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
    });

    if (!child) {
      throw new NotFoundError('Child profile not found');
    }

    // Verify PIN
    if (child.pin !== pin) {
      // Log failed attempt for security
      // TODO: Implement failed PIN attempt tracking
      throw new UnauthorizedError('Invalid PIN');
    }

    // Generate child token
    const childToken = tokenService.generateChildToken(
      child.id,
      parentId,
      child.ageGroup
    );

    // Update last active
    await prisma.child.update({
      where: { id: childId },
      data: { lastActiveAt: new Date() },
    });

    return { childToken, child };
  },

  /**
   * Send email verification OTP
   */
  async sendVerificationOtp(email: string): Promise<{ success: boolean; error?: string }> {
    const parent = await prisma.parent.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!parent) {
      // Don't reveal if email exists
      return { success: true };
    }

    if (parent.emailVerified) {
      return { success: false, error: 'Email is already verified' };
    }

    return otpService.createAndSend(email, 'verify_email');
  },

  /**
   * Verify email with OTP code
   */
  async verifyEmail(email: string, code: string): Promise<{ success: boolean; error?: string }> {
    // Verify OTP
    const result = await otpService.verify(email, code, 'verify_email');

    if (!result.valid) {
      return { success: false, error: result.error };
    }

    // Mark email as verified
    await prisma.parent.update({
      where: { email: email.toLowerCase() },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    logger.info(`Email verified for ${email}`);

    return { success: true };
  },

  /**
   * Resend verification OTP (with cooldown)
   */
  async resendVerificationOtp(email: string): Promise<{ success: boolean; error?: string; waitSeconds?: number }> {
    const parent = await prisma.parent.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!parent) {
      // Don't reveal if email exists
      return { success: true };
    }

    if (parent.emailVerified) {
      return { success: false, error: 'Email is already verified' };
    }

    return otpService.resend(email, 'verify_email', 60);
  },

  /**
   * Request password reset - sends OTP to email
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const parent = await prisma.parent.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!parent) {
      // Don't reveal if email exists - still return success
      return { success: true };
    }

    return otpService.createAndSend(email, 'reset_password');
  },

  /**
   * Verify password reset OTP
   */
  async verifyPasswordResetOtp(email: string, code: string): Promise<{ valid: boolean; error?: string }> {
    return otpService.verify(email, code, 'reset_password');
  },

  /**
   * Reset password with verified OTP (call verifyPasswordResetOtp first)
   */
  async resetPassword(email: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    const parent = await prisma.parent.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!parent) {
      return { success: false, error: 'Account not found' };
    }

    // Hash and update password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.parent.update({
      where: { id: parent.id },
      data: { passwordHash },
    });

    // Invalidate all sessions (force re-login)
    await sessionService.invalidateAllSessions(parent.id);

    logger.info(`Password reset for ${email}`);

    return { success: true };
  },

  /**
   * Change password (authenticated)
   */
  async changePassword(
    parentId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
    });

    if (!parent) {
      throw new NotFoundError('Account not found');
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, parent.passwordHash);

    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.parent.update({
      where: { id: parentId },
      data: { passwordHash },
    });

    // Invalidate all sessions (force re-login)
    await sessionService.invalidateAllSessions(parentId);
  },
};
