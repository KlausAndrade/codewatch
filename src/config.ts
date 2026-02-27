import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CodewatchConfig {
  dataDir: string;
  llmProvider: 'google' | 'openai';
  fallbackProvider: 'google' | 'openai' | 'none';
  googleModel: string;
  openaiModel: string;
  reflectThreshold: number;
  charsPerToken: number;
  autoReflect: boolean;
  maxCompressionLevel: number;
  projectDir: string;
  defaultBranch: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(): CodewatchConfig {
  return {
    dataDir: process.env.CODEWATCH_DATA_DIR || join(homedir(), 'mcp-data', 'codewatch-memory'),
    llmProvider: (process.env.CODEWATCH_LLM_PROVIDER as 'google' | 'openai') || 'google',
    fallbackProvider: (process.env.CODEWATCH_FALLBACK_PROVIDER as 'google' | 'openai' | 'none') || 'openai',
    googleModel: process.env.CODEWATCH_GOOGLE_MODEL || 'gemini-2.5-flash',
    openaiModel: process.env.CODEWATCH_OPENAI_MODEL || 'gpt-4o-mini',
    reflectThreshold: parseInt(process.env.CODEWATCH_REFLECT_THRESHOLD || '40000', 10),
    charsPerToken: parseFloat(process.env.CODEWATCH_CHARS_PER_TOKEN || '4'),
    autoReflect: process.env.CODEWATCH_AUTO_REFLECT !== 'false',
    maxCompressionLevel: parseInt(process.env.CODEWATCH_MAX_COMPRESSION || '3', 10),
    projectDir: process.env.CODEWATCH_PROJECT_DIR || process.cwd(),
    defaultBranch: process.env.CODEWATCH_DEFAULT_BRANCH || 'main',
    logLevel: (process.env.CODEWATCH_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  };
}
