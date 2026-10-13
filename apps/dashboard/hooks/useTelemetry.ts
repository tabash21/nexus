'use client';

import { useState, useEffect, useCallback } from 'react';
import { TelemetryData } from '@/types/telemetry';

export function useTelemetry(pollingIntervalMs: number = 2000) {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TelemetryData = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch status';
      setError(msg);
      console.error('Failed to fetch status:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Periodic polling
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchStatus, pollingIntervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStatus, pollingIntervalMs]);

  return {
    data,
    autoRefresh,
    setAutoRefresh,
    isLoading,
    error,
    fetchStatus,
  };
}
