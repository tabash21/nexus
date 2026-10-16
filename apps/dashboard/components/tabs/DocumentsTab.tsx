'use client';

import React, { useState } from 'react';
import { DocumentRow } from '@/types/telemetry';
import { DocumentModal } from '@/components/DocumentModal';

interface DocumentsTabProps {
  documents: DocumentRow[];
}

export function DocumentsTab({ documents }: DocumentsTabProps) {
  const [filterText, setFilterText] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<DocumentRow | null>(null);

  const filtered = documents.filter(doc => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      (doc.title && doc.title.toLowerCase().includes(q)) ||
      (doc.external_id && doc.external_id.toLowerCase().includes(q)) ||
      (doc.source_id && doc.source_id.toLowerCase().includes(q))
    );
  });

  return (
    <>
      <section className="tab-panel">
        <div className="panel-header">
          <div>
            <h3>Ingested Items (NestJS API Service)</h3>
            <span className="panel-subtitle">Normalized records queried live via GET /v1/items from the authenticated API</span>
          </div>
          <input
            type="text"
            className="search-input"
            placeholder="Filter by title or external ID..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item ID</th>
                <th>Source</th>
                <th>External ID</th>
                <th>Title</th>
                <th>Language</th>
                <th>Content Hash</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>No matching documents found.</td>
                </tr>
              ) : (
                filtered.map(doc => (
                  <tr key={doc.id}>
                    <td>
                      <code className="code-pill">{doc.id.slice(0, 8)}...</code>
                    </td>
                    <td>
                      <strong>{doc.source_id}</strong>
                    </td>
                    <td>
                      <code>{doc.external_id}</code>
                    </td>
                    <td>{doc.title || 'Untitled'}</td>
                    <td>
                      <span className="badge-version">{doc.language || 'Unknown'}</span>
                    </td>
                    <td>
                      <code title={doc.content_hash || ''}>{doc.content_hash?.slice(0, 10)}...</code>
                    </td>
                    <td>{new Date(doc.last_seen_at).toLocaleTimeString()}</td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => setSelectedDoc(doc)}
                      >
                        View JSON
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Document details modal encapsulated within DocumentsTab */}
      <DocumentModal
        doc={selectedDoc}
        onClose={() => setSelectedDoc(null)}
      />
    </>
  );
}
