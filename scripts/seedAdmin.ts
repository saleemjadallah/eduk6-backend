/**
 * Seed initial SUPER_ADMIN account for production
 *
 * Usage: npx tsx scripts/seedAdmin.ts
 *
 * Uses environment variables:
 *   ADMIN_EMAIL (default: admin@orbitlearn.com)
 *   ADMIN_PASSWORD (required for production - no default for security)
 *   ADMIN_NAME (default: Analytics Admin)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@orbitlearn.com';
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Analytics Admin';

  if (!password) {
    // For production, require explicit password
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ ADMIN_PASSWORD environment variable is required in production');
      process.exit(1);
    }
    // For development, use default
    console.log('⚠️  Using default password for development');
  }

  const finalPassword = password || 'AdminPassword123!';

  console.log('🔍 Checking for existing admin accounts...');

  // Check if admin already exists
  const existingAdmin = await prisma.admin.findFirst({
    where: { email: email.toLowerCase() }
  });

  if (existingAdmin) {
    console.log(`✅ Admin account already exists: ${existingAdmin.email}`);
    console.log(`   Role: ${existingAdmin.role}`);
    console.log(`   Created: ${existingAdmin.createdAt}`);
    return;
  }

  // Check if any admin exists
  const anyAdmin = await prisma.admin.findFirst();
  if (anyAdmin) {
    console.log(`ℹ️  An admin account already exists (${anyAdmin.email}). Skipping seed.`);
    return;
  }

  console.log('🔐 Creating SUPER_ADMIN account...');

  // Hash password
  const passwordHash = await bcrypt.hash(finalPassword, SALT_ROUNDS);

  // Create admin
  const admin = await prisma.admin.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      name,
      role: 'SUPER_ADMIN',
      emailVerified: true,
    },
  });

  console.log('✅ SUPER_ADMIN account created successfully!');
  console.log(`   Email: ${admin.email}`);
  console.log(`   Name: ${admin.name}`);
  console.log(`   Role: ${admin.role}`);
  console.log('');
  console.log('🔒 Login at: https://admin.orbitlearn.app/admin/login');
}

seedAdmin()
  .catch((error) => {
    console.error('❌ Error seeding admin:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
