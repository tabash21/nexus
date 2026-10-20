import { BedrockAgent, CLAUDE_SONNET_5_5, createBedrockRuntime, inspectBedrockEnvironment } from '@nexus/agents';

// Run from the repository root: npm run agents:example -- "Observation to summarize"
// The npm command loads .env and resolves the workspace package directly from source.
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run agents:example -- "Observation to summarize"');
  console.log('Uses Claude Sonnet 5.5 via Bedrock. Requires a bearer token or a complete IAM credential pair.');
} else if (!inspectBedrockEnvironment().ready) {
  console.error('Set AWS_BEARER_TOKEN_BEDROCK or both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.');
  process.exitCode = 1;
} else {
  const observation = args.join(' ').trim() || 'A news outlet reports road closures near the northern border.';
  const runtime = createBedrockRuntime(CLAUDE_SONNET_5_5);
  try {
    const agent = new BedrockAgent(runtime, {
      system: 'Summarize the supplied OSINT observation concisely. Preserve uncertainty and do not invent facts.',
    });
    const result = await agent.run(observation, AbortSignal.timeout(60_000));
    console.log(result.text);
    console.log(JSON.stringify({ usage: result.usage, turns: result.turns }, null, 2));
  } catch (error: unknown) {
    // Service error messages may contain request details; only report the exception class.
    console.error(`Agent example failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    process.exitCode = 1;
  } finally {
    // The service or script that creates the runtime owns its shutdown.
    runtime.destroy();
  }
}
