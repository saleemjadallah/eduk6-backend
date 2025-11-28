/**
 * Badge Image Generator using Gemini Image Generation
 * Generates unique, kid-friendly badge images for the OrbitLearn achievement system
 *
 * Usage: npx tsx scripts/generateBadges.ts
 */

import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini with the new SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Badge definitions with detailed visual descriptions
const BADGE_DEFINITIONS = [
  // Learning Category
  {
    id: 'first_lesson',
    name: 'First Steps',
    category: 'learning',
    rarity: 'common',
    visualDescription: 'A cute baby step footprint on a glowing path, with sparkles around it, representing the first step in learning',
    colors: 'soft blue, light yellow, white sparkles',
  },
  {
    id: 'lesson_master_10',
    name: 'Lesson Explorer',
    category: 'learning',
    rarity: 'common',
    visualDescription: 'A friendly cartoon explorer character with a magnifying glass discovering a glowing book, adventure theme',
    colors: 'forest green, brown, golden highlights',
  },
  {
    id: 'lesson_master_50',
    name: 'Study Champion',
    category: 'learning',
    rarity: 'rare',
    visualDescription: 'A golden trophy cup with books stacked around it, confetti, and a champion medal, victory celebration theme',
    colors: 'gold, royal blue, silver accents',
  },
  {
    id: 'lesson_master_100',
    name: 'Learning Legend',
    category: 'learning',
    rarity: 'epic',
    visualDescription: 'A majestic golden crown sitting on top of a stack of ancient wisdom books, with magical aura and floating stars',
    colors: 'royal gold, deep purple, magical sparkles',
  },

  // Mastery Category
  {
    id: 'first_correct',
    name: 'Getting Started',
    category: 'mastery',
    rarity: 'common',
    visualDescription: 'A bright green checkmark inside a friendly star shape, with celebration rays emanating outward',
    colors: 'bright green, sunny yellow, white rays',
  },
  {
    id: 'question_master_50',
    name: 'Question Whiz',
    category: 'mastery',
    rarity: 'common',
    visualDescription: 'A cute cartoon brain character wearing glasses and holding a lightning bolt, looking smart and confident',
    colors: 'pink brain, electric blue, yellow lightning',
  },
  {
    id: 'question_master_100',
    name: 'Answer Expert',
    category: 'mastery',
    rarity: 'rare',
    visualDescription: 'A glowing lightbulb with a graduation cap, surrounded by question marks turning into checkmarks',
    colors: 'bright yellow, scholarly blue, green checkmarks',
  },
  {
    id: 'perfect_score_1',
    name: 'Perfectionist',
    category: 'mastery',
    rarity: 'common',
    visualDescription: 'A shining golden star with the number 100 in the center, radiating perfection and achievement',
    colors: 'golden yellow, white glow, subtle rainbow shimmer',
  },
  {
    id: 'perfect_score_10',
    name: 'Quiz Wizard',
    category: 'mastery',
    rarity: 'epic',
    visualDescription: 'A magical wizard hat with a wand casting sparkles, surrounded by floating A+ papers and stars',
    colors: 'mystical purple, silver stars, magical gold',
  },

  // Flashcard Category
  {
    id: 'flashcard_starter',
    name: 'Flashcard Friend',
    category: 'learning',
    rarity: 'common',
    visualDescription: 'A cute stack of colorful flashcards with a friendly face on the top card, waving hello',
    colors: 'rainbow pastel cards, friendly blue face, pink cheeks',
  },
  {
    id: 'flashcard_pro',
    name: 'Memory Master',
    category: 'learning',
    rarity: 'rare',
    visualDescription: 'A glowing brain made of interconnected flashcards, with memory circuits lighting up',
    colors: 'electric blue, neural purple, golden connections',
  },
  {
    id: 'flashcard_legend',
    name: 'Flashcard Legend',
    category: 'learning',
    rarity: 'epic',
    visualDescription: 'A legendary phoenix rising from a pile of mastered flashcards, representing rebirth of knowledge',
    colors: 'fiery orange, golden flames, mystical purple background',
  },

  // Study Time Category
  {
    id: 'study_time_1h',
    name: 'Time Starter',
    category: 'learning',
    rarity: 'common',
    visualDescription: 'A friendly alarm clock character giving a thumbs up, with the hour hand pointing to 1',
    colors: 'cherry red, white face, golden bells',
  },
  {
    id: 'study_time_5h',
    name: 'Time Traveler',
    category: 'learning',
    rarity: 'common',
    visualDescription: 'A whimsical time portal with clock gears and a cartoon character stepping through, adventure theme',
    colors: 'cosmic blue, silver gears, time vortex purple',
  },
  {
    id: 'study_time_20h',
    name: 'Dedicated Learner',
    category: 'learning',
    rarity: 'rare',
    visualDescription: 'An open book with a heart in the center, surrounded by hours passing like gentle waves',
    colors: 'warm amber, book brown, heart red, soft blue time waves',
  },
  {
    id: 'study_time_50h',
    name: 'Scholar',
    category: 'learning',
    rarity: 'epic',
    visualDescription: 'An ancient scholar owl wearing a graduation cap, sitting on a pile of books with a glowing hourglass',
    colors: 'wise brown owl, scholarly blue cap, golden sand in hourglass',
  },

  // Streak Category
  {
    id: 'streak_3',
    name: 'Hat Trick',
    category: 'streak',
    rarity: 'common',
    visualDescription: 'Three flames in a row forming a friendly fire pattern, representing 3 consecutive days of learning',
    colors: 'orange flames, yellow centers, warm red base',
  },
  {
    id: 'streak_7',
    name: 'Week Warrior',
    category: 'streak',
    rarity: 'rare',
    visualDescription: 'A cartoon warrior character with a shield showing 7 stars, standing proud with a sword of knowledge',
    colors: 'brave blue armor, golden sword, silver shield',
  },
  {
    id: 'streak_14',
    name: 'Fortnight Fighter',
    category: 'streak',
    rarity: 'rare',
    visualDescription: 'A strong flexing arm made of calendar pages, showing determination and consistency',
    colors: 'powerful red, calendar white, muscle definition gold',
  },
  {
    id: 'streak_30',
    name: 'Unstoppable',
    category: 'streak',
    rarity: 'epic',
    visualDescription: 'A gleaming diamond surrounded by a ring of fire, unbreakable and eternal, representing 30 days of dedication',
    colors: 'brilliant diamond blue, fiery orange ring, platinum shimmer',
  },
  {
    id: 'streak_100',
    name: 'Legendary Streak',
    category: 'streak',
    rarity: 'legendary',
    visualDescription: 'A majestic golden crown with 100 embedded gems, surrounded by eternal flames and cosmic energy',
    colors: 'royal gold, gem rainbow, cosmic purple aura, eternal flame orange',
  },

  // Level Category
  {
    id: 'level_5',
    name: 'Rising Star',
    category: 'special',
    rarity: 'common',
    visualDescription: 'A cute star character with a happy face, rising up with a trail of smaller stars behind it',
    colors: 'sunny yellow star, trail of white stars, sky blue background accent',
  },
  {
    id: 'level_10',
    name: 'Shining Bright',
    category: 'special',
    rarity: 'rare',
    visualDescription: 'A brilliant supernova star exploding with light rays, representing maximum brightness and achievement',
    colors: 'brilliant white center, golden rays, purple cosmic dust',
  },
  {
    id: 'level_25',
    name: 'Master Learner',
    category: 'special',
    rarity: 'epic',
    visualDescription: 'A prestigious medal with a book and brain symbol, hanging from a silk ribbon',
    colors: 'gold medal, royal blue ribbon, silver book emblem',
  },
  {
    id: 'level_50',
    name: 'Grand Master',
    category: 'special',
    rarity: 'legendary',
    visualDescription: 'An ornate royal scepter topped with a glowing orb of knowledge, representing ultimate mastery',
    colors: 'imperial gold scepter, glowing blue orb, royal purple gems',
  },

  // Special Time-based Category
  {
    id: 'early_bird',
    name: 'Early Bird',
    category: 'special',
    rarity: 'rare',
    visualDescription: 'A cheerful cartoon bird wearing a tiny graduation cap, perched on a sunrise, holding a book',
    colors: 'cheerful yellow bird, orange sunrise, sky blue background',
  },
  {
    id: 'night_owl',
    name: 'Night Owl',
    category: 'special',
    rarity: 'rare',
    visualDescription: 'A wise owl character wearing reading glasses, studying under moonlight with stars around',
    colors: 'brown owl, silver moonlight, deep blue night sky, golden stars',
  },
  {
    id: 'weekend_warrior',
    name: 'Weekend Warrior',
    category: 'special',
    rarity: 'rare',
    visualDescription: 'A fun surfboard with books on it riding a wave, representing weekend learning adventure',
    colors: 'ocean blue wave, colorful surfboard, sandy beach tones',
  },
];

