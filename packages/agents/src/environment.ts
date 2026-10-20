export type AgentEnvironment = Readonly<Record<string, string | undefined>>;

export interface BedrockEnvironmentStatus {
  readonly AWS_BEARER_TOKEN_BEDROCK: boolean;
  readonly AWS_ACCESS_KEY_ID: boolean;
  readonly AWS_SECRET_ACCESS_KEY: boolean;
  readonly authentication: 'bearer' | 'iam' | null;
  readonly ready: boolean;
}

/** Reports presence only; credential values must never enter diagnostics. */
export function inspectBedrockEnvironment(env: AgentEnvironment = process.env): BedrockEnvironmentStatus {
  const bearer = Boolean(env.AWS_BEARER_TOKEN_BEDROCK?.trim());
  const accessKey = Boolean(env.AWS_ACCESS_KEY_ID?.trim());
  const secretKey = Boolean(env.AWS_SECRET_ACCESS_KEY?.trim());
  return {
    AWS_BEARER_TOKEN_BEDROCK: bearer,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    authentication: bearer ? 'bearer' : accessKey && secretKey ? 'iam' : null,
    ready: bearer || (accessKey && secretKey),
  };
}

export function assertBedrockEnvironment(env: AgentEnvironment = process.env): void {
  if (!inspectBedrockEnvironment(env).ready) {
    throw new Error('Set AWS_BEARER_TOKEN_BEDROCK or both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
  }
}
