// Session management service using Redis
import { redis } from '../../config/redis.js';
import { tokenService } from './tokenService.js';

export interface Session {
  userId: string;
  type: 'parent' | 'child';
  parentId?: string;
  refreshTokenId: string;
  createdAt: string;
  lastActivityAt: string;
  deviceInfo?: string;
  ipAddress?: string;
}

const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';

export const sessionService = {
  /**
   * Create a new session
   */
  async createSession(session: Omit<Session, 'createdAt' | 'lastActivityAt'>): Promise<void> {
    const now = new Date().toISOString();
    const fullSession: Session = {
      ...session,
      createdAt: now,
      lastActivityAt: now,
    };

    const key = `${SESSION_PREFIX}${session.refreshTokenId}`;
    const expiry = tokenService.getRefreshTokenExpirySeconds();

    // Store session data
    await redis.setex(key, expiry, JSON.stringify(fullSession));

    // Track active sessions per user
    await redis.sadd(`${USER_SESSIONS_PREFIX}${session.userId}`, session.refreshTokenId);
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

    if (session) {
      session.lastActivityAt = new Date().toISOString();
      const key = `${SESSION_PREFIX}${refreshTokenId}`;
      const ttl = await redis.ttl(key);

      if (ttl > 0) {
        await redis.setex(key, ttl, JSON.stringify(session));
      }
    }
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

    // Delete all session data
    const keys = sessionIds.map((id: string) => `${SESSION_PREFIX}${id}`);
    await redis.del(...keys);

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
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  },

  /**
   * Blacklist an access token (for logout)
   */
  async blacklistToken(token: string, expiresInSeconds: number): Promise<void> {
    await redis.setex(`blacklist:${token}`, expiresInSeconds, '1');
  },

  /**
   * Check if a token is blacklisted
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await redis.get(`blacklist:${token}`);
    return result !== null;
  },
};
