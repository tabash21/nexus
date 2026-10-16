'use client';

import React from 'react';
import { TelemetryData } from '@/types/telemetry';

interface PipelineFlowProps {
  data: TelemetryData | null;
  flowPulse: boolean;
  onSelectTab: (tab: 'containers' | 'kafka' | 'documents' | 's3') => void;
}

export function PipelineFlow({ data, flowPulse, onSelectTab }: PipelineFlowProps) {
  const rawTopics = (data?.kafka?.topics ?? []).filter(t => t.topic.startsWith('raw.') || t.topic.startsWith('sim.'));
  const totalKafkaMsgs = rawTopics.reduce((total,t) => total + t.partitions.reduce((acc,p) => acc + Number(p.offset || 0),0),0);
  const dbCounts = data?.database?.counts || {};
  const s3Objects = data?.s3?.objects || [];

  return (
    <section className="flow-section">
      <div className="section-header">
        <div className="section-title">
          <h2>Interactive Pipeline Flow (Dual-Path Ingestion)</h2>
          <p>Real-time topology connecting Ingest, Kafka streaming, Worker normalization, PostgreSQL, and S3 Connect</p>
        </div>
        <div className="flow-legend">
          <span className="legend-item"><span className="dot active"></span> Operational Path</span>
          <span className="legend-item"><span className="dot archive"></span> Archival Path</span>
          <span className="legend-item"><span className="dot dlq"></span> Quarantine DLQ</span>
        </div>
      </div>

      <div className="flow-canvas">
        {/* Node 1: Producer */}
        <div
          className={`flow-node node-producer ${flowPulse ? 'pulse-highlight' : ''}`}
          onClick={() => onSelectTab('kafka')}
        >
          <div className="node-badge">INGEST</div>
          <div className="node-title">OSINT Sources</div>
          <div className="node-meta">Simulators & Feeds</div>
          <div className="node-status-dot"></div>
        </div>

        <div className="flow-arrow arrow-1">
          <div className="flow-particle"></div>
        </div>

        {/* Node 2: Kafka */}
        <div
          className={`flow-node node-kafka ${flowPulse ? 'pulse-highlight' : ''}`}
          onClick={() => onSelectTab('kafka')}
        >
          <div className="node-badge">
            {data?.kafka?.securityProtocol === 'SASL_SSL' ? 'CLOUD KAFKA' : 'BROKER'}
          </div>
          <div className="node-title">
            {data?.kafka?.brokers?.[0] ? data.kafka.brokers[0] : 'Apache Kafka 4'}
          </div>
              <div className="node-meta">Platform topics ({totalKafkaMsgs} msgs)</div>
          <div className="node-status-dot"></div>
        </div>

        {/* Dual Branch Container */}
        <div className="flow-branch-container">
          {/* Operational branch (Top) */}
          <div className="flow-branch branch-top">
            <div className="flow-arrow branch-arrow">
              <div className="flow-particle particle-op"></div>
            </div>

            {/* Node 3: Worker */}
            <div
              className={`flow-node node-worker ${flowPulse ? 'pulse-highlight' : ''}`}
              onClick={() => onSelectTab('containers')}
            >
              <div className="node-badge">WORKER</div>
              <div className="node-title">Nexus Worker</div>
              <div className="node-meta">Normalizer Engine</div>
              <div className="node-status-dot"></div>
            </div>

            <div className="flow-arrow branch-arrow">
              <div className="flow-particle particle-op"></div>
            </div>

            {/* Node 4: PostgreSQL */}
            <div
              className={`flow-node node-postgres ${flowPulse ? 'pulse-highlight' : ''}`}
              onClick={() => onSelectTab('documents')}
            >
              <div className="node-badge">STORAGE</div>
              <div className="node-title">PostgreSQL 17</div>
              <div className="node-meta">Normalized & Indexed</div>
              <div className="node-status-dot"></div>
            </div>

            <div className="flow-arrow branch-arrow">
              <div className="flow-particle particle-op"></div>
            </div>

            {/* Node 5: API */}
            <div
              className={`flow-node node-api ${flowPulse ? 'pulse-highlight' : ''}`}
              onClick={() => onSelectTab('documents')}
            >
              <div className="node-badge">REST API & UI FEED</div>
              <div className="node-title">NestJS Query API</div>
              <div className="node-meta">{dbCounts.documents_count ?? 0} items queryable (/v1/items)</div>
              <div className="node-status-dot"></div>
            </div>
          </div>

          {/* Archival branch (Bottom) */}
          <div className="flow-branch branch-bottom">
            <div className="flow-arrow branch-arrow">
              <div className="flow-particle particle-arch"></div>
            </div>

            {/* Node 6: Connect */}
            <div
              className="flow-node node-connect"
              onClick={() => onSelectTab('containers')}
            >
              <div className="node-badge">CONNECTOR</div>
              <div className="node-title">Kafka Connect</div>
              <div className="node-meta">nexus-connect group</div>
              <div className="node-status-dot"></div>
            </div>

            <div className="flow-arrow branch-arrow">
              <div className="flow-particle particle-arch"></div>
            </div>

            {/* Node 7: S3 */}
            <div
              className="flow-node node-s3"
              onClick={() => onSelectTab('s3')}
            >
              <div className="node-badge">RAW ARCHIVE</div>
              <div className="node-title">LocalStack S3</div>
              <div className="node-meta">s3://{data?.s3?.bucket || 'nexus-raw'} ({s3Objects.length} files)</div>
              <div className="node-status-dot"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
