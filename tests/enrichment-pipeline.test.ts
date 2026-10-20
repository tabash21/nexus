import { describe, expect, it } from 'vitest';
import {
  ProcessorRegistry,
  testProcessor,
  type EnrichmentProcessor,
  type EnrichmentTaskContext,
  type ProcessorResult,
} from '../apps/enrichment-worker/src/processors/index.js';
import { archiveCoordinates } from '../apps/enrichment-worker/src/archive/index.js';

describe('enrichment processor pipeline & registry', () => {
  it('initializes registry with default entity mentions and language processors and retrieves by key', () => {
    const registry = new ProcessorRegistry();
    expect(registry.getAll()).toHaveLength(2);
    expect(registry.find('lang', 'lang.v1')).toBeDefined();

    const found = registry.find('entity-mentions', 'entity-mentions.v1');
    expect(found).toBeDefined();
    expect(found?.jobType).toBe('entity-mentions');
    expect(found?.version).toBe('entity-mentions.v1');

    expect(registry.find('nonexistent', 'v1')).toBeUndefined();
  });

  it('registers and executes a topic-agnostic gold text processor', async () => {
    class WordCountProcessor implements EnrichmentProcessor {
      readonly jobType = 'word_count';
      readonly version = 'word_count.v1';
      readonly metadata = {
        jobType: 'word_count',
        version: 'word_count.v1',
        name: 'Word Counter',
        description: 'Calculates word count from normalized Silver item text',
        target: 'text' as const,
      };

      async process(context: EnrichmentTaskContext): Promise<ProcessorResult> {
        const words = context.item.text.trim().split(/\s+/).filter(Boolean).length;
        return {
          values: {
            wordCount: words,
            platform: context.item.platform,
          },
        };
      }
    }

    const registry = new ProcessorRegistry([testProcessor, new WordCountProcessor()]);
    expect(registry.getAll()).toHaveLength(2);

    const processor = registry.find('word_count', 'word_count.v1');
    expect(processor).toBeDefined();

    // Verify execution with a Telegram Silver item
    const telegramContext: EnrichmentTaskContext = {
      job: {
        job_id: '1',
        item_id: 'item_1',
        content_revision: '1',
        event_id: 'evt_1',
        job_type: 'word_count',
        processor_version: 'word_count.v1',
        input_hash: 'hash_1',
        claim_token: 'token_1',
        attempts: 1,
        raw_bytes: Buffer.from('{"telegram":true}'),
        raw_payload: { telegram: true },
        platform: 'telegram',
      },
      signal: new AbortController().signal,
      item: {
        itemId: 'item_1',
        platform: 'telegram',
        title: 'Telegram Alert',
        text: 'Critical situation developing in northern district',
        lang: 'en',
        url: 'https://t.me/channel/1',
      },
      raw: {
        payload: { telegram: true },
        bytes: Buffer.from('{"telegram":true}'),
      },
    };

    const telegramResult = await processor!.process(telegramContext);
    expect(telegramResult.values).toEqual({
      wordCount: 6,
      platform: 'telegram',
    });

    // Verify the EXACT same processor works on a future Twitter/X item without knowing its raw schema
    const twitterContext: EnrichmentTaskContext = {
      ...telegramContext,
      job: {
        ...telegramContext.job,
        platform: 'twitter',
        raw_payload: { data: { tweet_id: '12345' } },
      },
      item: {
        ...telegramContext.item,
        platform: 'twitter',
        title: null,
        text: 'Breaking news update regarding evacuation routes',
        url: 'https://twitter.com/user/status/12345',
      },
      raw: {
        payload: { data: { tweet_id: '12345' } },
        bytes: Buffer.from('{"data":{"tweet_id":"12345"}}'),
      },
    };

    const twitterResult = await processor!.process(twitterContext);
    expect(twitterResult.values).toEqual({
      wordCount: 6,
      platform: 'twitter',
    });
  });

  it('correctly parses Kafka Connect Avro partition coordinates', () => {
    const parsed = archiveCoordinates('raw/raw.telegram.v1/partition=2/raw.telegram.v1+2+0000000100.avro');
    expect(parsed).toEqual({
      topic: 'raw.telegram.v1',
      partition: 2,
      startOffset: 100n,
    });

    expect(archiveCoordinates('invalid/key.txt')).toBeNull();
  });
});
