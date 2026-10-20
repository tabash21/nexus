import type { ConverseCommandInput, Message, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import type { ModelConfig } from './models.js';

export interface ConverseRequestParts {
  readonly model: ModelConfig;
  readonly messages: readonly Message[];
  readonly system?: string;
  readonly toolConfig?: ToolConfiguration;
}

export function buildConverseRequest({
  model,
  messages,
  system,
  toolConfig,
}: ConverseRequestParts): ConverseCommandInput {
  return {
    modelId: model.model_id,
    // Snapshot: later turns append to the conversation and must not alter a request already sent.
    messages: [...messages],
    ...(system ? { system: [{ text: system }] } : {}),
    inferenceConfig: { maxTokens: model.params.max_tokens },
    additionalModelRequestFields: {
      thinking: { type: 'adaptive' },
      output_config: { effort: model.params.reasoning_effort },
    },
    ...(toolConfig ? { toolConfig } : {}),
  };
}
