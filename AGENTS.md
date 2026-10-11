# Project instructions

- Ask the user to confirm before introducing or replacing a major technology: frameworks, databases, messaging/storage systems, languages, package managers, or development/test tooling.
- The user has selected NestJS for both Node.js services and Turborepo for the monorepo.
- Use NestJS's default Express adapter for the API; do not introduce Fastify.
- Keep Kafka acknowledgement after durable processing; preserve ingestion idempotency and replay behavior.
- Run `npm run check` for code changes and report any infrastructure checks that cannot run.

