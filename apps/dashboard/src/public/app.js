// State
let state = {
  containers: [],
  kafka: null,
  database: null,
  s3: null,
  filterText: '',
  timer: null,
};

// DOM Elements
const autoRefreshToggle = document.getElementById('autoRefreshToggle');
const btnManualRefresh = document.getElementById('btnManualRefresh');
const btnPublishDemo = document.getElementById('btnPublishDemo');
const docSearchInput = document.getElementById('docSearchInput');
const detailModal = document.getElementById('detailModal');
const btnModalClose = document.getElementById('btnModalClose');
const modalTitle = document.getElementById('modalTitle');
const modalJson = document.getElementById('modalJson');
const toastNotification = document.getElementById('toastNotification');

// Metrics elements
const valContainers = document.getElementById('valContainers');
const valContainersSub = document.getElementById('valContainersSub');
const valKafkaTopics = document.getElementById('valKafkaTopics');
const valKafkaSub = document.getElementById('valKafkaSub');
const valDocs = document.getElementById('valDocs');
const valDocsSub = document.getElementById('valDocsSub');
const valS3 = document.getElementById('valS3');
const valS3Sub = document.getElementById('valS3Sub');
const flowKafkaMeta = document.getElementById('flowKafkaMeta');
const flowPgMeta = document.getElementById('flowPgMeta');
const flowS3Meta = document.getElementById('flowS3Meta');
const systemHealthText = document.getElementById('systemHealthText');

// Tables & Grids
const containersGrid = document.getElementById('containersGrid');
const kafkaTopicsTable = document.getElementById('kafkaTopicsTable').querySelector('tbody');
const kafkaGroupsTable = document.getElementById('kafkaGroupsTable').querySelector('tbody');
const documentsTable = document.getElementById('documentsTable').querySelector('tbody');
const s3Table = document.getElementById('s3Table').querySelector('tbody');

// Toast helper
function showToast(msg, duration = 3000) {
  toastNotification.textContent = msg;
  toastNotification.classList.add('show');
  setTimeout(() => toastNotification.classList.remove('show'), duration);
}

// Fetch all status data
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.containers = data.containers || [];
    state.kafka = data.kafka || null;
    state.database = data.database || null;
    state.s3 = data.s3 || null;

    renderKPIs();
    renderContainers();
    renderKafka();
    renderDocuments();
    renderS3();
    systemHealthText.textContent = 'LIVE MONITORING';
  } catch (err) {
    console.error('Fetch error:', err);
    systemHealthText.textContent = 'DISCONNECTED';
  }
}

// Render Top KPI Metrics & Flow Metadata
function renderKPIs() {
  // Containers
  const totalContainers = state.containers.length;
  const runningContainers = state.containers.filter(c => c && (c.State === 'running' || (c.Status && c.Status.includes('Up')))).length;
  valContainers.textContent = `${runningContainers}/${totalContainers}`;
  valContainersSub.textContent = runningContainers === totalContainers ? 'All 6 Services Healthy' : 'Degraded Cluster';
  document.getElementById('tabCountContainers').textContent = totalContainers;

  // Kafka
  if (state.kafka && state.kafka.topics) {
    const rawTopic = state.kafka.topics.find(t => t.topic === 'osint.raw.v1');
    const totalPartitions = state.kafka.topics.reduce((acc, t) => acc + (t.partitions?.length || 0), 0);
    valKafkaTopics.textContent = `${state.kafka.topics.length} Topics`;
    valKafkaSub.textContent = `${totalPartitions} total partitions active`;
    if (rawTopic && rawTopic.partitions) {
      const totalMessages = rawTopic.partitions.reduce((acc, p) => acc + Number(p.offset || 0), 0);
      flowKafkaMeta.textContent = `osint.raw.v1 (${totalMessages} msgs)`;
    }
  }

  // Database
  if (state.database && state.database.counts) {
    const c = state.database.counts;
    valDocs.textContent = c.documents_count != null ? c.documents_count : '0';
    valDocsSub.textContent = `${c.versions_count || 0} versions, ${c.events_count || 0} events`;
    flowPgMeta.textContent = `${c.documents_count || 0} docs, ${c.events_count || 0} events`;
  }

  // S3
  if (state.s3 && state.s3.objects) {
    valS3.textContent = `${state.s3.objects.length} Objects`;
    valS3Sub.textContent = `s3://${state.s3.bucket}`;
    flowS3Meta.textContent = `s3://${state.s3.bucket} (${state.s3.objects.length} files)`;
  }
}

