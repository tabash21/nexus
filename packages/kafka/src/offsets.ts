/**
 * Kafka commits the offset of the *next* message to consume.
 * Increments the stringified 64-bit integer offset safely using BigInt.
 */
export function nextOffset(offset: string): string {
  return (BigInt(offset) + 1n).toString();
}
