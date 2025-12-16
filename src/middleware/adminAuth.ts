// Admin Authentication middleware for VC Analytics Dashboard
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { UnauthorizedError, ForbiddenError } from './errorHandler.js';
import { redis } from '../config/redis.js';
import { AdminRole } from '@prisma/client';

// JWT payload types for admins
export interface AdminAccessTokenPayload {
  sub: string;           // Admin ID
  type: 'admin';
  email: string;
  role: AdminRole;
  iat: number;
  exp: number;
}

export interface AdminRefreshTokenPayload {
  sub: string;
  type: 'admin';
  jti: string;           // Unique token ID for revocation
  fid: string;           // Token family ID for reuse detection
  iat: number;
  exp: number;
}

/**
 * Hash a token for blacklist comparison
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify admin JWT token and attach admin to request
 */
export async function authenticateAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.substring(7);

    // Verify token with the access token secret
    const payload = jwt.verify(token, config.jwtAccessSecret) as AdminAccessTokenPayload;

    // Ensure this is an admin token
    if (payload.type !== 'admin') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Check if token is blacklisted (using hash for storage efficiency)
    const tokenHash = hashToken(token);
    const isBlacklisted = await redis.get(`blacklist:${tokenHash}`);
    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Attach admin info to request
    req.sessionType = 'admin';
    req.admin = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else {
      next(error);
    }
  }
}

/**
 * Require admin authentication
 */
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.admin) {
    throw new ForbiddenError('Admin authentication required');
  }
  next();
}

/**
 * Require SUPER_ADMIN role (can create other admins)
 */
export function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.admin) {
    throw new ForbiddenError('Admin authentication required');
  }

  if (req.admin.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Super admin privileges required');
  }

  next();
}

/**
 * Generate admin access token (15 minute expiry)
 */
export function generateAdminAccessToken(admin: {
  id: string;
  email: string;
  role: AdminRole;
}): string {
  const payload: Omit<AdminAccessTokenPayload, 'iat' | 'exp'> = {
    sub: admin.id,
    type: 'admin',
    email: admin.email,
    role: admin.role,
  };

  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessExpiry,
  });
}

/**
 * Generate admin refresh token
 */
export function generateAdminRefreshToken(adminId: string): {
  token: string;
  jti: string;
  fid: string;
} {
  const jti = crypto.randomUUID();
  const fid = crypto.randomUUID();

  const payload: Omit<AdminRefreshTokenPayload, 'iat' | 'exp'> = {
    sub: adminId,
    type: 'admin',
    jti,
    fid,
  };

  const token = jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiry,
  });

  return { token, jti, fid };
}

/**
 * Blacklist a token (for logout/revocation)
 */
export async function blacklistAdminToken(token: string, expiresInSeconds: number): Promise<void> {
  const tokenHash = hashToken(token);
  await redis.setex(`blacklist:${tokenHash}`, expiresInSeconds, '1');
}

/**
 * Verify refresh token and return payload
 */
export function verifyAdminRefreshToken(token: string): AdminRefreshTokenPayload {
  const payload = jwt.verify(token, config.jwtRefreshSecret) as AdminRefreshTokenPayload;

  if (payload.type !== 'admin') {
    throw new UnauthorizedError('Invalid token type');
  }

  return payload;
}
