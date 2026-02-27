import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateObservationTokens } from '../../src/utils/tokens.js';

describe('Token Estimation', () => {
  it('estimates tokens from text length', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 chars / 4 = 1.25, ceil = 2
    expect(estimateTokens('a'.repeat(100))).toBe(25); // 100 / 4 = 25
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates tokens for array of observations', () => {
    const observations = [
      { content: 'a'.repeat(40) }, // 10 tokens
      { content: 'b'.repeat(80) }, // 20 tokens
    ];
    expect(estimateObservationTokens(observations)).toBe(30);
  });

  it('handles single character', () => {
    expect(estimateTokens('x')).toBe(1);
  });
});
