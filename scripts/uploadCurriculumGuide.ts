/**
 * Upload Curriculum Guide to R2 CDN
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { uploadFile } from '../src/services/storage/storageService.js';

async function uploadCurriculumGuide() {
  const localPath = path.join(process.cwd(), 'public', 'downloads', 'Orbit-Learn-Curriculum-Guide.pdf');

  if (!fs.existsSync(localPath)) {
    console.error('❌ PDF file not found at:', localPath);
    console.error('   Run generateCurriculumGuide.ts first');
    process.exit(1);
  }

  console.log('📤 Uploading Curriculum Guide to R2 CDN...\n');

  const fileBuffer = fs.readFileSync(localPath);
  const storagePath = 'downloads/Orbit-Learn-Curriculum-Guide.pdf';

  try {
    const result = await uploadFile(
      'static',
      storagePath,
      fileBuffer,
      'application/pdf',
      {
        'content-disposition': 'attachment; filename="Orbit-Learn-Curriculum-Guide.pdf"',
        'cache-control': 'public, max-age=31536000', // 1 year cache
      }
    );

    console.log('✅ Upload successful!\n');
    console.log(`   Storage Path: ${result.storagePath}`);
    console.log(`   Public URL: ${result.publicUrl}`);
    console.log(`   Size: ${(result.size / 1024).toFixed(1)} KB`);
    console.log(`\n🔗 CDN URL: ${result.publicUrl}`);

  } catch (error) {
    console.error('❌ Upload failed:', error);
    process.exit(1);
  }
}

uploadCurriculumGuide();
