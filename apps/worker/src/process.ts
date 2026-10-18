import { itemIdentity, normalize, type SilverObservation } from '@nexus/contracts';
import { adapt } from './adapters/index.js';
import { runQuickProcessors } from './quick-processors.js';
import { applyTelegramDefaults } from './observation/telegram-defaults.js';
import { buildSilverObservation, decodePayload, quarantineRecord } from './observation/silver.js';
import type { Dependencies, Message } from './types.js';

export type { Dependencies, Message } from './types.js';

/**
 * Maps an incoming raw Kafka delivery into a normalized silver observation,
 * archiving the original bytes to S3 and committing upon successful silver or quarantine emission.
 */
export async function processMessage(message: Message, dependencies: Dependencies): Promise<void> {
  const archived = await dependencies.archive(message);
  let observation: SilverObservation;

  try {
    const value = decodePayload(message, dependencies.source);
    const adapted = applyTelegramDefaults(adapt(value, dependencies.source), value, message);
    const event = normalize(runQuickProcessors(adapted.event, dependencies.quickProcessors ?? []));

    observation = buildSilverObservation({
      event,
      value,
      archived,
      message,
      contentVersionAt: adapted.contentVersionAt,
      legacyReplay: adapted.legacyReplay,
    });
  } catch (error) {
    await dependencies.quarantine(quarantineRecord(error, message, archived));
    await dependencies.commit(message);
    return;
  }

  await dependencies.publish(itemIdentity(observation.event).itemId, observation);
  await dependencies.commit(message);
}
