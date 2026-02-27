import { readFileSync } from 'node:fs';

export interface TranscriptMessage {
  role: string;
  content: string;
  type?: string;
  tool_name?: string;
  tool_input?: unknown;
}

/**
 * Parse a Claude Code transcript JSONL file and extract human-readable messages.
 * Returns only the last N messages (from the end of the file).
 */
export function parseTranscript(transcriptPath: string, lastN: number = 20): TranscriptMessage[] {
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.trim().split('\n').filter(Boolean);
  const messages: TranscriptMessage[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Handle different transcript entry formats
      if (entry.type === 'user' || entry.role === 'user') {
        const content = extractContent(entry.content || entry.message);
        if (content) {
          messages.push({ role: 'user', content });
        }
      } else if (entry.type === 'assistant' || entry.role === 'assistant') {
        const content = extractContent(entry.content || entry.message);
        if (content) {
          messages.push({ role: 'assistant', content });
        }

        // Also capture tool use
        if (entry.content && Array.isArray(entry.content)) {
          for (const block of entry.content) {
            if (block.type === 'tool_use') {
              messages.push({
                role: 'assistant',
                content: `[Tool: ${block.name}] ${JSON.stringify(block.input).substring(0, 500)}`,
                type: 'tool_use',
                tool_name: block.name,
                tool_input: block.input,
              });
            }
          }
        }
      } else if (entry.type === 'tool_result' || entry.role === 'tool') {
        const content = extractContent(entry.content || entry.output);
        if (content) {
          messages.push({
            role: 'tool',
            content: content.substring(0, 1000), // Truncate tool results
            type: 'tool_result',
          });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Return only the last N messages
  return messages.slice(-lastN);
}

/**
 * Format transcript messages into a readable string for the Observer.
 */
export function formatMessagesForObserver(messages: TranscriptMessage[]): string {
  return messages
    .map((m) => {
      const prefix = m.role === 'user' ? 'USER' : m.role === 'tool' ? 'TOOL' : 'ASSISTANT';
      return `[${prefix}] ${m.content}`;
    })
    .join('\n\n');
}

function extractContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content.trim() || null;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .filter((block: any) => block.type === 'text' && block.text)
      .map((block: any) => block.text);
    return textParts.length > 0 ? textParts.join('\n').trim() : null;
  }

  return null;
}
