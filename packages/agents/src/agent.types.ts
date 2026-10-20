import type { Message, ToolSpecification, TokenUsage } from '@aws-sdk/client-bedrock-runtime';

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: NonNullable<ToolSpecification['inputSchema']>;
  /** Validate untrusted model input before performing an operation. */
  execute(input: unknown, signal?: AbortSignal): Promise<string>;
}

export interface AgentOptions {
  readonly system?: string;
  readonly tools?: readonly AgentTool[];
  /** Maximum model calls per run, including the final response. Defaults to 8. */
  readonly maxTurns?: number;
  /** Maximum tool executions per run. Defaults to 16. */
  readonly maxToolCalls?: number;
}

export interface AgentResult {
  readonly text: string;
  /** Full conversation, preserving signed thinking and tool blocks for subsequent turns. */
  readonly messages: Message[];
  readonly usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens' | 'totalTokens'>;
  readonly turns: number;
}
