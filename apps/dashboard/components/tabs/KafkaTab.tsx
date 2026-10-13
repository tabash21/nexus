'use client';

import React from 'react';
import { KafkaTopic, KafkaGroup } from '@/types/telemetry';

interface KafkaTabProps {
  topics: KafkaTopic[];
  groups: KafkaGroup[];
  brokers?: string[];
  securityProtocol?: string;
  connected?: boolean;
  error?: string;
}

export function KafkaTab({ topics, groups, brokers, securityProtocol, connected, error }: KafkaTabProps) {
  const brokerDisplay = brokers && brokers.length > 0 ? brokers.join(', ') : 'localhost:9092';
  return (
    <section className="tab-panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3>Kafka Topics & Consumer Groups</h3>
          <span className="panel-subtitle">
            Broker: <code className="code-pill">{brokerDisplay}</code>
            {securityProtocol && securityProtocol !== 'PLAINTEXT' && (
              <span style={{ marginLeft: '8px', color: '#38bdf8' }}>({securityProtocol})</span>
            )}
          </span>
        </div>
        <div>
          <span className={`badge-status ${connected ? 'badge-running' : 'badge-stopped'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
      {error && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          marginBottom: '16px',
          color: '#f87171',
          fontSize: '13px',
        }}>
          <strong>Connection notice:</strong> {error}
        </div>
      )}
      <div className="kafka-grid">
        <div className="data-card">
          <h4>Topics & Partition Offsets</h4>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Partition</th>
                  <th>High Watermark</th>
                  <th>Low Watermark</th>
                </tr>
              </thead>
              <tbody>
                {topics.length === 0 ? (
                  <tr><td colSpan={4}>No topic metadata available</td></tr>
                ) : (
                  topics.flatMap(t =>
                    t.partitions?.map(p => (
                      <tr key={`${t.topic}-${p.partition}`}>
                        <td><code className="code-pill">{t.topic}</code></td>
                        <td>Partition {p.partition}</td>
                        <td><strong>{p.offset}</strong></td>
                        <td>{p.low || 0}</td>
                      </tr>
                    ))
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="data-card">
          <h4>Consumer Groups</h4>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Group ID</th>
                  <th>Protocol</th>
                  <th>State</th>
                  <th>Members</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr><td colSpan={4}>No consumer groups discovered</td></tr>
                ) : (
                  groups.map(g => (
                    <tr key={g.groupId}>
                      <td><code className="code-pill">{g.groupId}</code></td>
                      <td>{g.protocolType || g.details?.protocolType || 'consumer'}</td>
                      <td><span className="badge-status badge-running">{g.details?.state || 'Stable'}</span></td>
                      <td>{g.details?.members ? `${g.details.members.length} client(s)` : 'Active'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
