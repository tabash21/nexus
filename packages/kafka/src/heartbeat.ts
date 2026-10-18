/**
 * Coordinates in-flight heartbeats during slow persistence or async operations.
 * If a heartbeat fails or throws, the guard rejects to prevent committing an expired lease.
 */
export async function withHeartbeat(
  heartbeat: () => Promise<void>,
  work: (guard: () => Promise<void>) => Promise<void>,
): Promise<void> {
  let failure: unknown;
  let pending: Promise<void> | undefined;

  const beat = async (): Promise<void> => {
    if (failure) throw failure;
    pending ??= heartbeat()
      .catch(error => {
        failure = error;
        throw error;
      })
      .finally(() => {
        pending = undefined;
      });
    await pending;
  };

  await beat();
  const timer = setInterval(() => {
    void beat().catch(() => {});
  }, 2000);

  try {
    await work(beat);
  } finally {
    clearInterval(timer);
    await pending?.catch(() => {});
  }
}
