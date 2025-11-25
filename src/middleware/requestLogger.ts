// Request logging middleware
import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

// Attach request ID to each request
export function attachRequestId(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = uuidv4();
  next();
}

// Custom morgan tokens
morgan.token('request-id', (req: Request) => req.requestId || '-');
morgan.token('user-id', (req: Request) => {
  if (req.parent) return `parent:${req.parent.id}`;
  if (req.child) return `child:${req.child.id}`;
  return '-';
});

// Morgan format
const morganFormat = config.isProduction
  ? ':remote-addr - :user-id [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :request-id :response-time ms'
  : ':method :url :status :response-time ms - :res[content-length]';

// Create morgan middleware that streams to winston
export const requestLogger = morgan(morganFormat, {
  stream: {
    write: (message: string) => {
      logger.info(message.trim());
    },
  },
  // Skip health check logs in production
  skip: (req) => {
    if (config.isProduction && req.url === '/health') {
      return true;
    }
    return false;
  },
});
