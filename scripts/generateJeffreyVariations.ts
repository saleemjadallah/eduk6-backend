// Generate 3 variations of Jeffrey as an alien-looking humanoid
import { genAI } from '../src/config/gemini.js';
import { config } from '../src/config/index.js';
import * as fs from 'fs';
import * as path from 'path';

const outputDir = path.join(process.cwd(), '../frontend/public/assets');

async function generateImage(prompt: string, filename: string): Promise<boolean> {
  console.log(`\n🎨 Generating ${filename}...`);

  const model = genAI.getGenerativeModel({
    model: config.gemini.models.image,
    generationConfig: {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['image', 'text'] },
    } as any);

    const parts = result.response.candidates?.[0]?.content?.parts;

    for (const part of parts || []) {
      if ((part as any).inlineData) {
        const data = (part as any).inlineData;
        const outputPath = path.join(outputDir, filename);
        fs.writeFileSync(outputPath, Buffer.from(data.data, 'base64'));
        console.log(`✅ Saved: ${outputPath}`);
        return true;
      }
    }
    console.log('❌ No image data in response');
    return false;
  } catch (error) {
    console.error(`❌ Error generating ${filename}:`, error);
    return false;
  }
}

async function main() {
  console.log('🚀 Generating 3 Jeffrey variations as alien-looking humanoid...\n');

  // IMAGE 1: Chat avatar - Jeffrey portrait for chat interface
  const prompt1 = `Create a character avatar portrait for a chat interface. This is Jeffrey, a friendly alien-human teacher who is an AI tutor in a children's learning app.

JEFFREY'S FACE SHAPE AND FEATURES (CRITICAL - must match exactly):
- ELONGATED, NARROW face shape - NOT round. Think tall oval, refined features
- Defined cheekbones, slim/narrow jaw
- Lavender/pale purple-tinted skin with a soft, healthy glow
- Large, warm expressive eyes with purple/violet irises
- Classic round glasses with thin gold/bronze frames
- Neat, well-groomed dark hair with a subtle purple tint, parted to the side
- Small, subtly pointed ears (alien feature)
- Brown tweed blazer visible at shoulders
- Light blue button-up shirt with a bow tie
- Warm, friendly, welcoming smile
- Mature, adult male teacher appearance
- Pixar/Disney 3D animation style - high quality render

COMPOSITION:
- Circular avatar crop - head and upper shoulders only
- Centered, looking slightly toward the viewer
- Warm, approachable expression like he's ready to help
- Clean composition that works well as a small chat bubble avatar

BACKGROUND:
- Solid soft cream or very light warm gray
- Clean and simple for avatar use
- Could have a subtle circular vignette

STYLE:
High quality 3D character render. Pixar-level polish. Must look great at small sizes (chat avatar). Friendly and trustworthy.

CRITICAL:
- LONG NARROW FACE - not round or chubby
- NO text, words, or letters
- Must work as a circular chat avatar
- Glasses and teacher attire are essential
- Lavender skin is essential (alien feature)
- Adult male teacher, not childlike proportions`;

  // IMAGE 2: Hero image - Jeffrey teaching kids of ALL ages (young to middle school)
  const prompt2 = `Create an illustration of Jeffrey teaching a diverse group of children spanning multiple age groups - from young elementary to middle school. This is for the hero section of an educational app's landing page. The message is "Jeffrey is with you all the way through your learning journey."

JEFFREY'S APPEARANCE (must match exactly):
- Lavender/pale purple-tinted skin
- Large warm purple eyes behind classic round gold-framed glasses
- Neat dark hair with purple tint, parted to the side
- Brown tweed blazer with elbow patches, light blue shirt, bow tie
- Standing at the front of the classroom, gesturing enthusiastically while teaching
- Warm, engaging expression - clearly enjoying teaching
- Small pointed ears visible
- Pixar/Disney 3D animation style

THE CLASSROOM SCENE - CRITICAL AGE DIVERSITY:
- Jeffrey standing/teaching at the front
- 5-7 diverse children of DIFFERENT AGES sitting at desks:
  * 1-2 young children (ages 5-6) - smaller, rounder faces, sitting in front
  * 2-3 elementary kids (ages 8-10) - in the middle
  * 2 older pre-teens/middle schoolers (ages 11-13) - taller, more mature features, sitting toward back
- The age progression should be visually clear - showing Jeffrey teaches ALL ages
- All children engaged, interested, and happy regardless of age
- Diverse ethnicities and genders across all age groups
- Warm, modern classroom environment
- Green chalkboard behind Jeffrey with doodles suitable for multiple levels (simple shapes AND more complex diagrams like atoms, equations symbols - NO actual text)
- Bookshelves with books of varying complexity, globe, science models
- Warm lighting like afternoon sunlight through windows

COMPOSITION:
- Wide/landscape format for hero banner
- Jeffrey prominently featured on the right side
- Children arranged to show age progression (younger in front, older in back)
- Depth and dimension - classroom feels real and inviting
- Warm, golden hour lighting

STYLE:
High quality 3D illustration in Pixar/Disney style. Warm, inviting, aspirational. Shows that this learning platform grows with children from kindergarten through middle school.

COLOR PALETTE:
- Jeffrey: lavender skin, brown tweed, gold glasses
- Classroom: warm woods, green chalkboard, colorful accents
- Overall warm, cheerful, educational atmosphere

CRITICAL:
- NO readable text anywhere in the image
- MUST show clear age diversity - young kids AND older pre-teens/middle schoolers
- Jeffrey must have lavender skin, glasses, tweed blazer
- Children must be diverse in age, ethnicity, and gender
- Scene must convey "learning companion for your entire educational journey"`;

  // IMAGE 3: Meet Jeffrey - Jeffrey waving at chalkboard
  const prompt3 = `Create an illustration of Jeffrey, a friendly alien-human teacher, standing at a chalkboard and waving welcomingly. This is for the "Meet Jeffrey" section of a landing page.

JEFFREY'S APPEARANCE (must match exactly):
- Lavender/pale purple-tinted skin
- Large warm purple eyes behind classic round gold-framed glasses
- Neat dark hair with purple tint, parted to the side
- Brown tweed blazer with elbow patches
- Light blue button-up shirt with a bow tie
- Standing pose, one hand raised in a friendly wave
- Big, warm, welcoming smile
- Small pointed ears visible
- Full body or 3/4 body visible
- Pixar/Disney 3D animation style

THE SCENE:
- Jeffrey standing in front of a green chalkboard
- Chalkboard has simple, friendly doodles: stars, planets, orbits, rockets, books, math symbols (NO actual text/words)
- Simple classroom setting - maybe a desk corner, some books
- Clean, focused composition with Jeffrey as the star
- Warm, inviting lighting

COMPOSITION:
- Jeffrey centered or slightly off-center
- Full body or from knees up
- Waving hand clearly visible
- Chalkboard provides nice backdrop context
- Square or slightly vertical format

STYLE:
High quality 3D character illustration. Pixar-level quality. Friendly, approachable, makes kids want to learn with him.

COLOR PALETTE:
- Jeffrey: lavender skin, brown tweed, gold glasses, blue shirt
- Background: green chalkboard, warm wood tones
- Chalk doodles: white/cream colored
- Overall warm and inviting

CRITICAL:
- NO readable text or words on chalkboard - only simple doodles/symbols
- Jeffrey must be waving welcomingly
- Lavender skin, glasses, tweed blazer are essential
- Must feel friendly and approachable for children`;

  // IMAGE 4: Logo icon - Jeffrey with orbit rings (narrow face version)
  const prompt4 = `Create a logo/icon for "Orbit Learn" - an educational learning app for children.

DESIGN CONCEPT:
Jeffrey, a friendly alien-human teacher, is positioned inside a circular orbit design, waving welcomingly.

JEFFREY'S FACE SHAPE AND FEATURES (CRITICAL - must match exactly):
- ELONGATED, NARROW face shape - NOT round. Think tall oval, refined adult features
- Defined cheekbones, slim/narrow jaw - like a distinguished professor
- Lavender/pale purple-tinted skin
- Large warm purple eyes behind classic round gold-framed glasses
- Neat dark hair with purple tint, parted to the side
- Brown tweed blazer, light blue shirt, bow tie
- Warm, welcoming expression, waving one hand
- Small pointed ears
- Mature adult male teacher - NOT childlike or cute proportions
- Pixar/Disney 3D style but with adult proportions

LOGO COMPOSITION:
- Circular badge/emblem design
- Jeffrey in the center, shown from chest up, friendly wave
- A stylized orbital path circles the entire design (like a planet's orbit trail)
- Small stars, books, and educational icons scattered around the orbit path
- The orbit creates a frame around Jeffrey
- Teal/green intertwining orbits

STYLE:
Modern app icon aesthetic. Bold, clean lines. Friendly and approachable. Works at multiple sizes.

BACKGROUND:
Soft gradient from light blue to white, or clean white.

COLOR PALETTE:
- Jeffrey: lavender, brown tweed, gold glasses frames
- Orbit ring: bright green or teal
- Stars: golden yellow
- Books: colorful (pink, blue, green)

CRITICAL:
- LONG NARROW ADULT FACE - not round, not childlike
- NO text, words, or letters anywhere
- Square format suitable for app icon
- Glasses and teacher outfit are essential
- Must match the elongated face style of the classroom scenes`;

  // Generate chat avatar and logo icon with consistent narrow face
  await generateImage(prompt1, 'rebranding-jeffrey-2024/jeffrey-chat-avatar.png');
  await generateImage(prompt4, 'rebranding-jeffrey-2024/orbit-learn-logo-icon.png');

  console.log('\n🎉 Done! Check frontend/public/assets/images/ for the generated images.');
}

main().catch(console.error);
