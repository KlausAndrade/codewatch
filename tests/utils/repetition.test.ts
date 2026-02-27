import { describe, it, expect } from 'vitest';
import { detectDegenerateRepetition } from '../../src/utils/repetition.js';

describe('Degenerate Repetition Detection', () => {
  it('returns false for normal text', () => {
    const text = `
- Fixed authentication bug in middleware
- Added rate limiting to API endpoints
- Chose Redis for session storage
- Updated Docker configuration
- Refactored user service module
- Added pagination to search results
- Implemented webhook handler
    `.trim();

    expect(detectDegenerateRepetition(text)).toBe(false);
  });

  it('returns false for fewer than 6 lines', () => {
    const text = `
- Same observation
- Same observation
- Same observation
    `.trim();

    expect(detectDegenerateRepetition(text)).toBe(false);
  });

  it('detects exact duplicate lines (>30%)', () => {
    const text = `
- Fixed the bug
- Fixed the bug
- Fixed the bug
- Fixed the bug
- Something different
- Another thing
- Fixed the bug
    `.trim();

    expect(detectDegenerateRepetition(text)).toBe(true);
  });

  it('detects high word overlap in consecutive lines', () => {
    const text = `
- The user wants to implement authentication using JWT tokens
- The user wants to implement authentication using OAuth tokens
- The user wants to implement authentication using session tokens
- Something completely different here
- Another unique observation
- Yet another observation
    `.trim();

    expect(detectDegenerateRepetition(text)).toBe(true);
  });

  it('detects substring repetition patterns', () => {
    // Each line starts with "- " so the filter picks them up, and the repeated substring is long enough
    const lines = Array(6).fill('- Fixed the authentication bug in the middleware layer for the API endpoint handler');
    const text = lines.join('\n');

    expect(detectDegenerateRepetition(text)).toBe(true);
  });
});
