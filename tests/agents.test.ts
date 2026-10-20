import { describe, expect, it, vi } from 'vitest';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockAgent,
  CLAUDE_SONNET_5_5,
  bedrockClientConfig,
  inspectBedrockEnvironment,
  type AgentTool,
  type BedrockRuntime,
} from '@nexus/agents';

function reply(stopReason: ConverseCommandOutput['stopReason'] = 'end_turn'): ConverseCommandOutput {
  return {
    $metadata: {},
    metrics: { latencyMs: 1 },
    stopReason,
    output: { message: { role: 'assistant', content: [{ text: 'Done' }] } },
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  };
}

function toolReply(name = 'lookup'): ConverseCommandOutput {
  const result = reply('tool_use');
  result.output = {
    message: {
      role: 'assistant',
      content: [
        { reasoningContent: { reasoningText: { text: 'thinking', signature: 'signed-thinking' } } },
        { toolUse: { toolUseId: 'call-1', name, input: { query: 'example' } } },
      ],
    },
  };
  return result;
}

function runtime() {
  return { converse: vi.fn<BedrockRuntime['converse']>(), destroy: vi.fn() };
}

function lookup(): AgentTool {
  return {
    name: 'lookup',
    description: 'Look up a value',
    inputSchema: { json: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    execute: vi.fn<AgentTool['execute']>().mockResolvedValue('Found'),
  };
}

describe('Bedrock environment and credentials', () => {
  it('reports missing and blank credentials without disclosing values', () => {
    const status = inspectBedrockEnvironment({ AWS_BEARER_TOKEN_BEDROCK: ' ', AWS_ACCESS_KEY_ID: 'private-key' });
    expect(status).toEqual({
      AWS_BEARER_TOKEN_BEDROCK: false,
      AWS_ACCESS_KEY_ID: true,
      AWS_SECRET_ACCESS_KEY: false,
      authentication: null,
      ready: false,
    });
    expect(JSON.stringify(status)).not.toContain('private-key');
    expect(() => bedrockClientConfig(CLAUDE_SONNET_5_5, {})).toThrow('Set AWS_BEARER_TOKEN_BEDROCK');
  });

  it('prefers bearer authentication when both credential methods are present', () => {
    const env = { AWS_BEARER_TOKEN_BEDROCK: 'bearer', AWS_ACCESS_KEY_ID: 'key', AWS_SECRET_ACCESS_KEY: 'secret' };
    expect(inspectBedrockEnvironment(env).authentication).toBe('bearer');
    const config = bedrockClientConfig(CLAUDE_SONNET_5_5, env);
    expect(config.token).toEqual({ token: 'bearer' });
    expect(config.authSchemePreference).toEqual(['httpBearerAuth']);
    expect(config.credentials).toBeUndefined();
  });

  it('uses IAM credentials and preserves temporary session tokens', () => {
    const env = { AWS_ACCESS_KEY_ID: 'key', AWS_SECRET_ACCESS_KEY: 'secret', AWS_SESSION_TOKEN: 'session' };
    expect(inspectBedrockEnvironment(env).authentication).toBe('iam');
    expect(bedrockClientConfig(CLAUDE_SONNET_5_5, env)).toMatchObject({
      region: 'il-central-1',
      authSchemePreference: ['sigv4'],
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret', sessionToken: 'session' },
    });
  });

  it.each([
    {
      env: { AWS_BEARER_TOKEN_BEDROCK: 'test-bearer' },
      header: 'Authorization',
      authorization: /^Bearer test-bearer$/,
    },
    {
      env: { AWS_ACCESS_KEY_ID: 'test-key', AWS_SECRET_ACCESS_KEY: 'test-secret' },
      header: 'authorization',
      authorization: /^AWS4-HMAC-SHA256 /,
    },
  ])('authenticates SDK requests with the selected method', async ({ env, header, authorization }) => {
    let observed: { hostname: unknown; expectedAuthentication: boolean } | undefined;
    const handle = async (request: unknown) => {
      if (!request || typeof request !== 'object') throw new Error('Expected an HTTP request.');
      const http = request as { hostname?: unknown; headers?: Record<string, string | undefined> };
      // Never give assertion diffs a complete request: it contains credential-bearing headers.
      observed = { hostname: http.hostname, expectedAuthentication: authorization.test(http.headers?.[header] ?? '') };
      return {
        response: {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify(reply())),
        },
      };
    };
    const client = new BedrockRuntimeClient({
      ...bedrockClientConfig(CLAUDE_SONNET_5_5, env),
      requestHandler: { handle },
    });
    try {
      await client.send(
        new ConverseCommand({
          modelId: CLAUDE_SONNET_5_5.model_id,
          messages: [{ role: 'user', content: [{ text: 'Test' }] }],
        }),
      );
      expect(observed).toEqual({
        hostname: 'bedrock-runtime.il-central-1.amazonaws.com',
        expectedAuthentication: true,
      });
    } finally {
      client.destroy();
    }
  });
});

