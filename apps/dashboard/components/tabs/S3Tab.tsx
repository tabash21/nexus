'use client';

import React from 'react';
import { S3Object } from '@/types/telemetry';

interface S3TabProps {
  bucket?: string;
  objects: S3Object[];
}

export function S3Tab({ bucket = 'nexus-raw', objects }: S3TabProps) {
  return (
    <section className="tab-panel">
      <div className="panel-header">
        <h3>LocalStack S3 Bucket: <code className="code-pill">{bucket}</code></h3>
        <span className="panel-subtitle">Raw Avro archive objects written by Kafka Connect</span>
      </div>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Object Key</th>
              <th>Partition</th>
              <th>File Size</th>
              <th>Archived At</th>
            </tr>
          </thead>
          <tbody>
            {objects.length === 0 ? (
              <tr><td colSpan={4}>Bucket is empty. Waiting for Kafka Connect sink flush.</td></tr>
            ) : (
              objects.map(obj => {
                const match = obj.key.match(/partition=(\d+)/);
                const part = match ? `Partition ${match[1]}` : 'General';
                return (
                  <tr key={obj.key}>
                    <td><code className="code-pill">{obj.key}</code></td>
                    <td>{part}</td>
                    <td>{obj.size} bytes</td>
                    <td>{obj.lastModified ? new Date(obj.lastModified).toLocaleString() : '--'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
