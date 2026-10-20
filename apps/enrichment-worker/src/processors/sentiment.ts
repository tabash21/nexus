
import analyzeSentiment from 'multilang-sentiment';
import type { SentimentLabel } from '@nexus/contracts';

import type {
  EnrichmentProcessor,
  EnrichmentTaskContext,
  ProcessorResult,
} from './types.js';

interface SentimentResult {
  sentiment: SentimentLabel;
  score: number;
}

interface SentimentWords {
  positive: readonly string[];
  negative: readonly string[];
}

const additionalSentimentWords: Record<string, SentimentWords> = {
  en: {
    positive: ['promising'],
    negative: [],
  },
};

function getLanguageCode(language: string): string {
  return language.toLowerCase().split(/[-_]/)[0] || 'en';
}

function hasAdditionalSentiment(
  text: string,
  words: readonly string[],
  language: string,
): boolean {
  const tokens =
    text.toLocaleLowerCase(language).match(/[\p{L}\p{M}]+/gu) ?? [];

  return tokens.some((token) => words.includes(token));
}

export function classifySentiment(
  text: string,
  language = 'en',
): SentimentResult {
  if (!text.trim()) {
    return { sentiment: 'neutral', score: 0 };
  }

  const result = analyzeSentiment(text, language);
  const additionalWords = additionalSentimentWords[getLanguageCode(language)];

  const hasPositive =
    result.positive.length > 0 ||
    (additionalWords !== undefined &&
      hasAdditionalSentiment(text, additionalWords.positive, language));

  const hasNegative =
    result.negative.length > 0 ||
    (additionalWords !== undefined &&
      hasAdditionalSentiment(text, additionalWords.negative, language));

  const sentiment: SentimentLabel =
    hasPositive && hasNegative
      ? 'mixed'
      : hasPositive
        ? 'positive'
        : hasNegative
          ? 'negative'
          : result.score > 0
            ? 'positive'
            : result.score < 0
              ? 'negative'
              : 'neutral';

  return {
    sentiment,
    score: result.score,
  };
}

export class SentimentProcessor implements EnrichmentProcessor {
  readonly jobType = 'sentiment';
  readonly version = 'sentiment.v1';

  readonly metadata = {
    jobType: 'sentiment',
    version: 'sentiment.v1',
    name: 'Sentiment Analysis',
    description: 'Classifies text sentiment',
    target: 'text' as const,
  };

  async process(
    context: EnrichmentTaskContext,
  ): Promise<ProcessorResult> {
    const result = classifySentiment(context.item.text);

    return {
      values: {
        sentiment: result.sentiment,
        score: result.score,
      },
    };
  }
}

export const sentimentProcessor = new SentimentProcessor();
