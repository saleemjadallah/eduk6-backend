// Admin Authentication Service for VC Analytics Dashboard
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../../config/database.js';
import { sessionService } from '../auth/sessionService.js';
import {
  generateAdminAccessToken,
  generateAdminRefreshToken,
  verifyAdminRefreshToken,
  blacklistAdminToken,
} from '../../middleware/adminAuth.js';
import { UnauthorizedError, ConflictError, ValidationError, NotFoundError, ForbiddenError } from '../../middleware/errorHandler.js';
import { AdminRole } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12; // Stricter for admins

export interface AdminLoginResult {
  accessToken: string;
  refreshToken: string;
  admin: {
    id: string;
    email: string;
    name: string;
    role: AdminRole;
    emailVerified: boolean;
    lastLoginAt: Date | null;
  };
}

export interface CreateAdminParams {
  email: string;
  password: string;
  name: string;
  role?: AdminRole;
}

/**
 * Hash a refresh token for secure storage
 */
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const adminAuthService = {
  /**
   * Login an admin
   */
  async login(
    email: string,
    password: string,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<AdminLoginResult> {
    // Find admin
    const admin = await prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!admin) {
      // Log failed attempt
      logger.warn('Failed admin login attempt - email not found', { email: email.toLowerCase() });
      throw new UnauthorizedError('Invalid email or password');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, admin.passwordHash);

    if (!isValid) {
      logger.warn('Failed admin login attempt - invalid password', { email: email.toLowerCase(), adminId: admin.id });
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate tokens
    const accessToken = generateAdminAccessToken(admin);
    const { token: refreshToken, jti, fid } = generateAdminRefreshToken(admin.id);

    // Create session with hashed token
    await sessionService.createSession({
      userId: admin.id,
      type: 'admin',
      refreshTokenId: jti,
      refreshTokenHash: hashRefreshToken(refreshToken),
      tokenFamilyId: fid,
      deviceInfo,
      ipAddress,
    });

    // Update last login
    await prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    logger.info('Admin logged in successfully', { adminId: admin.id, email: admin.email, role: admin.role });

    return {
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        emailVerified: admin.emailVerified,
        lastLoginAt: admin.lastLoginAt,
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
      payload = verifyAdminRefreshToken(refreshToken);
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
      logger.warn(`Refresh token hash mismatch for admin ${session.userId}`);
      await sessionService.invalidateTokenFamily(payload.fid, session.userId);
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Get admin data for new access token
    const admin = await prisma.admin.findUnique({
      where: { id: payload.sub },
    });

    if (!admin) {
      throw new UnauthorizedError('Admin not found');
    }

    // Generate new tokens
    const newAccessToken = generateAdminAccessToken(admin);
    const { token: newRefreshToken, jti: newJti, fid: newFid } = generateAdminRefreshToken(admin.id);

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
      const payload = verifyAdminRefreshToken(refreshToken);
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
          await blacklistAdminToken(accessToken, expiresIn);
        }
      } catch {
        // Token might be invalid/expired, that's okay
      }
    }
  },

  /**
   * Logout from all devices
   */
  async logoutAll(adminId: string): Promise<{ sessionsInvalidated: number }> {
    const count = await sessionService.invalidateAllSessions(adminId);
    logger.info('Admin logged out from all devices', { adminId, sessionsInvalidated: count });
    return { sessionsInvalidated: count };
  },

  /**
   * Get current admin data
   */
  async getCurrentAdmin(adminId: string) {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new NotFoundError('Admin account not found');
    }

    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      emailVerified: admin.emailVerified,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
    };
  },

  /**
   * Create a new admin (SUPER_ADMIN only)
   */
  async createAdmin(
    creatorId: string,
    params: CreateAdminParams
  ): Promise<{ adminId: string; email: string }> {
    // Verify creator is SUPER_ADMIN
    const creator = await prisma.admin.findUnique({
      where: { id: creatorId },
    });

    if (!creator || creator.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Only Super Admins can create new admin accounts');
    }

    const { email, password, name, role = 'ANALYST' } = params;

    // Check if email already exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingAdmin) {
      throw new ConflictError('An admin with this email already exists');
    }

    // Validate password strength (stricter for admins)
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create admin account
    const admin = await prisma.admin.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        role,
        emailVerified: true, // Admins are pre-verified since created by SUPER_ADMIN
      },
    });

    logger.info('New admin account created', {
      creatorId,
      newAdminId: admin.id,
      newAdminEmail: admin.email,
      role: admin.role,
    });

    return {
      adminId: admin.id,
      email: admin.email,
    };
  },

  /**
   * Change password (authenticated)
   */
  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new NotFoundError('Admin account not found');
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, admin.passwordHash);

    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Validate new password (stricter for admins)
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.admin.update({
      where: { id: adminId },
      data: { passwordHash },
    });

    // Invalidate all sessions (force re-login)
    await sessionService.invalidateAllSessions(adminId);

    logger.info('Admin password changed', { adminId });
  },

  /**
   * List all admins (SUPER_ADMIN only)
   */
  async listAdmins(requesterId: string): Promise<Array<{
    id: string;
    email: string;
    name: string;
    role: AdminRole;
    emailVerified: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
  }>> {
    // Verify requester is SUPER_ADMIN
    const requester = await prisma.admin.findUnique({
      where: { id: requesterId },
    });

    if (!requester || requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Only Super Admins can list admin accounts');
    }

    const admins = await prisma.admin.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return admins;
  },

  /**
   * Update admin role (SUPER_ADMIN only)
   */
  async updateAdminRole(
    requesterId: string,
    targetAdminId: string,
    newRole: AdminRole
  ): Promise<void> {
    // Verify requester is SUPER_ADMIN
    const requester = await prisma.admin.findUnique({
      where: { id: requesterId },
    });

    if (!requester || requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Only Super Admins can modify admin roles');
    }

    // Cannot change own role
    if (requesterId === targetAdminId) {
      throw new ValidationError('Cannot change your own role');
    }

    // Verify target exists
    const target = await prisma.admin.findUnique({
      where: { id: targetAdminId },
    });

    if (!target) {
      throw new NotFoundError('Admin not found');
    }

    await prisma.admin.update({
      where: { id: targetAdminId },
      data: { role: newRole },
    });

    logger.info('Admin role updated', {
      requesterId,
      targetAdminId,
      previousRole: target.role,
      newRole,
    });
  },

  /**
   * Delete admin (SUPER_ADMIN only)
   */
  async deleteAdmin(requesterId: string, targetAdminId: string): Promise<void> {
    // Verify requester is SUPER_ADMIN
    const requester = await prisma.admin.findUnique({
      where: { id: requesterId },
    });

    if (!requester || requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Only Super Admins can delete admin accounts');
    }

    // Cannot delete self
    if (requesterId === targetAdminId) {
      throw new ValidationError('Cannot delete your own account');
    }

    // Verify target exists
    const target = await prisma.admin.findUnique({
      where: { id: targetAdminId },
    });

    if (!target) {
      throw new NotFoundError('Admin not found');
    }

    // Invalidate all sessions
    await sessionService.invalidateAllSessions(targetAdminId);

    // Delete admin
    await prisma.admin.delete({
      where: { id: targetAdminId },
    });

    logger.info('Admin account deleted', {
      requesterId,
      deletedAdminId: targetAdminId,
      deletedAdminEmail: target.email,
    });
  },

  /**
   * Seed initial SUPER_ADMIN account (for initial setup only)
   * This should only be called during initial deployment
   */
  async seedSuperAdmin(
    email: string,
    password: string,
    name: string
  ): Promise<{ adminId: string; email: string } | null> {
    // Check if any admin exists
    const existingAdmin = await prisma.admin.findFirst();

    if (existingAdmin) {
      logger.info('Admin account already exists, skipping seed');
      return null;
    }

    // Validate password
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create SUPER_ADMIN
    const admin = await prisma.admin.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        role: 'SUPER_ADMIN',
        emailVerified: true,
      },
    });

    logger.info('Initial SUPER_ADMIN account created', {
      adminId: admin.id,
      email: admin.email,
    });

    return {
      adminId: admin.id,
      email: admin.email,
    };
  },
};
