import PptxParser from 'node-pptx-parser';

async function main() {
  const parser = new PptxParser('/Users/saleemjadallah/Downloads/G6_T2_W16_Articles.pptx');
  
  try {
    const textContent = await parser.extractText();
    
    console.log(`Total slides: ${textContent.length}\n`);
    
    textContent.forEach((slide) => {
      console.log(`\n=== SLIDE ${slide.id} ===`);
      console.log(slide.text.join('\n'));
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
