import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { collectorEventSchema, itemIdentity, sourceSubscriptions } from '@nexus/contracts';
import { getKafkaProducer } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const input: unknown = await req.json();
    const body = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};

    const targetPlatform = typeof body.platform === 'string' && body.platform ? body.platform : 'telegram';
    const targetMode = body.mode === 'simulation' ? 'simulation' : 'real';

    const source = sourceSubscriptions().find(s => s.platform === targetPlatform && s.mode === targetMode)
      ?? sourceSubscriptions().find(s => s.platform === 'telegram' && s.mode === 'real');

    if (!source) {
      return NextResponse.json({ error: `No active source subscription for platform "${targetPlatform}"` }, { status: 400 });
    }

    const eventId = typeof body.eventId === 'string' ? body.eventId : randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const observedAt = new Date(nowSec * 1000).toISOString();

    let payload: unknown;
    let messageKey: string;
    let externalId: string;

    if (source.adapter === 'telegram.v1') {
      const channelId = String(body.channelId || body.sourceId || '1406113886');
      const messageId = typeof body.messageId === 'number'
        ? body.messageId
        : Math.floor(Date.now() / 1000) * 100 + Math.floor(Math.random() * 100);
      externalId = String(messageId);

      const title = typeof body.title === 'string' && body.title.trim()
        ? body.title.trim()
        : `OSINT Intelligence Bulletin #${messageId}`;
      const text = typeof body.text === 'string' && body.text.trim()
        ? body.text.trim()
        : 'Real-time OSINT document telemetry stream verification payload.';
      const channelHandle = typeof body.handle === 'string' ? body.handle : 'nexus_intel';
      const postUrl = typeof body.url === 'string' && body.url ? body.url : `https://t.me/${channelHandle}/${messageId}`;

      const fullMessage = `${title}\n\n${text}\n\n${postUrl}`;
      const linkOffset = fullMessage.indexOf(postUrl);

      payload = {
        id: messageId,
        peerId: {
          channelId,
          className: 'PeerChannel',
        },
        date: nowSec,
        message: fullMessage,
        className: 'Message',
        flags: 17536,
        post: true,
        views: typeof body.views === 'number' ? body.views : Math.floor(Math.random() * 150) + 10,
        forwards: typeof body.forwards === 'number' ? body.forwards : Math.floor(Math.random() * 15),
        postAuthor: typeof body.author === 'string' ? body.author : 'Nexus OSINT Desk',
        entities: [
          {
            offset: 0,
            length: title.length,
            className: 'MessageEntityBold',
          },
          ...(linkOffset >= 0 ? [
            {
              offset: linkOffset,
              length: postUrl.length,
              className: 'MessageEntityUrl',
              url: postUrl,
            },
          ] : []),
        ],
        eventId,
      };

      messageKey = `${source.platform}:${channelId}:${messageId}`;
    } else {
      externalId = typeof body.externalId === 'string' ? body.externalId : randomUUID();
      const event = collectorEventSchema.parse({
        schemaVersion: 'provisional.v1',
        eventId,
        platform: source.platform,
        collector: 'dashboard-demo',
        provider: 'demo',
        observedAt,
        source: {
          id: body.sourceId || 'demo-dashboard',
          kind: 'channel',
          name: body.sourceName || 'Dashboard demo',
        },
        item: {
          nativeId: externalId,
          title: body.title || 'Demo item',
          text: body.text || 'OSINT pipeline verification item.',
          url: body.url || undefined,
          language: body.language || undefined,
        },
      });

      payload = event;
      messageKey = itemIdentity({ ...event, realityId: source.realityId }).itemId;
    }

    const producer = await getKafkaProducer();
    await producer.send({
      topic: source.topic,
      acks: -1,
      messages: [{
        key: messageKey,
        value: JSON.stringify(payload),
      }],
    });

    return NextResponse.json({
      success: true,
      eventId,
      externalId,
      platform: source.platform,
      topic: source.topic,
      adapter: source.adapter,
      mode: source.mode,
      observedAt,
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not validate or publish demo item: ${message}` }, { status: 400 });
  }
}
