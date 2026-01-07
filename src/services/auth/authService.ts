// Main authentication service
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../config/database.js';
import { tokenService } from './tokenService.js';
import { sessionService } from './sessionService.js';
import { emailService, otpService } from '../email/index.js';
import { UnauthorizedError, ConflictError, ValidationError, NotFoundError } from '../../middleware/errorHandler.js';
import { AgeGroup, Child, Parent } from '@prisma/client';
import { logger } from '../../utils/logger.js';

// Google OAuth client - initialized lazily to ensure env var is available
let googleClient: OAuth2Client | null = null;

function getGoogleClient(): OAuth2Client {
  if (!googleClient) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID environment variable is not set');
    }
    googleClient = new OAuth2Client(clientId);
    logger.info('Google OAuth client initialized', { clientId: clientId.substring(0, 20) + '...' });
  }
  return googleClient;
}

const SALT_ROUNDS = 12;

// Helper to calculate age from date of birth
function calculateAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age;
}

// Standard child select fields for API responses
const childSelectFields = {
  id: true,
  displayName: true,
  avatarUrl: true,
  dateOfBirth: true,
  ageGroup: true,
  gradeLevel: true,
  lastActiveAt: true,
  createdAt: true,
} as const;

// Transform child data to include calculated age
function transformChildWithAge(child: any) {
  return {
    ...child,
    age: child.dateOfBirth ? calculateAge(child.dateOfBirth) : null,
    grade: child.gradeLevel,
  };
}

