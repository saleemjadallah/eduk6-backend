// OTP (One-Time Password) service for email verification
import { redis } from '../../config/redis.js';
import { emailService } from './emailService.js';
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';

const OTP_PREFIX = 'otp:';
const OTP_ATTEMPTS_PREFIX = 'otp_attempts:';
const OTP_EXPIRY_SECONDS = 600; // 10 minutes
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 3600; // 1 hour

export type OtpPurpose = 'verify_email' | 'reset_password' | 'login';

interface StoredOtp {
  code: string;
  purpose: OtpPurpose;
  email: string;
  createdAt: string;
  attempts: number;
}

export const otpService = {
  /**
   * Generate a 6-digit OTP code
   */
  generateCode(): string {
    // Generate cryptographically secure 6-digit code
    const buffer = crypto.randomBytes(4);
    const num = buffer.readUInt32BE(0);
    const code = (num % 900000 + 100000).toString();
    return code;
  },

  /**
   * Create and send OTP to email
   */
  async createAndSend(
    email: string,
    purpose: OtpPurpose
  ): Promise<{ success: boolean; error?: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Check rate limiting
    const attemptsKey = `${OTP_ATTEMPTS_PREFIX}${normalizedEmail}:${purpose}`;
    const recentAttempts = await redis.get(attemptsKey);

    if (recentAttempts && parseInt(recentAttempts) >= MAX_ATTEMPTS) {
      logger.warn(`OTP rate limit exceeded for ${normalizedEmail}`);
      return {
        success: false,
        error: 'Too many OTP requests. Please try again later.',
      };
    }

    // Generate new OTP
    const code = this.generateCode();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;

    const otpData: StoredOtp = {
      code,
      purpose,
      email: normalizedEmail,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    // Store OTP in Redis
    await redis.setex(key, OTP_EXPIRY_SECONDS, JSON.stringify(otpData));

    // Increment rate limit counter
    await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, RATE_LIMIT_WINDOW);

    // Send email
    const sent = await emailService.sendOtpEmail(normalizedEmail, code, purpose);

    if (!sent) {
      return {
        success: false,
        error: 'Failed to send verification email. Please try again.',
      };
    }

    logger.info(`OTP created and sent for ${purpose}`, { email: normalizedEmail });

    return { success: true };
  },

  /**
   * Create and send OTP to teacher email (green themed)
   */
  async createAndSendForTeacher(
    email: string,
    purpose: OtpPurpose
  ): Promise<{ success: boolean; error?: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Check rate limiting
    const attemptsKey = `${OTP_ATTEMPTS_PREFIX}${normalizedEmail}:${purpose}`;
    const recentAttempts = await redis.get(attemptsKey);

    if (recentAttempts && parseInt(recentAttempts) >= MAX_ATTEMPTS) {
      logger.warn(`OTP rate limit exceeded for teacher ${normalizedEmail}`);
      return {
        success: false,
        error: 'Too many OTP requests. Please try again later.',
      };
    }

    // Generate new OTP
    const code = this.generateCode();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;

    const otpData: StoredOtp = {
      code,
      purpose,
      email: normalizedEmail,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    // Store OTP in Redis
    await redis.setex(key, OTP_EXPIRY_SECONDS, JSON.stringify(otpData));

    // Increment rate limit counter
    await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, RATE_LIMIT_WINDOW);

    // Send teacher-specific email (green themed)
    const sent = await emailService.sendTeacherOtpEmail(normalizedEmail, code, purpose);

    if (!sent) {
      return {
        success: false,
        error: 'Failed to send verification email. Please try again.',
      };
    }

    logger.info(`Teacher OTP created and sent for ${purpose}`, { email: normalizedEmail });

    return { success: true };
  },

  /**
   * Verify an OTP code
   */
  async verify(
    email: string,
    code: string,
    purpose: OtpPurpose
  ): Promise<{ valid: boolean; error?: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;

    // Get stored OTP
    const stored = await redis.get(key);

    if (!stored) {
      return {
        valid: false,
        error: 'Verification code expired or not found. Please request a new one.',
      };
    }

    const otpData: StoredOtp = JSON.parse(stored);

    // Check attempt count
    if (otpData.attempts >= MAX_ATTEMPTS) {
      await redis.del(key);
      return {
        valid: false,
        error: 'Too many failed attempts. Please request a new code.',
      };
    }

    // Verify code (constant-time comparison to prevent timing attacks)
    const isValid = crypto.timingSafeEqual(
      Buffer.from(code),
      Buffer.from(otpData.code)
    );

    if (!isValid) {
      // Increment attempts
      otpData.attempts++;
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        await redis.setex(key, ttl, JSON.stringify(otpData));
      }

      const remainingAttempts = MAX_ATTEMPTS - otpData.attempts;
      return {
        valid: false,
        error: `Invalid code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
      };
    }

    // OTP is valid - delete it (one-time use)
    await redis.del(key);

    logger.info(`OTP verified successfully for ${purpose}`, { email: normalizedEmail });

    return { valid: true };
  },

  /**
   * Check if there's a pending OTP for an email
   */
  async hasPendingOtp(email: string, purpose: OtpPurpose): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;
    const exists = await redis.exists(key);
    return exists === 1;
  },

  /**
   * Get remaining time for an OTP (in seconds)
   */
  async getRemainingTime(email: string, purpose: OtpPurpose): Promise<number> {
    const normalizedEmail = email.toLowerCase().trim();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;
    const ttl = await redis.ttl(key);
    return ttl > 0 ? ttl : 0;
  },

  /**
   * Cancel/invalidate an OTP
   */
  async cancel(email: string, purpose: OtpPurpose): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;
    await redis.del(key);
  },

  /**
   * Resend OTP (with cooldown check)
   */
  async resend(
    email: string,
    purpose: OtpPurpose,
    cooldownSeconds: number = 60
  ): Promise<{ success: boolean; error?: string; waitSeconds?: number }> {
    const normalizedEmail = email.toLowerCase().trim();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;

    // Check if there's an existing OTP
    const stored = await redis.get(key);

    if (stored) {
      const otpData: StoredOtp = JSON.parse(stored);
      const createdAt = new Date(otpData.createdAt).getTime();
      const elapsed = (Date.now() - createdAt) / 1000;

      if (elapsed < cooldownSeconds) {
        const waitSeconds = Math.ceil(cooldownSeconds - elapsed);
        return {
          success: false,
          error: `Please wait ${waitSeconds} seconds before requesting a new code.`,
          waitSeconds,
        };
      }
    }

    // Create and send new OTP
    return this.createAndSend(email, purpose);
  },

  /**
   * Resend OTP for teacher (with cooldown check, green themed)
   */
  async resendForTeacher(
    email: string,
    purpose: OtpPurpose,
    cooldownSeconds: number = 60
  ): Promise<{ success: boolean; error?: string; waitSeconds?: number }> {
    const normalizedEmail = email.toLowerCase().trim();
    const key = `${OTP_PREFIX}${normalizedEmail}:${purpose}`;

    // Check if there's an existing OTP
    const stored = await redis.get(key);

    if (stored) {
      const otpData: StoredOtp = JSON.parse(stored);
      const createdAt = new Date(otpData.createdAt).getTime();
      const elapsed = (Date.now() - createdAt) / 1000;

      if (elapsed < cooldownSeconds) {
        const waitSeconds = Math.ceil(cooldownSeconds - elapsed);
        return {
          success: false,
          error: `Please wait ${waitSeconds} seconds before requesting a new code.`,
          waitSeconds,
        };
      }
    }

    // Create and send new OTP with teacher theme
    return this.createAndSendForTeacher(email, purpose);
  },
};

export default otpService;
