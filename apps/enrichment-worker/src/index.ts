import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { backfillProcessor, createPool, jobStats, retryJob } from '@nexus/database';
import { EnrichmentModule } from './enrichment.module.js';

const command = process.argv[2];
if (command) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = createPool(process.env.DATABASE_URL);
  try {
    if (command === 'stats') console.log(JSON.stringify(await jobStats(pool)));
    else if (command === 'retry' && process.argv[3]) console.log(await retryJob(pool, process.argv[3]));
    else if (command === 'backfill' && process.argv[3] && process.argv[4]) {
      console.log(await backfillProcessor(pool, process.argv[3], process.argv[4]));
    } else throw new Error('Usage: enrichment-worker [stats | retry JOB_ID | backfill JOB_TYPE VERSION]');
  } finally { await pool.end(); }
} else {
  const app = await NestFactory.createApplicationContext(EnrichmentModule);
  app.enableShutdownHooks();
}
