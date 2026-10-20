export { BedrockAgent } from './agent.js';
export type { AgentOptions, AgentResult, AgentTool } from './agent.types.js';
export { bedrockClientConfig, createBedrockRuntime } from './bedrock.resources.js';
export type { BedrockRuntime } from './bedrock.resources.js';
export { inspectBedrockEnvironment, assertBedrockEnvironment } from './environment.js';
export type { AgentEnvironment, BedrockEnvironmentStatus } from './environment.js';
export { CLAUDE_SONNET_5_5 } from './models.js';
export type { ModelConfig } from './models.js';
