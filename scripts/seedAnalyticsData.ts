/**
 * seedAnalyticsData.ts - Generate realistic historical data for VC Analytics Dashboard
 *
 * Generates:
 * - ~500 parent accounts (staggered signups over 6 months)
 * - ~800 children profiles
 * - ActivitySessions for DAU/WAU/MAU tracking
 * - Realistic retention curve (50% M1, 35% M2, 28% M3)
 * - 15% free-to-paid conversion
 * - Geographic distribution: UAE 60%, Saudi 25%, Qatar 15%
 *
 * Usage:
 *   npx tsx scripts/seedAnalyticsData.ts          # Full run (deletes existing test data)
 *   npx tsx scripts/seedAnalyticsData.ts --resume # Resume from where it left off
 *   npx tsx scripts/seedAnalyticsData.ts --clean  # Only delete test data
 */

// Parse command line arguments
const args = process.argv.slice(2);
const RESUME_MODE = args.includes('--resume');
const CLEAN_ONLY = args.includes('--clean');

import { PrismaClient, SubscriptionTier, AgeGroup, CurriculumType, Subject, SourceType, ProcessingStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Configuration
const CONFIG = {
  totalParents: 500,
  avgChildrenPerParent: 1.6, // ~800 children total
  monthsOfData: 6,
  freeToTrialRate: 0.25, // 25% try trial
  trialToPaidRate: 0.60, // 60% convert after trial
  retentionCurve: [1.0, 0.50, 0.35, 0.28, 0.24, 0.21, 0.19], // M0 to M6
  geoDistribution: {
    AE: 0.60,  // UAE
    SA: 0.25,  // Saudi Arabia
    QA: 0.10,  // Qatar
    KW: 0.05,  // Kuwait
  },
  curriculumDistribution: {
    BRITISH: 0.40,
    AMERICAN: 0.25,
    IB: 0.15,
    INDIAN_CBSE: 0.10,
    ARABIC: 0.10,
  },
  tierDistribution: { // After conversions
    FREE: 0.85,
    FAMILY: 0.10,
    FAMILY_PLUS: 0.05,
  },
  avgSessionsPerActiveDay: 1.5,
  avgSessionDuration: 25, // minutes
};

// Utility functions
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedChoice<T>(options: { item: T; weight: number }[]): T {
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
  let random = Math.random() * totalWeight;
  for (const option of options) {
    random -= option.weight;
    if (random <= 0) return option.item;
  }
  return options[options.length - 1].item;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function getDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// Names for realistic-looking data
const FIRST_NAMES = [
  'Ahmed', 'Mohammed', 'Ali', 'Omar', 'Yusuf', 'Hassan', 'Khalid', 'Ibrahim', 'Saeed', 'Majid',
  'Fatima', 'Aisha', 'Maryam', 'Sara', 'Noor', 'Layla', 'Hana', 'Dana', 'Reem', 'Lina',
  'Sarah', 'Emily', 'Michael', 'James', 'David', 'Sophie', 'Emma', 'William', 'Oliver', 'Charlotte',
];

const LAST_NAMES = [
  'Al-Hassan', 'Al-Rashid', 'Al-Farsi', 'Al-Mansouri', 'Al-Qassim', 'Al-Shamsi', 'Al-Nuaimi',
  'Abdullah', 'Mohammed', 'Ahmed', 'Khan', 'Patel', 'Singh', 'Sharma', 'Smith', 'Johnson',
];

const CHILD_DISPLAY_NAMES = [
  'Banana Explorer', 'Star Learner', 'Math Wizard', 'Science Star', 'Reading Champion',
  'Curious Cat', 'Smart Cookie', 'Bright Spark', 'Quick Thinker', 'Happy Helper',
  'Super Scholar', 'Brain Power', 'Knowledge King', 'Learning Lion', 'Wisdom Owl',
  'Clever Fox', 'Eager Beaver', 'Mighty Mind', 'Captain Clever', 'Professor Panda',
];

const PLATFORMS = ['web', 'ios', 'android'];
const DEVICE_TYPES = ['desktop', 'mobile', 'tablet'];

// Generate parent accounts with realistic distribution
async function generateParents(): Promise<string[]> {
  console.log('Generating parent accounts...');
  const parentIds: string[] = [];
  const endDate = new Date();
  const startDate = addMonths(endDate, -CONFIG.monthsOfData);

  // Distribute signups with growth curve (more recent = more signups)
  const signupDates: Date[] = [];
  for (let i = 0; i < CONFIG.totalParents; i++) {
    // Exponential growth: more signups in recent months
    const progress = Math.pow(Math.random(), 0.5); // Bias toward recent
    const signupDate = new Date(startDate.getTime() + progress * (endDate.getTime() - startDate.getTime()));
    signupDates.push(signupDate);
  }
  signupDates.sort((a, b) => a.getTime() - b.getTime());

  // Country options with weights
  const countryOptions = Object.entries(CONFIG.geoDistribution).map(([country, weight]) => ({
    item: country,
    weight,
  }));

  const passwordHash = await bcrypt.hash('TestPassword123', 10);

  for (let i = 0; i < CONFIG.totalParents; i++) {
    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);
    const country = weightedChoice(countryOptions);
    const signupDate = signupDates[i];

    // Determine subscription tier based on time and conversion rates
    const monthsSinceSignup = Math.floor((endDate.getTime() - signupDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
    let tier: SubscriptionTier = SubscriptionTier.FREE;
    let trialEndsAt: Date | null = null;

    // Conversion logic
    if (Math.random() < CONFIG.freeToTrialRate && monthsSinceSignup >= 1) {
      // Started a trial
      if (Math.random() < CONFIG.trialToPaidRate) {
        // Converted to paid
        tier = Math.random() < 0.67 ? SubscriptionTier.FAMILY : SubscriptionTier.FAMILY_PLUS;
      } else {
        // Still on free after trial
        tier = SubscriptionTier.FREE;
      }
    }

    const parent = await prisma.parent.create({
      data: {
        email: `parent_${i}_${Date.now()}@test.orbitlearn.com`,
        passwordHash,
        firstName,
        lastName,
        country,
        timezone: country === 'AE' ? 'Asia/Dubai' : country === 'SA' ? 'Asia/Riyadh' : 'Asia/Qatar',
        emailVerified: true,
        emailVerifiedAt: signupDate,
        subscriptionTier: tier,
        subscriptionStatus: 'ACTIVE',
        trialEndsAt,
        createdAt: signupDate,
        updatedAt: signupDate,
        lastLoginAt: addDays(signupDate, randomInt(0, Math.min(30, monthsSinceSignup * 30))),
      },
    });

    parentIds.push(parent.id);

    if ((i + 1) % 100 === 0) {
      console.log(`  Created ${i + 1}/${CONFIG.totalParents} parents`);
    }
  }

  return parentIds;
}

// Generate children for parents
async function generateChildren(parentIds: string[]): Promise<Map<string, string[]>> {
  console.log('Generating children profiles...');
  const parentChildMap = new Map<string, string[]>();

  const curriculumOptions = Object.entries(CONFIG.curriculumDistribution).map(([curriculum, weight]) => ({
    item: curriculum as CurriculumType,
    weight,
  }));

  for (const parentId of parentIds) {
    const parent = await prisma.parent.findUnique({ where: { id: parentId } });
    if (!parent) continue;

    const numChildren = Math.random() < 0.6 ? 1 : Math.random() < 0.7 ? 2 : 3;
    const childIds: string[] = [];

    for (let i = 0; i < numChildren; i++) {
      // Age between 4 and 12
      const age = randomInt(4, 12);
      const dateOfBirth = new Date();
      dateOfBirth.setFullYear(dateOfBirth.getFullYear() - age);

      const child = await prisma.child.create({
        data: {
          parentId,
          displayName: randomChoice(CHILD_DISPLAY_NAMES),
          pin: String(randomInt(1000, 9999)),
          dateOfBirth,
          ageGroup: age <= 7 ? AgeGroup.YOUNG : AgeGroup.OLDER,
          gradeLevel: Math.min(6, Math.max(1, age - 5)),
          curriculumType: weightedChoice(curriculumOptions),
          preferredLanguage: 'en',
          voiceEnabled: true,
          avatarVisible: true,
          createdAt: parent.createdAt,
          updatedAt: parent.createdAt,
        },
      });

      childIds.push(child.id);

      // Create initial progress record
      await prisma.userProgress.create({
        data: {
          childId: child.id,
          currentXP: randomInt(0, 5000),
          totalXP: randomInt(0, 10000),
          level: randomInt(1, 15),
          lessonsCompleted: randomInt(0, 50),
          questionsAnswered: randomInt(0, 200),
          flashcardsReviewed: randomInt(0, 500),
          totalStudyTimeSeconds: randomInt(0, 100000),
        },
      });
    }

    parentChildMap.set(parentId, childIds);
  }

  const totalChildren = Array.from(parentChildMap.values()).flat().length;
  console.log(`  Created ${totalChildren} children`);

  return parentChildMap;
}

// Generate activity sessions with realistic retention
async function generateActivitySessions(parentChildMap: Map<string, string[]>): Promise<void> {
  console.log('Generating activity sessions...');
  const endDate = new Date();
  const startDate = addMonths(endDate, -CONFIG.monthsOfData);
  let totalSessions = 0;

  for (const [parentId, childIds] of parentChildMap) {
    const parent = await prisma.parent.findUnique({ where: { id: parentId } });
    if (!parent) continue;

    const signupDate = parent.createdAt;
    const monthsSinceSignup = Math.floor((endDate.getTime() - signupDate.getTime()) / (30 * 24 * 60 * 60 * 1000));

    for (const childId of childIds) {
      // Generate sessions based on retention curve
      let currentDate = new Date(signupDate);

      while (currentDate < endDate) {
        const monthsActive = Math.floor((currentDate.getTime() - signupDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
        const retentionRate = CONFIG.retentionCurve[Math.min(monthsActive, CONFIG.retentionCurve.length - 1)];

        // Skip if user "churned" based on retention curve
        if (Math.random() > retentionRate) {
          currentDate = addDays(currentDate, 1);
          continue;
        }

        // Paid users are more active
        const isPaid = parent.subscriptionTier !== SubscriptionTier.FREE;
        const activityMultiplier = isPaid ? 1.5 : 1.0;

        // More activity on weekends
        const dayOfWeek = currentDate.getDay();
        const weekendBonus = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.3 : 1.0;

        // Random chance of activity this day
        if (Math.random() < 0.3 * activityMultiplier * weekendBonus) {
          const numSessions = Math.max(1, Math.round(CONFIG.avgSessionsPerActiveDay * (0.5 + Math.random())));

          for (let s = 0; s < numSessions; s++) {
            const sessionStart = new Date(currentDate);
            sessionStart.setHours(randomInt(6, 22), randomInt(0, 59));

            const durationMinutes = Math.round(CONFIG.avgSessionDuration * (0.3 + Math.random() * 1.4));
            const sessionEnd = new Date(sessionStart.getTime() + durationMinutes * 60 * 1000);

            // Activity breakdown
            const activities = {
              chat: randomInt(0, 10),
              flashcards: randomInt(0, 20),
              lesson: randomInt(5, 30),
              quiz: randomInt(0, 5),
              upload: randomInt(0, 2),
            };

            await prisma.activitySession.create({
              data: {
                childId,
                startedAt: sessionStart,
                endedAt: sessionEnd,
                durationMinutes,
                activities,
                xpEarned: randomInt(10, 200),
                lessonsStarted: randomInt(0, 3),
                lessonsCompleted: randomInt(0, 2),
                createdDate: getDateOnly(sessionStart),
                weekStart: getWeekStart(sessionStart),
                monthStart: getMonthStart(sessionStart),
                platform: randomChoice(PLATFORMS),
                deviceType: randomChoice(DEVICE_TYPES),
                createdAt: sessionStart,
              },
            });

            totalSessions++;
          }

          // Update child's lastActiveAt
          await prisma.child.update({
            where: { id: childId },
            data: { lastActiveAt: currentDate },
          });
        }

        currentDate = addDays(currentDate, 1);
      }
    }
  }

  console.log(`  Created ${totalSessions} activity sessions`);
}

// Generate some sample lessons for more realistic data
async function generateLessons(parentChildMap: Map<string, string[]>): Promise<void> {
  console.log('Generating sample lessons...');
  let totalLessons = 0;

  const subjects = Object.values(Subject);
  const sourceTypes = [SourceType.PDF, SourceType.IMAGE, SourceType.TEXT];

  for (const [, childIds] of parentChildMap) {
    for (const childId of childIds) {
      const child = await prisma.child.findUnique({ where: { id: childId } });
      if (!child) continue;

      // Generate 0-10 lessons per child
      const numLessons = randomInt(0, 10);

      for (let i = 0; i < numLessons; i++) {
        const createdAt = randomDate(child.createdAt, new Date());
        const isCompleted = Math.random() < 0.6;

        await prisma.lesson.create({
          data: {
            childId,
            title: `${randomChoice(subjects)} Lesson ${i + 1}`,
            summary: 'Auto-generated lesson for analytics testing',
            subject: randomChoice(subjects),
            gradeLevel: String(child.gradeLevel || 3),
            sourceType: randomChoice(sourceTypes),
            processingStatus: ProcessingStatus.COMPLETED,
            percentComplete: isCompleted ? 100 : randomInt(10, 90),
            timeSpentSeconds: randomInt(300, 3600),
            completedAt: isCompleted ? addDays(createdAt, randomInt(0, 7)) : null,
            createdAt,
            updatedAt: createdAt,
          },
        });

        totalLessons++;
      }
    }
  }

  console.log(`  Created ${totalLessons} lessons`);
}

// Generate admin account for testing
async function generateAdminAccount(): Promise<void> {
  console.log('Creating admin account...');

  const existingAdmin = await prisma.admin.findUnique({
    where: { email: 'admin@orbitlearn.com' },
  });

  if (existingAdmin) {
    console.log('  Admin account already exists');
    return;
  }

  const passwordHash = await bcrypt.hash('AdminPassword123!', 10);

  await prisma.admin.create({
    data: {
      email: 'admin@orbitlearn.com',
      passwordHash,
      name: 'Analytics Admin',
      role: 'SUPER_ADMIN',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  console.log('  Created admin account: admin@orbitlearn.com / AdminPassword123!');
}

// Helper to delete all test data
async function deleteTestData(): Promise<void> {
  // Delete in correct order due to foreign keys
  await prisma.activitySession.deleteMany({
    where: {
      child: {
        parent: { email: { contains: '@test.orbitlearn.com' } },
      },
    },
  });

  await prisma.lesson.deleteMany({
    where: {
      child: {
        parent: { email: { contains: '@test.orbitlearn.com' } },
      },
    },
  });

  await prisma.userProgress.deleteMany({
    where: {
      child: {
        parent: { email: { contains: '@test.orbitlearn.com' } },
      },
    },
  });

  await prisma.child.deleteMany({
    where: {
      parent: { email: { contains: '@test.orbitlearn.com' } },
    },
  });

  await prisma.parent.deleteMany({
    where: { email: { contains: '@test.orbitlearn.com' } },
  });
}

// Main execution
async function main() {
  console.log('='.repeat(60));
  console.log('OrbitLearn Analytics Seed Data Generator');
  console.log('='.repeat(60));
  console.log('');

  if (RESUME_MODE) {
    console.log('MODE: RESUME - Will use existing data and fill gaps');
  } else if (CLEAN_ONLY) {
    console.log('MODE: CLEAN ONLY - Will delete test data and exit');
  } else {
    console.log('MODE: FULL - Will delete existing test data and regenerate');
  }
  console.log('');

  try {
    // Check existing data
    const existingParents = await prisma.parent.count({
      where: {
        email: { contains: '@test.orbitlearn.com' },
      },
    });

    const existingChildren = await prisma.child.count({
      where: {
        parent: { email: { contains: '@test.orbitlearn.com' } },
      },
    });

    const existingSessions = await prisma.activitySession.count({
      where: {
        child: { parent: { email: { contains: '@test.orbitlearn.com' } } },
      },
    });

    console.log('Existing test data:');
    console.log(`  Parents:  ${existingParents}`);
    console.log(`  Children: ${existingChildren}`);
    console.log(`  Sessions: ${existingSessions}`);
    console.log('');

    // CLEAN ONLY mode
    if (CLEAN_ONLY) {
      if (existingParents > 0) {
        console.log('Deleting all test data...');
        await deleteTestData();
        console.log('Done.');
      } else {
        console.log('No test data to delete.');
      }
      return;
    }

    // RESUME mode - use existing data
    if (RESUME_MODE) {
      if (existingParents === 0) {
        console.log('No existing test data found. Run without --resume first.');
        return;
      }

      // Get existing parent IDs
      const existingParentRecords = await prisma.parent.findMany({
        where: { email: { contains: '@test.orbitlearn.com' } },
        select: { id: true },
      });
      const parentIds = existingParentRecords.map(p => p.id);

      // Build parent-child map from existing data
      const parentChildMap = new Map<string, string[]>();
      for (const parentId of parentIds) {
        const children = await prisma.child.findMany({
          where: { parentId },
          select: { id: true },
        });
        parentChildMap.set(parentId, children.map(c => c.id));
      }

      console.log(`Resuming with ${parentIds.length} parents, ${Array.from(parentChildMap.values()).flat().length} children`);
      console.log('');

      // Only generate sessions if none exist
      if (existingSessions === 0) {
        await generateActivitySessions(parentChildMap);
      } else {
        console.log(`Skipping activity sessions (${existingSessions} already exist)`);
      }

      // Check lessons
      const existingLessons = await prisma.lesson.count({
        where: { child: { parent: { email: { contains: '@test.orbitlearn.com' } } } },
      });
      if (existingLessons === 0) {
        await generateLessons(parentChildMap);
      } else {
        console.log(`Skipping lessons (${existingLessons} already exist)`);
      }

      await generateAdminAccount();

    } else {
      // FULL mode - delete and regenerate
      if (existingParents > 0) {
        console.log('Deleting existing test data...');
        await deleteTestData();
        console.log('Existing test data deleted.');
        console.log('');
      }

      // Generate new data
      const parentIds = await generateParents();
      const parentChildMap = await generateChildren(parentIds);
      await generateActivitySessions(parentChildMap);
      await generateLessons(parentChildMap);
      await generateAdminAccount();
    }

    // Print summary
    console.log('');
    console.log('='.repeat(60));
    console.log('SEED DATA GENERATION COMPLETE');
    console.log('='.repeat(60));

    const stats = await getStats();
    console.log('');
    console.log('Summary:');
    console.log(`  Parents:           ${stats.parents}`);
    console.log(`  Children:          ${stats.children}`);
    console.log(`  Activity Sessions: ${stats.sessions}`);
    console.log(`  Lessons:           ${stats.lessons}`);
    console.log('');
    console.log('Subscription Breakdown:');
    console.log(`  FREE:        ${stats.tiers.FREE}`);
    console.log(`  FAMILY:      ${stats.tiers.FAMILY}`);
    console.log(`  FAMILY_PLUS: ${stats.tiers.FAMILY_PLUS}`);
    console.log('');
    console.log('Geographic Distribution:');
    for (const [country, count] of Object.entries(stats.countries)) {
      console.log(`  ${country}: ${count}`);
    }
    console.log('');
    console.log('Admin Login:');
    console.log('  Email:    admin@orbitlearn.com');
    console.log('  Password: AdminPassword123!');
    console.log('');

  } catch (error) {
    console.error('Error seeding data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function getStats() {
  const parents = await prisma.parent.count({
    where: { email: { contains: '@test.orbitlearn.com' } },
  });

  const children = await prisma.child.count({
    where: { parent: { email: { contains: '@test.orbitlearn.com' } } },
  });

  const sessions = await prisma.activitySession.count({
    where: { child: { parent: { email: { contains: '@test.orbitlearn.com' } } } },
  });

  const lessons = await prisma.lesson.count({
    where: { child: { parent: { email: { contains: '@test.orbitlearn.com' } } } },
  });

  const tierCounts = await prisma.parent.groupBy({
    by: ['subscriptionTier'],
    where: { email: { contains: '@test.orbitlearn.com' } },
    _count: true,
  });

  const tiers: Record<string, number> = {
    FREE: 0,
    FAMILY: 0,
    FAMILY_PLUS: 0,
  };
  for (const t of tierCounts) {
    tiers[t.subscriptionTier] = t._count;
  }

  const countryCounts = await prisma.parent.groupBy({
    by: ['country'],
    where: { email: { contains: '@test.orbitlearn.com' } },
    _count: true,
  });

  const countries: Record<string, number> = {};
  for (const c of countryCounts) {
    countries[c.country] = c._count;
  }

  return { parents, children, sessions, lessons, tiers, countries };
}

main();
