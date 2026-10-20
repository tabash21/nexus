import {
  BedrockRuntimeClient,
  ConverseCommand,
  type BedrockRuntimeClientConfig,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { requireBedrockCredentials, type BedrockCredentials } from './credentials.js';
import type { AgentEnvironment } from './environment.js';
import { AgentConfigurationError } from './errors.js';
import { CLAUDE_SONNET_5_5, type ModelConfig } from './models.js';

export interface BedrockRuntime {
  converse(input: ConverseCommandInput, signal?: AbortSignal): Promise<ConverseCommandOutput>;
  destroy(): void;
}

/** SDK-level retries for transient inference failures. Tool side effects are never retried. */
const SDK_MAX_ATTEMPTS = 3;

// Only explicit environment credentials are accepted, including in bearer mode.
const rejectImplicitCredentials: BedrockRuntimeClientConfig['credentialDefaultProvider'] = () => async () => {
  throw new AgentConfigurationError('Implicit AWS credential lookup is disabled for the agent runtime.');
};

function authenticationConfig(credentials: BedrockCredentials): BedrockRuntimeClientConfig {
  switch (credentials.kind) {
    case 'bearer':
      return {
        token: { token: credentials.token },
        authSchemePreference: ['httpBearerAuth'],
      };
    case 'iam': {
      const { accessKeyId, secretAccessKey, sessionToken } = credentials;
      return {
        authSchemePreference: ['sigv4'],
        credentials: {
          accessKeyId,
          secretAccessKey,
          ...(sessionToken ? { sessionToken } : {}),
        },
      };
    }
    default: {
      const _exhaustive: never = credentials;
      throw new AgentConfigurationError('Unsupported Bedrock authentication method.');
    }
  }
}

export function bedrockClientConfig(
  model: ModelConfig = CLAUDE_SONNET_5_5,
  env: AgentEnvironment = process.env,
): BedrockRuntimeClientConfig {
  return {
    region: model.region,
    maxAttempts: SDK_MAX_ATTEMPTS,
    credentialDefaultProvider: rejectImplicitCredentials,
    ...authenticationConfig(requireBedrockCredentials(env)),
  } satisfies BedrockRuntimeClientConfig;
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