// Render Docker Containers Tab
function renderContainers() {
  if (!state.containers.length) {
    containersGrid.innerHTML = '<div class="loading-state">No containers discovered.</div>';
    return;
  }

  containersGrid.innerHTML = state.containers.map(c => {
    if (c.error) {
      return `<div class="container-card"><div class="text-rose">${c.error}: ${c.details || ''}</div></div>`;
    }
    const isRunning = c.State === 'running' || (c.Status && c.Status.includes('Up'));
    const badgeClass = isRunning ? 'badge-running' : 'badge-stopped';
    const statusText = c.Health ? `${c.State} (${c.Health})` : (c.Status || c.State);

    return `
      <div class="container-card">
        <div class="container-header">
          <span class="container-name">${c.Service || c.Name}</span>
          <span class="badge-status ${badgeClass}">${isRunning ? 'RUNNING' : 'STOPPED'}</span>
        </div>
        <div class="container-meta-row">
          <span>Container Name</span>
          <span class="meta-val">${c.Name || '--'}</span>
        </div>
        <div class="container-meta-row">
          <span>Status</span>
          <span class="meta-val">${statusText}</span>
        </div>
        <div class="container-meta-row">
          <span>Ports</span>
          <span class="meta-val">${c.Ports || 'Internal'}</span>
        </div>
        <div class="container-meta-row">
          <span>Image</span>
          <span class="meta-val">${c.Image ? c.Image.slice(0, 30) : '--'}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Render Kafka Topics & Consumer Groups
function renderKafka() {
  if (!state.kafka || !state.kafka.topics) {
    kafkaTopicsTable.innerHTML = '<tr><td colspan="4">No Kafka topic metadata available.</td></tr>';
    return;
  }

  // Topics
  const topicRows = [];
  state.kafka.topics.forEach(t => {
    if (!t.partitions || !t.partitions.length) {
      topicRows.push(`<tr><td><code class="code-pill">${t.topic}</code></td><td>-</td><td>-</td><td>-</td></tr>`);
    } else {
      t.partitions.forEach(p => {
        topicRows.push(`
          <tr>
            <td><code class="code-pill">${t.topic}</code></td>
            <td>Partition ${p.partition}</td>
            <td><strong>${p.offset}</strong></td>
            <td>${p.low || 0}</td>
          </tr>
        `);
      });
    }
  });
  kafkaTopicsTable.innerHTML = topicRows.join('') || '<tr><td colspan="4">No topics found.</td></tr>';

  // Consumer Groups
  if (state.kafka.groups && state.kafka.groups.length) {
    kafkaGroupsTable.innerHTML = state.kafka.groups.map(g => {
      const details = g.details || {};
      const membersCount = details.members ? details.members.length : 0;
      return `
        <tr>
          <td><code class="code-pill">${g.groupId}</code></td>
          <td>${g.protocolType || details.protocolType || 'consumer'}</td>
          <td><span class="badge-status badge-running">${details.state || 'Stable'}</span></td>
          <td>${membersCount} active client(s)</td>
        </tr>
      `;
    }).join('');
  } else {
    kafkaGroupsTable.innerHTML = '<tr><td colspan="4">No active consumer groups found.</td></tr>';
  }
}

// Render PostgreSQL Documents Table
function renderDocuments() {
  if (!state.database || !state.database.documents) {
    documentsTable.innerHTML = '<tr><td colspan="8">No document persistence records found.</td></tr>';
    return;
  }

  const query = state.filterText.toLowerCase();
  const docs = state.database.documents.filter(d => {
    if (!query) return true;
    return (d.title && d.title.toLowerCase().includes(query)) ||
           (d.external_id && d.external_id.toLowerCase().includes(query)) ||
           (d.source_id && d.source_id.toLowerCase().includes(query));
  });

  if (!docs.length) {
    documentsTable.innerHTML = '<tr><td colspan="8">No documents matching search query.</td></tr>';
    return;
  }

  documentsTable.innerHTML = docs.map(doc => {
    const jsonStr = encodeURIComponent(JSON.stringify(doc));
    return `
      <tr>
        <td><code class="code-pill">${doc.id.slice(0, 8)}...</code></td>
        <td><strong>${doc.source_id}</strong></td>
        <td><code>${doc.external_id}</code></td>
        <td>${doc.title || 'Untitled'}</td>
        <td><span class="badge-version">${doc.language || 'en'}</span></td>
        <td><code title="${doc.content_hash}">${doc.content_hash ? doc.content_hash.slice(0, 10) + '...' : '-'}</code></td>
        <td>${new Date(doc.last_seen_at).toLocaleTimeString()}</td>
        <td>
          <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 0.75rem;" onclick="viewDocJson('${jsonStr}')">
            View JSON
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Render S3 Bucket Objects
function renderS3() {
  if (!state.s3 || !state.s3.objects) {
    s3Table.innerHTML = '<tr><td colspan="4">No S3 archives found.</td></tr>';
    return;
  }

  if (!state.s3.objects.length) {
    s3Table.innerHTML = '<tr><td colspan="4">Bucket is empty. Waiting for Kafka Connect flush.</td></tr>';
    return;
  }

  s3Table.innerHTML = state.s3.objects.map(obj => {
    const partitionMatch = obj.key.match(/partition=(\d+)/);
    const partition = partitionMatch ? `Partition ${partitionMatch[1]}` : 'General';
    return `
      <tr>
        <td><code class="code-pill">${obj.key}</code></td>
        <td>${partition}</td>
        <td>${obj.size} bytes</td>
        <td>${obj.lastModified ? new Date(obj.lastModified).toLocaleString() : '--'}</td>
      </tr>
    `;
  }).join('');
}

// Global modal viewer for document detail
window.viewDocJson = function(encodedJson) {
  try {
    const obj = JSON.parse(decodeURIComponent(encodedJson));
    modalTitle.textContent = `Document: ${obj.title || obj.external_id}`;
    modalJson.textContent = JSON.stringify(obj, null, 2);
    detailModal.classList.add('open');
  } catch (err) {
    console.error('Modal display error:', err);
  }
};

// Modal close handler
btnModalClose.addEventListener('click', () => detailModal.classList.remove('open'));
detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) detailModal.classList.remove('open');
});

