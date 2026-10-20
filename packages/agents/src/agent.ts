import type { Message } from '@aws-sdk/client-bedrock-runtime';
import type { AgentOptions, AgentResult } from './agent.types.js';
import type { BedrockRuntime } from './bedrock.resources.js';
import {
  addUsage,
  emptyUsage,
  extractText,
  extractToolUses,
  toInitialMessages,
  toolResultMessage,
} from './conversation.js';
import { AgentConfigurationError, AgentLimitError, AgentResponseError } from './errors.js';
import { CLAUDE_SONNET_5_5, type ModelConfig } from './models.js';
import { buildConverseRequest } from './request.js';
import { ToolRegistry, type ResolvedToolCall } from './tools.js';

export const DEFAULT_MAX_TURNS = 8;
export const DEFAULT_MAX_TOOL_CALLS = 16;

function requirePositiveLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new AgentConfigurationError('Agent limits must be positive safe integers.');
  }
  return limit;
}

/** Bounded, sequential tool execution over Bedrock Converse. No tools are registered implicitly. */
export class BedrockAgent {
  private readonly tools: ToolRegistry;
  private readonly maxTurns: number;
  private readonly maxToolCalls: number;

  constructor(
    private readonly runtime: BedrockRuntime,
    private readonly options: AgentOptions = {},
    private readonly model: ModelConfig = CLAUDE_SONNET_5_5,
  ) {
    this.maxTurns = requirePositiveLimit(options.maxTurns ?? DEFAULT_MAX_TURNS);
    this.maxToolCalls = requirePositiveLimit(options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS);
    this.tools = new ToolRegistry(options.tools);
  }

  async run(input: string | readonly Message[], signal?: AbortSignal): Promise<AgentResult> {
    const messages = toInitialMessages(input);
    let usage = emptyUsage();
    let toolCallsUsed = 0;

    for (let turn = 1; ; turn++) {
      const response = await this.requestTurn(messages, signal);
      messages.push(response.message);
      usage = addUsage(usage, response.usage);

      switch (response.stopReason) {
        case 'end_turn':
          return {
            text: extractText(response.message),
            messages,
            usage,
            turns: turn,
          };
        case 'tool_use':
          break;
        default:
          throw new AgentResponseError(`Agent response incomplete: ${response.stopReason ?? 'unknown stop reason'}`);
      }

      if (turn >= this.maxTurns) {
        throw new AgentLimitError('Agent model turn limit reached.');
      }

      const calls = this.planToolCalls(response.message, toolCallsUsed);
      messages.push(await this.executeToolCalls(calls, signal));
      toolCallsUsed += calls.length;
    }
  }

  private async requestTurn(messages: readonly Message[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const response = await this.runtime.converse(
      buildConverseRequest({
        model: this.model,
        messages,
        system: this.options.system,
        toolConfig: this.tools.toolConfig,
      }),
      signal,
    );
    signal?.throwIfAborted();

    const message = response.output?.message;
    if (message?.role !== 'assistant') {
      throw new AgentResponseError('Bedrock returned no assistant message.');
    }
    return { message, stopReason: response.stopReason, usage: response.usage };
  }

  /** Validates the requested batch against budgets and the registry before any side effect. */
  private planToolCalls(message: Message, used: number): ResolvedToolCall[] {
    const requests = extractToolUses(message);
    if (!requests.length) {
      throw new AgentResponseError('Bedrock requested tools without any tool calls.');
    }
    if (used + requests.length > this.maxToolCalls) {
      throw new AgentLimitError('Agent tool call limit reached.');
    }
    return this.tools.resolve(requests);
  }

  /** Executes sequentially by design: tools may have ordered side effects and must observe cancellation. */
  private async executeToolCalls(calls: readonly ResolvedToolCall[], signal?: AbortSignal): Promise<Message> {
    const results: { toolUseId: string; text: string }[] = [];
    for (const { toolUseId, input, tool } of calls) {
      signal?.throwIfAborted();
      results.push({ toolUseId, text: await tool.execute(input, signal) });
    }
    return toolResultMessage(results);
  }
}
