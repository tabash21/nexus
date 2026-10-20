import type { Tool, ToolConfiguration, ToolUseBlock } from '@aws-sdk/client-bedrock-runtime';
import type { AgentTool } from './agent.types.js';
import { AgentConfigurationError, AgentResponseError } from './errors.js';

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export interface ResolvedToolCall {
  readonly toolUseId: string;
  readonly input: unknown;
  readonly tool: AgentTool;
}

const toToolSpec = ({ name, description, inputSchema }: AgentTool): Tool => ({
  toolSpec: { name, description, inputSchema },
});

/** Immutable, validated set of tools available to a single agent. */
export class ToolRegistry {
  private readonly byName: ReadonlyMap<string, AgentTool>;
  /** Precomputed Bedrock tool configuration; undefined when no tools are registered. */
  readonly toolConfig: ToolConfiguration | undefined;

  constructor(tools: readonly AgentTool[] = []) {
    const byName = new Map<string, AgentTool>();
    for (const tool of tools) {
      if (!TOOL_NAME_PATTERN.test(tool.name)) {
        throw new AgentConfigurationError('Invalid agent tool name.');
      }
      if (byName.has(tool.name)) {
        throw new AgentConfigurationError(`Duplicate agent tool: ${tool.name}`);
      }
      byName.set(tool.name, tool);
    }
    this.byName = byName;
    this.toolConfig = byName.size ? { tools: [...byName.values()].map(toToolSpec) } : undefined;
  }

  /** Resolves the whole batch up front so no tool runs if any request is invalid. */
  resolve(requests: readonly ToolUseBlock[]): ResolvedToolCall[] {
    return requests.map(({ toolUseId, name, input }) => {
      const tool = name === undefined ? undefined : this.byName.get(name);
      if (!tool || !toolUseId) {
        throw new AgentResponseError('Bedrock requested an unknown or malformed tool.');
      }
      return { toolUseId, input, tool };
    });
  }
}
