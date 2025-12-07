// Token Quota Enforcement Middleware
import { Request, Response, NextFunction } from 'express';
import { quotaService } from '../services/teacher/index.js';
import { TokenOperation } from '@prisma/client';
import { PaymentRequiredError, ForbiddenError } from './errorHandler.js';

/**
 * Middleware to check and enforce token quota before AI operations
 * @param operation - The type of token operation
 * @param estimatedTokens - Optional estimated tokens (will use defaults if not provided)
 */
export function enforceTokenQuota(operation: TokenOperation, estimatedTokens?: number) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.teacher) {
        throw new ForbiddenError('Teacher authentication required');
      }

      const check = await quotaService.checkQuota(req.teacher.id, operation, estimatedTokens);

      if (!check.allowed) {
        throw new PaymentRequiredError(
          `Token quota exceeded. You have ${check.remainingTokens} tokens remaining. ` +
          `Your quota resets on ${check.quotaResetDate.toLocaleDateString()}.`
        );
      }

      // Attach quota check result to request for use in route handlers
      req.quotaCheck = {
        allowed: check.allowed,
        remainingTokens: check.remainingTokens,
        estimatedCost: check.estimatedCost,
        warning: check.warning,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to dynamically check quota based on request body
 * Useful when token estimate depends on input content
 */
export function enforceTokenQuotaDynamic(
  operation: TokenOperation,
  getEstimate: (req: Request) => number
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.teacher) {
        throw new ForbiddenError('Teacher authentication required');
      }

      const estimatedTokens = getEstimate(req);
      const check = await quotaService.checkQuota(req.teacher.id, operation, estimatedTokens);

      if (!check.allowed) {
        throw new PaymentRequiredError(
          `Token quota exceeded. This operation requires approximately ${estimatedTokens} tokens, ` +
          `but you only have ${check.remainingTokens} remaining.`
        );
      }

      req.quotaCheck = {
        allowed: check.allowed,
        remainingTokens: check.remainingTokens,
        estimatedCost: check.estimatedCost,
        warning: check.warning,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Helper to estimate tokens from text content in request body
 */
export function estimateFromContent(contentField: string = 'content') {
  return (req: Request): number => {
    const content = req.body[contentField];
    if (!content || typeof content !== 'string') {
      return 1000; // Default estimate
    }
    return quotaService.estimateTokens(content);
  };
}

/**
 * Helper to estimate tokens for grading operations
 */
export function estimateForGrading(submissionField: string = 'submissions') {
  return (req: Request): number => {
    const submissions = req.body[submissionField];
    if (!Array.isArray(submissions)) {
      return 3000; // Single submission estimate
    }
    // ~3000 tokens per submission on average
    return submissions.length * 3000;
  };
}
