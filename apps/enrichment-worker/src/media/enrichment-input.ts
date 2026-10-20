import { hash } from '@nexus/contracts';
import { MEDIA_PROCESSOR_VERSION, type itemSchema } from '@nexus/database';

/** Pure opt-in input builder. Source post text remains a separate, unchanged value. */
export function buildMediaEnrichmentInput(
  item: Pick<itemSchema.ItemRow, 'title' | 'content_text' | 'content_revision'>,
  media: readonly itemSchema.ItemMediaRow[],
) {
  const attachments = [...media]
    .sort((a, b) => a.position - b.position)
    .map(attachment => ({
      position: attachment.position,
      generation: attachment.attachment_generation,
      ocrText: attachment.ocr_text,
    }));
  return {
    originalText: item.content_text,
    attachments,
    combinedText: [
      item.title,
      item.content_text,
      ...attachments
        .filter(attachment => attachment.ocrText?.trim())
        .map(attachment => `[Attachment ${attachment.position}]\n${attachment.ocrText}`),
    ]
      .filter(Boolean)
      .join('\n\n'),
    inputHash: hash({
      contentRevision: item.content_revision.toString(),
      title: item.title,
      text: item.content_text,
      processorVersion: MEDIA_PROCESSOR_VERSION,
      attachments,
    }),
  };
}
