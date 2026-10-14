import { NextResponse } from 'next/server';
import { getContainers, getKafkaStats, getApiStats, getS3Stats } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [containers, kafkaStats, apiStats, s3Stats] = await Promise.all([
    getContainers(),
    getKafkaStats(),
    getApiStats(),
    getS3Stats(),
  ]);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    containers,
    kafka: kafkaStats,
    api: apiStats,
    database: apiStats, // backward compatibility for existing dashboard components
    s3: s3Stats,
  });
}
