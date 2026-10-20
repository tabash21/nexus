
import { describe, expect, it } from 'vitest';
import {
  ProcessorRegistry,
  sentimentProcessor,
  testProcessor,
  type EnrichmentProcessor,
  type EnrichmentTaskContext,
  type ProcessorResult,
} from '../apps/enrichment-worker/src/processors/index.js';
import { archiveCoordinates } from '../apps/enrichment-worker/src/archive/index.js';
import {
  InvalidSentimentLabelError,
  validateSentimentLabel,
} from '@nexus/database';
import { classifySentiment } from '../apps/enrichment-worker/src/processors/sentiment.js';

describe('enrichment processor pipeline & registry', () => {
  it('handles additional English sentiment cases', () => {
    expect(
      classifySentiment(
        'The decision is excellent and the outcome is exciting',
      ).sentiment,
    ).toBe('positive');

    expect(
      classifySentiment('The plan is promising, but the risks are serious')
        .sentiment,
    ).toBe('mixed');

    expect(
      classifySentiment('I do not like this').sentiment,
    ).toBe('negative');
  });

  it('handles empty text', () => {
    expect(classifySentiment('').sentiment).toBe('neutral');
  });

  it('initializes registry with default diagnostic processor and retrieves by key', () => {
    const registry = new ProcessorRegistry();
    expect(registry.getAll()).toHaveLength(2);

    const found = registry.find('test', 'test.v1');
    expect(found).toBeDefined();
    expect(found?.jobType).toBe('test');
    expect(found?.version).toBe('test.v1');

    expect(registry.find('nonexistent', 'v1')).toBeUndefined();
    expect(registry.find('sentiment', 'sentiment.v1')).toBe(sentimentProcessor);
  });

  it('validates canonical sentiment labels and rejects invalid values', () => {
    expect(validateSentimentLabel('positive')).toBe('positive');
    expect(validateSentimentLabel('neutral')).toBe('neutral');
    expect(validateSentimentLabel('negative')).toBe('negative');
    expect(validateSentimentLabel('mixed')).toBe('mixed');

    expect(() => validateSentimentLabel('joyful')).toThrow(
      InvalidSentimentLabelError,
    );
  });

  it('classifies English, quoted and ambiguous text using the defined labels', () => {
    expect(
      classifySentiment(
        'I love this breakthrough and celebrate the victory!',
      ).sentiment,
    ).toBe('positive');

    expect(
      classifySentiment(
        'The report states the meeting is at 3pm and the budget is $5m.',
      ).sentiment,
    ).toBe('neutral');

    expect(
      classifySentiment(
        'The fire destroyed the hospital and families are grieving.',
      ).sentiment,
    ).toBe('negative');

    expect(
      classifySentiment(
        'The plan is promising, but the site is still unsafe and the budget collapsed.',
      ).sentiment,
    ).toBe('mixed');

    expect(
      classifySentiment(
        '“Amazing progress,” she said, while the team still fears failure.',
      ).sentiment,
    ).toBe('mixed');
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

      async process(
        context: EnrichmentTaskContext,
      ): Promise<ProcessorResult> {
        const words = context.item.text
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;

        return {
          values: {
            wordCount: words,
            platform: context.item.platform,
          },
        };
      }
    }

    const registry = new ProcessorRegistry([
      testProcessor,
      new WordCountProcessor(),
    ]);

    expect(registry.getAll()).toHaveLength(2);

    const processor = registry.find('word_count', 'word_count.v1');
    expect(processor).toBeDefined();

    if (!processor) {
      throw new Error('Word count processor was not registered');
    }

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

    const telegramResult = await processor.process(telegramContext);

    expect(telegramResult.values).toEqual({
      wordCount: 6,
      platform: 'telegram',
    });

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

    const twitterResult = await processor.process(twitterContext);

    expect(twitterResult.values).toEqual({
      wordCount: 6,
      platform: 'twitter',
    });
  });

  it('correctly parses Kafka Connect Avro partition coordinates', () => {
    const parsed = archiveCoordinates(
      'raw/raw.telegram.v1/partition=2/raw.telegram.v1+2+0000000100.avro',
    );

    expect(parsed).toEqual({
      topic: 'raw.telegram.v1',
      partition: 2,
      startOffset: 100n,
    });

    expect(archiveCoordinates('invalid/key.txt')).toBeNull();
  });
});
