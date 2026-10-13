'use client';

import React from 'react';
import { ContainerInfo } from '@/types/telemetry';

interface ContainersTabProps {
  containers: ContainerInfo[];
}

export function ContainersTab({ containers }: ContainersTabProps) {
  return (
    <section className="tab-panel">
      <div className="panel-header">
        <h3>Docker Compose Containers</h3>
        <span className="panel-subtitle">Current services running in local stack</span>
      </div>
      <div className="containers-grid">
        {containers.map((c, i) => {
          if (c.error) {
            return (
              <div className="container-card" key={i}>
                <div className="text-rose">{c.error}: {c.details}</div>
              </div>
            );
          }
          const isRunning = c.State === 'running' || (c.Status && c.Status.includes('Up'));
          return (
            <div className="container-card" key={c.ID || i}>
              <div className="container-header">
                <span className="container-name">{c.Service || c.Name}</span>
                <span className={`badge-status ${isRunning ? 'badge-running' : 'badge-stopped'}`}>
                  {isRunning ? 'RUNNING' : 'STOPPED'}
                </span>
              </div>
              <div className="container-meta-row">
                <span>Container Name</span>
                <span className="meta-val">{c.Name || '--'}</span>
              </div>
              <div className="container-meta-row">
                <span>Status</span>
                <span className="meta-val">{c.Health ? `${c.State} (${c.Health})` : (c.Status || c.State)}</span>
              </div>
              <div className="container-meta-row">
                <span>Ports</span>
                <span className="meta-val">{c.Ports || 'Internal'}</span>
              </div>
              <div className="container-meta-row">
                <span>Image</span>
                <span className="meta-val">{c.Image?.slice(0, 32) || '--'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
