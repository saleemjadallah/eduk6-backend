/**
 * Migration script to update existing content status
 * - Quizzes with quizContent -> PUBLISHED
 * - Flashcard decks with flashcardContent -> PUBLISHED
 * - Lessons with lessonContent -> PUBLISHED
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateContentStatus() {
  console.log('Starting content status migration...\n');

  // Update quizzes that have actual quiz content
  const quizResult = await prisma.teacherContent.updateMany({
    where: {
      contentType: 'QUIZ',
      status: 'DRAFT',
      quizContent: {
        not: null,
      },
    },
    data: {
      status: 'PUBLISHED',
    },
  });
  console.log(`Updated ${quizResult.count} quizzes to PUBLISHED`);

  // Update flashcard decks that have actual flashcard content
  const flashcardResult = await prisma.teacherContent.updateMany({
    where: {
      contentType: 'FLASHCARD_DECK',
      status: 'DRAFT',
      flashcardContent: {
        not: null,
      },
    },
    data: {
      status: 'PUBLISHED',
    },
  });
  console.log(`Updated ${flashcardResult.count} flashcard decks to PUBLISHED`);

  // Update lessons that have actual lesson content
  const lessonResult = await prisma.teacherContent.updateMany({
    where: {
      contentType: 'LESSON',
      status: 'DRAFT',
      lessonContent: {
        not: null,
      },
    },
    data: {
      status: 'PUBLISHED',
    },
  });
  console.log(`Updated ${lessonResult.count} lessons to PUBLISHED`);

  // Update study guides that have content
  const studyGuideResult = await prisma.teacherContent.updateMany({
    where: {
      contentType: 'STUDY_GUIDE',
      status: 'DRAFT',
      lessonContent: {
        not: null,
      },
    },
    data: {
      status: 'PUBLISHED',
    },
  });
  console.log(`Updated ${studyGuideResult.count} study guides to PUBLISHED`);

  const total = quizResult.count + flashcardResult.count + lessonResult.count + studyGuideResult.count;
  console.log(`\nTotal: ${total} content items updated to PUBLISHED`);
}

updateContentStatus()
  .then(() => {
    console.log('\nMigration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
