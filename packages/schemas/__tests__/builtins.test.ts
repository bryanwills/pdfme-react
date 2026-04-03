import { describe, expect, it } from 'vitest';
import { builtInPlugins, text } from '../src/index.js';

describe('builtInPlugins', () => {
  it('keeps the default plugin surface text-only', () => {
    expect(Object.keys(builtInPlugins)).toEqual(['Text']);
    expect(builtInPlugins.Text).toBe(text);
  });
});
