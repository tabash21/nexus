'use client';

import React from 'react';

interface ToastProps {
  message: string | null;
}

export function Toast({ message }: ToastProps) {
  if (!message) return null;

  return (
    <div className="toast show">
      {message}
    </div>
  );
}