describe('Bedrock agent', () => {
  it('sends the requested model, adaptive thinking and total output budget', async () => {
    const client = runtime();
    client.converse.mockResolvedValue(reply());
    const signal = new AbortController().signal;
    const result = await new BedrockAgent(client, { system: 'Be concise.' }).run('Hello', signal);
    expect(result.text).toBe('Done');
    expect(client.converse).toHaveBeenCalledWith(
      {
        modelId: 'global.anthropic.claude-sonnet-5-5',
        messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
        system: [{ text: 'Be concise.' }],
        inferenceConfig: { maxTokens: 16000 },
        additionalModelRequestFields: { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } },
      },
      signal,
    );
  });

  it('round trips signed thinking and tool results and totals token usage', async () => {
    const client = runtime();
    const first = toolReply();
    client.converse.mockResolvedValueOnce(first).mockResolvedValueOnce(reply());
    const tool = lookup();
    const result = await new BedrockAgent(client, { tools: [tool] }).run('Look up example');
    expect(tool.execute).toHaveBeenCalledWith({ query: 'example' }, undefined);
    const nextMessages = client.converse.mock.calls[1]?.[0].messages;
    expect(nextMessages?.[1]).toEqual(first.output?.message);
    expect(nextMessages?.[2]).toEqual({
      role: 'user',
      content: [{ toolResult: { toolUseId: 'call-1', status: 'success', content: [{ text: 'Found' }] } }],
    });
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 6, totalTokens: 10 });
    expect(result.turns).toBe(2);
  });

  it('rejects unknown tools before running any tools in the batch', async () => {
    const client = runtime();
    const response = toolReply();
    response.output?.message?.content?.push({ toolUse: { toolUseId: 'call-2', name: 'unknown', input: {} } });
    client.converse.mockResolvedValue(response);
    const tool = lookup();
    await expect(new BedrockAgent(client, { tools: [tool] }).run('Go')).rejects.toThrow('unknown or malformed');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('enforces model and tool limits before further side effects', async () => {
    const client = runtime();
    client.converse.mockResolvedValue(toolReply());
    const tool = lookup();
    await expect(new BedrockAgent(client, { tools: [tool], maxTurns: 1 }).run('Go')).rejects.toThrow('turn limit');
    expect(tool.execute).not.toHaveBeenCalled();
    await expect(new BedrockAgent(client, { tools: [tool], maxToolCalls: 1 }).run('Go')).rejects.toThrow(
      'tool call limit',
    );
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects token truncation and service failures without claiming completion', async () => {
    const client = runtime();
    client.converse.mockResolvedValueOnce(reply('max_tokens')).mockRejectedValueOnce(new Error('Unavailable'));
    const agent = new BedrockAgent(client);
    await expect(agent.run('Go')).rejects.toThrow('incomplete: max_tokens');
    await expect(agent.run('Go')).rejects.toThrow('Unavailable');
  });

  it('honors cancellation before the request and before tool side effects', async () => {
    const client = runtime();
    const controller = new AbortController();
    controller.abort();
    await expect(new BedrockAgent(client).run('Go', controller.signal)).rejects.toThrow();
    expect(client.converse).not.toHaveBeenCalled();
    const tool = lookup();
    const duringRequest = new AbortController();
    client.converse.mockImplementation(async () => {
      duringRequest.abort();
      return toolReply();
    });
    await expect(new BedrockAgent(client, { tools: [tool] }).run('Go', duringRequest.signal)).rejects.toThrow();
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('propagates tool errors without retrying side effects', async () => {
    const client = runtime();
    client.converse.mockResolvedValue(toolReply());
    const tool = { ...lookup(), execute: vi.fn<AgentTool['execute']>().mockRejectedValue(new Error('Tool failed')) };
    await expect(new BedrockAgent(client, { tools: [tool] }).run('Go')).rejects.toThrow('Tool failed');
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(client.converse).toHaveBeenCalledTimes(1);
  });

  it('validates limits and duplicate tool names', () => {
    for (const maxTurns of [0, -1, 1.5, Infinity]) {
      expect(() => new BedrockAgent(runtime(), { maxTurns })).toThrow('positive safe integers');
    }
    expect(() => new BedrockAgent(runtime(), { tools: [lookup(), lookup()] })).toThrow('Duplicate agent tool');
  });
});
