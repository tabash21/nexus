import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { EnrichmentModule } from './enrichment.module.js';
import { runCli } from './cli.js';

const cliArgs = process.argv.slice(2);

if (cliArgs.length > 0) {
  await runCli(cliArgs);
} else {
  const app = await NestFactory.createApplicationContext(EnrichmentModule);
  app.enableShutdownHooks();
}
