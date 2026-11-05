import { describe, expect, it } from 'vitest';
import { collectPublishKeys } from './art';

describe('collectPublishKeys', () => {
  it('accepts uuid and slug project keys', () => {
    const keys = collectPublishKeys(
      [
        {
          image_key: '2b28beba-09cb-4786-982c-403399515548-1.png',
          mask_key: '2b28beba-09cb-4786-982c-403399515548-1-mask.png',
        },
        { image_key: 'demo-proj-red-cat-1.png', mask_key: null },
      ],
      '{}',
    );
    expect(keys).toContain('2b28beba-09cb-4786-982c-403399515548-1.png');
    expect(keys).toContain('2b28beba-09cb-4786-982c-403399515548-1-mask.png');
    expect(keys).toContain('demo-proj-red-cat-1.png');
  });

  it('rejects traversal and non-png keys', () => {
    const keys = collectPublishKeys(
      [
        { image_key: '../../etc/passwd', mask_key: null },
        { image_key: '/abs-1.png', mask_key: null },
        { image_key: 'demo-proj-red-cat-1.jpg', mask_key: null },
      ],
      'see /api/ai/art/../../x and /api/ai/art/flash-A1-cat.png',
    );
    expect(keys).toEqual(['flash-A1-cat.png']);
  });
});
