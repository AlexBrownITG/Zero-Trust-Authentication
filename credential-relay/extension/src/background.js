const NATIVE_HOST = 'com.credential_relay.agent';
const SERVER_URL = 'http://localhost:3000';
const API_PREFIX = '/api';

// --- Native Messaging ---

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

// --- Server API ---

async function fetchCredentials() {
  const res = await fetch(`${SERVER_URL}${API_PREFIX}/credentials`);
  if (!res.ok) throw new Error(`Failed to fetch credentials: ${res.status}`);
  return res.json();
}

async function fetchDevices() {
  const res = await fetch(`${SERVER_URL}${API_PREFIX}/devices`);
  if (!res.ok) throw new Error(`Failed to fetch devices: ${res.status}`);
  return res.json();
}

async function createRequest(deviceId, credentialId, siteUrl) {
  const res = await fetch(`${SERVER_URL}${API_PREFIX}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, credentialId, siteUrl }),
  });
  if (!res.ok) throw new Error(`Failed to create request: ${res.status}`);
  return res.json();
}

// --- Message Handlers ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg, sender) {
  switch (msg.action) {
    case 'get_credentials':
      return { ok: true, data: await fetchCredentials() };

    case 'get_devices':
      return { ok: true, data: await fetchDevices() };

    case 'request_credential': {
      const { deviceId, credentialId, siteUrl } = msg;
      const request = await createRequest(deviceId, credentialId, siteUrl);
      return { ok: true, data: request };
    }

    case 'poll_request_status': {
      // Poll server for request status (works without native messaging)
      const res = await fetch(`${SERVER_URL}${API_PREFIX}/requests/${msg.requestId}`);
      if (!res.ok) return { ok: false, error: `Status check failed: ${res.status}` };
      const request = await res.json();
      return { ok: true, data: request };
    }

    case 'fetch_credential_direct': {
      // One-time credential fetch from server (bypasses native messaging)
      const res = await fetch(`${SERVER_URL}${API_PREFIX}/requests/${msg.requestId}/credential`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || `Fetch failed: ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, data };
    }

    case 'check_agent': {
      // Ping native host to verify agent connectivity
      try {
        const response = await sendNativeMessage({ action: 'ping' });
        return { ok: true, agentConnected: response.ok };
      } catch {
        return { ok: true, agentConnected: false };
      }
    }

    case 'detect_login': {
      // Content script reports a login form was detected
      const tabId = sender.tab?.id;
      if (tabId) {
        chrome.action.setBadgeText({ text: '!', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#38bdf8', tabId });
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown action: ${msg.action}` };
  }
}
