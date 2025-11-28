// Authentication middleware
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { UnauthorizedError, ForbiddenError } from './errorHandler.js';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { AgeGroup } from '@prisma/client';

// JWT payload types
export interface AccessTokenPayload {
  sub: string;           // User ID (parent or child)
  type: 'parent' | 'child';
  parentId?: string;     // For child tokens, reference to parent
  ageGroup?: AgeGroup;   // For child tokens
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'parent' | 'child';
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
 * Verify JWT token and attach user to request
 */
export async function authenticate(
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
    const payload = jwt.verify(token, config.jwtAccessSecret) as AccessTokenPayload;

    // Check if token is blacklisted (using hash for storage efficiency)
    const tokenHash = hashToken(token);
    const isBlacklisted = await redis.get(`blacklist:${tokenHash}`);
    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Attach user info to request
    req.sessionType = payload.type;

    if (payload.type === 'parent') {
      req.parent = {
        id: payload.sub,
        email: '', // Will be populated if needed
      };
    } else if (payload.type === 'child') {
      req.child = {
        id: payload.sub,
        parentId: payload.parentId!,
        ageGroup: payload.ageGroup!,
        displayName: '', // Will be populated if needed
      };
    }

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
 * Require parent authentication
 */
export function requireParent(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.parent) {
    throw new ForbiddenError('Parent authentication required');
  }
  next();
}

/**
 * Require child session authentication
 */
export function requireChild(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.child) {
    throw new ForbiddenError('Child session required');
  }
  next();
}

/**
 * Require verified parental consent (COPPA compliance)
 */
export async function requireConsent(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parentId = req.parent?.id || req.child?.parentId;

    if (!parentId) {
      throw new ForbiddenError('Authentication required');
    }

    // Check for verified consent
    const consent = await prisma.consent.findFirst({
      where: {
        parentId,
        status: 'VERIFIED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    if (!consent) {
      throw new ForbiddenError('Verified parental consent required');
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Verify that the authenticated user has access to a specific child
 */
export function authorizeChildAccess(childIdParam: string = 'childId') {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const childId = req.params[childIdParam] || req.body.childId;

      if (!childId) {
        throw new ForbiddenError('Child ID required');
      }

      // If it's a child session, verify it's the same child
      if (req.child) {
        if (req.child.id !== childId) {
          throw new ForbiddenError('Access denied to this child profile');
        }
        next();
        return;
      }

      // If it's a parent, verify the child belongs to them
      if (req.parent) {
        const child = await prisma.child.findFirst({
          where: {
            id: childId,
            parentId: req.parent.id,
          },
        });

        if (!child) {
          throw new ForbiddenError('Access denied to this child profile');
        }

        next();
        return;
      }

      throw new ForbiddenError('Authentication required');
    } catch (error) {
      next(error);
    }
  };
}