// Event Simulation Trigger
btnPublishDemo.addEventListener('click', async () => {
  btnPublishDemo.disabled = true;
  btnPublishDemo.textContent = 'Publishing...';

  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `OSINT Intelligence Bulletin #${Math.floor(Math.random() * 9000 + 1000)}`,
        text: `Automated live flow verification report generated at ${new Date().toISOString()}`,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      showToast(`Event published to Kafka! ID: ${data.eventId.slice(0, 8)}...`);
      // Trigger instant pulse animation across flow nodes
      document.querySelectorAll('.flow-node').forEach(n => {
        n.style.boxShadow = '0 0 25px rgba(0, 242, 254, 0.8)';
        setTimeout(() => n.style.boxShadow = '', 1200);
      });
      // Refresh status immediately
      await fetchStatus();
    } else {
      showToast(`Error: ${data.error || 'Failed to publish'}`);
    }
  } catch (err) {
    showToast('Failed to publish event');
  } finally {
    btnPublishDemo.disabled = false;
    btnPublishDemo.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
      Inject OSINT Event
    `;
  }
});

// Tabs navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const panelId = btn.getAttribute('data-tab');
    const targetPanel = document.getElementById(panelId);
    if (targetPanel) targetPanel.classList.add('active');
  });
});

// Flow nodes click-to-tab navigation
document.querySelectorAll('.flow-node[data-target]').forEach(node => {
  node.addEventListener('click', () => {
    const targetTab = node.getAttribute('data-target');
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
    if (tabBtn) tabBtn.click();
  });
});

// Search filter
docSearchInput.addEventListener('input', (e) => {
  state.filterText = e.target.value;
  renderDocuments();
});

// Manual refresh
btnManualRefresh.addEventListener('click', fetchStatus);

// Auto-refresh control
function resetTimer() {
  if (state.timer) clearInterval(state.timer);
  if (autoRefreshToggle.checked) {
    state.timer = setInterval(fetchStatus, 2000);
  }
}
autoRefreshToggle.addEventListener('change', resetTimer);

// Initial bootstrap
fetchStatus();
resetTimer();
