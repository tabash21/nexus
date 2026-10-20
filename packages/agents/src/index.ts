// Agent runner
export { BedrockAgent, DEFAULT_MAX_TOOL_CALLS, DEFAULT_MAX_TURNS } from './agent.js';
export type { AgentOptions, AgentResult, AgentTool, TokenUsageTotals } from './agent.types.js';

// Errors
export { AgentConfigurationError, AgentError, AgentLimitError, AgentResponseError } from './errors.js';

// Bedrock runtime & environment
export { bedrockClientConfig, createBedrockRuntime } from './bedrock.resources.js';
export type { BedrockRuntime } from './bedrock.resources.js';
export { assertBedrockEnvironment, inspectBedrockEnvironment } from './environment.js';
export type { AgentEnvironment, BedrockEnvironmentStatus } from './environment.js';

// Models
export { CLAUDE_SONNET_5_5 } from './models.js';
export type { ModelConfig, ReasoningEffort } from './models.js';
