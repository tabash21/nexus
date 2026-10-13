import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { collectorEventSchema, itemIdentity } from '@nexus/contracts';
import { getKafkaProducer } from '@/lib/telemetry';
import { sourceSubscriptions } from '../../../../../scripts/lib/source-registry.mjs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const input: unknown = await req.json();
    const body = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
    const source = sourceSubscriptions().find(source => source.platform === 'telegram' && source.mode === 'real');
    if (!source) return NextResponse.json({ error: 'Telegram demo source is not configured' }, { status: 400 });
    const event = collectorEventSchema.parse({ schemaVersion: 'provisional.v1', eventId: randomUUID(),
      platform: 'telegram', collector: 'dashboard-demo', provider: 'demo', observedAt: new Date().toISOString(),
      source: { id: body.sourceId || 'demo-dashboard', kind: 'channel', name: body.sourceName || 'Dashboard demo' },
      item: { nativeId: body.externalId || randomUUID(), title: body.title || 'Demo item',
        text: body.text || 'OSINT pipeline verification item.', url: body.url || undefined, language: body.language || undefined },
    });
    const producer = await getKafkaProducer();
    await producer.send({ topic: source.topic, acks: -1, messages: [{ key: itemIdentity({ ...event, realityId: source.realityId }).itemId, value: JSON.stringify(event) }] });
    return NextResponse.json({ success: true, eventId: event.eventId, externalId: event.item.nativeId,
      topic: source.topic, observedAt: event.observedAt }, { status: 201 });
  } catch { return NextResponse.json({ error: 'Could not validate or publish demo item' }, { status: 400 }); }
}
