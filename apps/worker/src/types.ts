import type { Delivery, SilverObservation, SourceSubscription } from '@nexus/contracts';
import type { IHeaders } from 'kafkajs';
import type { ArchivedRaw } from './archive.js';
import type { QuickProcessor } from './quick-processors.js';

export type Message = Delivery & {
  value: Buffer | null;
  key: Buffer | null;
  timestamp: string;
  headers?: IHeaders;
};

export type Dependencies = {
  source: SourceSubscription;
  quickProcessors?: readonly QuickProcessor[];
  archive: (message: Message) => Promise<ArchivedRaw>;
  publish: (key: string, observation: SilverObservation) => Promise<void>;
  quarantine: (record: Record<string, unknown>) => Promise<void>;
  commit: (message: Delivery) => Promise<void>;
};
