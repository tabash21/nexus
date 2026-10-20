export interface ModelConfig {
  readonly model_id: string;
  readonly region: string;
  readonly params: {
    readonly reasoning_effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** Total output budget, including thinking tokens. */
    readonly max_tokens: number;
  };
}

export const CLAUDE_SONNET_5_5: ModelConfig = Object.freeze({
  model_id: 'global.anthropic.claude-sonnet-5-5',
  region: 'il-central-1',
  params: Object.freeze({ reasoning_effort: 'low', max_tokens: 16000 }),
});
