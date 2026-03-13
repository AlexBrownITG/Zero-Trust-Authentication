// Admin Dashboard — Vanilla JS
(function () {
  'use strict';

  var ws = null;
  var requests = {};
  var connectedAgents = new Set();

  var wsStatusEl = document.getElementById('ws-status');
  var agentsEl = document.getElementById('agents');
  var queueEl = document.getElementById('request-queue');

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws/admin');

    ws.onopen = function () {
      wsStatusEl.textContent = 'WebSocket: Connected';
      wsStatusEl.className = 'status connected';
      loadExistingRequests();
    };

    ws.onclose = function () {
      wsStatusEl.textContent = 'WebSocket: Disconnected — reconnecting...';
      wsStatusEl.className = 'status disconnected';
      setTimeout(connect, 3000);
    };

    ws.onerror = function () {
      ws.close();
    };

    ws.onmessage = function (event) {
      var msg = JSON.parse(event.data);
      handleMessage(msg);
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'request.new':
        requests[msg.payload.id] = msg.payload;
        renderRequests();
        break;
      case 'request.approved':
      case 'request.rejected':
      case 'request.relayed':
      case 'request.completed':
      case 'request.expired':
        if (requests[msg.payload.id || msg.payload.requestId]) {
          var id = msg.payload.id || msg.payload.requestId;
          if (msg.payload.status) {
            requests[id].status = msg.payload.status;
          } else {
            // derive from type
            requests[id].status = msg.type.replace('request.', '');
          }
          renderRequests();
        }
        break;
      case 'agent.status':
        if (msg.payload.connectedAgents) {
          connectedAgents = new Set(msg.payload.connectedAgents);
        } else if (msg.payload.status === 'connected') {
          connectedAgents.add(msg.payload.deviceId);
        } else if (msg.payload.status === 'disconnected') {
          connectedAgents.delete(msg.payload.deviceId);
        }
        renderAgents();
        break;
    }
  }

  function loadExistingRequests() {
    fetch('/api/requests')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        data.forEach(function (r) { requests[r.id] = r; });
        renderRequests();
      })
      .catch(function (err) { console.error('Failed to load requests', err); });
  }

  function renderAgents() {
    if (connectedAgents.size === 0) {
      agentsEl.innerHTML = '<span class="empty-state">No agents connected</span>';
      return;
    }
    agentsEl.innerHTML = '';
    connectedAgents.forEach(function (id) {
      var span = document.createElement('span');
      span.className = 'agent-badge';
      span.textContent = id.substring(0, 8) + '...';
      span.title = id;
      agentsEl.appendChild(span);
    });
  }

  function renderRequests() {
    var ids = Object.keys(requests).sort(function (a, b) {
      return (requests[b].requestedAt || '').localeCompare(requests[a].requestedAt || '');
    });

    if (ids.length === 0) {
      queueEl.innerHTML = '<div class="empty-state">No requests</div>';
      return;
    }

    queueEl.innerHTML = '';
    ids.forEach(function (id) {
      var r = requests[id];
      var card = document.createElement('div');
      card.className = 'request-card';

      var status = r.status || 'pending';
      var heading = (r.serviceName || r.credentialId || 'Unknown') + ' → ' + (r.deviceAlias || r.deviceHostname || r.deviceId || 'Unknown');

      card.innerHTML =
        '<h3>' + escapeHtml(heading) + ' <span class="badge ' + status + '">' + status + '</span></h3>' +
        '<p>Username: ' + escapeHtml(r.username || 'N/A') + '</p>' +
        '<p>Request ID: ' + escapeHtml(r.id) + '</p>' +
        '<p>Requested: ' + escapeHtml(r.requestedAt || '') + '</p>';

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
    fetch('/api/requests/' + requestId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, resolvedBy: 'admin' }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          alert('Error: ' + data.error);
          return;
        }
        requests[data.id] = data;
        renderRequests();
      })
      .catch(function (err) { alert('Request failed: ' + err.message); });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  connect();
})();
