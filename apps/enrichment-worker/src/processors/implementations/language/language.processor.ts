import type { ItemLanguage, LanguageInput } from '@nexus/database';
import type {
  EnrichmentProcessor,
  EnrichmentTaskContext,
  LanguageDetector,
  ProcessorContext,
  ProcessorResult,
} from '../../types.js';
import { detectLanguage } from './detect.js';

/**
 * Language detection processor (`lang.v1`).
 * Runs inline in the silver writer transaction to populate `core.item.lang` and
 * `lang_confidence`; the platform-claimed `lang_platform` is never read or overwritten.
 */
export class LanguageProcessor implements EnrichmentProcessor, LanguageDetector {
  readonly jobType = 'lang';
  readonly version = 'lang.v1';
  readonly inputs = ['title', 'text'] as const;
  readonly metadata = {
    jobType: 'lang',
    version: 'lang.v1',
    name: 'Language Detection',
    description: 'Detects BCP-47 item language from title and text with a 0-1 confidence',
    target: 'text' as const,
    supportedPlatforms: ['*'],
  };

  detect(input: LanguageInput): ItemLanguage {
    return detectLanguage(input);
  }

  async process(context: ProcessorContext | EnrichmentTaskContext): Promise<ProcessorResult> {
    const input =
      'item' in context
        ? { title: context.item.title, text: context.item.text }
        : { title: context.job.title ?? null, text: context.job.content_text ?? '' };
    const { lang, confidence } = this.detect(input);
    return { values: { lang, confidence } };
  }
}

export const languageProcessor = new LanguageProcessor();
