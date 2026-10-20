import { mediaJobs, type ItemMediaRow } from '../schema/index.js';
import type { IngestTransaction } from '../types.js';
import { MEDIA_PROCESSOR_VERSION } from './types.js';

export async function scheduleMediaJob(tx: IngestTransaction, media: ItemMediaRow): Promise<void> {
  await tx
    .insert(mediaJobs)
    .values({
      item_id: media.item_id,
      position: media.position,
      attachment_generation: media.attachment_generation,
      source_url: media.media_url,
      media_type: media.media_type,
      processor_version: MEDIA_PROCESSOR_VERSION,
    })
    .onConflictDoNothing();
}
