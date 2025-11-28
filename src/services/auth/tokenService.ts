// JWT token generation and verification service
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/index.js';
import { AgeGroup } from '@prisma/client';
import type { AccessTokenPayload, RefreshTokenPayload } from '../../middleware/auth.js';

// Token expiry durations
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface GenerateTokensResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  refreshTokenHash: string;
}

export const tokenService = {
  /**
   * Hash a refresh token for secure storage
   * Uses SHA-256 to create a one-way hash
   */
  hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  },

  /**
   * Generate a cryptographically secure token family ID
   * Used for refresh token rotation and reuse detection
   */
  generateTokenFamilyId(): string {
    return crypto.randomBytes(16).toString('hex');
  },

  /**
   * Generate access and refresh tokens for a parent
   */
  generateParentTokens(parentId: string, tokenFamilyId?: string): GenerateTokensResult {
    const refreshTokenId = uuidv4();
    const familyId = tokenFamilyId || this.generateTokenFamilyId();

    const accessToken = jwt.sign(
      {
        sub: parentId,
        type: 'parent',
      } as Omit<AccessTokenPayload, 'iat' | 'exp'>,
      config.jwtAccessSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = jwt.sign(
      {
        sub: parentId,
        type: 'parent',
        jti: refreshTokenId,
        fid: familyId, // Token family ID for reuse detection
      } as Omit<RefreshTokenPayload, 'iat' | 'exp'>,
      config.jwtRefreshSecret,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    return {
      accessToken,
      refreshToken,
      refreshTokenId,
      refreshTokenHash: this.hashRefreshToken(refreshToken),
    };
  },

  /**
   * Generate access token for a child session
   */
  generateChildToken(
    childId: string,
    parentId: string,
    ageGroup: AgeGroup
  ): string {
    return jwt.sign(
      {
        sub: childId,
        type: 'child',
        parentId,
        ageGroup,
      } as Omit<AccessTokenPayload, 'iat' | 'exp'>,
      config.jwtAccessSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  },

  /**
   * Verify an access token
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, config.jwtAccessSecret) as AccessTokenPayload;
  },

  /**
   * Verify a refresh token
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, config.jwtRefreshSecret) as RefreshTokenPayload;
  },

  /**
   * Decode a token without verification (for inspection)
   */
  decodeToken(token: string): AccessTokenPayload | RefreshTokenPayload | null {
    return jwt.decode(token) as AccessTokenPayload | RefreshTokenPayload | null;
  },

  /**
   * Get refresh token expiry in seconds (for Redis TTL)
   */
  getRefreshTokenExpirySeconds(): number {
    return 7 * 24 * 60 * 60; // 7 days in seconds
  },

  /**
   * Get access token remaining TTL in seconds
   */
  getAccessTokenRemainingTTL(token: string): number {
    try {
      const decoded = jwt.decode(token) as { exp?: number };
      if (!decoded?.exp) return 0;
      const remaining = decoded.exp - Math.floor(Date.now() / 1000);
      return Math.max(0, remaining);
    } catch {
      return 0;
    }
  },
};
