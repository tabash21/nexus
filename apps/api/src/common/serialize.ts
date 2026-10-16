export const serialize = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_, entry: unknown) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  );
