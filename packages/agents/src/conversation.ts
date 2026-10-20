import type { Message, ToolUseBlock } from '@aws-sdk/client-bedrock-runtime';
import type { TokenUsageTotals } from './agent.types.js';
import { AgentConfigurationError } from './errors.js';

export function toInitialMessages(input: string | readonly Message[]): Message[] {
  // Clone caller-owned history so the run never mutates it.
  const messages: Message[] =
    typeof input === 'string' ? [{ role: 'user', content: [{ text: input }] }] : structuredClone([...input]);
  if (!messages.length) {
    throw new AgentConfigurationError('An agent run needs at least one message.');
  }
  return messages;
}

export const extractText = (message: Message): string =>
  (message.content ?? []).flatMap(block => (block.text === undefined ? [] : [block.text])).join('\n');

export const extractToolUses = (message: Message): ToolUseBlock[] =>
  (message.content ?? []).flatMap(block => (block.toolUse ? [block.toolUse] : []));

export const toolResultMessage = (results: readonly { toolUseId: string; text: string }[]): Message => ({
  role: 'user',
  content: results.map(({ toolUseId, text }) => ({
    toolResult: { toolUseId, status: 'success', content: [{ text }] },
  })),
});

export const emptyUsage = (): TokenUsageTotals => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

export const addUsage = (total: TokenUsageTotals, turn: Partial<TokenUsageTotals> = {}): TokenUsageTotals => ({
  inputTokens: total.inputTokens + (turn.inputTokens ?? 0),
  outputTokens: total.outputTokens + (turn.outputTokens ?? 0),
  totalTokens: total.totalTokens + (turn.totalTokens ?? 0),
});
