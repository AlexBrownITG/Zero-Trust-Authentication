const $ = (sel) => document.querySelector(sel);

// State
let currentRequestId = null;
let pollTimer = null;

// --- Init ---

async function init() {
  await checkAgentStatus();
  await checkCurrentPage();
}

// --- Agent Status ---

async function checkAgentStatus() {
  const statusEl = $('#status');
  const statusText = $('#status-text');

  try {
    // Check server connectivity (the extension talks to the server directly now)
    const res = await chrome.runtime.sendMessage({ action: 'get_devices' });
    if (res.ok) {
      statusEl.className = 'status connected';
      statusText.textContent = 'Server connected';
    } else {
      statusEl.className = 'status disconnected';
      statusText.textContent = 'Server error';
    }
  } catch {
    statusEl.className = 'status disconnected';
    statusText.textContent = 'Server not connected';
  }
}

// --- Page Detection ---

async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const res = await chrome.tabs.sendMessage(tab.id, { action: 'has_login_form' });

    if (res.ok && res.hasLoginForm) {
      $('#no-login').classList.add('hidden');
      $('#login-detected').classList.remove('hidden');
      $('#page-domain').textContent = new URL(tab.url).hostname;
      $('#credential-select').classList.remove('hidden');
      await loadCredentialsAndDevices(tab.url);
    }
  } catch {
    // Content script not ready or no login form
  }
}

// --- Load Credentials & Devices ---

async function loadCredentialsAndDevices(pageUrl) {
  try {
    const [credRes, devRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'get_credentials' }),
      chrome.runtime.sendMessage({ action: 'get_devices' }),
    ]);

    const credSelect = $('#credential-list');
    credSelect.innerHTML = '';
    if (credRes.ok && credRes.data.length > 0) {
      for (const cred of credRes.data) {
        const opt = document.createElement('option');
        opt.value = cred.id;
        opt.textContent = `${cred.accountEmail} — ${cred.targetDomain}`;
        credSelect.appendChild(opt);
      }
    } else {
      const opt = document.createElement('option');
      opt.textContent = 'No credentials available';
      credSelect.appendChild(opt);
    }

    const devSelect = $('#device-list');
    devSelect.innerHTML = '';
    if (devRes.ok && devRes.data.length > 0) {
      for (const dev of devRes.data) {
        const opt = document.createElement('option');
        opt.value = dev.id;
        opt.textContent = dev.deviceAlias || dev.hostname || dev.id;
        devSelect.appendChild(opt);
      }
    } else {
      const opt = document.createElement('option');
      opt.textContent = 'No devices available';
      devSelect.appendChild(opt);
    }

    // Enable request button if both have valid options
    const hasCredentials = credRes.ok && credRes.data.length > 0;
    const hasDevices = devRes.ok && devRes.data.length > 0;
    $('#request-btn').disabled = !(hasCredentials && hasDevices);

    // Bind request button
    $('#request-btn').onclick = () => requestCredential(pageUrl);
  } catch (err) {
    console.error('Failed to load credentials/devices:', err);
  }
}

// --- Request Flow ---

async function requestCredential(siteUrl) {
  const deviceId = $('#device-list').value;
  const credentialId = $('#credential-list').value;

  if (!deviceId || !credentialId) return;

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'request_credential',
      deviceId,
      credentialId,
      siteUrl,
    });

    if (!res.ok) {
      showResult(res.error || 'Request failed', false);
      return;
    }

    currentRequestId = res.data.id;

    // Show waiting state
    $('#credential-select').classList.add('hidden');
    $('#waiting').classList.remove('hidden');
    $('#waiting-request-id').textContent = `Request: ${currentRequestId}`;

    // Start polling agent for the credential
    startPolling();
  } catch (err) {
    showResult(err.message, false);
  }
}

// --- Poll Server for Request Status ---

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    try {
      const res = await chrome.runtime.sendMessage({
        action: 'poll_request_status',
        requestId: currentRequestId,
      });
      if (!res.ok) return;

      const request = res.data;

      // Request was approved (or already relayed to agent) — credential is ready
      if (request.status === 'approved' || request.status === 'relayed') {
        clearInterval(pollTimer);
        pollTimer = null;

        $('#waiting-status').textContent = 'Approved! Injecting credential...';
        fetchAndInject();
      } else if (request.status === 'rejected') {
        clearInterval(pollTimer);
        pollTimer = null;
        showResult('Request was rejected by admin', false);
      } else if (request.status === 'expired') {
        clearInterval(pollTimer);
        pollTimer = null;
        showResult('Request expired', false);
      }
    } catch {
      // Server not reachable, keep polling
    }
  }, 1500);

  // Stop polling after 5 minutes (request TTL)
  setTimeout(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      showResult('Request expired — no approval received', false);
    }
  }, 5 * 60 * 1000);
}

// --- Fetch Credential from Server & Inject ---

async function fetchAndInject() {
  try {
    // Fetch decrypted credential directly from server (one-time use)
    const res = await chrome.runtime.sendMessage({
      action: 'fetch_credential_direct',
      requestId: currentRequestId,
    });

    if (!res.ok) {
      showResult(res.error || 'Failed to retrieve credential', false);
      return;
    }

    const { accountEmail, password } = res.data;

    // Send to content script to inject + auto-submit
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showResult('No active tab', false);
      return;
    }

    const injectRes = await chrome.tabs.sendMessage(tab.id, {
      action: 'inject_credential',
      accountEmail,
      password,
    });

    if (injectRes.ok) {
      const msg = injectRes.autoSubmitted
        ? 'Credential injected and submitted!'
        : 'Credential injected! (manual submit may be needed)';
      showResult(msg, true);
    } else {
      showResult(injectRes.error || 'Injection failed', false);
    }
  } catch (err) {
    showResult(err.message, false);
  }
}

// --- UI Helpers ---

function showResult(message, success) {
  $('#waiting').classList.add('hidden');
  $('#credential-select').classList.add('hidden');

  const resultEl = $('#result');
  const msgEl = $('#result-message');
  resultEl.classList.remove('hidden');
  msgEl.textContent = message;
  msgEl.className = success ? 'success' : 'error';
}

// --- Start ---

init();
