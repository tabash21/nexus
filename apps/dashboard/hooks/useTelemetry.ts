'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TelemetryData } from '@/types/telemetry';

export function useTelemetry(pollingIntervalMs: number = 2000) {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    // Prevent overlapping network requests
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    // Clear any pending poll timer
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/status', {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TelemetryData = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to fetch status';
      setError(msg);
      console.error('Failed to fetch status:', err);
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  // Smooth chained polling loop (waits for response before scheduling next interval)
  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      if (!isMounted || !autoRefresh) return;
      await fetchStatus();
      if (isMounted && autoRefresh) {
        timeoutIdRef.current = setTimeout(poll, pollingIntervalMs);
      }
    };

    poll();

    return () => {
      isMounted = false;
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
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
