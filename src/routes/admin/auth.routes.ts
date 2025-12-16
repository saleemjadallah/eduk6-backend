// Admin Authentication routes for VC Analytics Dashboard
import { Router, Request, Response, NextFunction } from 'express';
import { adminAuthService } from '../../services/admin/index.js';
import { authenticateAdmin, requireAdmin, requireSuperAdmin } from '../../middleware/adminAuth.js';
import { validateInput } from '../../middleware/validateInput.js';
import { authRateLimit } from '../../middleware/rateLimit.js';
import { z } from 'zod';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const adminLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

const createAdminSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().min(1, 'Name is required').max(100),
  role: z.enum(['SUPER_ADMIN', 'ANALYST']).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ANALYST']),
});

// ============================================
// AUTHENTICATION ROUTES
// ============================================

/**
 * POST /api/admin/auth/login
 * Admin login
 */
router.post(
  '/login',
  authRateLimit,
  validateInput(adminLoginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const deviceInfo = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await adminAuthService.login(email, password, deviceInfo, ipAddress);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          refreshToken: result.refreshToken,
          admin: result.admin,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  validateInput(refreshTokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const result = await adminAuthService.refreshTokens(refreshToken);

      res.json({
        success: true,
        data: {
          token: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/auth/logout
 * Invalidate current session
 */
router.post(
  '/logout',
  authenticateAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const accessToken = authHeader?.substring(7);
      const { refreshToken } = req.body;

      await adminAuthService.logout(refreshToken, accessToken);

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/auth/logout-all
 * Logout from all devices
 */
router.post(
  '/logout-all',
  authenticateAdmin,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminAuthService.logoutAll(req.admin!.id);

      res.json({
        success: true,
        message: `Logged out from ${result.sessionsInvalidated} sessions`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PROFILE ROUTES
// ============================================

/**
 * GET /api/admin/auth/me
 * Get current admin data
 */
router.get(
  '/me',
  authenticateAdmin,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = await adminAuthService.getCurrentAdmin(req.admin!.id);

      res.json({
        success: true,
        data: admin,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/auth/change-password
 * Change password (authenticated)
 */
router.post(
  '/change-password',
  authenticateAdmin,
  requireAdmin,
  validateInput(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      await adminAuthService.changePassword(req.admin!.id, currentPassword, newPassword);

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// SUPER_ADMIN ROUTES (Admin Management)
// ============================================

/**
 * GET /api/admin/auth/admins
 * List all admin accounts (SUPER_ADMIN only)
 */
router.get(
  '/admins',
  authenticateAdmin,
  requireSuperAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admins = await adminAuthService.listAdmins(req.admin!.id);

      res.json({
        success: true,
        data: admins,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/auth/admins
 * Create a new admin account (SUPER_ADMIN only)
 */
router.post(
  '/admins',
  authenticateAdmin,
  requireSuperAdmin,
  validateInput(createAdminSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminAuthService.createAdmin(req.admin!.id, req.body);

      res.status(201).json({
        success: true,
        data: result,
        message: 'Admin account created successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/auth/admins/:adminId/role
 * Update an admin's role (SUPER_ADMIN only)
 */
router.patch(
  '/admins/:adminId/role',
  authenticateAdmin,
  requireSuperAdmin,
  validateInput(updateRoleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { adminId } = req.params;
      const { role } = req.body;

      await adminAuthService.updateAdminRole(req.admin!.id, adminId, role);

      res.json({
        success: true,
        message: 'Admin role updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/admin/auth/admins/:adminId
 * Delete an admin account (SUPER_ADMIN only)
 */
router.delete(
  '/admins/:adminId',
  authenticateAdmin,
  requireSuperAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { adminId } = req.params;

      await adminAuthService.deleteAdmin(req.admin!.id, adminId);

      res.json({
        success: true,
        message: 'Admin account deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
