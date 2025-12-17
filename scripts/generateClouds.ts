// Script to generate cloud backdrop images using Gemini API
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is required');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const OUTPUT_DIR = path.join(__dirname, '../../frontend/public/assets/images/clouds');

// Cloud prompts designed for a playful K-6 educational app
const CLOUD_PROMPTS = [
  {
    name: 'cloud_backdrop_top.png',
    prompt: `Create a seamless, wide panoramic illustration of soft, fluffy cartoon clouds floating at the top of a sky.
    Style: Playful, child-friendly, similar to educational apps for kids aged 4-12.
    Colors: Soft whites, very light blues, subtle pink and lavender tints.
    The clouds should be rounded, bubbly, and friendly-looking with smooth gradients.
    The bottom edge should fade to complete transparency (for overlaying on content).
    Aspect ratio: Very wide, like a banner (approximately 1920x400 pixels concept).
    No characters, no text, just beautiful dreamy clouds.
    The style should match a modern educational app with bold, clean aesthetics.`,
  },
  {
    name: 'cloud_backdrop_bottom.png',
    prompt: `Create a seamless, wide panoramic illustration of soft, fluffy cartoon clouds floating at the bottom of a scene.
    Style: Playful, child-friendly, similar to educational apps for kids aged 4-12.
    Colors: Soft whites with subtle pastel pink, lavender, and light blue tints - like cotton candy clouds.
    The clouds should be rounded, puffy, and dreamy with soft gradients.
    The top edge should fade to complete transparency (for overlaying on content).
    Aspect ratio: Very wide, like a banner (approximately 1920x500 pixels concept).
    No characters, no text, just beautiful soft clouds that look inviting and magical.
    These clouds should feel like you could bounce on them - very soft and fluffy.`,
  },
  {
    name: 'cloud_single_1.png',
    prompt: `Create a single fluffy cartoon cloud on a completely transparent background.
    Style: Playful, child-friendly, bold cartoon style with a subtle black outline.
    Colors: Bright white with soft blue-gray shadows and a very subtle gradient.
    The cloud should be rounded and bubbly, like a cloud from a children's picture book.
    Simple, clean design that would fit in a modern educational app.
    PNG with transparent background.
    No text, no characters, just one beautiful fluffy cloud.`,
  },
  {
    name: 'cloud_single_2.png',
    prompt: `Create a single medium-sized fluffy cartoon cloud on a completely transparent background.
    Style: Cute, playful, child-friendly with soft edges and rounded shapes.
    Colors: White with very subtle pink and lavender tints, soft shadows.
    The cloud should look soft and dreamy, like something from a cozy children's app.
    Clean, modern design aesthetic.
    PNG with transparent background.
    Different shape from a standard cloud - maybe elongated or with extra puffs.`,
  },
];

async function generateCloudImage(prompt: string, outputPath: string): Promise<void> {
  console.log(`Generating: ${path.basename(outputPath)}...`);

  // Use gemini-2.0-flash-exp which supports native image generation
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
  });

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['Text', 'Image'],
      } as any,
    });

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts) {
      throw new Error('No response parts from image generation');
    }

    for (const part of parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData;
        const imageBuffer = Buffer.from(inlineData.data, 'base64');
        fs.writeFileSync(outputPath, imageBuffer);
        console.log(`  ✓ Saved: ${outputPath}`);
        return;
      }
    }

    throw new Error('No image data in response');
  } catch (error) {
    console.error(`  ✗ Failed to generate ${path.basename(outputPath)}:`, error);
    throw error;
  }
}

async function main() {
  console.log('🌥️  Cloud Image Generator for Orbit Learn\n');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created directory: ${OUTPUT_DIR}\n`);
  }

  for (const cloud of CLOUD_PROMPTS) {
    const outputPath = path.join(OUTPUT_DIR, cloud.name);
    try {
      await generateCloudImage(cloud.prompt, outputPath);
      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Skipping ${cloud.name} due to error`);
    }
  }

  console.log('\n✨ Cloud generation complete!');
  console.log(`Images saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
