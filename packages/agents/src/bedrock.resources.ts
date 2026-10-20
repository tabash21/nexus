import {
  BedrockRuntimeClient,
  ConverseCommand,
  type BedrockRuntimeClientConfig,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { assertBedrockEnvironment, type AgentEnvironment } from './environment.js';
import { CLAUDE_SONNET_5_5, type ModelConfig } from './models.js';

export interface BedrockRuntime {
  converse(input: ConverseCommandInput, signal?: AbortSignal): Promise<ConverseCommandOutput>;
  destroy(): void;
}

export function bedrockClientConfig(
  model: ModelConfig = CLAUDE_SONNET_5_5,
  env: AgentEnvironment = process.env,
): BedrockRuntimeClientConfig {
  assertBedrockEnvironment(env);
  const common: BedrockRuntimeClientConfig = {
    region: model.region,
    maxAttempts: 3,
    // This factory accepts explicit environment credentials only, including in bearer mode.
    credentialDefaultProvider: () => async () => {
      throw new Error('Implicit AWS credential lookup is disabled for the agent runtime.');
    },
  };
  const bearer = env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (bearer) {
    return {
      ...common,
      token: { token: bearer },
      authSchemePreference: ['httpBearerAuth'],
    };
  }
  return {
    ...common,
    authSchemePreference: ['sigv4'],
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!.trim(),
      ...(env.AWS_SESSION_TOKEN?.trim() ? { sessionToken: env.AWS_SESSION_TOKEN.trim() } : {}),
    },
  };
}

/** The caller owns this resource and must destroy it during shutdown. */
export function createBedrockRuntime(
  model: ModelConfig = CLAUDE_SONNET_5_5,
  env: AgentEnvironment = process.env,
): BedrockRuntime {
  const client = new BedrockRuntimeClient(bedrockClientConfig(model, env));
  return {
    converse: (input, signal) => client.send(new ConverseCommand(input), { abortSignal: signal }),
    destroy: () => client.destroy(),
  };
}
