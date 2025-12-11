/**
 * Parent Routes Index
 *
 * Exports all parent-related routes for mounting in the main app.
 */

import { Router } from 'express';
import subscriptionRoutes from './subscription.routes.js';

const router = Router();

// Mount subscription routes
router.use('/subscription', subscriptionRoutes);

export default router;
