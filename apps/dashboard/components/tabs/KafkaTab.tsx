'use client';

import React from 'react';
import { KafkaTopic, KafkaGroup } from '@/types/telemetry';

interface KafkaTabProps {
  topics: KafkaTopic[];
  groups: KafkaGroup[];
}

export function KafkaTab({ topics, groups }: KafkaTabProps) {
  return (
    <section className="tab-panel">
      <div className="panel-header">
        <h3>Kafka Topics & Consumer Groups</h3>
        <span className="panel-subtitle">Topics: osint.raw.v1, osint.quarantine.v1</span>
      </div>
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
