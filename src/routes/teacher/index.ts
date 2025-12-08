// Teacher routes index
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import quotaRoutes from './quota.routes.js';
import contentRoutes from './content.routes.js';
import exportRoutes from './export.routes.js';

const router = Router();

// Mount teacher routes
router.use('/auth', authRoutes);
router.use('/quota', quotaRoutes);
router.use('/content', contentRoutes);
router.use('/export', exportRoutes);

// Future routes will be added here:
// router.use('/rubrics', rubricRoutes);
// router.use('/grading', gradingRoutes);

export default router;
