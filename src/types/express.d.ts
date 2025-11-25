// Express request extensions
import { Parent, Child, AgeGroup } from '@prisma/client';

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

      // Session type
      sessionType?: 'parent' | 'child';

      // Request ID for logging
      requestId?: string;
    }
  }
}

export {};
