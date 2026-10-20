import type { SentimentLabel } from '@nexus/contracts';
import { InvalidSentimentLabelError } from './errors.js';

const validLabels: SentimentLabel[] = [
  'positive',
  'neutral',
  'negative',
  'mixed',
];

export function validateSentimentLabel(
  value: SentimentLabel,
): SentimentLabel {
  if (
    typeof value === 'string' &&
    validLabels.includes(value)
  ) {
    return value;
  }

  throw new InvalidSentimentLabelError(
    `Invalid sentiment label: ${String(value)}`,
  );
}