// Session management service using Redis
import { redis } from '../../config/redis.js';
import { tokenService } from './tokenService.js';
import { logger } from '../../utils/logger.js';

export interface Session {
  userId: string;
  type: 'parent' | 'child';
  parentId?: string;
  refreshTokenId: string;
  refreshTokenHash: string; // Hashed refresh token for secure storage
  tokenFamilyId: string; // For reuse detection
  createdAt: string;
  lastActivityAt: string;
  deviceInfo?: string;
  ipAddress?: string;
  rotationCount: number; // Track how many times token has been rotated
  isValid: boolean; // Flag to invalidate without deletion (for reuse detection)
}

const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';
const TOKEN_FAMILY_PREFIX = 'token_family:';

export const sessionService = {
  /**
   * Create a new session
   */
  async createSession(session: Omit<Session, 'createdAt' | 'lastActivityAt' | 'rotationCount' | 'isValid'>): Promise<void> {
    const now = new Date().toISOString();
    const fullSession: Session = {
      ...session,
      createdAt: now,
      lastActivityAt: now,
      rotationCount: 0,
      isValid: true,
    };

    const key = `${SESSION_PREFIX}${session.refreshTokenId}`;
    const expiry = tokenService.getRefreshTokenExpirySeconds();

    // Store session data
    await redis.setex(key, expiry, JSON.stringify(fullSession));

    // Track active sessions per user
    await redis.sadd(`${USER_SESSIONS_PREFIX}${session.userId}`, session.refreshTokenId);

    // Track token family for reuse detection
    await redis.setex(
      `${TOKEN_FAMILY_PREFIX}${session.tokenFamilyId}`,
      expiry,
      JSON.stringify({
        userId: session.userId,
        currentTokenId: session.refreshTokenId,
        createdAt: now,
      })
    );
  },

  /**
   * Get a session by refresh token ID
   */
  async getSession(refreshTokenId: string): Promise<Session | null> {
    const key = `${SESSION_PREFIX}${refreshTokenId}`;
    const data = await redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as Session;
  },

  /**
   * Update session activity timestamp
   */
  async updateSessionActivity(refreshTokenId: string): Promise<void> {
    const session = await this.getSession(refreshTokenId);

    if (session && session.isValid) {
      session.lastActivityAt = new Date().toISOString();
      const key = `${SESSION_PREFIX}${refreshTokenId}`;
      const ttl = await redis.ttl(key);

      if (ttl > 0) {
        await redis.setex(key, ttl, JSON.stringify(session));
      }
    }
  },

  /**
   * Rotate a session (after refresh token use)
   * Returns the new session with updated token info
   */
  async rotateSession(
    oldRefreshTokenId: string,
    newRefreshTokenId: string,
    newRefreshTokenHash: string,
    tokenFamilyId: string
  ): Promise<Session | null> {
    const oldSession = await this.getSession(oldRefreshTokenId);

    if (!oldSession) {
      return null;
    }

    // Check for token reuse - if the old token is already invalid
    if (!oldSession.isValid) {
      // Token reuse detected! Invalidate the entire family
      logger.warn(`Token reuse detected for user ${oldSession.userId}, family ${tokenFamilyId}`);
      await this.invalidateTokenFamily(tokenFamilyId, oldSession.userId);
      return null;
    }

    const now = new Date().toISOString();

    // Mark old session as invalid (for reuse detection)
    oldSession.isValid = false;
    const oldKey = `${SESSION_PREFIX}${oldRefreshTokenId}`;
    const oldTtl = await redis.ttl(oldKey);
    if (oldTtl > 0) {
      // Keep the old session briefly for reuse detection
      await redis.setex(oldKey, Math.min(oldTtl, 3600), JSON.stringify(oldSession));
    }

    // Create new session
    const newSession: Session = {
      ...oldSession,
      refreshTokenId: newRefreshTokenId,
      refreshTokenHash: newRefreshTokenHash,
      lastActivityAt: now,
      rotationCount: oldSession.rotationCount + 1,
      isValid: true,
    };

    const newKey = `${SESSION_PREFIX}${newRefreshTokenId}`;
    const expiry = tokenService.getRefreshTokenExpirySeconds();

    await redis.setex(newKey, expiry, JSON.stringify(newSession));

    // Update user sessions set
    await redis.srem(`${USER_SESSIONS_PREFIX}${oldSession.userId}`, oldRefreshTokenId);
    await redis.sadd(`${USER_SESSIONS_PREFIX}${oldSession.userId}`, newRefreshTokenId);

    // Update token family
    await redis.setex(
      `${TOKEN_FAMILY_PREFIX}${tokenFamilyId}`,
      expiry,
      JSON.stringify({
        userId: oldSession.userId,
        currentTokenId: newRefreshTokenId,
        updatedAt: now,
      })
    );

    return newSession;
  },

  /**
   * Invalidate an entire token family (for reuse detection)
   */
  async invalidateTokenFamily(tokenFamilyId: string, userId: string): Promise<void> {
    logger.warn(`Invalidating token family ${tokenFamilyId} for user ${userId}`);

    // Get all sessions for this user
    const sessionIds = await redis.smembers(`${USER_SESSIONS_PREFIX}${userId}`);

    // Delete sessions that belong to this family
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && session.tokenFamilyId === tokenFamilyId) {
        await redis.del(`${SESSION_PREFIX}${sessionId}`);
        await redis.srem(`${USER_SESSIONS_PREFIX}${userId}`, sessionId);
      }
    }

    // Delete the family record
    await redis.del(`${TOKEN_FAMILY_PREFIX}${tokenFamilyId}`);
  },

  /**
   * Invalidate a single session
   */
  async invalidateSession(refreshTokenId: string): Promise<void> {
    const session = await this.getSession(refreshTokenId);

    if (session) {
      const key = `${SESSION_PREFIX}${refreshTokenId}`;
      await redis.del(key);
      await redis.srem(`${USER_SESSIONS_PREFIX}${session.userId}`, refreshTokenId);
    }
  },

  /**
   * Invalidate all sessions for a user (logout everywhere)
   */
  async invalidateAllSessions(userId: string): Promise<number> {
    const sessionIds = await redis.smembers(`${USER_SESSIONS_PREFIX}${userId}`);

    if (sessionIds.length === 0) {
      return 0;
    }

    // Get all token families for this user
    const tokenFamilies = new Set<string>();
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session?.tokenFamilyId) {
        tokenFamilies.add(session.tokenFamilyId);
      }
    }

    // Delete all session data
    const keys = sessionIds.map((id: string) => `${SESSION_PREFIX}${id}`);
    await redis.del(...keys);

    // Delete all token families
    for (const familyId of tokenFamilies) {
      await redis.del(`${TOKEN_FAMILY_PREFIX}${familyId}`);
    }

    // Clear the user's session set
    await redis.del(`${USER_SESSIONS_PREFIX}${userId}`);

    return sessionIds.length;
  },

  /**
   * Get count of active sessions for a user
   */
  async getActiveSessionCount(userId: string): Promise<number> {
    return redis.scard(`${USER_SESSIONS_PREFIX}${userId}`);
  },

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    const sessionIds = await redis.smembers(`${USER_SESSIONS_PREFIX}${userId}`);
    const sessions: Session[] = [];

    for (const id of sessionIds) {
      const session = await this.getSession(id);
      if (session && session.isValid) {
        sessions.push(session);
      }
    }

    return sessions;
  },

  /**
   * Blacklist an access token (for logout)
   */
  async blacklistToken(token: string, expiresInSeconds: number): Promise<void> {
    const tokenHash = tokenService.hashRefreshToken(token); // Reuse hash function
    await redis.setex(`blacklist:${tokenHash}`, expiresInSeconds, '1');
  },

  /**
   * Check if a token is blacklisted
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const tokenHash = tokenService.hashRefreshToken(token);
    const result = await redis.get(`blacklist:${tokenHash}`);
    return result !== null;
  },

  /**
   * Validate refresh token hash matches stored hash
   */
  async validateRefreshTokenHash(refreshTokenId: string, tokenHash: string): Promise<boolean> {
    const session = await this.getSession(refreshTokenId);
    if (!session || !session.isValid) {
      return false;
    }
    return session.refreshTokenHash === tokenHash;
  },
};
