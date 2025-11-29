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

// Image prompts for each section - Following Google AI Studio best practices:
// 1. Use natural language & full sentences (not "tag soup")
// 2. Be specific and descriptive (subject, setting, lighting, mood, materiality)
// 3. Provide context (the "why" or "for whom")
// 4. Specify style clearly (editorial, cartoon, whiteboard, etc.)

const IMAGE_PROMPTS = [
  {
    name: 'hero-jeffrey-teaching',
    prompt: `Create a heartwarming scene of Jeffrey, a friendly anthropomorphic banana character with large round glasses, teaching a small group of diverse elementary school children in a bright, welcoming classroom.

SCENE COMPOSITION: Jeffrey stands at the front of the classroom, gesturing enthusiastically toward a colorful chalkboard covered with simple educational drawings. Four to five children of different ethnicities sit at desks in a semi-circle, their faces lit up with curiosity and delight. One child has their hand raised eagerly.

JEFFREY'S CHARACTER: Jeffrey should have a warm yellow color with a gentle gradient, wearing his signature large round glasses that make him look wise yet approachable. His expression radiates kindness and enthusiasm - think of a favorite teacher everyone remembers fondly. He has simple cartoon arms and a welcoming posture.

ENVIRONMENT: A cozy classroom with warm wooden floors, soft natural light streaming through large windows, and educational posters on the walls (shown as colorful shapes, not readable text). Potted plants add life to the space. Books are neatly arranged on shelves.

LIGHTING & MOOD: Golden afternoon sunlight creates a warm, inviting atmosphere. The lighting should feel like a perfect autumn afternoon - comfortable, safe, and full of possibility. The overall mood is joyful engagement and the magic of learning together.

STYLE: Polished Pixar-style 3D animation aesthetic with smooth surfaces, warm color grading, and expressive character designs. Professional quality suitable for a hero banner on an educational website.`,
  },
  {
    name: 'meet-jeffrey',
    prompt: `Create an endearing portrait of Jeffrey, the friendly banana mascot, introducing himself to the viewer with a warm, welcoming wave.

CHARACTER DESIGN: Jeffrey is a cheerful anthropomorphic banana with a soft yellow gradient from lighter at the top to slightly deeper yellow at the bottom. He wears large, round glasses that give him an intellectual yet friendly appearance - like a favorite librarian or beloved teacher. His expression is genuinely warm and inviting, with a gentle smile and kind eyes behind his glasses.

POSE & GESTURE: Jeffrey waves hello with one hand while his other hand rests comfortably at his side. His body language should convey openness and friendliness - slightly leaning forward as if eager to meet a new friend. His posture is confident but not intimidating.

BACKGROUND: A soft, warm classroom setting slightly blurred in the background. We can make out a chalkboard with simple, cheerful doodles (shapes and squiggles, no text), some books on a shelf, and warm light coming from off-frame. The focus should be clearly on Jeffrey.

LIGHTING: Soft, warm front lighting that makes Jeffrey feel approachable and friendly. A subtle rim light separates him from the background and gives him dimension. The overall feel should be like being greeted by sunshine.

STYLE: High-quality cartoon character design suitable for brand mascot use. Think of beloved characters like those from modern animated films - appealing, expressive, and memorable. The rendering should be clean and professional.`,
  },
  {
    name: 'how-it-works-upload',
    prompt: `Illustrate the magical moment when a child uses technology to capture their homework, showing the wonder of digital learning transformation.

SCENE: A child (around 8-10 years old) holds a glowing tablet device, photographing a worksheet or textbook page on their desk. The scene captures the exact moment of "magic" - sparkles and soft light particles emanate from the tablet's camera, suggesting the content is being transformed into something special.

THE CHILD: Show a child with an expression of delighted wonder - eyes wide, slight smile, fully engaged in the moment. The child should appear relatable and could be any ethnicity. Their posture leans slightly forward with focused attention.

THE MAGIC EFFECT: Gentle sparkles, stars, and swirling light particles flow from the tablet toward the homework, creating a bridge of magical energy. The effect should feel whimsical and enchanting, not overwhelming or chaotic. Think of the sparkle effects in Disney films.

ENVIRONMENT: A cozy study space - could be a bedroom desk or kitchen table. Warm lamp light illuminates the scene. A few books and school supplies are visible but not cluttered. The background is softly focused to keep attention on the magical moment.

COLOR PALETTE: Warm ambers and golds from the lamp light, cool blues and purples in the magical sparkles, creating a harmonious contrast. The tablet emits a soft, friendly glow.

STYLE: Warm, inviting cartoon illustration style with a touch of magical realism. The magic effects should feel believable within the cartoon world - enchanting but not scary.`,
  },
  {
    name: 'how-it-works-ai-magic',
    prompt: `Visualize the concept of AI transforming educational content into organized, beautiful learning materials - capturing the "behind the scenes" magic of smart learning tools.

CENTRAL CONCEPT: A friendly, abstract representation of AI processing - imagine a glowing, colorful brain made of interconnected nodes and gentle geometric patterns, surrounded by flowing streams of educational content being transformed.

THE TRANSFORMATION: On one side, various educational inputs float toward the AI center: a document, a book, handwritten notes (shown as shapes and lines, not readable text). These items have a slightly faded, unorganized appearance. On the other side, emerging from the AI, are beautifully organized outputs: neat flashcards, colorful study guides, organized notes - all glowing with fresh energy and perfect organization.

VISUAL METAPHOR: The AI should feel helpful and friendly, not robotic or cold. Use warm colors (golds, oranges) mixed with cool tech colors (teals, soft purples) to create a balance between warmth and innovation. Think of it as a helpful librarian crossed with a wizard.

MOVEMENT & FLOW: Create a sense of dynamic transformation with flowing lines and particles moving from input to output. The composition should guide the eye from left (messy inputs) through center (AI magic) to right (beautiful outputs).

ATMOSPHERE: Magical and wonder-filled, like witnessing something amazing happen. The background should be a soft gradient that doesn't compete with the main elements - perhaps a warm cream transitioning to a soft lavender.

STYLE: Modern, friendly infographic style with a touch of magic. Clean lines, smooth gradients, and a professional yet whimsical feel suitable for explaining technology to families.`,
  },
  {
    name: 'how-it-works-learn',
    prompt: `Create a warm, engaging scene of a child having a delightful learning conversation with Jeffrey on their tablet, showing the joy of personalized AI tutoring.

THE INTERACTION: A happy child sits comfortably, holding a tablet that shows Jeffrey's friendly face on screen. Both the child and Jeffrey appear engaged in pleasant conversation - the child might be mid-giggle or showing an "aha!" moment of understanding. Jeffrey on the screen should look attentive and encouraging.

THE CHILD: Around 7-9 years old, any ethnicity, sitting in a relaxed but engaged posture. Their expression shows genuine enjoyment - this is learning that feels like talking to a friend. Perhaps they're leaning back slightly in their chair or sitting cross-legged on a couch.

JEFFREY ON SCREEN: Jeffrey's face fills most of the tablet screen, his expression warm and encouraging. Maybe he's explaining something with an animated gesture visible, or giving a proud, supportive smile. A speech bubble or chat interface is subtly suggested (as shapes, not text).

ENVIRONMENT: A comfortable home setting - a cozy couch or beanbag, soft afternoon light, maybe a window visible in the background. The space feels safe, comfortable, and conducive to relaxed learning. A few books might be nearby.

LIGHTING: Warm, soft lighting that creates an intimate, comfortable atmosphere. The tablet screen provides a gentle glow that illuminates the child's happy face. Overall feeling of a cozy afternoon spent learning.

COLOR PALETTE: Warm neutrals for the home environment, with Jeffrey's cheerful yellow providing a bright focal point on the screen. Soft blues and greens as accent colors.

STYLE: Warm, character-driven illustration style similar to modern children's book illustrations. Expressive, relatable characters with attention to emotional storytelling.`,
  },
  {
    name: 'tool-flashcards',
    prompt: `Design a magical, eye-catching illustration showcasing digital flashcards as an exciting learning tool, perfect for representing the flashcard feature.

CENTRAL COMPOSITION: A dynamic arrangement of colorful flashcards floating and gently spinning in a magical space. The cards should be arranged in an appealing composition - some tilted, some straight, creating depth and movement. Five to seven cards at various angles and distances.

THE FLASHCARDS: Each card is beautifully designed with rounded corners and a subtle glow. Cards show different colors - warm yellows, cool blues, fresh greens, soft purples - representing different subjects or difficulty levels. The front and back of cards are visible on different cards, suggesting the flip interaction. Absolutely no readable text - just colorful shapes, simple icons (star, lightbulb, checkmark), and abstract patterns.

MAGICAL ATMOSPHERE: Gentle sparkles, small stars, and soft light particles float around the cards, suggesting the magic of learning. Subtle trails of light follow the cards' implied movement. The overall effect is wonder and excitement, not chaos.

BACKGROUND: A soft, dreamy gradient background - perhaps transitioning from a warm peach at the bottom to a soft lavender at the top. The background should complement the cards without competing for attention.

LIGHTING: Soft, diffused lighting with gentle highlights on the card edges. Each card seems to have a subtle inner glow, making them feel alive and interactive.

STYLE: Clean, modern vector illustration style with smooth gradients and professional polish. Think of app store feature graphics or educational technology marketing materials - appealing, clean, and trustworthy.`,
  },
  {
    name: 'tool-quizzes',
    prompt: `Create an exciting, celebratory illustration representing the joy and accomplishment of taking quizzes, showing the game-like experience of interactive learning.

THE CELEBRATION MOMENT: Capture the exciting moment of getting answers right - green checkmarks appearing, gold stars bursting forth, and a sense of achievement radiating from the scene. This should feel like winning at a fun game.

GAME ELEMENTS: Abstract representations of quiz elements floating in the scene - circular answer bubbles, checkmark badges, star rewards, progress indicators (all without readable text). These elements should feel playful and game-like, using bright, engaging colors.

CHARACTERS: Two or three happy cartoon children in celebratory poses - arms raised in triumph, jumping with joy, or high-fiving. Their expressions show pure delight and pride in their accomplishments. Diverse representation.

VISUAL EFFECTS: Confetti, sparkles, and gentle light bursts emanate from the center of the composition. Green checkmarks and gold stars are prominent but integrated into the overall design. The energy is positive and exciting but not overwhelming.

COLOR PALETTE: Vibrant greens for success indicators, rich golds for stars and achievements, bright blues and purples for accent elements. The overall palette should feel rewarding and celebratory - like a birthday party for your brain.

COMPOSITION: Dynamic, energetic layout with elements radiating outward from a central point of celebration. The eye should move around the image discovering delightful details.

STYLE: Bright, energetic cartoon style similar to educational game interfaces or achievement screens. Fun, polished, and appealing to children while still looking professional.`,
  },
  {
    name: 'tool-study-guides',
    prompt: `Illustrate the magic of personalized study guides - showing beautiful, organized learning materials that feel inviting and helpful rather than overwhelming.

CENTRAL ELEMENT: A large, open study guide or notebook taking center stage, its pages fanned open invitingly. The pages should appear to glow softly with the magic of organized knowledge. The guide looks professionally designed and beautifully laid out.

PAGE CONTENT: The visible pages show colorful organizational elements - highlighted sections (shown as color blocks, not text), cute sticky note tabs in various colors, simple icons representing different types of information, hand-drawn style arrows connecting concepts, and small illustrative doodles. Everything suggests organization and clarity without any readable text.

MAGICAL TOUCHES: Gentle sparkles and light particles rise from the pages, suggesting the knowledge coming to life. Perhaps a few additional smaller study materials (index cards, a highlighter, colored pens) float nearby, also touched by the magical glow.

ENVIRONMENT: Soft, warm background that feels like a cozy study space. Maybe hints of a wooden desk surface visible, warm lamp light suggested. The focus should clearly be on the magical study guide.

LIGHTING: The study guide is the light source, glowing from within with warm, inviting light. This creates a sense of the materials being alive with helpful knowledge, ready to guide the learner.

COLOR PALETTE: Warm neutrals for the paper and background, with vibrant accent colors in the organizational elements - cheerful yellows for highlights, friendly blues for sticky notes, fresh greens for checkmarks. The overall feel should be organized, calming, and approachable.

STYLE: Warm, inviting illustration style that makes studying feel cozy and enjoyable. Think of the aesthetic of beautiful bullet journals or well-designed educational apps.`,
  },
  {
    name: 'tool-infographics',
    prompt: `Create a stunning illustration showcasing the power of visual learning through beautiful infographics, demonstrating how complex information becomes clear and engaging.

THE INFOGRAPHIC: A beautifully designed educational infographic takes center stage, showing how information can be organized visually. The content should suggest a science topic (like the solar system, water cycle, or plant growth) but represented entirely through illustrations, icons, diagrams, and color-coded sections - absolutely no readable text.

VISUAL ELEMENTS: Include various types of data visualization shown in kid-friendly ways - simple pie charts, cute bar graphs with icons, flow diagrams with arrows, comparison graphics, timeline elements. Each element should be colorful, clear, and engaging. Small illustrative icons (planets, water droplets, leaves) relate to the suggested topic.

DESIGN QUALITY: The infographic should look professionally designed - clean layouts, harmonious color schemes, clear visual hierarchy. It should demonstrate that learning materials can be beautiful as well as informative.

FLOATING ELEMENTS: A few design elements (icons, small diagrams, arrows) float outside the main infographic, suggesting the building blocks of visual communication. Perhaps a magnifying glass hovers nearby, emphasizing the clarity that infographics provide.

BACKGROUND: A soft, neutral gradient that allows the colorful infographic to pop. Subtle grid lines or dots might suggest a design workspace.

LIGHTING: Even, professional lighting that makes all colors appear vibrant and true. The infographic itself might have a very subtle glow, suggesting its helpfulness.

COLOR PALETTE: A sophisticated but kid-friendly palette - teals, corals, soft purples, and warm yellows working in harmony. The colors should demonstrate good design principles while remaining appealing to children.

STYLE: Modern editorial infographic style meets children's educational illustration. Clean, professional, and visually impressive while remaining accessible and friendly.`,
  },
  {
    name: 'parent-dashboard',
    prompt: `Illustrate a heartwarming scene of a parent and child sharing a moment of pride while reviewing learning progress together, showcasing the family connection in education.

THE MOMENT: A parent and child sit together, both looking at a laptop screen that displays a colorful progress dashboard. The parent has an arm around the child or a hand on their shoulder. Both wear expressions of warm pride and connection - the parent proud of their child, the child happy to share their accomplishments.

THE DASHBOARD: On the laptop screen, we see a beautifully designed dashboard with colorful charts, progress bars, star ratings, and achievement badges - all represented visually without readable text. Greens and golds suggest positive progress. The interface looks modern and friendly.

THE CHARACTERS: The parent and child should feel relatable and warm. Any configuration (mother/father with son/daughter) works, with diverse representation welcome. Their body language shows closeness, support, and shared joy. The child might be pointing at something on screen, excitedly sharing a recent achievement.

ENVIRONMENT: A cozy home setting - a comfortable couch or at a kitchen table, warm evening light, family photos suggested in the background (as shapes, not detailed images). The space feels lived-in and loving.

LIGHTING: Warm, soft lighting that creates an intimate family moment. The laptop screen provides a gentle glow that illuminates both faces. Golden hour light from a window adds warmth.

EMOTIONAL TONE: This image should make parents feel that they can be connected to their child's learning journey. It's about partnership, pride, and family involvement in education.

STYLE: Warm, emotive illustration style similar to touching family moments in animated films. Expressive characters, rich atmosphere, and emotional storytelling.`,
  },
  {
    name: 'safety-family',
    prompt: `Create a reassuring, warm illustration conveying the safety and security of the learning platform, showing a happy family protected while learning together digitally.

THE PROTECTION CONCEPT: A happy, diverse family (two parents and two children) sits together using various devices (tablets, laptop) for learning. Around them, a gentle, translucent shield or bubble of soft blue-white light provides a sense of protection. The shield should feel comforting and safe, not like a barrier.

THE FAMILY: The family members are relaxed and happy, engaged with their devices and occasionally with each other. Their body language shows comfort and trust. One child might be showing something on their tablet to a parent, another might be focused on their own screen. The parents look relaxed and confident.

THE SHIELD EFFECT: The protective element should be subtle and beautiful - perhaps a soft glow around the family, gentle sparkles along its edge, or a comforting light that seems to embrace them. It suggests digital safety without being heavy-handed. Think of it as a warm hug of light.

ENVIRONMENT: A cozy living room setting with comfortable furniture, warm lighting, and homey details. The space outside the family group might be slightly cooler in tone, emphasizing the warmth and safety within their protected space.

LIGHTING: Warm, golden light emanates from within the protected space, while the protective shield has a soft blue-white glow. The combination creates a sense of technology and warmth working together.

SYMBOLIC ELEMENTS: Subtle trust indicators might be included - a small shield icon, a gentle lock symbol, stars suggesting quality - all integrated naturally into the scene without being obtrusive.

STYLE: Reassuring, warm illustration style that builds trust with parents. The image should say "your children are safe here" without being scary about what they're being protected from.`,
  },
  {
    name: 'celebration',
    prompt: `Design a joyful, triumphant celebration scene showing diverse children experiencing the thrill of educational achievement, perfect for conveying the rewards of learning.

THE CELEBRATION: An exuberant scene of four to five diverse children in full celebration mode - jumping, arms raised, high-fiving, laughing with pure joy. This is the moment of triumph - completing a goal, mastering a subject, earning an achievement. The energy is infectious and positive.

THE CHILDREN: Each child shows a different expression of joy - one might be mid-jump with arms stretched toward the sky, another doing a victory pose, others hugging or high-fiving. They're diverse in ethnicity, gender, and style, united in their celebration. Their expressions are genuinely joyful - wide smiles, sparkling eyes, pure happiness.

CELEBRATORY ELEMENTS: Confetti rains down in rainbow colors. Gold stars and sparkles burst around the group. Trophy and medal shapes might float nearby. Ribbons and streamers add to the festive atmosphere. Books and learning materials are incorporated into the celebration - perhaps tossed joyfully in the air or clutched proudly.

BACKGROUND: An energetic, warm gradient that supports the celebration without competing - perhaps warm yellows transitioning to cheerful oranges. Light rays might emanate from behind the group, adding to the triumphant feel.

LIGHTING: Bright, warm, and dynamic lighting that makes everything feel alive with energy. Highlights catch the confetti and sparkles, creating visual excitement throughout the scene.

COLOR PALETTE: Vibrant celebration colors - golds, bright blues, warm oranges, festive purples, joyful greens. The palette should feel like a party, graduation, and championship victory all rolled into one.

STYLE: Dynamic, expressive cartoon style with high energy and movement. Think of the celebratory moments in sports films or achievement screens in beloved video games - pure, earned joy.`,
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

    // The prompts already contain comprehensive style guidance
    // Add only critical requirements that should apply to all images
    const enhancedPrompt = `${prompt}

UNIVERSAL REQUIREMENTS FOR THIS IMAGE:
- The image must be completely safe and appropriate for children of all ages
- Do NOT include any readable text, words, letters, or numbers in the image
- All characters should appear friendly, warm, and welcoming
- The final image should be high-resolution and suitable for professional website use
- Render with consistent lighting and color grading throughout the scene`;

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
