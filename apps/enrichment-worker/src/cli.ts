import {
  createPool,
  createItemDatabase,
  jobStats,
  retryJob,
  backfillProcessor,
  backfillMediaJobs,
  retryMediaJob,
  mediaJobStats,
} from '@nexus/database';

const CLI_USAGE =
  'Usage: enrichment-worker [stats | retry <JOB_ID> | backfill <JOB_TYPE> <VERSION> | media-stats | media-backfill | media-retry <UUID>]';

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to execute CLI commands');
  }

  const pool = createPool(process.env.DATABASE_URL);

  try {
    switch (command) {
      case 'media-stats': {
        console.log(JSON.stringify(await mediaJobStats(createItemDatabase(pool)), null, 2));
        break;
      }
      case 'media-backfill': {
        console.log(`Scheduled ${await backfillMediaJobs(createItemDatabase(pool))} media jobs`);
        break;
      }
      case 'media-retry': {
        const jobId = args[1];
        if (!jobId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId)) {
          throw new Error('Usage: enrichment-worker media-retry <UUID>');
        }
        console.log(
          (await retryMediaJob(createItemDatabase(pool), jobId)) ? 'Media job queued' : 'Media job not eligible',
        );
        break;
      }
      case 'stats': {
        const stats = await jobStats(pool);
        console.log(JSON.stringify(stats, null, 2));
        break;
      }
      case 'retry': {
        const jobId = args[1];
        if (!jobId) {
          throw new Error('Usage: enrichment-worker retry <JOB_ID>');
        }
        const succeeded = await retryJob(pool, jobId);
        console.log(succeeded ? `Job ${jobId} queued for retry` : `Job ${jobId} not found or not eligible for retry`);
        break;
      }
      case 'backfill': {
        const jobType = args[1];
        const version = args[2];
        if (!jobType || !version) {
          throw new Error('Usage: enrichment-worker backfill <JOB_TYPE> <PROCESSOR_VERSION>');
        }
        const count = await backfillProcessor(pool, jobType, version);
        console.log(`Backfill scheduled ${count} jobs for ${jobType}@${version}`);
        break;
      }
      default: {
        throw new Error(`Unknown command: "${command}".\n${CLI_USAGE}`);
      }
    }
  } finally {
    await pool.end();
  }
}
