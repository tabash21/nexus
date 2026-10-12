'use client';

import React from 'react';
import { DocumentRow } from '@/types/telemetry';

interface DocumentModalProps {
  doc: DocumentRow | null;
  onClose: () => void;
}

export function DocumentModal({ doc, onClose }: DocumentModalProps) {
  if (!doc) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Document: {doc.title || doc.external_id}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <pre><code className="json-code">{JSON.stringify(doc, null, 2)}</code></pre>
        </div>
      </div>
    </div>
  );
}
