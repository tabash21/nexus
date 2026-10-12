import { NextResponse } from 'next/server';
import { getContainers, getKafkaStats, getDatabaseStats, getS3Stats } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [containers, kafkaStats, dbStats, s3Stats] = await Promise.all([
    getContainers(),
    getKafkaStats(),
    getDatabaseStats(),
    getS3Stats(),
  ]);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    containers,
    kafka: kafkaStats,
    database: dbStats,
    s3: s3Stats,
  });
}
