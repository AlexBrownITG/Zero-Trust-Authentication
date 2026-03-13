/**
 * Content script — runs on every page.
 * Detects login forms and handles credential injection.
 */

const KEYSTROKE_DELAY_MIN = 10;
const KEYSTROKE_DELAY_MAX = 40;

// --- Login Form Detection ---

function findLoginForm() {
  const passwordFields = document.querySelectorAll('input[type="password"]');
  if (passwordFields.length === 0) return null;

  for (const pwField of passwordFields) {
    // Walk up to find the containing form (or closest container)
    const form = pwField.closest('form') || pwField.parentElement;
    if (!form) continue;

    // Look for an email/username field in the same form
    const emailField = form.querySelector(
      'input[type="email"], input[type="text"][name*="user"], input[type="text"][name*="email"], ' +
      'input[type="text"][name*="login"], input[type="text"][autocomplete="username"], ' +
      'input[type="text"][autocomplete="email"], input[name="identifier"], input[name="username"]'
    );

    return {
      form,
      emailField: emailField || null,
      passwordField: pwField,
    };
  }

  return null;
}

function detectAndNotify() {
  const login = findLoginForm();
  if (login) {
    chrome.runtime.sendMessage({ action: 'detect_login' });
  }
}

// --- Credential Injection ---

function randomDelay() {
  return KEYSTROKE_DELAY_MIN + Math.random() * (KEYSTROKE_DELAY_MAX - KEYSTROKE_DELAY_MIN);
}

function simulateKeystroke(element, char) {
  const eventDefaults = { bubbles: true, cancelable: true, key: char };

  element.dispatchEvent(new KeyboardEvent('keydown', eventDefaults));
  element.dispatchEvent(new KeyboardEvent('keypress', eventDefaults));

  // Update the value using native input setter to trigger React/Vue/Angular change detection
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(element, element.value + char);
  } else {
    element.value += char;
  }

  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
  element.dispatchEvent(new KeyboardEvent('keyup', eventDefaults));
}

function typeText(element, text) {
  return new Promise((resolve) => {
    // Focus and clear field
    element.focus();
    element.value = '';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));

    let i = 0;
    function typeNext() {
      if (i >= text.length) {
        element.dispatchEvent(new Event('change', { bubbles: true }));
        resolve();
        return;
      }
      simulateKeystroke(element, text[i]);
      i++;
      setTimeout(typeNext, randomDelay());
    }
    typeNext();
  });
}

// Block copy/paste/context menu on injected fields
function lockField(element) {
  const block = (e) => e.preventDefault();
  element.addEventListener('copy', block);
  element.addEventListener('cut', block);
  element.addEventListener('paste', block);
  element.addEventListener('contextmenu', block);
  element.setAttribute('readonly', 'true');

  // Remove readonly after a brief delay so form submission works
  setTimeout(() => element.removeAttribute('readonly'), 100);
}

async function injectCredential(accountEmail, password) {
  const login = findLoginForm();
  if (!login) {
    return { ok: false, error: 'No login form found on page' };
  }

  // Type email if field exists
  if (login.emailField && accountEmail) {
    await typeText(login.emailField, accountEmail);
    lockField(login.emailField);
  }

  // Type password
  await typeText(login.passwordField, password);
  lockField(login.passwordField);

  return { ok: true };
}

// --- Message Handler ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'inject_credential') {
    injectCredential(msg.accountEmail, msg.password)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'has_login_form') {
    const login = findLoginForm();
    sendResponse({
      ok: true,
      hasLoginForm: !!login,
      hasEmailField: !!login?.emailField,
    });
    return false;
  }
});

// --- Init ---

// Detect on load
detectAndNotify();

// Re-detect on DOM changes (SPAs that lazy-render forms)
const observer = new MutationObserver(() => {
  detectAndNotify();
});
observer.observe(document.body, { childList: true, subtree: true });
