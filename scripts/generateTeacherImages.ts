/**
 * Script to generate Teacher Portal images using Gemini AI
 * Run with: npx tsx scripts/generateTeacherImages.ts
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
const OUTPUT_DIR = path.join(__dirname, '../../frontend/public/assets/images/teacher');

// Teacher Portal Image Prompts
// Aesthetic: Professional but quirky, warm educational feel
// Color palette: Cream (#FDF8F3), Chalkboard Green (#2D5A4A), Terracotta (#C75B39), Gold (#D4A853)

const IMAGE_PROMPTS = [
  {
    name: 'teacher-hero-grading',
    prompt: `Create an inviting illustration showing a teacher's desk with AI-assisted grading tools, combining traditional and modern elements.

SCENE COMPOSITION: An organized teacher's desk viewed from a slight bird's eye angle. On one side, a neat stack of handwritten student papers. In the center, a glowing tablet or laptop showing AI analysis with checkmarks and feedback appearing. A cup of coffee with steam rising adds warmth to the scene.

AESTHETIC: Warm, professional illustration style with a hint of whimsy. Think editorial illustration meets cozy classroom. The scene should feel like a modern teacher's workspace that's both efficient and human.

COLOR PALETTE: Use a warm, muted palette inspired by retro classrooms:
- Warm cream background (#FDF8F3)
- Deep chalkboard green (#2D5A4A) for the desk or laptop accents
- Terracotta orange (#C75B39) for accent elements like a mug or sticky notes
- Warm gold (#D4A853) for highlights and the "AI magic" glow
- Soft sage green (#7BAE7F) for plant or success checkmarks

DETAILS:
- Papers with hand-drawn style writing (squiggles, not readable text)
- AI interface shown with simple icons and progress bars
- A small potted succulent or pencil cup for personality
- Soft ambient lighting suggesting late afternoon work session
- Perhaps a pair of reading glasses nearby

STYLE: Clean, modern illustration with a hand-crafted feel. NOT photorealistic - think of illustrations you'd see in a premium education app or design magazine. Subtle textures like paper grain or soft shadows add depth without clutter.

MOOD: Productive yet calm, showing how AI makes grading easier while keeping the human touch. The overall feeling should be "finally, a helper that gets it."`,
  },
  {
    name: 'teacher-hero-content',
    prompt: `Illustrate the concept of transforming raw educational content into beautifully formatted lessons through AI magic.

SCENE: A creative "transformation" visualization. On the left, scattered rough notes, a crumpled worksheet, and a messy PDF printout. In the center, swirling particles of light (the AI transformation happening). On the right, emerging from the magic: a perfectly formatted lesson with clear sections, colorful callout boxes, and organized content.

VISUAL METAPHOR: Think of it like a "before and after" connected by magical energy - the chaos becomes clarity. The transformation should feel satisfying and almost alchemical.

COLOR PALETTE:
- Background: Soft cream (#FDF8F3) with subtle texture
- "Before" side: Slightly desaturated, papers in white/gray
- Transformation magic: Warm gold (#D4A853) sparkles and swirls with hints of sage green (#7BAE7F)
- "After" side: Vibrant but professional - chalkboard green (#2D5A4A) headers, terracotta (#C75B39) highlights, clean white cards

STYLE: Modern editorial illustration with playful motion. The magic particles should feel premium, not cheesy - think of the elegant particle effects in high-end app animations. The papers and documents should have a slightly sketchy, hand-drawn quality.

DETAILS TO INCLUDE:
- The "before" papers: handwritten math equations, printed text, maybe a photo of a worksheet
- The transformation zone: concentric circles of light, floating symbols (lightbulbs, checkmarks, stars)
- The "after" content: visible sections like "Key Concepts," question cards, vocabulary boxes

MOOD: Inspiring and empowering. This should make teachers feel "yes, this is exactly what I need." The image conveys that AI does the tedious formatting so teachers can focus on teaching.`,
  },
  {
    name: 'teacher-hero-collaborate',
    prompt: `Create an illustration showing the concept of teachers sharing and collaborating on educational content.

SCENE: A bird's eye view of multiple teacher workspaces connected by flowing lines, suggesting a network of collaboration. Each workspace shows different subject areas (math equations, science diagrams, language arts) but they're visually unified.

CONCEPTUAL ELEMENTS:
- 3-4 "workspace bubbles" floating in space, each with distinct content
- Elegant flowing lines connecting them, suggesting sharing and exchange
- Small icons representing different content types flowing between workspaces
- A central "hub" where everything connects, perhaps with a star or school icon

COLOR TREATMENT:
- Background: Deep navy or soft cream with subtle gradient
- Workspace bubbles: White/cream with colored accents
- Connection lines: Gradient from gold (#D4A853) to sage green (#7BAE7F)
- Content icons in each bubble use the full palette (chalkboard green, terracotta, plum)

STYLE: Clean, modern, almost infographic-like but with warmth. Think of Apple's collaboration illustrations but with more educational character. Should feel both professional and approachable.

DETAILS:
- Each workspace has personality: one might have a coffee cup, another a plant
- The content in each bubble is stylized (math symbols, atom icons, book shapes)
- Small avatars or initials representing teachers at each workspace
- Subtle "sparkle" effects where content transfers between workspaces

MOOD: Community and professional growth. Teachers supporting teachers. The feeling of being part of something larger than your own classroom.`,
  },
  {
    name: 'teacher-empty-state-create',
    prompt: `Design a friendly, encouraging illustration for an empty state screen - "No content yet, let's create something!"

SCENE: A clean, minimal composition showing a friendly blank canvas or notepad with a welcoming invitation to create. Should feel like possibility and potential, not emptiness.

ELEMENTS:
- A large, slightly tilted blank page or document with rounded corners
- Floating around it: colorful shapes suggesting potential content (small icons of books, lightbulbs, question marks, stars)
- Perhaps a pencil or cursor hovering, ready to begin
- Subtle decorative elements like dotted lines or gentle sparkles suggesting "magic about to happen"

COLOR PALETTE:
- Main background: Soft cream (#FDF8F3)
- Blank page: Pure white with soft shadow
- Floating elements: Mix of gold (#D4A853), sage (#7BAE7F), terracotta (#C75B39), and plum (#7B5EA7)
- All colors should be soft and inviting, not overwhelming

STYLE: Whimsical but professional illustration. Think of the empty state illustrations in apps like Notion or Linear - friendly, encouraging, and beautifully crafted. Not cartoonish, but has personality.

MOOD: Welcoming and motivating. Should make users feel excited to create something, not stressed about having nothing. The energy is "what wonderful things will you make today?"

IMPORTANT: Keep significant negative space. This will be used in a UI where there's text above and a button below.`,
  },
  {
    name: 'teacher-success-celebration',
    prompt: `Create a celebratory illustration for success moments - like when content is published or grading is complete.

SCENE: A burst of joyful energy emanating from a central point - could be a star, a completed checkmark, or an abstract "success" symbol. Confetti, sparkles, and celebratory elements radiate outward.

ELEMENTS:
- Central focal point: A golden star or badge with a checkmark
- Radiating elements: Confetti in brand colors, small stars, gentle firework-like bursts
- Educational symbols mixed in: tiny books, A+ badges, lightbulbs, graduation caps
- Overall composition is balanced and joyful, not chaotic

COLOR PALETTE:
- Background: Soft gradient from cream to light gold
- Central element: Rich gold (#D4A853) with white and terracotta accents
- Confetti/sparkles: Full palette - gold, sage green (#7BAE7F), terracotta (#C75B39), plum (#7B5EA7), chalkboard green (#2D5A4A)
- Keep gold and warm tones dominant for celebratory feeling

STYLE: Festive but sophisticated. Think of the celebration screens in premium apps - the confetti is well-designed, not clip art. There's movement implied but the image is balanced and could be viewed at any moment.

ANIMATION NOTE: While this is a static image, design it so it could feel dynamic - the confetti appears to be falling, the sparkles catching light, the energy radiating outward.

MOOD: Pure joy and accomplishment. "You did it!" The feeling after grading 30 papers in 10 minutes instead of 3 hours.`,
  },
];

// Ensure output directory exists
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

// Generate a single image
async function generateImage(prompt: { name: string; prompt: string }): Promise<void> {
  console.log(`\n🎨 Generating: ${prompt.name}...`);

  try {
    // Use imagen-3.0-generate-002 for image generation
    const model = genAI.getGenerativeModel({
      model: 'imagen-3.0-generate-002',
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt.prompt }],
        },
      ],
      generationConfig: {
        // Image-specific settings
        responseMimeType: 'image/png',
      } as any,
    });

    const response = result.response;

    // Check if we got image data
    if (response.candidates?.[0]?.content?.parts?.[0]) {
      const part = response.candidates[0].content.parts[0];

      if ('inlineData' in part && part.inlineData) {
        const imageData = part.inlineData.data;
        const outputPath = path.join(OUTPUT_DIR, `${prompt.name}.png`);

        // Save the image
        const buffer = Buffer.from(imageData, 'base64');
        fs.writeFileSync(outputPath, buffer);

        console.log(`✅ Saved: ${outputPath}`);
      } else {
        console.log(`⚠️ No image data in response for ${prompt.name}`);
        console.log('Response:', JSON.stringify(response, null, 2));
      }
    } else {
      console.log(`⚠️ Unexpected response structure for ${prompt.name}`);
      console.log('Response:', JSON.stringify(response, null, 2));
    }
  } catch (error: any) {
    console.error(`❌ Error generating ${prompt.name}:`, error.message);

    // If Imagen isn't available, provide instructions
    if (error.message?.includes('not found') || error.message?.includes('permission')) {
      console.log(`
💡 Note: Image generation requires the Imagen API.

To enable image generation:
1. Go to Google Cloud Console
2. Enable the "Vertex AI API"
3. Enable the "Cloud Vision API"
4. Ensure your API key has access to Imagen

Alternatively, you can:
- Use the prompts above in Google AI Studio manually
- Use a different image generation service
- Use the SVG illustrations in TeacherIllustrations.jsx
      `);
    }
  }
}

// Main function
async function main(): Promise<void> {
  console.log('🎓 Orbit Learn Teacher Portal - Image Generation');
  console.log('================================================\n');

  // Ensure output directory exists
  ensureDir(OUTPUT_DIR);

  console.log(`📂 Output directory: ${OUTPUT_DIR}`);
  console.log(`🖼️ Images to generate: ${IMAGE_PROMPTS.length}`);

  // Generate images sequentially to avoid rate limits
  for (const prompt of IMAGE_PROMPTS) {
    await generateImage(prompt);

    // Add delay between requests
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('\n✨ Image generation complete!');
  console.log('\nGenerated images can be used in the teacher portal UI.');
  console.log('Import them from: /assets/images/teacher/');
}

main().catch(console.error);
