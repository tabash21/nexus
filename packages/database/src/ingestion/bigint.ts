/**
 * Converts a stringified integer count/timestamp into a BigInt safely, or returns undefined.
 */
export const toBigInt = (value: string | undefined): bigint | undefined =>
  value === undefined ? undefined : BigInt(value);
