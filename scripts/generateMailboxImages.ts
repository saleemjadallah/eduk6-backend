/**
 * Mailbox Image Generator using Gemini Image Generation
 * Generates custom suggestion box imagery for Student and Teacher portals
 *
 * Usage: npx tsx scripts/generateMailboxImages.ts
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

// Mailbox image definitions
const MAILBOX_DEFINITIONS = [
  {
    id: 'student_mailbox',
    name: 'Student Suggestion Mailbox',
    prompt: `Create a cute, cartoon-style mailbox for a children's educational app called OrbitLearn.

IMPORTANT DESIGN GUIDELINES:
- STYLE: Playful cartoon style suitable for children ages 4-12
- Bold black outlines (4px thick, comic book style)
- Bright, vibrant colors that pop
- Friendly, approachable, and fun
- NO realistic or scary imagery
- NO text or letters on the mailbox

MAILBOX DESIGN:
- Classic American mailbox shape (cylindrical with rounded top)
- A small RED flag on the side (in the down position, not raised)
- Give the mailbox a friendly cartoon face on the front (big happy eyes, cute smile)
- Add small decorative elements like hearts, stars, or sparkles around it
- The mailbox should look inviting and clickable

COLOR PALETTE:
- Main body: Bright blue (#4169E1) or vibrant teal
- Accent highlights: Sunny yellow (#FFD700) and lime green (#32CD32)
- Red/orange flag
- Black outlines
- White eyes with black pupils

COMPOSITION:
- Front-facing view, slightly angled (3/4 view)
- The mailbox should be the main focus
- Include a subtle soft shadow beneath
- Background: Solid soft gradient (light blue to white) or transparent

The mailbox should look like something a child would be excited to click on to share their ideas!`,
  },
  {
    id: 'student_mailbox_flag',
    name: 'Student Mailbox with Flag Up',
    prompt: `Create a cute, cartoon-style mailbox for a children's educational app, showing the FLAG RAISED UP position.

IMPORTANT DESIGN GUIDELINES:
- STYLE: Playful cartoon style suitable for children ages 4-12
- Bold black outlines (4px thick, comic book style)
- Bright, vibrant colors
- Friendly, approachable aesthetic
- NO text or letters on the mailbox

MAILBOX DESIGN:
- Classic American mailbox shape (cylindrical with rounded top)
- The RED/ORANGE flag is RAISED UP at a 45-degree angle (indicating mail to send)
- Friendly cartoon face on the front (excited expression, like it's ready to receive something)
- Small sparkles or excitement lines around the raised flag
- The mailbox looks eager and alert

COLOR PALETTE:
- Main body: Bright blue (#4169E1) or vibrant teal
- Accent highlights: Sunny yellow (#FFD700) and lime green (#32CD32)
- Red/orange flag (raised up)
- Black outlines
- White eyes with black pupils looking up at the flag

COMPOSITION:
- Front-facing view, slightly angled (3/4 view)
- Match the exact same style as the base mailbox but with flag up
- Include subtle shadow beneath
- Background: Solid soft gradient or transparent`,
  },
  {
    id: 'teacher_mailbox',
    name: 'Teacher Suggestion Box',
    prompt: `Create an elegant, vintage-style suggestion box for a professional teacher portal in an educational app.

IMPORTANT DESIGN GUIDELINES:
- STYLE: Retro classroom aesthetic, refined illustration style
- Clean lines with subtle shadows for depth
- Warm, professional, and inviting
- NOT childish, but still friendly and approachable
- NO text or labels on the box

SUGGESTION BOX DESIGN:
- Classic wooden suggestion box shape (rectangular with a slot on top for papers)
- Polished dark wood grain texture (mahogany or walnut style)
- Brass metal fittings on corners and edges
- A brass mail slot on the front or top
- Small decorative brass plate where a label would go (but empty)
- Subtle vintage schoolhouse feel

COLOR PALETTE - "Retro Classroom" theme:
- Main body: Warm dark wood brown with grain
- Accents: Brass/gold (#D4A853) for metal fittings
- Background accent: Warm cream (#FDF8F3)
- Hints of chalkboard green (#2D5A4A) and terracotta (#C75B39)

COMPOSITION:
- Front-facing view, slightly angled (3/4 view)
- The box should look substantial and trustworthy
- Include a soft shadow beneath
- Background: Solid cream/beige gradient or transparent

The suggestion box should look like a treasured classroom fixture that teachers would feel comfortable using to share feedback.`,
  },
  {
    id: 'letter',
    name: 'Flying Letter/Envelope',
    prompt: `Create a cute cartoon envelope/letter for an animation where it flies into a mailbox.

IMPORTANT DESIGN GUIDELINES:
- STYLE: Playful cartoon style, works for both children and adults
- Bold outlines with clean, simple design
- Bright colors that stand out
- NO text or writing on the envelope

ENVELOPE DESIGN:
- Classic envelope shape (rectangular with triangular flap)
- Sealed with the flap down
- A cute small heart or star seal sticker on the flap
- The envelope looks happy/excited (optional: tiny cartoon face or motion lines)
- Slight curve to suggest it's flying/moving

COLOR PALETTE:
- Main body: Crisp white or soft cream
- Flap/seal: Red or pink heart sticker
- Accent lines: Light blue or yellow highlights
- Black outlines (thinner than mailbox)

COMPOSITION:
- Angled view as if flying through the air (tilted ~15 degrees)
- Include small motion lines or speed streaks
- The envelope should look lightweight and in motion
- Background: Transparent or solid white

This envelope will animate flying from a form into a mailbox, so it should look dynamic and cheerful!`,
  },
];

async function generateMailboxImage(definition: typeof MAILBOX_DEFINITIONS[0]): Promise<Buffer | null> {
  try {
    console.log(`  Generating: ${definition.name} (${definition.id})...`);

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: definition.prompt,
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

    console.error(`  No image generated for ${definition.id}`);
    return null;
  } catch (error: any) {
    console.error(`  Error generating ${definition.id}:`, error.message || error);
    return null;
  }
}

async function main() {
  const outputDir = path.join(__dirname, '../../frontend/public/assets/suggestions');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(60));
  console.log('OrbitLearn Suggestion Box Image Generator');
  console.log('='.repeat(60));
  console.log(`Output directory: ${outputDir}`);
  console.log(`Total images to generate: ${MAILBOX_DEFINITIONS.length}\n`);

  const results: { id: string; name: string; success: boolean; path?: string }[] = [];

  // Process images sequentially to avoid rate limiting
  for (let i = 0; i < MAILBOX_DEFINITIONS.length; i++) {
    const definition = MAILBOX_DEFINITIONS[i];
    console.log(`\n[${i + 1}/${MAILBOX_DEFINITIONS.length}] ${definition.name}`);

    const imageBuffer = await generateMailboxImage(definition);

    if (imageBuffer) {
      const outputPath = path.join(outputDir, `${definition.id}.png`);
      fs.writeFileSync(outputPath, new Uint8Array(imageBuffer));
      console.log(`  Saved to ${definition.id}.png`);
      results.push({ id: definition.id, name: definition.name, success: true, path: outputPath });
    } else {
      console.log(`  Failed to generate`);
      results.push({ id: definition.id, name: definition.name, success: false });
    }

    // Add a delay between requests to avoid rate limiting
    if (i < MAILBOX_DEFINITIONS.length - 1) {
      console.log('  Waiting 3 seconds before next image...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('GENERATION COMPLETE');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\nSuccessful: ${successful}/${MAILBOX_DEFINITIONS.length}`);
  console.log(`Failed: ${failed}/${MAILBOX_DEFINITIONS.length}`);

  if (failed > 0) {
    console.log('\nFailed images:');
    results.filter(r => !r.success).forEach(r => console.log(`  - ${r.name} (${r.id})`));
  }

  if (successful > 0) {
    console.log('\nSuccessful images:');
    results.filter(r => r.success).forEach(r => console.log(`  - ${r.name} (${r.id})`));
  }

  // Generate a manifest file
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalImages: MAILBOX_DEFINITIONS.length,
    successful,
    failed,
    images: MAILBOX_DEFINITIONS.map(d => ({
      id: d.id,
      name: d.name,
      imagePath: `/assets/suggestions/${d.id}.png`,
    })),
  };

  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`\nManifest saved to manifest.json`);
}

main().catch(console.error);
