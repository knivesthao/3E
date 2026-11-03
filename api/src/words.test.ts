import { describe, expect, it } from 'vitest';
import { flagHardPages } from './ai/words';

const CAST = '{"characters":[],"places":[]}';

describe('flagHardPages', () => {
  it('passes level-clean scenes', () => {
    const pages = flagHardPages(
      [{ scene_number: 1, narration: 'A boy sees a red dog.', bubbles: [] }],
      'A1',
      CAST,
    );
    expect(pages).toEqual([]);
  });

  it('flags off-level words per scene, not the whole book', () => {
    const pages = flagHardPages(
      [
        { scene_number: 1, narration: 'A boy sees a red dog.', bubbles: [] },
        { scene_number: 2, narration: 'Photosynthesis baffles xenobiologists.', bubbles: [] },
      ],
      'A1',
      CAST,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].scene_number).toBe(2);
    expect(pages[0].unknown).toContain('photosynthesis');
  });

  it('exempts cast names like /finish does', () => {
    const pages = flagHardPages(
      [{ scene_number: 1, narration: 'Noy sees a red dog.', bubbles: [{ speaker: 'Noy', text: 'Run!' }] }],
      'A1',
      '{"characters":[{"name":"Noy"}],"places":[]}',
    );
    expect(pages).toEqual([]);
  });
});
