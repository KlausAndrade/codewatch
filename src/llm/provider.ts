import { generateText, type LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { groq } from '@ai-sdk/groq';
import type { LLMProvider } from '../config.js';

export interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

function getModelForProvider(provider: LLMProvider): LanguageModel {
  switch (provider) {
    case 'google':
      return google(process.env.CODEWATCH_GOOGLE_MODEL || 'gemini-2.5-flash');
    case 'openai':
      return openai(process.env.CODEWATCH_OPENAI_MODEL || 'gpt-4o-mini');
    case 'groq':
      return groq(process.env.CODEWATCH_GROQ_MODEL || 'llama-3.3-70b-versatile');
    default:
      return google('gemini-2.5-flash');
  }
}

function detectProvider(): { primary: LLMProvider; fallback: LLMProvider | null } {
  const primary = (process.env.CODEWATCH_LLM_PROVIDER as LLMProvider) || 'google';
  const fallback = (process.env.CODEWATCH_FALLBACK_PROVIDER as LLMProvider | 'none') || 'openai';
  return {
    primary,
    fallback: fallback === 'none' ? null : fallback as LLMProvider,
  };
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const { primary, fallback } = detectProvider();

  try {
    const { text } = await generateText({
      model: getModelForProvider(primary),
      system: options.systemPrompt,
      prompt: options.userPrompt,
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 4096,
    });
    return text;
  } catch (error) {
    if (fallback) {
      console.error(`Primary LLM (${primary}) failed, trying fallback (${fallback}):`, error);
      const { text } = await generateText({
        model: getModelForProvider(fallback),
        system: options.systemPrompt,
        prompt: options.userPrompt,
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxTokens ?? 4096,
      });
      return text;
    }
    throw error;
  }
}
