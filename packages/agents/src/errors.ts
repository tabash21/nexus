/** Base class for every error raised by `@nexus/agents` itself (not tool or SDK errors). */
export class AgentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid caller-supplied configuration or input: limits, tools, credentials, empty conversations. */
export class AgentConfigurationError extends AgentError {}

/** A per-run turn or tool-call budget was exhausted. */
export class AgentLimitError extends AgentError {}

/** Bedrock returned a response the runner cannot safely continue from. */
export class AgentResponseError extends AgentError {}
