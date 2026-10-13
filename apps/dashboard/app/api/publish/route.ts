import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eventSchema } from '@nexus/contracts';
import { getKafkaProducer } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const eventId = randomUUID();
    const event = eventSchema.parse({
      schemaVersion: 1,
      eventId,
      source: {
        id: body.sourceId || 'demo-react-ui',
        name: body.sourceName || 'Nexus React Flow Monitor',
      },
      observedAt: new Date().toISOString(),
      document: {
        externalId: body.externalId || `art-${Date.now().toString(36)}`,
        url: body.url || `https://nexus.local/news/${Date.now().toString(36)}`,
        title: body.title || 'Simulated OSINT Intelligence Report',
        text: body.text || 'Real-time OSINT document telemetry stream verification payload generated from Next.js UI.',
        language: body.language || 'en',
        attributes: { simulator: 'nextjs-dashboard', timestamp: Date.now() },
      },
    });

    const producer = await getKafkaProducer();
    const topic = process.env.KAFKA_TOPIC || 'osint.raw.v1';
    await producer.send({
      topic,
      acks: -1,
      messages: [
        {
          key: `${event.source.id}:${event.document.externalId}`,
          value: JSON.stringify(event),
        },
      ],
    });

    return NextResponse.json({
      success: true,
      eventId: event.eventId,
      externalId: event.document.externalId,
      topic,
      observedAt: event.observedAt,
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
