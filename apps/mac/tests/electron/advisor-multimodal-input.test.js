import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  COMPANION_MAX_IMAGE_INPUTS,
  assertCompanionMultimodalInput,
  collectCompanionImageDataUrls
} = require('../../src/main/advisor-multimodal-input.cjs');

function dataUrl(index = 0) {
  return `data:image/png;base64,${Buffer.from(`image-${index}`).toString('base64')}`;
}

describe('Companion multimodal input boundary', () => {
  it('accepts and counts a 40-image Responses payload', () => {
    const input = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Review these.' },
          ...Array.from({ length: 40 }, (_, index) => ({
            type: 'input_image',
            image_url: dataUrl(index)
          }))
        ]
      }
    ];

    expect(assertCompanionMultimodalInput(input)).toMatchObject({ count: 40 });
    expect(collectCompanionImageDataUrls(input)).toHaveLength(40);
  });

  it('accepts Chat Completions image parts and rejects unsafe or excessive input', () => {
    expect(
      assertCompanionMultimodalInput([
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: dataUrl(1) } }]
        }
      ])
    ).toMatchObject({ count: 1 });

    expect(() =>
      assertCompanionMultimodalInput([
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: 'https://example.test/image.png' }]
        }
      ])
    ).toThrow(/data URLs/i);

    expect(() =>
      assertCompanionMultimodalInput([
        {
          role: 'user',
          content: Array.from({ length: COMPANION_MAX_IMAGE_INPUTS + 1 }, (_, index) => ({
            type: 'input_image',
            image_url: dataUrl(index)
          }))
        }
      ])
    ).toThrow(/up to 50 images/i);
  });
});
