// Admin Dashboard — Vanilla JS
(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────
  var ws = null;
  var requests = {};
  var credentials = {};
  var devices = {};
  var connectedAgents = new Set();
  var currentFilter = 'all';
  var testRequestId = null;

  // ─── DOM refs ───────────────────────────────────────────
  var wsStatusEl = document.getElementById('ws-status');
  var agentsListEl = document.getElementById('agents-list');
  var queueEl = document.getElementById('request-queue');
  var credListEl = document.getElementById('credentials-list');
  var devicesListEl = document.getElementById('devices-list');
  var auditLogEl = document.getElementById('audit-log');
  var toastsEl = document.getElementById('toasts');

  // ─── Tab navigation ────────────────────────────────────
  document.querySelectorAll('.sidebar-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.sidebar-item').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      var tab = document.getElementById('tab-' + btn.dataset.tab);
      if (tab) tab.classList.add('active');

      // Refresh data when switching tabs
      if (btn.dataset.tab === 'credentials') loadCredentials();
      if (btn.dataset.tab === 'devices') loadDevices();
      if (btn.dataset.tab === 'requests') loadExistingRequests();
      if (btn.dataset.tab === 'test') { loadDevices(); loadCredentials(); }
      if (btn.dataset.tab === 'audit') loadAuditLog();
    });
  });

  // ─── Request filter buttons ────────────────────────────
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderRequests();
    });
  });

  // ─── WebSocket ──────────────────────────────────────────
  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws/admin');

    ws.onopen = function () {
      wsStatusEl.textContent = 'Connected';
      wsStatusEl.className = 'status connected';
      loadExistingRequests();
      loadCredentials();
      loadDevices();
    };

    ws.onclose = function () {
      wsStatusEl.textContent = 'Disconnected';
      wsStatusEl.className = 'status disconnected';
      setTimeout(connect, 3000);
    };

    ws.onerror = function () { ws.close(); };

    ws.onmessage = function (event) {
      var msg = JSON.parse(event.data);
      handleMessage(msg);
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'new_request':
        requests[msg.payload.id] = msg.payload;
        renderRequests();
        toast('New credential request from ' + escapeHtml(msg.payload.hostname || 'unknown'), 'info');
        break;

      case 'request_resolved':
        var id = msg.payload.id || msg.payload.requestId;
        if (requests[id]) {
          if (msg.payload.status) requests[id].status = msg.payload.status;
          if (msg.payload.resolvedBy) requests[id].resolvedBy = msg.payload.resolvedBy;
          renderRequests();

          // Update test flow if watching this request
          if (id === testRequestId) updateTestStatus(requests[id]);
        }
        break;

      case 'agent_status':
        if (msg.payload.connectedAgents) {
          connectedAgents = new Set(msg.payload.connectedAgents);
        } else if (msg.payload.status === 'connected') {
          connectedAgents.add(msg.payload.deviceId);
          toast('Agent connected: ' + msg.payload.deviceId.substring(0, 8) + '...', 'success');
        } else if (msg.payload.status === 'disconnected') {
          connectedAgents.delete(msg.payload.deviceId);
          toast('Agent disconnected', 'error');
        }
        renderAgents();
        break;
    }
  }

  // ─── Toast notifications ────────────────────────────────
  function toast(message, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = message;
    toastsEl.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(function () { el.remove(); }, 300);
    }, 4000);
  }

  // ─── API helpers ────────────────────────────────────────
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api' + path, opts).then(function (res) { return res.json(); });
  }

  // ─── Credentials ───────────────────────────────────────
  function loadCredentials() {
    api('GET', '/credentials').then(function (data) {
      if (Array.isArray(data)) {
        credentials = {};
        data.forEach(function (c) { credentials[c.id] = c; });
        renderCredentials();
        renderTestSelects();
      }
    }).catch(function () { toast('Failed to load credentials', 'error'); });
  }

  function renderCredentials() {
    var creds = Object.values(credentials);
    if (creds.length === 0) {
      credListEl.innerHTML = '<div class="empty-state">No credentials stored. Create one above.</div>';
      return;
    }

    var html = '<table><thead><tr><th>Account Email</th><th>Target Domain</th><th>ID</th><th>Updated</th></tr></thead><tbody>';
    creds.forEach(function (c) {
      html += '<tr>' +
        '<td>' + escapeHtml(c.accountEmail) + '</td>' +
        '<td>' + escapeHtml(c.targetDomain) + '</td>' +
        '<td style="font-family:monospace; font-size:0.75rem; color:#64748b;">' + escapeHtml(c.id) + '</td>' +
        '<td>' + escapeHtml(formatTime(c.updatedAt)) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    credListEl.innerHTML = html;
  }

  document.getElementById('btn-create-cred').addEventListener('click', function () {
    var email = document.getElementById('cred-email').value.trim();
    var domain = document.getElementById('cred-domain').value.trim();
    var password = document.getElementById('cred-password').value;

    if (!email || !domain || !password) {
      toast('All fields are required', 'error');
      return;
    }

    api('POST', '/credentials', { accountEmail: email, targetDomain: domain, password: password })
      .then(function (data) {
        if (data.error) { toast(data.error, 'error'); return; }
        credentials[data.id] = data;
        renderCredentials();
        renderTestSelects();
        toast('Credential created for ' + email, 'success');
        document.getElementById('cred-email').value = '';
        document.getElementById('cred-domain').value = '';
        document.getElementById('cred-password').value = '';
      })
      .catch(function () { toast('Failed to create credential', 'error'); });
  });

  // ─── Devices ────────────────────────────────────────────
  function loadDevices() {
    api('GET', '/devices').then(function (data) {
      if (Array.isArray(data)) {
        devices = {};
        data.forEach(function (d) { devices[d.id] = d; });
        renderDevices();
        renderTestSelects();
      }
    }).catch(function () { toast('Failed to load devices', 'error'); });
  }

  function renderDevices() {
    var devs = Object.values(devices);
    if (devs.length === 0) {
      devicesListEl.innerHTML = '<div class="empty-state">No devices registered. Start an agent to register a device.</div>';
      return;
    }

    var html = '<table><thead><tr><th>Hostname</th><th>Alias</th><th>MAC Address</th><th>Status</th><th>ID</th><th>Last Seen</th></tr></thead><tbody>';
    devs.forEach(function (d) {
      var isOnline = connectedAgents.has(d.id);
      html += '<tr>' +
        '<td>' + escapeHtml(d.hostname) + '</td>' +
        '<td>' + escapeHtml(d.deviceAlias || '—') + '</td>' +
        '<td style="font-family:monospace;">' + escapeHtml(d.macAddress) + '</td>' +
        '<td><span class="badge ' + d.status + '">' + d.status + '</span>' +
          (isOnline ? ' <span class="agent-badge">online</span>' : '') + '</td>' +
        '<td style="font-family:monospace; font-size:0.75rem; color:#64748b;">' + escapeHtml(d.id) + '</td>' +
        '<td>' + escapeHtml(formatTime(d.lastSeen)) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    devicesListEl.innerHTML = html;
  }

  // ─── Requests ───────────────────────────────────────────
  function loadExistingRequests() {
    api('GET', '/requests').then(function (data) {
      if (Array.isArray(data)) {
        data.forEach(function (r) { requests[r.id] = r; });
        renderRequests();
      }
    }).catch(function () { toast('Failed to load requests', 'error'); });
  }

  function renderRequests() {
    var ids = Object.keys(requests).sort(function (a, b) {
      return (requests[b].requestedAt || '').localeCompare(requests[a].requestedAt || '');
    });

    if (currentFilter !== 'all') {
      ids = ids.filter(function (id) { return requests[id].status === currentFilter; });
    }

    if (ids.length === 0) {
      queueEl.innerHTML = '<div class="empty-state">No ' + (currentFilter === 'all' ? '' : currentFilter + ' ') + 'requests</div>';
      return;
    }

    queueEl.innerHTML = '';
    ids.forEach(function (id) {
      var r = requests[id];
      var card = document.createElement('div');
      card.className = 'card';

      var status = r.status || 'pending';
      var hostname = r.hostname || (devices[r.deviceId] ? devices[r.deviceId].hostname : r.deviceId.substring(0, 8));
      var credInfo = credentials[r.credentialId];
      var account = r.accountEmail || (credInfo ? credInfo.accountEmail : 'N/A');
      var target = r.targetDomain || (credInfo ? credInfo.targetDomain : r.siteUrl || 'Unknown');

      card.innerHTML =
        '<h3>' + escapeHtml(hostname) + ' &rarr; ' + escapeHtml(target) +
        ' <span class="badge ' + status + '">' + status + '</span></h3>' +
        '<p>Account: ' + escapeHtml(account) + '</p>' +
        '<p>Site URL: ' + escapeHtml(r.siteUrl || 'N/A') + '</p>' +
        '<p class="mono">Request: ' + escapeHtml(r.id) + '</p>' +
        '<p class="mono">Requested: ' + escapeHtml(formatTime(r.requestedAt)) +
        (r.resolvedBy ? ' &middot; Resolved by: ' + escapeHtml(r.resolvedBy) : '') + '</p>';

      if (status === 'pending') {
        var actions = document.createElement('div');
        actions.className = 'actions';

        var approveBtn = document.createElement('button');
        approveBtn.className = 'btn-approve';
        approveBtn.textContent = 'Approve';
        approveBtn.onclick = function () { resolveRequest(r.id, 'approve'); };

        var rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn-reject';
        rejectBtn.textContent = 'Reject';
        rejectBtn.onclick = function () { resolveRequest(r.id, 'reject'); };

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        card.appendChild(actions);
      }

      queueEl.appendChild(card);
    });
  }

  function resolveRequest(requestId, action) {
    api('PATCH', '/requests/' + requestId, { action: action, resolvedBy: 'admin@dashboard' })
      .then(function (data) {
        if (data.error) { toast('Error: ' + data.error, 'error'); return; }
        requests[data.id] = data;
        renderRequests();
        toast('Request ' + action + 'd', action === 'approve' ? 'success' : 'info');
      })
      .catch(function (err) { toast('Request failed: ' + err.message, 'error'); });
  }

  // ─── Test Flow ──────────────────────────────────────────
  function renderTestSelects() {
    var deviceSelect = document.getElementById('test-device');
    var credSelect = document.getElementById('test-credential');

    // Devices
    var devHtml = '<option value="">Select device...</option>';
    Object.values(devices).forEach(function (d) {
      var online = connectedAgents.has(d.id) ? ' [online]' : '';
      devHtml += '<option value="' + escapeHtml(d.id) + '">' +
        escapeHtml(d.hostname) + ' (' + d.id.substring(0, 8) + '...)' + online + '</option>';
    });
    deviceSelect.innerHTML = devHtml;

    // Credentials
    var credHtml = '<option value="">Select credential...</option>';
    Object.values(credentials).forEach(function (c) {
      credHtml += '<option value="' + escapeHtml(c.id) + '">' +
        escapeHtml(c.accountEmail) + ' &mdash; ' + escapeHtml(c.targetDomain) + '</option>';
    });
    credSelect.innerHTML = credHtml;
  }

  document.getElementById('btn-create-request').addEventListener('click', function () {
    var deviceId = document.getElementById('test-device').value;
    var credentialId = document.getElementById('test-credential').value;
    var siteUrl = document.getElementById('test-site-url').value.trim();

    if (!deviceId || !credentialId || !siteUrl) {
      toast('All fields are required', 'error');
      return;
    }

    // Auto-populate site URL from credential domain if empty
    api('POST', '/requests', { deviceId: deviceId, credentialId: credentialId, siteUrl: siteUrl })
      .then(function (data) {
        if (data.error) {
          toast(data.error + (data.details ? ': ' + JSON.stringify(data.details) : ''), 'error');
          return;
        }
        requests[data.id] = data;
        testRequestId = data.id;
        renderRequests();
        showTestStep2(data);
        toast('Request created!', 'success');
      })
      .catch(function () { toast('Failed to create request', 'error'); });
  });

  function showTestStep2(req) {
    var resultEl = document.getElementById('test-result');
    var infoEl = document.getElementById('test-request-info');
    var actionsEl = document.getElementById('test-actions');
    var relayEl = document.getElementById('test-relay-status');

    resultEl.style.display = 'block';
    relayEl.style.display = 'none';

    var credInfo = credentials[req.credentialId];
    infoEl.innerHTML =
      '<p>Request ID: <span style="font-family:monospace;color:#64748b;">' + escapeHtml(req.id) + '</span></p>' +
      '<p>Device: ' + escapeHtml(req.hostname || 'Unknown') + '</p>' +
      '<p>Credential: ' + escapeHtml(credInfo ? credInfo.accountEmail + ' @ ' + credInfo.targetDomain : req.credentialId) + '</p>' +
      '<p>Status: <span class="badge ' + req.status + '">' + req.status + '</span></p>';

    actionsEl.innerHTML = '';

    if (req.status === 'pending') {
      var approveBtn = document.createElement('button');
      approveBtn.className = 'btn-approve';
      approveBtn.textContent = 'Approve';
      approveBtn.onclick = function () {
        resolveTestRequest(req.id, 'approve');
      };

      var rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn-reject';
      rejectBtn.textContent = 'Reject';
      rejectBtn.onclick = function () {
        resolveTestRequest(req.id, 'reject');
      };

      actionsEl.appendChild(approveBtn);
      actionsEl.appendChild(rejectBtn);
    }
  }

  function resolveTestRequest(requestId, action) {
    api('PATCH', '/requests/' + requestId, { action: action, resolvedBy: 'admin@dashboard' })
      .then(function (data) {
        if (data.error) { toast('Error: ' + data.error, 'error'); return; }
        requests[data.id] = data;
        renderRequests();
        showTestStep2(data);
        toast('Request ' + action + 'd!', action === 'approve' ? 'success' : 'info');

        if (action === 'approve') {
          showTestStep3(data, 'Credential sent to agent via WebSocket. Waiting for relay confirmation...');
        }
      })
      .catch(function (err) { toast('Failed: ' + err.message, 'error'); });
  }

  function showTestStep3(req, message) {
    var relayEl = document.getElementById('test-relay-status');
    var relayInfoEl = document.getElementById('test-relay-info');
    relayEl.style.display = 'block';

    var statusHtml =
      '<p style="margin-bottom:0.5rem;">' + escapeHtml(message) + '</p>' +
      '<p>Status: <span class="badge ' + req.status + '">' + req.status + '</span></p>';

    if (req.status === 'relayed' || req.status === 'completed') {
      statusHtml += '<p style="color:#4ade80; margin-top:0.5rem; font-weight:600;">Credential successfully relayed to agent!</p>';
    }

    relayInfoEl.innerHTML = statusHtml;
  }

  function updateTestStatus(req) {
    showTestStep2(req);
    var statusMessages = {
      approved: 'Credential sent to agent. Waiting for relay...',
      relayed: 'Credential relayed to agent and decrypted in memory!',
      completed: 'Credential injection completed successfully!',
      expired: 'Request expired.',
      rejected: 'Request was rejected.',
    };
    if (statusMessages[req.status]) {
      showTestStep3(req, statusMessages[req.status]);
    }
  }

  // ─── Audit Log ──────────────────────────────────────────
  function loadAuditLog() {
    var eventType = document.getElementById('audit-filter').value;
    var query = eventType ? '?eventType=' + eventType : '';

    api('GET', '/audit' + query).then(function (data) {
      if (!Array.isArray(data)) { auditLogEl.innerHTML = '<div class="empty-state">Failed to load audit log</div>'; return; }
      if (data.length === 0) { auditLogEl.innerHTML = '<div class="empty-state">No audit entries</div>'; return; }

      var html = '<table><thead><tr><th>Timestamp</th><th>Event</th><th>Device</th><th>Request</th><th>Details</th></tr></thead><tbody>';
      data.forEach(function (entry) {
        var eventClass = '';
        if (entry.eventType.includes('approved') || entry.eventType.includes('connected')) eventClass = 'color:#4ade80;';
        if (entry.eventType.includes('rejected') || entry.eventType.includes('disconnected')) eventClass = 'color:#f87171;';
        if (entry.eventType.includes('relayed') || entry.eventType.includes('created')) eventClass = 'color:#60a5fa;';

        var meta = '';
        if (entry.metadata && typeof entry.metadata === 'object') {
          var parsed = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
          var keys = Object.keys(parsed);
          if (keys.length > 0) {
            meta = keys.map(function (k) { return escapeHtml(k) + ': ' + escapeHtml(String(parsed[k])); }).join(', ');
          }
        }

        html += '<tr>' +
          '<td style="white-space:nowrap;">' + escapeHtml(formatTime(entry.timestamp)) + '</td>' +
          '<td style="' + eventClass + 'font-weight:600;">' + escapeHtml(entry.eventType) + '</td>' +
          '<td style="font-family:monospace;font-size:0.6875rem;">' + escapeHtml(entry.deviceId ? entry.deviceId.substring(0, 8) + '...' : '—') + '</td>' +
          '<td style="font-family:monospace;font-size:0.6875rem;">' + escapeHtml(entry.requestId ? entry.requestId.substring(0, 8) + '...' : '—') + '</td>' +
          '<td style="font-size:0.75rem;color:#94a3b8;">' + (meta || '—') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
      auditLogEl.innerHTML = html;
    }).catch(function () { toast('Failed to load audit log', 'error'); });
  }

  document.getElementById('btn-refresh-audit').addEventListener('click', loadAuditLog);
  document.getElementById('audit-filter').addEventListener('change', loadAuditLog);

  // ─── Agents ─────────────────────────────────────────────
  function renderAgents() {
    if (connectedAgents.size === 0) {
      agentsListEl.innerHTML = '<span style="color:#64748b;">none</span>';
      return;
    }
    var html = '';
    connectedAgents.forEach(function (id) {
      html += '<span class="agent-badge" title="' + escapeHtml(id) + '">' + id.substring(0, 8) + '...</span> ';
    });
    agentsListEl.innerHTML = html;

    // Also refresh devices view if it's visible
    renderDevices();
  }

  // ─── Helpers ────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      return d.toLocaleTimeString() + ' ' + d.toLocaleDateString();
    } catch (e) {
      return isoStr;
    }
  }

  // ─── Init ───────────────────────────────────────────────
  connect();
})();
