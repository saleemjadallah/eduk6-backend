/**
 * Script to generate landing page images using Gemini AI
 * Run with: npx tsx scripts/generateLandingImages.ts
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
  console.error('❌ GEMINI_API_KEY not found in environment');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Output directory for generated images
const OUTPUT_DIR = path.join(__dirname, '../../frontend/public/assets/images/landing');

// Image prompts for each section
const IMAGE_PROMPTS = [
  {
    name: 'hero-jeffrey-teaching',
    prompt: 'Friendly cartoon banana character with big round glasses teaching diverse happy children of different ethnicities in a colorful classroom setting with books and educational posters, warm lighting, everyone smiling and engaged in learning, bright cheerful colors, playful cartoon style, no text in image',
  },
  {
    name: 'meet-jeffrey',
    prompt: 'Cute friendly cartoon banana mascot character with big round glasses and a warm welcoming smile, waving hello, standing next to a chalkboard with simple colorful drawings, warm educational setting, bright cheerful cartoon style, kid-friendly design, no text',
  },
  {
    name: 'how-it-works-upload',
    prompt: 'Happy child taking a photo of homework with a glowing tablet device, magical sparkles and stars around the device, colorful playful cartoon style, educational setting with books nearby, warm cheerful atmosphere, no text',
  },
  {
    name: 'how-it-works-ai-magic',
    prompt: 'Friendly colorful AI brain with gears and sparkles processing documents and books, transforming them into organized colorful notes and flashcards, magical educational cartoon style, bright colors, whimsical and fun, no text',
  },
  {
    name: 'how-it-works-learn',
    prompt: 'Happy child chatting with a friendly banana mascot character on a tablet screen, both smiling and engaged, colorful educational environment with books and stars, warm cheerful cartoon style, no text',
  },
  {
    name: 'tool-flashcards',
    prompt: 'Colorful stack of digital flashcards floating in space with sparkles and stars, educational icons around them, bright cheerful cartoon style, kid-friendly design, magical learning atmosphere, no text on cards',
  },
  {
    name: 'tool-quizzes',
    prompt: 'Fun quiz game interface with green checkmarks and gold stars, happy cartoon characters celebrating correct answers, bright educational game style, colorful and engaging, no readable text',
  },
  {
    name: 'tool-study-guides',
    prompt: 'Open colorful study guide book with highlighted sections and sticky notes, magical glowing pages with icons, cartoon educational style, bright warm colors, inviting and fun, no readable text',
  },
  {
    name: 'tool-infographics',
    prompt: 'Beautiful colorful infographic poster with icons diagrams and illustrations explaining science concepts, kid-friendly educational design, bright colors, visual learning style, no readable text',
  },
  {
    name: 'parent-dashboard',
    prompt: 'Parent and child sitting together looking at a colorful progress dashboard on a laptop screen showing charts and graphs, warm family moment, bright cheerful cartoon style, educational technology, cozy home setting, no readable text',
  },
  {
    name: 'safety-family',
    prompt: 'Protective glowing blue shield around a happy diverse family using tablets and laptops together, safe digital learning environment, warm cozy home setting, bright cheerful cartoon style, feeling of security and trust, no text',
  },
  {
    name: 'celebration',
    prompt: 'Happy diverse group of children celebrating with books trophies and confetti, stars and sparkles everywhere, achievement celebration scene, bright joyful cartoon style, educational success theme, warm cheerful colors, no text',
  },
];

async function generateImage(prompt: string): Promise<Buffer | null> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp-image-generation',
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      },
    });

    const enhancedPrompt = `${prompt}

Style requirements:
- Child-safe and appropriate for all ages
- Bright, cheerful color palette with yellows, blues, greens
- High quality detailed cartoon artwork
- Welcoming and positive mood
- Professional illustration quality
- Suitable for educational website`;

    console.log(`  Generating with prompt: "${prompt.substring(0, 50)}..."`);

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: enhancedPrompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['image', 'text'],
      },
    } as any);

    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts) {
      console.error('  ❌ No response parts');
      return null;
    }

    for (const part of parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData;
        const buffer = Buffer.from(inlineData.data, 'base64');
        return buffer;
      }
    }

    console.error('  ❌ No image data in response');
    return null;
  } catch (error) {
    console.error('  ❌ Generation error:', error);
    return null;
  }
}

async function main() {
  console.log('🎨 Landing Page Image Generator\n');
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log('📁 Created output directory\n');
  }

  const results: { name: string; success: boolean; path?: string }[] = [];

  for (let i = 0; i < IMAGE_PROMPTS.length; i++) {
    const { name, prompt } = IMAGE_PROMPTS[i];
    console.log(`[${i + 1}/${IMAGE_PROMPTS.length}] Generating: ${name}`);

    const imageBuffer = await generateImage(prompt);

    if (imageBuffer) {
      const outputPath = path.join(OUTPUT_DIR, `${name}.png`);
      fs.writeFileSync(outputPath, imageBuffer);
      console.log(`  ✅ Saved: ${outputPath}\n`);
      results.push({ name, success: true, path: outputPath });
    } else {
      console.log(`  ❌ Failed to generate: ${name}\n`);
      results.push({ name, success: false });
    }

    // Add delay between requests to avoid rate limiting
    if (i < IMAGE_PROMPTS.length - 1) {
      console.log('  ⏳ Waiting 3 seconds before next request...\n');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  // Summary
  console.log('\n📊 Generation Summary:');
  console.log('─'.repeat(50));
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed images:');
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`  - ${r.name}`));
  }

  console.log('\n🎉 Done!');
}

main().catch(console.error);
