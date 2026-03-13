/**
 * Content script — runs on every page.
 * Detects login forms and handles credential injection with
 * auto-submit, field locking, and post-submit cleanup.
 */

const KEYSTROKE_DELAY_MIN = 10;
const KEYSTROKE_DELAY_MAX = 40;

// --- Login Form Detection ---

/**
 * Google login is multi-step:
 *   Step 1: Email/identifier field only (no password visible)
 *   Step 2: Password field appears after email submit
 * We also handle generic login forms with both fields visible.
 */
function findLoginForm() {
  // Check for Google's multi-step login
  const isGoogleLogin = location.hostname.includes('accounts.google.com');

  if (isGoogleLogin) {
    return detectGoogleLogin();
  }

  // Generic login form detection
  return detectGenericLogin();
}

function detectGoogleLogin() {
  // Step 2: Password step — password field is visible
  const pwField = document.querySelector('input[type="password"]:not([hidden])');
  if (pwField && isVisible(pwField)) {
    const submitBtn = document.querySelector('#passwordNext, button[type="submit"], input[type="submit"]');
    return {
      form: pwField.closest('form') || pwField.parentElement,
      emailField: null,
      passwordField: pwField,
      submitButton: submitBtn,
      isGoogleMultiStep: true,
      step: 'password',
    };
  }

  // Step 1: Email/identifier step
  const emailField = document.querySelector(
    'input[type="email"], input[name="identifier"], input#identifierId'
  );
  if (emailField && isVisible(emailField)) {
    const submitBtn = document.querySelector('#identifierNext, button[type="submit"], input[type="submit"]');
    return {
      form: emailField.closest('form') || emailField.parentElement,
      emailField: emailField,
      passwordField: null,
      submitButton: submitBtn,
      isGoogleMultiStep: true,
      step: 'email',
    };
  }

  return null;
}

function detectGenericLogin() {
  const passwordFields = document.querySelectorAll('input[type="password"]');
  if (passwordFields.length === 0) return null;

  for (const pwField of passwordFields) {
    if (!isVisible(pwField)) continue;

    const form = pwField.closest('form');
    const container = form || pwField.parentElement;
    if (!container) continue;

    // Broad email/username field detection — try many common patterns
    const emailField = container.querySelector(
      'input[type="email"], input[type="text"][name*="user"], input[type="text"][name*="email"], ' +
      'input[type="text"][name*="login"], input[type="text"][autocomplete="username"], ' +
      'input[type="text"][autocomplete="email"], input[name="identifier"], input[name="username"], ' +
      'input[name="login"]'
    ) || container.querySelector(
      // Fallback: any text/email input that appears before the password field
      'input[type="text"], input[type="email"]'
    );

    // Submit button detection — try form first, then broader search
    let submitBtn = null;
    if (form) {
      submitBtn = form.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type])'
      );
    }
    // Broader search: look for common submit buttons near the form
    if (!submitBtn) {
      submitBtn = document.querySelector(
        'button[type="submit"], input[type="submit"]'
      );
    }
    // Last resort: find a button whose text looks like a login action
    if (!submitBtn) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent.trim().toLowerCase();
        if (['sign in', 'log in', 'login', 'submit', 'sign up', 'continue'].includes(text)) {
          submitBtn = btn;
          break;
        }
      }
    }

    return {
      form: container,
      emailField: emailField || null,
      passwordField: pwField,
      submitButton: submitBtn || null,
      isGoogleMultiStep: false,
      step: 'full',
    };
  }

  return null;
}

function isVisible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
}

