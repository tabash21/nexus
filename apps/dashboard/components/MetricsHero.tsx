'use client';

import React from 'react';
import { TelemetryData } from '@/types/telemetry';

interface MetricsHeroProps {
  data: TelemetryData | null;
  onSelectTab: (tab: 'containers' | 'kafka' | 'documents' | 's3') => void;
}

export function MetricsHero({ data, onSelectTab }: MetricsHeroProps) {
  const totalContainers = data?.containers?.length || 0;
  const runningContainers = data?.containers?.filter(
    c => c.State === 'running' || (c.Status && c.Status.includes('Up'))
  ).length || 0;

  const kafkaTopics = data?.kafka?.topics || [];
  const rawTopic = kafkaTopics.find(t => t.topic === 'osint.raw.v1');
  const totalPartitions = kafkaTopics.reduce((acc, t) => acc + (t.partitions?.length || 0), 0);
  const totalKafkaMsgs = rawTopic?.partitions?.reduce((acc, p) => acc + Number(p.offset || 0), 0) || 0;

  const dbCounts = data?.database?.counts || {};
  const s3Objects = data?.s3?.objects || [];

  return (
    <section className="metrics-grid">
      <div className="metric-card" onClick={() => onSelectTab('containers')} style={{ cursor: 'pointer' }}>
        <div className="metric-icon containers-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        </div>
        <div className="metric-info">
          <span className="metric-label">Active Containers</span>
          <div className="metric-value">{runningContainers}/{totalContainers}</div>
        </div>
        <div className="metric-trend text-emerald">
          {runningContainers === totalContainers && totalContainers > 0 ? 'All 6 Services Healthy' : 'Stack Initializing'}
        </div>
      </div>

      <div className="metric-card" onClick={() => onSelectTab('kafka')} style={{ cursor: 'pointer' }}>
        <div className="metric-icon kafka-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </div>
        <div className="metric-info">
          <span className="metric-label">Kafka KRaft Broker</span>
          <div className="metric-value">{kafkaTopics.length} Topics</div>
        </div>
        <div className="metric-trend text-cyan">{totalPartitions} total partitions ({totalKafkaMsgs} msgs)</div>
      </div>

      <div className="metric-card" onClick={() => onSelectTab('documents')} style={{ cursor: 'pointer' }}>
        <div className="metric-icon pg-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        </div>
        <div className="metric-info">
          <span className="metric-label">PostgreSQL Documents</span>
          <div className="metric-value">{dbCounts.documents_count ?? '--'}</div>
        </div>
        <div className="metric-trend text-indigo">{dbCounts.versions_count ?? 0} versions, {dbCounts.events_count ?? 0} events</div>
      </div>

      <div className="metric-card" onClick={() => onSelectTab('s3')} style={{ cursor: 'pointer' }}>
        <div className="metric-icon s3-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="metric-info">
          <span className="metric-label">S3 Raw Archives</span>
          <div className="metric-value">{s3Objects.length} Objects</div>
        </div>
        <div className="metric-trend text-amber">s3://{data?.s3?.bucket || 'nexus-raw'}</div>
      </div>
    </section>
  );
}
