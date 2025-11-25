// PostgreSQL connection via Prisma
import { PrismaClient } from '@prisma/client';
import { config } from './index.js';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Use singleton pattern to prevent multiple connections in development
export const prisma = global.prisma || new PrismaClient({
  log: config.debug ? ['query', 'info', 'warn', 'error'] : ['error'],
});

if (!config.isProduction) {
  global.prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
