import { describe, expect, it } from 'vitest';
import { fitWithin } from './image';

describe('photo resize', () => {
  it('caps the longest side at 1600px keeping aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ w: 1200, h: 1600 });
    expect(fitWithin(1600, 900)).toEqual({ w: 1600, h: 900 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });
});
