import { describe, it, expect } from 'vitest';
import { sanitizeObservationLines, truncateObservation, parseXmlBlock } from '../../src/utils/sanitize.js';

describe('sanitizeObservationLines', () => {
  it('keeps lines under the limit unchanged', () => {
    const text = 'Short line\nAnother short line';
    expect(sanitizeObservationLines(text)).toBe(text);
  });

  it('truncates lines over 10000 chars', () => {
    const longLine = 'x'.repeat(15000);
    const result = sanitizeObservationLines(longLine);
    expect(result.length).toBeLessThan(15000);
    expect(result).toContain('...');
  });
});

describe('truncateObservation', () => {
  it('keeps short text unchanged', () => {
    expect(truncateObservation('hello world')).toBe('hello world');
  });

  it('truncates text over 500 chars', () => {
    const long = 'a'.repeat(600);
    const result = truncateObservation(long);
    expect(result.length).toBe(500);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('parseXmlBlock', () => {
  it('extracts content from XML tags', () => {
    const text = 'prefix <observations>some content</observations> suffix';
    expect(parseXmlBlock(text, 'observations')).toBe('some content');
  });

  it('handles multiline content', () => {
    const text = `<current-task>
Building the auth module
</current-task>`;
    expect(parseXmlBlock(text, 'current-task')).toBe('Building the auth module');
  });

  it('returns null for missing tags', () => {
    expect(parseXmlBlock('no tags here', 'observations')).toBeNull();
  });

  it('returns null for malformed tags', () => {
    expect(parseXmlBlock('<observations>no closing tag', 'observations')).toBeNull();
  });
});
