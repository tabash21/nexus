'use client';

import React from 'react';
import { TelemetryData, TabType } from '@/types/telemetry';
import { ContainersTab } from '@/components/tabs/ContainersTab';
import { KafkaTab } from '@/components/tabs/KafkaTab';
import { DocumentsTab } from '@/components/tabs/DocumentsTab';
import { S3Tab } from '@/components/tabs/S3Tab';

interface TabExplorerProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  data: TelemetryData | null;
}

export function TabExplorer({ activeTab, onSelectTab, data }: TabExplorerProps) {
  const totalContainers = data?.containers?.length || 0;

  return (
    <main className="tabs-section">
      <nav className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'containers' ? 'active' : ''}`}
          onClick={() => onSelectTab('containers')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          Containers ({totalContainers})
        </button>

        <button
          className={`tab-btn ${activeTab === 'kafka' ? 'active' : ''}`}
          onClick={() => onSelectTab('kafka')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Kafka UI
        </button>

        <button
          className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => onSelectTab('documents')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Items (API Service)
        </button>

        <button
          className={`tab-btn ${activeTab === 's3' ? 'active' : ''}`}
          onClick={() => onSelectTab('s3')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          S3 Raw Archive
        </button>
      </nav>

      {activeTab === 'containers' && (
        <ContainersTab containers={data?.containers || []} />
      )}

      {activeTab === 'kafka' && (
        <KafkaTab
          topics={data?.kafka?.topics || []}
          groups={data?.kafka?.groups || []}
          brokers={data?.kafka?.brokers}
          securityProtocol={data?.kafka?.securityProtocol}
          connected={data?.kafka?.connected}
          error={data?.kafka?.error}
        />
      )}

      {activeTab === 'documents' && (
        <DocumentsTab
          documents={data?.database?.documents || []}
        />
      )}

      {activeTab === 's3' && (
        <S3Tab
          bucket={data?.s3?.bucket}
          objects={data?.s3?.objects || []}
        />
      )}
    </main>
  );
}
