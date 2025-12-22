/**
 * Script to generate Instagram marketing post for Orbit Learn
 * Run with: npx tsx scripts/generateInstagramPost.ts
 *
 * Uses Gemini 3 Pro Image model to create engaging social media visuals
 */

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not found in environment');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Output directory for marketing images
const OUTPUT_DIR = path.join(__dirname, '../public/marketing/instagram');

// Instagram post prompt - optimized for Gemini image generation
const INSTAGRAM_POST_PROMPT = `Create a vibrant, eye-catching illustration for an Instagram post promoting Orbit Learn, an AI-powered educational app for children ages 4-12.

SCENE COMPOSITION:
A joyful child (around 8 years old) sits comfortably on a colorful bean bag, excitedly using a tablet that displays the Orbit Learn app interface. Jeffrey, the friendly mascot character, appears to float or leap out of the tablet screen in a magical burst of sparkles and light, as if coming to life to help with learning.

THE CHILD:
- Ethnically diverse appearance, could be of any background
- Expression of pure delight and wonder - eyes wide, genuine smile
- Casual, comfortable clothing in bright colors
- Relaxed, engaged posture leaning slightly forward toward the tablet

JEFFREY THE MASCOT:
- A friendly, approachable 3D cartoon character with soft lavender/purple skin
- Slightly elongated face shape with a gentle, warm expression
- Large, round gold-framed glasses that make him look wise yet approachable
- Wavy purple hair, neatly styled
- Wearing a brown herringbone tweed jacket over a light blue shirt
- Purple bow tie that matches his hair
- Warm, genuine smile with kind eyes
- Joyful, welcoming expression with arms open wide
- Appears to emerge magically from the tablet screen surrounded by sparkles
- Body positioned as if jumping toward the child to high-five or wave

MAGICAL ELEMENTS:
- Colorful stars, sparkles, and light particles burst from the tablet
- Small floating educational icons around Jeffrey: a book, a lightbulb, stars, checkmarks (no readable text)
- Rainbow trail of light suggesting movement and magic
- Soft glow emanating from the tablet screen

BACKGROUND:
- Soft, warm gradient transitioning from peachy orange at bottom to soft purple-pink at top
- Slightly blurred to keep focus on the main subjects
- Gentle bokeh light effects add depth and magic

COLOR PALETTE:
- Primary: Warm yellows (Jeffrey), soft blues, vibrant purples
- Accent: Coral orange, mint green, gold sparkles
- Overall warm and inviting with high saturation for Instagram appeal

LIGHTING:
- Bright, cheerful lighting with soft shadows
- The tablet and Jeffrey emit a magical glow
- Warm, golden highlights catch the sparkles

STYLE:
- Modern 3D cartoon aesthetic similar to Pixar/DreamWorks animation
- Clean, polished, professional quality
- High color saturation optimized for social media
- Suitable for square Instagram post (1080x1080)

CRITICAL REQUIREMENTS:
- NO text, words, letters, or numbers visible anywhere in the image
- All elements must be child-safe and family-friendly
- Characters should look warm, friendly, and inviting
- The image should evoke feelings of joy, magic, and excitement about learning
- Professional quality suitable for official brand marketing`;

async function generateImage(prompt: string): Promise<Buffer | null> {
  try {
    // Use the latest Gemini image generation model
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp-image-generation',
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    });

    console.log('Generating Instagram post image...');
    console.log('This may take 30-60 seconds...\n');

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    } as any);

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts) {
      console.error('No response parts received from Gemini');
      return null;
    }

    for (const part of parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData;
        const buffer = Buffer.from(inlineData.data, 'base64');
        console.log('Image generated successfully!');
        return buffer;
      }
    }

    console.error('No image data found in response');
    return null;
  } catch (error) {
    console.error('Image generation failed:', error);
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  ORBIT LEARN - Instagram Post Generator');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log('Created output directory\n');
  }

  // Generate the image
  const imageBuffer = await generateImage(INSTAGRAM_POST_PROMPT);

  if (imageBuffer) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `instagram-post-${timestamp}.png`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    fs.writeFileSync(outputPath, imageBuffer);
    console.log(`\nImage saved: ${outputPath}`);
    console.log(`\nFile size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);

    // Also save as the "latest" version
    const latestPath = path.join(OUTPUT_DIR, 'instagram-post-latest.png');
    fs.writeFileSync(latestPath, imageBuffer);
    console.log(`Latest version saved: ${latestPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('  IMAGE GENERATION COMPLETE');
    console.log('='.repeat(60));

    return outputPath;
  } else {
    console.error('\nFailed to generate Instagram post image');
    process.exit(1);
  }
}

main().catch(console.error);
