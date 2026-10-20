import {
  readVariable,
  requireBedrockCredentials,
  resolveBedrockCredentials,
  type BedrockAuthentication,
} from './credentials.js';

export type AgentEnvironment = Readonly<Record<string, string | undefined>>;

export interface BedrockEnvironmentStatus {
  readonly AWS_BEARER_TOKEN_BEDROCK: boolean;
  readonly AWS_ACCESS_KEY_ID: boolean;
  readonly AWS_SECRET_ACCESS_KEY: boolean;
  readonly authentication: BedrockAuthentication | null;
  readonly ready: boolean;
}

/** Reports presence only; credential values must never enter diagnostics. */
export function inspectBedrockEnvironment(env: AgentEnvironment = process.env): BedrockEnvironmentStatus {
  const isSet = (name: string) => readVariable(env, name) !== undefined;
  const authentication = resolveBedrockCredentials(env)?.kind ?? null;
  return {
    AWS_BEARER_TOKEN_BEDROCK: isSet('AWS_BEARER_TOKEN_BEDROCK'),
    AWS_ACCESS_KEY_ID: isSet('AWS_ACCESS_KEY_ID'),
    AWS_SECRET_ACCESS_KEY: isSet('AWS_SECRET_ACCESS_KEY'),
    authentication,
    ready: authentication !== null,
  };
}

export function assertBedrockEnvironment(env: AgentEnvironment = process.env): void {
  requireBedrockCredentials(env);
}