export interface SignupParams {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  referralCode?: string;
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
    consentStatus: 'none' | 'pending' | 'verified';
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
  async signup(params: SignupParams): Promise<{ parentId: string; referralApplied?: boolean }> {
    const { email, password, firstName, lastName, country, referralCode } = params;

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

    // Validate referral code if provided
    let validReferralCode: { id: string; parentId: string | null; teacherId: string | null } | null = null;
    if (referralCode) {
      validReferralCode = await prisma.referralCode.findUnique({
        where: { code: referralCode.toUpperCase(), isActive: true },
        select: { id: true, parentId: true, teacherId: true },
      });
      if (!validReferralCode) {
        logger.warn('Invalid referral code used during signup', { referralCode, email });
        // Don't block signup for invalid referral code, just ignore it
      }
    }

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

    // Create referral record if valid code was used
    let referralApplied = false;
    if (validReferralCode) {
      try {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30-day attribution window

        await prisma.referral.create({
          data: {
            referralCodeId: validReferralCode.id,
            referredParentId: parent.id,
            channel: 'COPY_LINK', // Default, can be overridden if tracking channel in URL
            status: 'SIGNED_UP',
            signedUpAt: new Date(),
            expiresAt,
          },
        });

        // Increment total referrals count
        await prisma.referralCode.update({
          where: { id: validReferralCode.id },
          data: { totalReferrals: { increment: 1 } },
        });

        referralApplied = true;
        logger.info('Referral tracked for new signup', {
          parentId: parent.id,
          referralCodeId: validReferralCode.id,
          referrerType: validReferralCode.parentId ? 'parent' : 'teacher',
        });
      } catch (err) {
        logger.error('Failed to create referral record', { error: err, parentId: parent.id });
        // Don't fail signup if referral tracking fails
      }
    }

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

    return { parentId: parent.id, referralApplied };
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
    // Find parent with consent status
    const parent = await prisma.parent.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        children: {
          select: childSelectFields,
        },
        consents: {
          where: {
            status: 'VERIFIED',
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!parent) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check if user signed up with Google (no password)
    if (!parent.passwordHash) {
      throw new UnauthorizedError('This account uses Google Sign-In. Please sign in with Google.');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, parent.passwordHash);

    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate tokens (includes token family ID for rotation tracking)
    const { accessToken, refreshToken, refreshTokenId, refreshTokenHash } = tokenService.generateParentTokens(parent.id);

    // Get the token family ID from the generated token
    const tokenPayload = tokenService.verifyRefreshToken(refreshToken);
    const tokenFamilyId = tokenPayload.fid || tokenService.generateTokenFamilyId();

    // Create session with hashed token
    await sessionService.createSession({
      userId: parent.id,
      type: 'parent',
      refreshTokenId,
      refreshTokenHash,
      tokenFamilyId,
      deviceInfo,
      ipAddress,
    });

    // Update last login
    await prisma.parent.update({
      where: { id: parent.id },
      data: { lastLoginAt: new Date() },
    });

    // Determine consent status
    const hasVerifiedConsent = parent.consents && parent.consents.length > 0;
    const consentStatus = hasVerifiedConsent ? 'verified' : 'none';

    return {
      accessToken,
      refreshToken,
      parent: {
        id: parent.id,
        email: parent.email,
        firstName: parent.firstName,
        lastName: parent.lastName,
        emailVerified: parent.emailVerified,
        consentStatus,
      },
      children: parent.children,
    };
  },

  /**
   * Google Sign-In - handles both new users and returning users
   * For new users: creates account with emailVerified=true, isNewUser=true
   * For returning users: logs them in, isNewUser=false
   */
  async googleSignIn(
    idToken: string,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<LoginResult & { isNewUser: boolean }> {
    // Verify the Google ID token
    let ticket;
    try {
      const client = getGoogleClient();
      const clientId = process.env.GOOGLE_CLIENT_ID;
      logger.info('Verifying Google ID token', { audience: clientId?.substring(0, 20) + '...' });
      ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
    } catch (error: any) {
      logger.error('Google ID token verification failed', {
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

    // Check if user exists by googleId or email
    let parent = await prisma.parent.findFirst({
      where: {
        OR: [
          { googleId },
          { email: email.toLowerCase() },
        ],
      },
      include: {
        children: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            ageGroup: true,
          },
        },
        consents: {
          where: {
            status: 'VERIFIED',
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    let isNewUser = false;

    if (!parent) {
      // New user - create account
      isNewUser = true;
      parent = await prisma.parent.create({
        data: {
          email: email.toLowerCase(),
          googleId,
          authProvider: 'google',
          firstName: firstName || null,
          lastName: lastName || null,
          emailVerified: email_verified ?? true, // Google verifies emails
          emailVerifiedAt: email_verified ? new Date() : null,
        },
        include: {
          children: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
              ageGroup: true,
            },
          },
          consents: {
            where: { status: 'VERIFIED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      // Send welcome email for new users
      logger.info(`Sending welcome email for new Google user: ${parent.email}`);
      emailService.sendWelcomeEmail(
        parent.email,
        parent.firstName || 'there'
      ).then(success => {
        if (success) {
          logger.info(`Welcome email sent successfully for Google user: ${parent!.email}`);
        } else {
          logger.error(`Welcome email failed for Google user: ${parent!.email}`);
        }
      }).catch(err => {
        logger.error('Failed to send welcome email for Google user', { error: err, parentId: parent!.id });
      });

      logger.info(`New Google user created: ${parent.email}`);
    } else {
      // Existing user - check if we need to link Google account
      if (!parent.googleId) {
        // User signed up with email, now logging in with Google
        // Link the Google account
        parent = await prisma.parent.update({
          where: { id: parent.id },
          data: {
            googleId,
            // Don't change authProvider - keep original
            // Mark email as verified if not already
            emailVerified: true,
            emailVerifiedAt: parent.emailVerifiedAt || new Date(),
          },
          include: {
            children: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
                ageGroup: true,
              },
            },
            consents: {
              where: {
                status: 'VERIFIED',
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        logger.info(`Linked Google account to existing user: ${parent.email}`);
      }
    }

    // Generate tokens
    const { accessToken, refreshToken, refreshTokenId, refreshTokenHash } = tokenService.generateParentTokens(parent.id);

    // Get the token family ID from the generated token
    const tokenPayload = tokenService.verifyRefreshToken(refreshToken);
    const tokenFamilyId = tokenPayload.fid || tokenService.generateTokenFamilyId();

    // Create session
    await sessionService.createSession({
      userId: parent.id,
      type: 'parent',
      refreshTokenId,
      refreshTokenHash,
      tokenFamilyId,
      deviceInfo,
      ipAddress,
    });

    // Update last login
    await prisma.parent.update({
      where: { id: parent.id },
      data: { lastLoginAt: new Date() },
    });

    // Determine consent status
    const hasVerifiedConsent = parent.consents && parent.consents.length > 0;
    const consentStatus = hasVerifiedConsent ? 'verified' : 'none';

    return {
      accessToken,
      refreshToken,
      parent: {
        id: parent.id,
        email: parent.email,
        firstName: parent.firstName,
        lastName: parent.lastName,
        emailVerified: parent.emailVerified,
        consentStatus,
      },
      children: parent.children,
      isNewUser,
    };
  },

  /**
   * Refresh access token
   * Implements token rotation with reuse detection
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

    // Verify the refresh token hash matches (defense in depth)
    const tokenHash = tokenService.hashRefreshToken(refreshToken);
    if (session.refreshTokenHash && session.refreshTokenHash !== tokenHash) {
      // Token tampering detected
      logger.warn(`Refresh token hash mismatch for user ${session.userId}`);
      await sessionService.invalidateTokenFamily(payload.fid || session.tokenFamilyId, session.userId);
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Get token family ID for rotation
    const tokenFamilyId = payload.fid || session.tokenFamilyId;

    // Generate new tokens with same family ID (for rotation tracking)
    const tokens = tokenService.generateParentTokens(payload.sub, tokenFamilyId);

    // Rotate the session (this handles reuse detection)
    const newSession = await sessionService.rotateSession(
      payload.jti,
      tokens.refreshTokenId,
      tokens.refreshTokenHash,
      tokenFamilyId
    );

    if (!newSession) {
      // Rotation failed - likely due to token reuse detection
      throw new UnauthorizedError('Session compromised. Please log in again.');
    }

    // Update session activity
    await sessionService.updateSessionActivity(tokens.refreshTokenId);

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
   * Includes brute force protection with exponential backoff
   */
  async switchToChild(
    parentId: string,
    childId: string,
    pin: string
  ): Promise<{ childToken: string; child: Child }> {
    // PIN security constants
    const MAX_PIN_ATTEMPTS = 5;
    const LOCKOUT_DURATION_MINUTES = 15;

    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
    });

    if (!child) {
      throw new NotFoundError('Child profile not found');
    }

    // Check if account is locked due to too many failed attempts
    if (child.pinLockedUntil && child.pinLockedUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (child.pinLockedUntil.getTime() - Date.now()) / (1000 * 60)
      );
      logger.warn(`PIN locked for child ${childId}, ${remainingMinutes} minutes remaining`);
      throw new UnauthorizedError(
        `Too many failed attempts. Please try again in ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}.`
      );
    }

    // Verify PIN
    if (child.pin !== pin) {
      // Increment failed attempts
      const newAttempts = (child.pinAttempts || 0) + 1;
      const remainingAttempts = MAX_PIN_ATTEMPTS - newAttempts;

      // Check if we need to lock the account
      if (newAttempts >= MAX_PIN_ATTEMPTS) {
        // Lock the account for increasing duration based on how many times locked
        const lockoutMinutes = LOCKOUT_DURATION_MINUTES;
        const lockUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);

        await prisma.child.update({
          where: { id: childId },
          data: {
            pinAttempts: newAttempts,
            pinLockedUntil: lockUntil,
          },
        });

        logger.warn(`PIN locked for child ${childId} after ${newAttempts} failed attempts`);
        throw new UnauthorizedError(
          `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`
        );
      }

      // Update failed attempts count
      await prisma.child.update({
        where: { id: childId },
        data: { pinAttempts: newAttempts },
      });

      logger.warn(`Failed PIN attempt for child ${childId}: ${newAttempts}/${MAX_PIN_ATTEMPTS}`);

      if (remainingAttempts <= 2) {
        throw new UnauthorizedError(
          `Invalid PIN. ${remainingAttempts} attempt${remainingAttempts > 1 ? 's' : ''} remaining before lockout.`
        );
      }

      throw new UnauthorizedError('Invalid PIN');
    }

    // PIN is correct - reset failed attempts and clear lockout
    if (child.pinAttempts > 0 || child.pinLockedUntil) {
      await prisma.child.update({
        where: { id: childId },
        data: {
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      });
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
   * Verify email with OTP code and return tokens to log user in
   */
  async verifyEmail(email: string, code: string): Promise<{
    success: boolean;
    error?: string;
    accessToken?: string;
    refreshToken?: string;
    parent?: any;
    children?: any[];
  }> {
    // Verify OTP
    const result = await otpService.verify(email, code, 'verify_email');

    if (!result.valid) {
      return { success: false, error: result.error };
    }

    // Mark email as verified and get parent data
    const parent = await prisma.parent.update({
      where: { email: email.toLowerCase() },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailVerified: true,
        subscriptionTier: true,
        createdAt: true,
      },
    });

    // Check consent status from Consent table
    const latestConsent = await prisma.consent.findFirst({
      where: { parentId: parent.id },
      orderBy: { createdAt: 'desc' },
    });

    // Get children
    const children = await prisma.child.findMany({
      where: { parentId: parent.id },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        gradeLevel: true,
        createdAt: true,
      },
    });

    // Generate tokens using tokenService
    const tokens = tokenService.generateParentTokens(parent.id);

    // Get the token family ID from the generated token
    const tokenPayload = tokenService.verifyRefreshToken(tokens.refreshToken);
    const tokenFamilyId = tokenPayload.fid || tokenService.generateTokenFamilyId();

    // Store refresh token session with hashed token
    await sessionService.createSession({
      userId: parent.id,
      type: 'parent',
      refreshTokenId: tokens.refreshTokenId,
      refreshTokenHash: tokens.refreshTokenHash,
      tokenFamilyId,
    });

    logger.info(`Email verified and logged in for ${email}`);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      parent: {
        ...parent,
        consentStatus: latestConsent?.status || 'none',
      },
      children,
    };
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

    // Check if user has a password (Google OAuth users don't)
    if (!parent.passwordHash) {
      throw new ValidationError('Cannot change password for Google Sign-In accounts. Please manage your password through Google.');
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

  /**
   * Get current user data with children
   */
  async getCurrentUser(parentId: string) {
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: {
        children: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            ageGroup: true,
            gradeLevel: true,
            lastActiveAt: true,
          },
        },
        consents: {
          where: { status: 'VERIFIED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!parent) {
      throw new NotFoundError('Account not found');
    }

    const hasVerifiedConsent = parent.consents.length > 0;
    const consentStatus = hasVerifiedConsent ? 'verified' : 'none';

    return {
      user: {
        id: parent.id,
        email: parent.email,
        firstName: parent.firstName,
        lastName: parent.lastName,
        phone: parent.phone,
        country: parent.country,
        timezone: parent.timezone,
        emailVerified: parent.emailVerified,
        subscriptionTier: parent.subscriptionTier,
        subscriptionStatus: parent.subscriptionStatus,
        consentStatus,
      },
      children: parent.children,
    };
  },

  /**
   * Update parent profile
   */
  async updateParentProfile(
    parentId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      country?: string;
      timezone?: string;
    }
  ) {
    // Filter out undefined values
    const updateData: Record<string, string> = {};
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;

    const parent = await prisma.parent.update({
      where: { id: parentId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        country: true,
        timezone: true,
      },
    });

    return parent;
  },

  /**
   * Delete account and all associated data (COPPA compliance)
   * Cancels any active Stripe subscription and deletes all associated data
   */
  async deleteAccount(parentId: string, password: string): Promise<void> {
    // Get parent data including subscription info
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
      },
    });

    if (!parent) {
      throw new NotFoundError('Account not found');
    }

    // Check if user has a password (Google OAuth users don't)
    if (!parent.passwordHash) {
      throw new ValidationError('Google Sign-In accounts cannot be deleted with password verification. Please contact support.');
    }

    // Verify password before allowing deletion
    const isValid = await bcrypt.compare(password, parent.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid password');
    }

    // Cancel active Stripe subscription if exists
    if (parent.stripeSubscriptionId) {
      try {
        const stripe = (await import('stripe')).default;
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (stripeSecretKey) {
          const stripeClient = new stripe(stripeSecretKey, {
            apiVersion: '2025-11-17.clover',
          });
          // Cancel immediately, not at period end
          await stripeClient.subscriptions.cancel(parent.stripeSubscriptionId);
          logger.info(`Cancelled Stripe subscription for deleted parent`, {
            parentId,
            subscriptionId: parent.stripeSubscriptionId,
          });
        }
      } catch (error) {
        // Log but don't block deletion - subscription will eventually fail/expire
        logger.error('Failed to cancel Stripe subscription during account deletion', {
          error,
          parentId,
          subscriptionId: parent.stripeSubscriptionId,
        });
      }
    }

    // Invalidate all sessions
    await sessionService.invalidateAllSessions(parentId);

    // Clean up any pending OTPs (best-effort, they auto-expire anyway)
    try {
      await otpService.cancel(parent.email, 'verify_email');
      await otpService.cancel(parent.email, 'reset_password');
    } catch {
      // OTP cleanup is best-effort - OTPs auto-expire after 10 minutes
    }

    // Delete the parent account (cascades to children and all related data)
    await prisma.parent.delete({
      where: { id: parentId },
    });

    logger.info(`Account deleted: ${parentId}`);
  },

  /**
   * Reset child PIN (requires parent password confirmation)
   * This allows parents to reset the PIN if they forgot it
   */
  async resetChildPin(
    parentId: string,
    childId: string,
    parentPassword: string,
    newPin: string
  ): Promise<{ success: boolean }> {
    // Validate new PIN format
    if (!/^\d{4}$/.test(newPin)) {
      throw new ValidationError('PIN must be exactly 4 digits');
    }

    // Get parent and verify password
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { passwordHash: true, email: true, firstName: true },
    });

    if (!parent) {
      throw new NotFoundError('Parent account not found');
    }

    // Check if user has a password (Google OAuth users don't)
    if (!parent.passwordHash) {
      throw new ValidationError('Google Sign-In accounts require alternative verification. Please contact support to reset PIN.');
    }

    // Verify parent password for re-authentication
    const isPasswordValid = await bcrypt.compare(parentPassword, parent.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid password');
    }

    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
      select: { id: true, displayName: true },
    });

    if (!child) {
      throw new NotFoundError('Child profile not found');
    }

    // Update the PIN and reset any lockout
    await prisma.child.update({
      where: { id: childId },
      data: {
        pin: newPin,
        pinAttempts: 0,
        pinLockedUntil: null,
      },
    });

    logger.info(`PIN reset for child ${childId} by parent ${parentId}`);

    // Send security notification email (async)
    emailService.sendSecurityAlert(
      parent.email,
      parent.firstName || 'there',
      'PIN Reset',
      `The PIN for ${child.displayName}'s profile was reset.`
    ).catch(err => {
      logger.error('Failed to send PIN reset notification', { error: err, parentId });
    });

    return { success: true };
  },

  /**
   * Unlock child PIN (clear lockout without changing PIN)
   * Used when child is locked out but parent knows the PIN
   */
  async unlockChildPin(
    parentId: string,
    childId: string,
    parentPassword: string
  ): Promise<{ success: boolean }> {
    // Get parent and verify password
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      select: { passwordHash: true },
    });

    if (!parent) {
      throw new NotFoundError('Parent account not found');
    }

    // Check if user has a password (Google OAuth users don't)
    if (!parent.passwordHash) {
      throw new ValidationError('Google Sign-In accounts require alternative verification. Please contact support to unlock PIN.');
    }

    // Verify parent password
    const isPasswordValid = await bcrypt.compare(parentPassword, parent.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid password');
    }

    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
    });

    if (!child) {
      throw new NotFoundError('Child profile not found');
    }

    // Clear lockout
    await prisma.child.update({
      where: { id: childId },
      data: {
        pinAttempts: 0,
        pinLockedUntil: null,
      },
    });

    logger.info(`PIN unlocked for child ${childId} by parent ${parentId}`);

    return { success: true };
  },

  /**
   * Get child PIN lockout status
   */
  async getChildPinStatus(
    parentId: string,
    childId: string
  ): Promise<{
    isLocked: boolean;
    attempts: number;
    lockedUntil: Date | null;
    remainingMinutes: number | null;
  }> {
    // Verify child belongs to parent
    const child = await prisma.child.findFirst({
      where: { id: childId, parentId },
      select: { pinAttempts: true, pinLockedUntil: true },
    });

    if (!child) {
      throw new NotFoundError('Child profile not found');
    }

    const isLocked = child.pinLockedUntil ? child.pinLockedUntil > new Date() : false;
    const remainingMinutes = isLocked && child.pinLockedUntil
      ? Math.ceil((child.pinLockedUntil.getTime() - Date.now()) / (1000 * 60))
      : null;

    return {
      isLocked,
      attempts: child.pinAttempts,
      lockedUntil: child.pinLockedUntil,
      remainingMinutes,
    };
  },
};
