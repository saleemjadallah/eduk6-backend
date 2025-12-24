// Teacher routes index
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import quotaRoutes from './quota.routes.js';
import contentRoutes from './content.routes.js';
import exportRoutes from './export.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import audioUpdateRoutes from './audioUpdate.routes.js';
import subPlanRoutes from './subPlan.routes.js';
import iepGoalRoutes from './iepGoal.routes.js';

const router = Router();

// Mount teacher routes
router.use('/auth', authRoutes);
router.use('/quota', quotaRoutes);
router.use('/content', contentRoutes);
router.use('/export', exportRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/audio-updates', audioUpdateRoutes);
router.use('/sub-plans', subPlanRoutes);
router.use('/iep-goals', iepGoalRoutes);

// Future routes will be added here:
// router.use('/rubrics', rubricRoutes);
// router.use('/grading', gradingRoutes);

export default router;
