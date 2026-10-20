import type { ContentBlock, Message } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockRuntime } from './bedrock.resources.js';
import type { AgentOptions, AgentResult, AgentTool } from './agent.types.js';
import { CLAUDE_SONNET_5_5, type ModelConfig } from './models.js';

/** Bounded, sequential tool execution over Bedrock Converse. No tools are registered implicitly. */
export class BedrockAgent {
  private readonly tools: ReadonlyMap<string, AgentTool>;
  private readonly maxTurns: number;
  private readonly maxToolCalls: number;

  constructor(
    private readonly runtime: BedrockRuntime,
    private readonly options: AgentOptions = {},
    private readonly model: ModelConfig = CLAUDE_SONNET_5_5,
  ) {
    this.maxTurns = options.maxTurns ?? 8;
    this.maxToolCalls = options.maxToolCalls ?? 16;
    for (const limit of [this.maxTurns, this.maxToolCalls]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Agent limits must be positive safe integers.');
    }
    const tools = new Map<string, AgentTool>();
    for (const tool of options.tools ?? []) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error('Invalid agent tool name.');
      if (tools.has(tool.name)) throw new Error(`Duplicate agent tool: ${tool.name}`);
      tools.set(tool.name, tool);
    }
    this.tools = tools;
  }

  async run(input: string | readonly Message[], signal?: AbortSignal): Promise<AgentResult> {
    const messages: Message[] =
      typeof input === 'string' ? [{ role: 'user', content: [{ text: input }] }] : structuredClone([...input]);
    if (!messages.length) throw new Error('An agent run needs at least one message.');
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let toolCalls = 0;
    for (let turns = 1; turns <= this.maxTurns; turns++) {
      signal?.throwIfAborted();
      const response = await this.runtime.converse(
        {
          modelId: this.model.model_id,
          messages: [...messages],
          ...(this.options.system ? { system: [{ text: this.options.system }] } : {}),
          inferenceConfig: { maxTokens: this.model.params.max_tokens },
          additionalModelRequestFields: {
            thinking: { type: 'adaptive' },
            output_config: { effort: this.model.params.reasoning_effort },
          },
          ...(this.tools.size
            ? {
                toolConfig: {
                  tools: [...this.tools.values()].map(tool => ({
                    toolSpec: { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
                  })),
                },
              }
            : {}),
        },
        signal,
      );
      signal?.throwIfAborted();
      const message = response.output?.message;
      if (!message || message.role !== 'assistant') throw new Error('Bedrock returned no assistant message.');
      messages.push(message);
      usage.inputTokens += response.usage?.inputTokens ?? 0;
      usage.outputTokens += response.usage?.outputTokens ?? 0;
      usage.totalTokens += response.usage?.totalTokens ?? 0;
      if (response.stopReason === 'end_turn') {
        return {
          text: (message.content ?? []).flatMap(block => (block.text === undefined ? [] : [block.text])).join('\n'),
          messages,
          usage,
          turns,
        };
      }
      if (response.stopReason !== 'tool_use') {
        throw new Error(`Agent response incomplete: ${response.stopReason ?? 'unknown stop reason'}`);
      }
      if (turns === this.maxTurns) throw new Error('Agent model turn limit reached.');
      const requests = (message.content ?? []).flatMap(block => (block.toolUse ? [block.toolUse] : []));
      if (!requests.length) throw new Error('Bedrock requested tools without any tool calls.');
      if (toolCalls + requests.length > this.maxToolCalls) throw new Error('Agent tool call limit reached.');
      // Validate the whole batch before executing any tools.
      const calls = requests.map(request => {
        const tool = request.name ? this.tools.get(request.name) : undefined;
        if (!tool || !request.toolUseId) throw new Error('Bedrock requested an unknown or malformed tool.');
        return { request, tool };
      });
      const results: ContentBlock[] = [];
      for (const { request, tool } of calls) {
        signal?.throwIfAborted();
        const text = await tool.execute(request.input, signal);
        toolCalls++;
        results.push({ toolResult: { toolUseId: request.toolUseId!, status: 'success', content: [{ text }] } });
      }
      messages.push({ role: 'user', content: results });
    }
    throw new Error('Agent model turn limit reached.');
  }
}
