'use client';

import { useState, useCallback, useRef } from 'react';

export function useToast(defaultDurationMs: number = 3500) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback(
    (message: string, durationMs: number = defaultDurationMs) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setToastMessage(message);
      timeoutRef.current = setTimeout(() => {
        setToastMessage(null);
      }, durationMs);
    },
    [defaultDurationMs]
  );

  const dismissToast = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToastMessage(null);
  }, []);

  return {
    toastMessage,
    showToast,
    dismissToast,
  };
}
