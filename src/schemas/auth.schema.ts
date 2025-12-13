// Zod schemas for auth validation
import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  country: z.string().length(2).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const verifyEmailSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const switchToChildSchema = z.object({
  pin: z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'PIN must be numeric'),
});

// Consent schemas
export const verifyCCConsentSchema = z.object({
  paymentIntentId: z.string().min(1),
});

export const verifyKBQConsentSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().min(1),
    answer: z.string().min(1),
  })).min(3).max(5),
});

// PIN reset schemas
export const resetChildPinSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  newPin: z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'PIN must be numeric'),
});

export const unlockChildPinSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

// KBQ reset schemas
export const resetKBQSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  answers: z.array(z.object({
    questionId: z.string().min(1),
    answer: z.string().min(1),
  })).min(3).max(5),
});

export const resetKBQViaCCSchema = z.object({
  paymentIntentId: z.string().min(1),
  answers: z.array(z.object({
    questionId: z.string().min(1),
    answer: z.string().min(1),
  })).min(3).max(5),
});

// Account deletion schema
export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required to confirm account deletion'),
});

// Type exports
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SwitchToChildInput = z.infer<typeof switchToChildSchema>;
export type VerifyCCConsentInput = z.infer<typeof verifyCCConsentSchema>;
export type VerifyKBQConsentInput = z.infer<typeof verifyKBQConsentSchema>;
export type ResetChildPinInput = z.infer<typeof resetChildPinSchema>;
export type UnlockChildPinInput = z.infer<typeof unlockChildPinSchema>;
export type ResetKBQInput = z.infer<typeof resetKBQSchema>;
export type ResetKBQViaCCInput = z.infer<typeof resetKBQViaCCSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