function detectAndNotify() {
  const login = findLoginForm();
  if (login) {
    chrome.runtime.sendMessage({
      action: 'detect_login',
      step: login.step,
      isGoogleMultiStep: login.isGoogleMultiStep,
    });
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

  // Update value using native input setter to trigger React/Angular change detection
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
    element.focus();
    // Clear field
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(element, '');
    } else {
      element.value = '';
    }
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

// --- Field Security ---

function lockField(element) {
  if (!element) return;

  // Block copy/paste/context menu
  const block = (e) => e.preventDefault();
  element.addEventListener('copy', block);
  element.addEventListener('cut', block);
  element.addEventListener('paste', block);
  element.addEventListener('contextmenu', block);

  // Lock field type to "password" — prevents show-password toggles
  if (element.type === 'password') {
    try {
      Object.defineProperty(element, 'type', {
        get: () => 'password',
        set: () => {},
        configurable: true,
      });
    } catch {
      // Fallback: just keep monitoring
    }
  }

  // Remove Google's show-password toggle button
  removeShowPasswordToggle();
}

function removeShowPasswordToggle() {
  // Google uses various selectors for the eye icon
  const toggleSelectors = [
    '[aria-label*="Show password"]',
    '[aria-label*="show password"]',
    '[data-is-touch-wrapper] button',
    '.VfPpkd-Bz112c-LgbsSe[aria-label*="password"]',
  ];

  for (const sel of toggleSelectors) {
    const toggles = document.querySelectorAll(sel);
    toggles.forEach((el) => {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    });
  }
}

// --- Auto Submit ---

function clickSubmit(button) {
  if (!button) return false;

  button.focus();
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  return true;
}

// --- Post-Submit Cleanup ---

function cleanupField(element) {
  if (!element) return;

  // Clear the field value
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(element, '');
  } else {
    element.value = '';
  }
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));
}

// --- Wait for element to appear (for multi-step flows) ---

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // Check if already exists
    const existing = document.querySelector(selector);
    if (existing && isVisible(existing)) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

// --- Main Injection Flow ---

async function injectCredential(accountEmail, password) {
  const login = findLoginForm();
  if (!login) {
    return { ok: false, error: 'No login form found on page' };
  }

  try {
    if (login.isGoogleMultiStep) {
      return await injectGoogleMultiStep(login, accountEmail, password);
    } else {
      return await injectGenericForm(login, accountEmail, password);
    }
  } catch (err) {
    return { ok: false, error: err.message || 'Injection failed' };
  }
}

async function injectGoogleMultiStep(login, accountEmail, password) {
  if (login.step === 'email' && accountEmail) {
    // Step 1: Type email and submit
    await typeText(login.emailField, accountEmail);
    lockField(login.emailField);

    if (login.submitButton) {
      clickSubmit(login.submitButton);
    }

    // Step 2: Wait for password field to appear
    const pwField = await waitForElement('input[type="password"]', 10000);

    // Small delay for transition animation
    await new Promise((r) => setTimeout(r, 500));

    // Type password FIRST, then lock
    removeShowPasswordToggle();
    await typeText(pwField, password);
    lockField(pwField);

    // Find and click the password submit button
    const pwSubmit = document.querySelector('#passwordNext, button[type="submit"]');
    if (pwSubmit) {
      clickSubmit(pwSubmit);
    }

    // Cleanup after submit
    setTimeout(() => {
      cleanupField(pwField);
    }, 500);

    return { ok: true, autoSubmitted: true };
  }

  if (login.step === 'password') {
    // Already on password step — type first, then lock
    removeShowPasswordToggle();
    await typeText(login.passwordField, password);
    lockField(login.passwordField);

    if (login.submitButton) {
      clickSubmit(login.submitButton);
    }

    setTimeout(() => {
      cleanupField(login.passwordField);
    }, 500);

    return { ok: true, autoSubmitted: true };
  }

  return { ok: false, error: 'Unexpected Google login step: ' + login.step };
}

async function injectGenericForm(login, accountEmail, password) {
  // Type email if field exists
  if (login.emailField && accountEmail) {
    await typeText(login.emailField, accountEmail);
    lockField(login.emailField);
  }

  // Small delay between fields (some forms need this)
  await new Promise((r) => setTimeout(r, 200));

  // Type password FIRST, then lock (lockField's Object.defineProperty can interfere with value setters)
  await typeText(login.passwordField, password);
  lockField(login.passwordField);

  // Small delay before submit
  await new Promise((r) => setTimeout(r, 300));

  // Auto-submit
  let submitted = false;
  if (login.submitButton) {
    submitted = clickSubmit(login.submitButton);
  }

  // Cleanup after submit
  setTimeout(() => {
    cleanupField(login.passwordField);
    if (login.emailField) cleanupField(login.emailField);
  }, 1000);

  return { ok: true, autoSubmitted: submitted };
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
      hasPasswordField: !!login?.passwordField,
      step: login?.step || null,
      isGoogleMultiStep: login?.isGoogleMultiStep || false,
    });
    return false;
  }
});

// --- Init ---

detectAndNotify();

// Re-detect on DOM changes (SPAs that lazy-render forms)
const observer = new MutationObserver(() => {
  detectAndNotify();
});
observer.observe(document.body, { childList: true, subtree: true });
