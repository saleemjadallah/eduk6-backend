// Teacher Authentication middleware
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { UnauthorizedError, ForbiddenError } from './errorHandler.js';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { TeacherRole } from '@prisma/client';

// JWT payload types for teachers
export interface TeacherAccessTokenPayload {
  sub: string;           // Teacher ID
  type: 'teacher';
  email: string;
  orgId?: string;        // Organization ID if applicable
  role: TeacherRole;
  iat: number;
  exp: number;
}

export interface TeacherRefreshTokenPayload {
  sub: string;
  type: 'teacher';
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
 * Verify teacher JWT token and attach teacher to request
 */
export async function authenticateTeacher(
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
    const payload = jwt.verify(token, config.jwtAccessSecret) as TeacherAccessTokenPayload;

    // Ensure this is a teacher token
    if (payload.type !== 'teacher') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Check if token is blacklisted (using hash for storage efficiency)
    const tokenHash = hashToken(token);
    const isBlacklisted = await redis.get(`blacklist:${tokenHash}`);
    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Attach teacher info to request
    req.sessionType = 'teacher';
    req.teacher = {
      id: payload.sub,
      email: payload.email,
      organizationId: payload.orgId,
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
 * Require teacher authentication
 */
export function requireTeacher(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.teacher) {
    throw new ForbiddenError('Teacher authentication required');
  }
  next();
}

/**
 * Require organization admin role
 */
export function requireOrgAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.teacher) {
    throw new ForbiddenError('Teacher authentication required');
  }

  if (!['ADMIN', 'SUPER_ADMIN'].includes(req.teacher.role)) {
    throw new ForbiddenError('Organization admin privileges required');
  }

  next();
}

/**
 * Require super admin role (can manage all orgs)
 */
export function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.teacher) {
    throw new ForbiddenError('Teacher authentication required');
  }

  if (req.teacher.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Super admin privileges required');
  }

  next();
}

/**
 * Verify that teacher belongs to the specified organization
 */
export function requireOrganization(orgIdParam: string = 'organizationId') {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.teacher) {
        throw new ForbiddenError('Teacher authentication required');
      }

      const orgId = req.params[orgIdParam] || req.body.organizationId;

      if (!orgId) {
        throw new ForbiddenError('Organization ID required');
      }

      // Check if teacher belongs to this organization
      if (req.teacher.organizationId !== orgId) {
        throw new ForbiddenError('Access denied to this organization');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Verify email is verified for teacher account
 */
export async function requireVerifiedEmail(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.teacher) {
      throw new ForbiddenError('Teacher authentication required');
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: req.teacher.id },
      select: { emailVerified: true },
    });

    if (!teacher) {
      throw new UnauthorizedError('Teacher not found');
    }

    if (!teacher.emailVerified) {
      throw new ForbiddenError('Email verification required');
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Verify teacher has an active subscription
 */
export async function requireActiveSubscription(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.teacher) {
      throw new ForbiddenError('Teacher authentication required');
    }

    const teacher = await prisma.teacher.findUnique({
      where: { id: req.teacher.id },
      select: {
        subscriptionStatus: true,
        subscriptionExpiresAt: true,
        organization: {
          select: {
            subscriptionStatus: true,
          },
        },
      },
    });

    if (!teacher) {
      throw new UnauthorizedError('Teacher not found');
    }

    // Check organization subscription first (if part of org)
    if (teacher.organization) {
      if (teacher.organization.subscriptionStatus !== 'ACTIVE') {
        throw new ForbiddenError('Organization subscription is not active');
      }
    } else {
      // Check individual subscription
      if (teacher.subscriptionStatus !== 'ACTIVE') {
        throw new ForbiddenError('Subscription is not active');
      }

      // Check expiration
      if (teacher.subscriptionExpiresAt && teacher.subscriptionExpiresAt < new Date()) {
        throw new ForbiddenError('Subscription has expired');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Generate teacher access token
 */
export function generateTeacherAccessToken(teacher: {
  id: string;
  email: string;
  organizationId?: string | null;
  role: TeacherRole;
}): string {
  const payload: Omit<TeacherAccessTokenPayload, 'iat' | 'exp'> = {
    sub: teacher.id,
    type: 'teacher',
    email: teacher.email,
    role: teacher.role,
  };

  if (teacher.organizationId) {
    payload.orgId = teacher.organizationId;
  }

  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessExpiry,
  });
}

/**
 * Generate teacher refresh token
 */
export function generateTeacherRefreshToken(teacherId: string): {
  token: string;
  jti: string;
  fid: string;
} {
  const jti = crypto.randomUUID();
  const fid = crypto.randomUUID();

  const payload: Omit<TeacherRefreshTokenPayload, 'iat' | 'exp'> = {
    sub: teacherId,
    type: 'teacher',
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
export async function blacklistToken(token: string, expiresInSeconds: number): Promise<void> {
  const tokenHash = hashToken(token);
  await redis.setex(`blacklist:${tokenHash}`, expiresInSeconds, '1');
}

/**
 * Verify refresh token and return payload
 */
export function verifyTeacherRefreshToken(token: string): TeacherRefreshTokenPayload {
  const payload = jwt.verify(token, config.jwtRefreshSecret) as TeacherRefreshTokenPayload;

  if (payload.type !== 'teacher') {
    throw new UnauthorizedError('Invalid token type');
  }

  return payload;
}
