import analyzeSentiment from 'multilang-sentiment';
import { validateSentimentLabel } from '@nexus/database';
import type { SentimentLabel } from '@nexus/contracts';
import type {
  EnrichmentProcessor,
  EnrichmentTaskContext,
  ProcessorResult,
} from './types.js';

interface SentimentAnalysisOptions {
  title?: string | null;
  lang?: string | null;
}

interface SentimentResult {
  sentiment: SentimentLabel;
  score: number;
  positiveScore?: number;
  negativeScore?: number;
  hasQuotes?: boolean;
  hasContrast?: boolean;
  language?: string | null;
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

  return tokens.some(token => words.includes(token));
}

export function classifySentiment(
  text: string,
  options: SentimentAnalysisOptions = {},
): SentimentResult {
  const language = options.lang ?? 'en';
  const cleanText = text.trim();
  const cleanTitle = options.title?.trim() ?? '';
  const fullContent = cleanTitle ? `${cleanTitle}. ${cleanText}` : cleanText;

  if (!fullContent) {
    return {
      sentiment: 'neutral',
      score: 0,
      positiveScore: 0,
      negativeScore: 0,
      hasQuotes: false,
      hasContrast: false,
      language: options.lang ?? null,
    };
  }

  const result = analyzeSentiment(fullContent, language);
  const additionalWords = additionalSentimentWords[getLanguageCode(language)];

  const hasPositive =
    result.positive.length > 0 ||
    (additionalWords !== undefined &&
      hasAdditionalSentiment(fullContent, additionalWords.positive, language));

  const hasNegative =
    result.negative.length > 0 ||
    (additionalWords !== undefined &&
      hasAdditionalSentiment(fullContent, additionalWords.negative, language));

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
    sentiment: validateSentimentLabel(sentiment),
    score: result.score,
    positiveScore: result.positive.length,
    negativeScore: result.negative.length,
    hasQuotes: false,
    hasContrast: false,
    language: options.lang ?? null,
  };
}

export class SentimentProcessor implements EnrichmentProcessor {
  readonly jobType = 'sentiment';
  readonly version = 'sentiment.v1';
  readonly inputs = ['text', 'title'] as const;

  readonly metadata = {
    jobType: 'sentiment',
    version: 'sentiment.v1',
    name: 'Sentiment Analysis',
    description: 'Classifies text sentiment',
    target: 'text' as const,
    supportedPlatforms: ['*'] as const,
  };

  supports(): boolean {
    return true;
  }

  async process(context: EnrichmentTaskContext): Promise<ProcessorResult> {
    const result = classifySentiment(context.item.text, {
      title: context.item.title,
      lang: context.item.lang,
    });

    return {
      values: {
        sentiment: result.sentiment,
        score: result.score,
        positiveScore: result.positiveScore,
        negativeScore: result.negativeScore,
        hasQuotes: result.hasQuotes,
        hasContrast: result.hasContrast,
        model: this.metadata.name ?? 'sentiment-analyzer',
        prompt_version: this.version,
        classified_at: new Date().toISOString(),
      },
    };
  }
}

export const sentimentProcessor = new SentimentProcessor();