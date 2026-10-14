import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { claimJobs, completeJob, failJob, jobStats, renewJob, type ClaimedJob } from '@nexus/database';
import { reconcileArchive } from './archive.js';
import { ENRICHMENT_RESOURCES, type EnrichmentResources } from './resources.js';

@Injectable()
export class EnrichmentService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly active = new Set<Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private pollTimer?: NodeJS.Timeout;
  private archiveTimer?: NodeJS.Timeout;
  private stopping = false;
  private archiveRunning = false;
  constructor(@Inject(ENRICHMENT_RESOURCES) private readonly resources: EnrichmentResources) {}

  async onModuleInit(): Promise<void> {
    await this.resources.pool.query('SELECT 1 FROM ingest.enrichment_jobs LIMIT 1');
    this.logger.log('Enrichment service ready');
    this.schedulePoll(0);
    this.scheduleArchive(20000);
  }

  private schedulePoll(delay: number): void {
    if (!this.stopping) this.pollTimer = setTimeout(() => void this.poll(), delay);
  }
  private async poll(): Promise<void> {
    try {
      const capacity = this.resources.concurrency - this.active.size;
      if (capacity > 0) for (const job of await claimJobs(this.resources.pool, capacity)) {
        const task = this.runJob(job).finally(() => this.active.delete(task));
        this.active.add(task);
      }
    } catch (error) { this.logger.error(error, 'Job poll failed'); }
    finally { this.schedulePoll(1000); }
  }

  private async runJob(job: ClaimedJob): Promise<void> {
    const processor = this.resources.processors.find(p => p.jobType === job.job_type && p.version === job.processor_version);
    const controller = new AbortController();
    this.controllers.add(controller);
    const pulse = setInterval(() => void renewJob(this.resources.pool, job).then(ok => {
      if (!ok) controller.abort(new Error('Job lease lost'));
    }).catch(error => { controller.abort(error); this.logger.error(error, 'Lease renewal failed'); }), 30000);
    try {
      if (!processor) throw new Error(`Processor ${job.job_type}@${job.processor_version} is not deployed`);
      const output = await processor.process({ job, signal: controller.signal });
      const status = await completeJob(this.resources.pool, job, output);
      if (status !== 'succeeded') this.logger.warn(`Job ${job.job_id} ${status}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Job ${job.job_id} failed: ${reason}`);
      try { await failJob(this.resources.pool, job, reason); }
      catch (failure) { this.logger.error(failure, 'Could not record job failure'); }
    } finally { clearInterval(pulse); this.controllers.delete(controller); }
  }

  private scheduleArchive(delay: number): void {
    if (!this.stopping) this.archiveTimer = setTimeout(() => void this.archive(), delay);
  }
  private async archive(): Promise<void> {
    if (this.archiveRunning) return;
    this.archiveRunning = true;
    try {
      const stats = await reconcileArchive(this.resources.pool, this.resources.s3, this.resources.rawBucket);
      if (stats.linked || stats.mismatched) this.logger.log(`Archive records linked=${stats.linked} mismatched=${stats.mismatched}`);
      this.logger.debug(JSON.stringify(await jobStats(this.resources.pool)));
    } catch (error) { this.logger.error(error, 'Archive reconciliation failed; enrichment remains available'); }
    finally { this.archiveRunning = false; this.scheduleArchive(60000); }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.pollTimer); clearTimeout(this.archiveTimer);
    for (const controller of this.controllers) controller.abort(new Error('Shutting down'));
    await Promise.allSettled(this.active);
    this.resources.s3.destroy();
    await this.resources.pool.end();
  }
}
