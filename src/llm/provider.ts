import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';

export interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

type ModelProvider = 'google' | 'openai';

function getModel(provider: ModelProvider, modelName?: string) {
  switch (provider) {
    case 'google':
      return google(modelName || 'gemini-2.5-flash');
    case 'openai':
      return openai(modelName || 'gpt-4o-mini');
    default:
      return google('gemini-2.5-flash');
  }
}

function detectProvider(): { primary: ModelProvider; fallback: ModelProvider | null } {
  const primary = (process.env.CODEWATCH_LLM_PROVIDER as ModelProvider) || 'google';
  const fallback = (process.env.CODEWATCH_FALLBACK_PROVIDER as ModelProvider | 'none') || 'openai';
  return {
    primary,
    fallback: fallback === 'none' ? null : fallback as ModelProvider,
  };
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const { primary, fallback } = detectProvider();
  const primaryModel = process.env.CODEWATCH_GOOGLE_MODEL || process.env.CODEWATCH_OPENAI_MODEL;

  try {
    const { text } = await generateText({
      model: getModel(primary, primary === 'google' ? process.env.CODEWATCH_GOOGLE_MODEL : process.env.CODEWATCH_OPENAI_MODEL),
      system: options.systemPrompt,
      prompt: options.userPrompt,
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 4096,
    });
    return text;
  } catch (error) {
    if (fallback) {
      console.error(`Primary LLM (${primary}) failed, trying fallback (${fallback}):`, error);
      const { text } = await generateText({
        model: getModel(fallback, fallback === 'google' ? process.env.CODEWATCH_GOOGLE_MODEL : process.env.CODEWATCH_OPENAI_MODEL),
        system: options.systemPrompt,
        prompt: options.userPrompt,
        temperature: options.temperature ?? 0.3,
        maxTokens: options.maxTokens ?? 4096,
      });
      return text;
    }
    throw error;
  }
}
