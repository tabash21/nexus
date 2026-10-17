'use client';

import type { TelemetryData } from '@/types/telemetry';

interface PipelineFlowProps {
  data: TelemetryData | null;
  flowPulse: boolean;
  onSelectTab: (tab: 'containers' | 'kafka' | 'documents' | 's3') => void;
}

export function PipelineFlow({ data, flowPulse, onSelectTab }: PipelineFlowProps) {
  const topics = data?.kafka?.topics ?? [];
  const raw = topics.filter(t => t.topic.startsWith('raw.') || t.topic.startsWith('sim.'));
  const silver = topics.find(t => t.topic === 'items.silver');
  const rawCount = raw.reduce((sum, t) => sum + t.partitions.reduce((part, p) => part + Number(p.offset || 0), 0), 0);
  const silverCount = silver?.partitions.reduce((sum, p) => sum + Number(p.offset || 0), 0) ?? 0;
  const pulse = flowPulse ? 'pulse-highlight' : '';
  const arrow = <div className="flow-arrow"><div className="flow-particle"></div></div>;

  return <section className="flow-section">
    <div className="section-header"><div className="section-title">
      <h2>Bronze → Silver → PostgreSQL</h2>
      <p>The worker archives raw deliveries and publishes normalized silver observations. The enrichment worker writes gold tables.</p>
    </div></div>
    <div className="flow-canvas">
      <div className="flow-node node-kafka" onClick={() => onSelectTab('kafka')}>
        <div className="node-badge">SOURCE KAFKA</div><div className="node-title">Raw topics</div>
        <div className="node-meta">{rawCount} messages</div>
      </div>
      {arrow}
      <div className={`flow-node node-worker ${pulse}`} onClick={() => onSelectTab('containers')}>
        <div className="node-badge">MAPPER</div><div className="node-title">Worker</div>
        <div className="node-meta">Archive + normalize</div>
      </div>
      <div className="flow-branch-container">
        <div className="flow-branch branch-top">
          {arrow}
          <div className="flow-node node-kafka" onClick={() => onSelectTab('kafka')}>
            <div className="node-badge">SILVER KAFKA</div><div className="node-title">items.silver</div>
            <div className="node-meta">{silverCount} messages</div>
          </div>
          {arrow}
          <div className={`flow-node node-worker ${pulse}`} onClick={() => onSelectTab('containers')}>
            <div className="node-badge">DB WRITER</div><div className="node-title">Enrichment worker</div>
            <div className="node-meta">No models yet</div>
          </div>
          {arrow}
          <div className={`flow-node node-postgres ${pulse}`} onClick={() => onSelectTab('documents')}>
            <div className="node-badge">GOLD</div><div className="node-title">PostgreSQL</div>
            <div className="node-meta">{data?.database?.counts?.documents_count ?? 0} queryable items</div>
          </div>
        </div>
        <div className="flow-branch branch-bottom">
          {arrow}
          <div className="flow-node node-s3" onClick={() => onSelectTab('s3')}>
            <div className="node-badge">BRONZE</div><div className="node-title">S3 raw archive</div>
            <div className="node-meta">s3://{data?.s3?.bucket || 'nexus-raw'} ({data?.s3?.objects?.length ?? 0} objects)</div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
