// NanoBanana K-6 AI Learning Platform - Backend Entry Point
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { config, validateEnv } from './config/index.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { logger } from './utils/logger.js';
import {
  errorHandler,
  notFoundHandler,
  standardRateLimit,
} from './middleware/index.js';
import { attachRequestId, requestLogger } from './middleware/requestLogger.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import childRoutes from './routes/child.routes.js';
import profileRoutes from './routes/profile.routes.js';
import parentRoutes from './routes/parent.routes.js';
import lessonRoutes from './routes/lesson.routes.js';
import chatRoutes from './routes/chat.routes.js';
import flashcardRoutes from './routes/flashcard.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import aiRoutes from './routes/ai.routes.js';
import exerciseRoutes from './routes/exercise.routes.js';
import noteRoutes from './routes/note.routes.js';
import safetyRoutes from './routes/safety.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import privacyRoutes from './routes/privacy.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import supportRoutes from './routes/support.routes.js';
import teacherRoutes from './routes/teacher/index.js';
import ocrRoutes from './routes/ocr.routes.js';
import webhookRoutes from './routes/webhook.routes.js';

// Services initialization
import { initializeContentProcessor, shutdownContentProcessor } from './services/learning/contentProcessor.js';
import { badgeService } from './services/gamification/badgeService.js';

// Validate environment
try {
  validateEnv();
} catch (error) {
  logger.error('Environment validation failed', { error });
  process.exit(1);
}

const app = express();

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Trust proxy - required for Railway/reverse proxy deployments
// This allows express-rate-limit to correctly identify users via X-Forwarded-For
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: config.allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Request ID and logging
app.use(attachRequestId);
app.use(requestLogger);

// Stripe webhooks need raw body for signature verification
// Must be registered BEFORE express.json() middleware
app.use('/api/webhooks/stripe-consent', express.raw({ type: 'application/json' }), webhookRoutes);
app.use('/api/webhooks/stripe-subscription', express.raw({ type: 'application/json' }), webhookRoutes);

// Body parsing (for all other routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting (global)
app.use(standardRateLimit);

// ============================================
// ROUTES
// ============================================

// Health check (no auth required)
app.get('/health', async (_req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis connection
    await redis.ping();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Service dependencies unavailable',
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/children', childRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/flashcards', flashcardRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/parent/safety', safetyRoutes);
app.use('/api/parent/settings', settingsRoutes);
app.use('/api/parent/privacy', privacyRoutes);
app.use('/api/parent/reports', reportsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/ocr', ocrRoutes);

// Teacher Portal routes
app.use('/api/teacher', teacherRoutes);

// TODO: Add remaining routes as they're implemented
// app.use('/api/gamification', gamificationRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// ============================================
// SERVER STARTUP
// ============================================

async function startServer(): Promise<void> {
  try {
    // Connect to database
    await prisma.$connect();
    logger.info('Database connected');

    // Connect to Redis
    await redis.ping();
    logger.info('Redis connected');

    // Initialize content processing queue
    try {
      initializeContentProcessor();
    } catch (error) {
      logger.warn('Content processor initialization skipped (Redis may not be available)');
    }

    // Initialize badges
    try {
      await badgeService.initializeBadges();
      logger.info('Badges initialized');
    } catch (error) {
      logger.warn('Badge initialization skipped');
    }

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`NanoBanana K-6 Backend running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Frontend URL: ${config.frontendUrl}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      server.close(async () => {
        try {
          await shutdownContentProcessor();
          await prisma.$disconnect();
          await redis.quit();
          logger.info('Server shut down successfully');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', { error });
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

startServer();

export default app;
