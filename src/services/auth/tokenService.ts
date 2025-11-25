// JWT token generation and verification service
import jwt from 'jsonwebtoken';
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
}

export const tokenService = {
  /**
   * Generate access and refresh tokens for a parent
   */
  generateParentTokens(parentId: string): GenerateTokensResult {
    const refreshTokenId = uuidv4();

    const accessToken = jwt.sign(
      {
        sub: parentId,
        type: 'parent',
      } as Omit<AccessTokenPayload, 'iat' | 'exp'>,
      config.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = jwt.sign(
      {
        sub: parentId,
        type: 'parent',
        jti: refreshTokenId,
      } as Omit<RefreshTokenPayload, 'iat' | 'exp'>,
      config.jwtSecret,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    return { accessToken, refreshToken, refreshTokenId };
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
      config.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  },

  /**
   * Verify an access token
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, config.jwtSecret) as AccessTokenPayload;
  },

  /**
   * Verify a refresh token
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, config.jwtSecret) as RefreshTokenPayload;
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
};
