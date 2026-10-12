'use client';

import React, { useState } from 'react';

interface HeaderProps {
  autoRefresh: boolean;
  onToggleAutoRefresh: (val: boolean) => void;
  onManualRefresh: () => void;
  onPublished?: (eventId: string) => void;
  onError?: (msg: string) => void;
}

export function Header({
  autoRefresh,
  onToggleAutoRefresh,
  onManualRefresh,
  onPublished,
  onError,
}: HeaderProps) {
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `OSINT Intelligence Bulletin #${Math.floor(Math.random() * 9000 + 1000)}`,
          text: `Real-time OSINT document telemetry stream verification payload generated from Next.js React UI at ${new Date().toISOString()}`,
        }),
      });

      const result = await res.json();
      if (res.ok) {
        onPublished?.(result.eventId || '');
      } else {
        onError?.(`Publish error: ${result.error || 'Failed'}`);
      }
    } catch {
      onError?.('Publish request failed');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <header className="top-nav">
      <div className="brand">
        <div className="logo-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="url(#logo-grad)" strokeWidth="2.5" />
            <path d="M12 6L16 12L12 18L8 12Z" fill="url(#logo-grad)" />
            <defs>
              <linearGradient id="logo-grad" x1="0" y1="0" x2="24" y2="24">
                <stop offset="0%" stopColor="#00f2fe" />
                <stop offset="100%" stopColor="#4facfe" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="brand-text">
          <h1>
            NEXUS <span className="badge-version">v0.1.0</span>
            <span className="badge-framework">Next.js 15 / React 19</span>
          </h1>
          <p className="tagline">Real-Time OSINT Data Platform & Pipeline Flow Monitor</p>
        </div>
      </div>

      <div className="header-controls">
        <div className="system-health-pill">
          <span className="status-indicator live"></span>
          <span className="health-text">LIVE MONITORING</span>
        </div>

        <button
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={isPublishing}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          {isPublishing ? 'Publishing...' : 'Inject OSINT Event'}
        </button>

        <div className="auto-refresh-toggle">
          <label className="switch">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => onToggleAutoRefresh(e.target.checked)}
            />
            <span className="slider"></span>
          </label>
          <span className="refresh-label">Live 2s</span>
        </div>

        <button
          className="btn btn-ghost"
          onClick={onManualRefresh}
          title="Refresh Now"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </button>
      </div>
    </header>
  );
}
