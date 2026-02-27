import { describe, it, expect } from 'vitest';
import { categorize, getDefaultPriority } from '../../src/agents/categorizer.js';

describe('Categorizer - Heuristic', () => {
  it('categorizes bug-related content', async () => {
    const result = await categorize('Fixed the authentication bug in middleware', false);
    expect(result).toBe('bugfix');
  });

  it('categorizes architecture decisions', async () => {
    const result = await categorize('Decided to use repository pattern for data access layer', false);
    expect(result).toBe('architecture');
  });

  it('categorizes dependency choices', async () => {
    const result = await categorize('Install zod package version 3.23 for validation', false);
    expect(result).toBe('dependency');
  });

  it('categorizes user preferences', async () => {
    const result = await categorize('I prefer using TypeScript strict mode always', false);
    expect(result).toBe('user_preference');
  });

  it('categorizes conventions', async () => {
    const result = await categorize('Use camelCase naming convention for all variables', false);
    expect(result).toBe('convention');
  });

  it('categorizes task context', async () => {
    const result = await categorize('Currently working on implementing the auth sprint deadline Friday', false);
    expect(result).toBe('task_context');
  });

  it('categorizes file-heavy content as file_pattern', async () => {
    const result = await categorize(
      'Key files: src/auth/middleware.ts, src/auth/guard.ts, src/auth/token.ts handle authentication',
      false,
    );
    expect(result).toBe('file_pattern');
  });

  it('defaults to learning for ambiguous content', async () => {
    const result = await categorize('The system behaves oddly when caching is enabled', false);
    expect(result).toBe('learning');
  });
});

describe('Default Priority', () => {
  it('returns high for architecture', () => {
    expect(getDefaultPriority('architecture')).toBe('high');
  });

  it('returns high for user_preference', () => {
    expect(getDefaultPriority('user_preference')).toBe('high');
  });

  it('returns medium for bugfix', () => {
    expect(getDefaultPriority('bugfix')).toBe('medium');
  });

  it('returns medium for learning', () => {
    expect(getDefaultPriority('learning')).toBe('medium');
  });
});
