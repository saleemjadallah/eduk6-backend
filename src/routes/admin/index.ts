// Admin routes index for VC Analytics Dashboard
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import analyticsRoutes from './analytics.routes.js';

const router = Router();

// Mount admin routes
router.use('/auth', authRoutes);
router.use('/analytics', analyticsRoutes);

export default router;
