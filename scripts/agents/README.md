# Bedrock agent examples

Run these commands from the repository root after `npm ci`. The npm scripts load the root `.env` and resolve `@nexus/agents` from TypeScript source, so a separate build is not required.

## Configure authentication

Copy `.env.example` to `.env` if you do not already have a `.env` file. Fill in one authentication method:

```dotenv
# Method 1: Bedrock bearer token
AWS_BEARER_TOKEN_BEDROCK=your-bedrock-token
```

Or leave the bearer token empty and configure both IAM values:

```dotenv
# Method 2: IAM credentials
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
# Include this for temporary IAM credentials:
AWS_SESSION_TOKEN=your-session-token
```

Bearer authentication takes precedence when both methods are configured. The preset already selects `global.anthropic.claude-sonnet-5-5` from `il-central-1`, adaptive thinking, low effort, and a 16,000-token total output budget including thinking. No `AWS_REGION` setting is needed for this preset. The runtime requires explicit environment credentials and does not use AWS profiles or instance roles.

## Verify and run

```powershell
# Check credential presence without making an inference request:
npm run agents:verify

# Verify model access with a short inference request:
npm run agents:verify -- --invoke

# Show usage without requiring credentials or making a request:
npm run agents:example -- --help

# Summarize the example observation:
npm run agents:example

# Summarize your own observation:
npm run agents:example -- "A news outlet reports road closures near the northern border."
```

`--invoke` and the summarization examples make billable Bedrock requests. Both use a 60-second timeout. Missing credentials produce a nonzero exit code before inference. Credential values are never printed; failed requests print only the exception class.

[`example.ts`](example.ts) shows the complete runnable flow: create the runtime, construct an agent with a system instruction, submit an observation, print the response and token usage, and destroy the runtime in `finally`. [`verify.ts`](verify.ts) shows credential diagnostics and an optional model-access check.

## Use the library in code

```typescript
import { BedrockAgent, createBedrockRuntime } from '@nexus/agents';

const runtime = createBedrockRuntime();
try {
  const agent = new BedrockAgent(runtime, {
    system: 'Summarize OSINT observations concisely without inventing facts.',
  });
  const result = await agent.run('Observation text', AbortSignal.timeout(60_000));
  console.log(result.text);
  console.log(result.usage);
} finally {
  runtime.destroy();
}
```

The library reads `process.env`; the npm example command loads `.env` for you. In a service, load its environment before creating the runtime, declare `@nexus/agents` as a workspace dependency, and own the runtime in the service resource factory. See the [agent infrastructure guide](../../docs/agents.md) for tool registration, execution limits, and conversation continuation.
