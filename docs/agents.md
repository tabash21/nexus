# Agent infrastructure

`@nexus/agents` provides a reusable Bedrock Converse runtime and a bounded agent runner. It is a separate library; the silver writer continues to persist observations without invoking a model.

The `CLAUDE_SONNET_5_5` preset uses `global.anthropic.claude-sonnet-5-5` from `il-central-1`, with adaptive thinking, low effort, and a 16,000-token total output budget. The runtime maps `reasoning_effort` to `additionalModelRequestFields.output_config.effort`, sends `thinking: { type: 'adaptive' }`, and maps `max_tokens` to `inferenceConfig.maxTokens`. This budget includes thinking tokens. The global profile can route inference outside the source region.

## Credentials and verification

Provide either `AWS_BEARER_TOKEN_BEDROCK` or both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the process environment or the root `.env`. Temporary IAM credentials also require `AWS_SESSION_TOKEN`. Bearer authentication takes precedence when both methods are present. This initial environment-based factory requires these explicit variables; it does not fall back to AWS profiles or instance roles.

```powershell
npm run agents:verify
npm run agents:verify -- --invoke
```

The first command prints credential presence, selected authentication, and the model configuration. It exits with code 1 if neither credential method is complete. It never prints credential values. The optional `--invoke` makes a billable, short inference request to verify actual model access, with a 60-second timeout; output contains only status and token usage. Environment presence alone does not establish that credentials are valid or that the account has model access. Protected environment files are not generated or modified by these commands.

## Runnable example

Configure one authentication method using the blank entries in `.env.example`, then run `npm run agents:example -- "Observation to summarize"` from the repository root. The command loads `.env` and runs directly from source. See [`scripts/agents/example.ts`](../scripts/agents/example.ts) and its [README](../scripts/agents/README.md) for the complete code and setup instructions. Use `npm run agents:example -- --help` for usage without making a request.

## Use in a service

Declare `@nexus/agents` as a workspace dependency of the consuming service before importing it. Own the runtime in the service resource factory and call `destroy()` during shutdown.

```typescript
import { BedrockAgent, createBedrockRuntime } from '@nexus/agents';

const runtime = createBedrockRuntime();
try {
  const agent = new BedrockAgent(runtime, { system: 'Summarize the supplied observation concisely.' });
  const result = await agent.run('Observation text', AbortSignal.timeout(60_000));
  console.log(result.text);
} finally {
  runtime.destroy();
}
```

Tools are opt-in `AgentTool` objects with a name, description, JSON input schema, and async `execute(input: unknown, signal?)` handler returning text. Each handler must validate model-supplied input before using it and honor cancellation. JSON schemas describe inputs to Bedrock; the runner does not perform local schema validation. Tools execute sequentially, with defaults of eight model calls and sixteen tool executions per run. Unknown tools, exhausted limits, truncated responses, and runtime or tool failures reject the run. Tool side effects are not retried by the runner. The SDK may retry transient inference requests up to three attempts.

The result contains the conversation with signed thinking blocks and tool results preserved; pass `result.messages` plus a new user message to a subsequent run. Token usage totals all model calls within a run. No built-in tools, database writes, Kafka subscriptions, or NestJS providers are installed automatically.

AWS references: [model availability](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html), [adaptive thinking and effort](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html), and [Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html).
