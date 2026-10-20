import { BedrockAgent, CLAUDE_SONNET_5_5, createBedrockRuntime, inspectBedrockEnvironment } from '@nexus/agents';

const status = inspectBedrockEnvironment();
console.log(JSON.stringify({ model: CLAUDE_SONNET_5_5, environment: status }, null, 2));
if (!status.ready) {
  console.error('Set AWS_BEARER_TOKEN_BEDROCK or both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
  process.exitCode = 1;
} else if (process.argv.includes('--invoke')) {
  const runtime = createBedrockRuntime();
  try {
    const result = await new BedrockAgent(runtime).run('Reply with exactly OK.', AbortSignal.timeout(60_000));
    console.log(JSON.stringify({ invocation: 'ok', usage: result.usage }));
  } catch (error: unknown) {
    // SDK error messages can include service response details; print only the exception class.
    console.error(`Bedrock invocation failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    process.exitCode = 1;
  } finally {
    runtime.destroy();
  }
}
