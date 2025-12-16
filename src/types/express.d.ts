// Express request extensions
import { Parent, Child, AgeGroup, TeacherRole, AdminRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      // Authenticated parent
      parent?: {
        id: string;
        email: string;
      };

      // Authenticated child session
      child?: {
        id: string;
        parentId: string;
        ageGroup: AgeGroup;
        displayName: string;
      };

      // Authenticated teacher
      teacher?: {
        id: string;
        email: string;
        organizationId?: string;
        role: TeacherRole;
      };

      // Authenticated admin (VC Analytics Dashboard)
      admin?: {
        id: string;
        email: string;
        role: AdminRole;
      };

      // Session type
      sessionType?: 'parent' | 'child' | 'teacher' | 'admin';

      // Token quota check result (set by quota middleware)
      quotaCheck?: {
        allowed: boolean;
        remainingTokens: bigint;
        estimatedCost: number;
        warning?: string;
      };

      // Request ID for logging
      requestId?: string;
    }
  }
}

export {};
