export interface ArchiveCoordinates {
  topic: string;
  partition: number;
  startOffset: bigint;
}

/**
 * Parses Kafka Connect S3 sink naming convention:
 * `raw/<topic>/partition=<partition>/<topic>+<partition>+<startOffset>.avro`
 * Connect names an object by its first offset; records inside it retain subsequent offsets.
 */
export function archiveCoordinates(key: string): ArchiveCoordinates | null {
  const match = /(?:^|\/)([^/]+)\+(\d+)\+(\d+)\.avro$/.exec(key);
  if (!match) return null;

  return {
    topic: match[1]!,
    partition: Number(match[2]),
    startOffset: BigInt(match[3]!),
  };
}
