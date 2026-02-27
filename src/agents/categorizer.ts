import { callLLM } from '../llm/provider.js';
import { CATEGORIZER_PROMPT } from './prompts.js';

const VALID_CATEGORIES = [
  'architecture', 'bugfix', 'convention', 'dependency',
  'file_pattern', 'user_preference', 'task_context', 'learning',
] as const;

type Category = typeof VALID_CATEGORIES[number];

interface HeuristicResult {
  category: Category;
  confidence: number;
}

const KEYWORD_RULES: Array<{ keywords: string[]; category: Category; weight: number }> = [
  { keywords: ['bug', 'fix', 'error', 'exception', 'crash', 'broken', 'issue', 'regression', 'stack trace', 'debug'], category: 'bugfix', weight: 1 },
  { keywords: ['decided', 'chose', 'architecture', 'pattern', 'design', 'approach', 'strategy', 'refactor', 'restructure'], category: 'architecture', weight: 1 },
  { keywords: ['install', 'package', 'dependency', 'version', 'upgrade', 'downgrade', 'npm', 'composer', 'pip'], category: 'dependency', weight: 1 },
  { keywords: ['prefer', 'always', 'never', 'i like', 'i want', 'i need', 'my preference', 'i use'], category: 'user_preference', weight: 1.2 },
  { keywords: ['convention', 'naming', 'style', 'format', 'lint', 'prettier', 'camelcase', 'kebab', 'snake_case'], category: 'convention', weight: 1 },
  { keywords: ['task', 'working on', 'sprint', 'deadline', 'milestone', 'goal', 'building', 'implementing'], category: 'task_context', weight: 0.8 },
  { keywords: ['learned', 'discovered', 'found out', 'gotcha', 'turns out', 'realized', 'noticed'], category: 'learning', weight: 0.9 },
];

function heuristicCategorize(content: string): HeuristicResult {
  const lower = content.toLowerCase();

  // Check if content is heavily file-path oriented
  const filePathCount = (content.match(/[\w/-]+\.\w+/g) || []).length;
  if (filePathCount >= 3) {
    return { category: 'file_pattern', confidence: 0.8 };
  }

  let bestCategory: Category = 'learning';
  let bestScore = 0;

  for (const rule of KEYWORD_RULES) {
    let matchCount = 0;
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        matchCount++;
      }
    }
    const score = (matchCount / rule.keywords.length) * rule.weight;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  // Map score to confidence (at least 1 keyword match = 0.5+)
  const confidence = bestScore > 0 ? Math.min(0.5 + bestScore * 2, 1.0) : 0.3;

  return { category: bestCategory, confidence };
}

export async function categorize(content: string, useLLMFallback: boolean = true): Promise<Category> {
  const heuristic = heuristicCategorize(content);

  if (heuristic.confidence >= 0.7) {
    return heuristic.category;
  }

  if (!useLLMFallback) {
    return heuristic.category;
  }

  try {
    const prompt = CATEGORIZER_PROMPT.replace('{content}', content);
    const result = await callLLM({
      systemPrompt: 'You are a classification agent. Reply with ONLY the category name, nothing else.',
      userPrompt: prompt,
      temperature: 0,
      maxTokens: 20,
    });

    const cleaned = result.trim().toLowerCase();
    if (VALID_CATEGORIES.includes(cleaned as Category)) {
      return cleaned as Category;
    }
  } catch {
    // LLM fallback failed, use heuristic result
  }

  return heuristic.category;
}

export function getDefaultPriority(category: Category): 'high' | 'medium' | 'low' {
  switch (category) {
    case 'architecture':
    case 'user_preference':
      return 'high';
    case 'bugfix':
    case 'convention':
    case 'dependency':
    case 'file_pattern':
      return 'medium';
    case 'task_context':
    case 'learning':
      return 'medium';
    default:
      return 'medium';
  }
}