// Rarity to border/glow color mapping
const RARITY_STYLES = {
  common: { border: '#9CA3AF', glow: 'none', bgGradient: 'light gray to white' },
  rare: { border: '#3B82F6', glow: 'soft blue', bgGradient: 'light blue to blue' },
  epic: { border: '#8B5CF6', glow: 'purple shimmer', bgGradient: 'purple to violet' },
  legendary: { border: '#F59E0B', glow: 'golden radiance', bgGradient: 'gold to orange' },
};

async function generateBadgeImage(badge: typeof BADGE_DEFINITIONS[0]): Promise<Buffer | null> {
  const rarityStyle = RARITY_STYLES[badge.rarity as keyof typeof RARITY_STYLES];

  const prompt = `Create a circular achievement badge icon for a children's educational app called OrbitLearn.

IMPORTANT DESIGN GUIDELINES:
- STYLE: Cartoon/illustrated style suitable for children ages 4-12
- Bold, clean outlines (like comic book style)
- Bright, vibrant colors that pop
- Friendly, approachable aesthetic
- NO realistic or scary imagery
- NO text or letters on the badge

SHAPE:
- Circular badge shape with a thick decorative border
- The main icon should be centered and fill most of the circle
- Leave a small margin from the edge

COLORS - Use OrbitLearn brand colors as accents:
- Nanobanana Blue: #3B82F6
- Nanobanana Yellow: #FCD34D
- Nanobanana Green: #22C55E
- Make colors bright and saturated
- Use gradients for depth

SPECIFIC BADGE DETAILS:
- Badge Name: "${badge.name}"
- Category: ${badge.category}
- Rarity: ${badge.rarity} (${rarityStyle.glow !== 'none' ? `add ${rarityStyle.glow} effect` : 'no glow effect'})
- Visual Theme: ${badge.visualDescription}
- Color Palette: ${badge.colors}
- Border Style: ${badge.rarity === 'legendary' ? 'Golden ornate border with gems' : badge.rarity === 'epic' ? 'Purple glowing border' : badge.rarity === 'rare' ? 'Blue metallic border' : 'Simple silver border'}

Generate a single circular badge icon that looks like a collectible achievement medal/badge that a child would be excited to earn. The badge should have a solid colored background (not transparent).`;

  try {
    console.log(`  Generating badge: ${badge.name} (${badge.id})...`);

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    // Extract image from response
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          const imageData = part.inlineData.data;
          return Buffer.from(imageData, 'base64');
        }
      }
    }

    console.error(`  No image generated for ${badge.id}`);
    return null;
  } catch (error: any) {
    console.error(`  Error generating ${badge.id}:`, error.message || error);
    return null;
  }
}

