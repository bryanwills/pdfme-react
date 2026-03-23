import { describe, expect, it } from 'vitest';
import { image, signature } from '../src/index.js';

describe('signature plugin', () => {
  it('exports the official signature plugin', () => {
    expect(signature.pdf).toBe(image.pdf);
    expect(signature.propPanel.defaultSchema.type).toBe('signature');
    expect(signature.propPanel.defaultSchema.width).toBe(62.5);
    expect(signature.propPanel.defaultSchema.height).toBe(37.5);
  });
});
