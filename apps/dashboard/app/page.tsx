'use client';

import React, { useState } from 'react';
import { TabType } from '@/types/telemetry';
import { useTelemetry } from '@/hooks/useTelemetry';
import { useToast } from '@/hooks/useToast';
import { Header } from '@/components/Header';
import { MetricsHero } from '@/components/MetricsHero';
import { PipelineFlow } from '@/components/PipelineFlow';
import { TabExplorer } from '@/components/TabExplorer';
import { Toast } from '@/components/Toast';

export default function DashboardPage() {
  // Shared telemetry state & auto-refresh polling
  const { data, autoRefresh, setAutoRefresh, fetchStatus } = useTelemetry();

  // Shared toast notifications
  const { toastMessage, showToast } = useToast();

  // Active tab state shared between Hero cards, Pipeline nodes, and Tab navigation
  const [activeTab, setActiveTab] = useState<TabType>('containers');

  // Pulse effect triggered across pipeline on new event injection
  const [flowPulse, setFlowPulse] = useState(false);

  const handlePublished = (eventId: string) => {
    showToast(`Telegram event published to Kafka! ID: ${eventId?.slice(0, 8)}...`);
    setFlowPulse(true);
    setTimeout(() => setFlowPulse(false), 1200);
    fetchStatus();
    setTimeout(() => fetchStatus(), 400);
  };

  return (
    <div className="app-container">
      {/* 1. Top Header with self-contained publish button & refresh controls */}
      <Header
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={setAutoRefresh}
        onManualRefresh={fetchStatus}
        onPublished={handlePublished}
        onError={showToast}
      />

      {/* 2. KPI Metrics Overview */}
      <MetricsHero
        data={data}
        onSelectTab={setActiveTab}
      />

      {/* 3. Interactive Topology Flow */}
      <PipelineFlow
        data={data}
        flowPulse={flowPulse}
        onSelectTab={setActiveTab}
      />

      {/* 4. Tabbed Subsystem Explorer */}
      <TabExplorer
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        data={data}
      />

      {/* 5. Global Toast Alerts */}
      <Toast message={toastMessage} />
    </div>
  );
}
