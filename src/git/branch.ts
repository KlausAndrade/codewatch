import { simpleGit } from 'simple-git';
import type { CodewatchConfig } from '../config.js';

let cachedBranch: string | null = null;
let cachedAt: number = 0;
const CACHE_TTL_MS = 10_000;

export async function getCurrentBranch(config: CodewatchConfig): Promise<string> {
  const now = Date.now();
  if (cachedBranch && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedBranch;
  }

  try {
    const git = simpleGit(config.projectDir);
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

    if (branch === 'HEAD') {
      const sha = (await git.revparse(['HEAD'])).trim();
      cachedBranch = `detached-${sha.substring(0, 8)}`;
    } else {
      cachedBranch = branch;
    }
  } catch {
    cachedBranch = config.defaultBranch;
  }

  cachedAt = now;
  return cachedBranch!;
}

export function invalidateBranchCache(): void {
  cachedBranch = null;
  cachedAt = 0;
}