async function main() {
  const outputDir = path.join(__dirname, '../../frontend/public/assets/badges');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(60));
  console.log('OrbitLearn Badge Generator');
  console.log('='.repeat(60));
  console.log(`Output directory: ${outputDir}`);
  console.log(`Total badges to generate: ${BADGE_DEFINITIONS.length}\n`);

  const results: { id: string; name: string; success: boolean; path?: string }[] = [];

  // Process badges sequentially to avoid rate limiting
  for (let i = 0; i < BADGE_DEFINITIONS.length; i++) {
    const badge = BADGE_DEFINITIONS[i];
    console.log(`\n[${i + 1}/${BADGE_DEFINITIONS.length}] ${badge.name} (${badge.rarity})`);

    const imageBuffer = await generateBadgeImage(badge);

    if (imageBuffer) {
      const outputPath = path.join(outputDir, `${badge.id}.png`);
      fs.writeFileSync(outputPath, new Uint8Array(imageBuffer));
      console.log(`  ✓ Saved to ${badge.id}.png`);
      results.push({ id: badge.id, name: badge.name, success: true, path: outputPath });
    } else {
      console.log(`  ✗ Failed to generate`);
      results.push({ id: badge.id, name: badge.name, success: false });
    }

    // Add a delay between requests to avoid rate limiting
    if (i < BADGE_DEFINITIONS.length - 1) {
      console.log('  Waiting 3 seconds before next badge...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('GENERATION COMPLETE');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\nSuccessful: ${successful}/${BADGE_DEFINITIONS.length}`);
  console.log(`Failed: ${failed}/${BADGE_DEFINITIONS.length}`);

  if (failed > 0) {
    console.log('\nFailed badges:');
    results.filter(r => !r.success).forEach(r => console.log(`  - ${r.name} (${r.id})`));
  }

  if (successful > 0) {
    console.log('\nSuccessful badges:');
    results.filter(r => r.success).forEach(r => console.log(`  - ${r.name} (${r.id})`));
  }

  // Generate a manifest file
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalBadges: BADGE_DEFINITIONS.length,
    successful,
    failed,
    badges: BADGE_DEFINITIONS.map(b => ({
      id: b.id,
      name: b.name,
      category: b.category,
      rarity: b.rarity,
      imagePath: `/assets/badges/${b.id}.png`,
    })),
  };

  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`\nManifest saved to manifest.json`);
}

main().catch(console.error);
