import type { AgentEnvironment } from './environment.js';
import { AgentConfigurationError } from './errors.js';

export type BedrockAuthentication = 'bearer' | 'iam';

export type BedrockCredentials =
  | { readonly kind: 'bearer'; readonly token: string }
  | {
      readonly kind: 'iam';
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
      readonly sessionToken?: string;
    };

export const MISSING_CREDENTIALS_MESSAGE =
  'Set AWS_BEARER_TOKEN_BEDROCK or both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.';

/** Returns the trimmed value, treating blank strings as absent. */
export function readVariable(env: AgentEnvironment, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

/** Bearer authentication takes precedence over IAM keys when both are configured. */
export function resolveBedrockCredentials(env: AgentEnvironment): BedrockCredentials | null {
  const token = readVariable(env, 'AWS_BEARER_TOKEN_BEDROCK');
  if (token) return { kind: 'bearer', token };

  const accessKeyId = readVariable(env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = readVariable(env, 'AWS_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) return null;

  const sessionToken = readVariable(env, 'AWS_SESSION_TOKEN');
  return { kind: 'iam', accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

export function requireBedrockCredentials(env: AgentEnvironment): BedrockCredentials {
  const credentials = resolveBedrockCredentials(env);
  if (!credentials) throw new AgentConfigurationError(MISSING_CREDENTIALS_MESSAGE);
  return credentials;
}
