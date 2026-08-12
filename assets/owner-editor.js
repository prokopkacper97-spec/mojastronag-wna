(async () => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const isPolish = document.documentElement.lang === 'pl';
  const language = isPolish ? 'pl' : 'en';
  const params = new URLSearchParams(window.location.search);
  const ownerRequested = params.get('owner') === '1';
  const revealContent = () => {
    window.clearTimeout(window.__contentRevealTimer);
    window.requestAnimationFrame(() => document.documentElement.classList.remove('content-loading'));
  };
  const copy = isPolish ? {
    draftKey: 'kp-site-pl-draft',
    legacyKey: 'kp-site-pl-edits',
    editOn: 'Zakończ edycję',
    editOff: 'Włącz edycję',
    published: 'Zmiany zostały opublikowane online.',
    publishing: 'Publikowanie…',
    publish: 'Opublikuj zmiany',
    wrongPassword: 'Nieprawidłowe hasło. Spróbuj ponownie.',
    unavailable: 'Panel online wymaga jeszcze aktywacji w ustawieniach Vercela.',
    saveFailed: 'Nie udało się opublikować zmian. Spróbuj ponownie.'
  } : {
    draftKey: 'kp-site-en-draft',
    legacyKey: 'kp-site-en-edits',
    editOn: 'Finish editing',
    editOff: 'Enable editing',
    published: 'Your changes are now published online.',
    publishing: 'Publishing…',
    publish: 'Publish changes',
    wrongPassword: 'Incorrect password. Please try again.',
    unavailable: 'The online editor still needs to be activated in Vercel settings.',
    saveFailed: 'The changes could not be published. Please try again.'
  };

  const baseSelectors = [
    'nav.links a', '.lang-switch a', '.eyebrow', 'h2', 'h3.sub-heading',
    '.about-copy p', '.about-fact span', '.about-fact strong', '.about-details h3',
    '.research-list span', '.membership-area li', '.tl-date', '.tl-title', '.tl-org', '.tl-desc',
    '.simple-list li', '.rg-stat .num', '.rg-stat .label', '.pub-meta span', '.pub-title a',
    '.pub-authors', '.pub-link', 'details.conf summary', '.conf-authors', '.conf-title', '.conf-venue',
    '.contact-card .name', '.contact-card .handle', '.footer-rights', '.built-by'
  ];
  const baseFields = [...document.querySelectorAll(baseSelectors.join(','))];
  baseFields.forEach((field, index) => {
    if (!field.dataset.edit) field.dataset.edit = `content-${String(index + 1).padStart(3, '0')}`;
    field.spellcheck = true;
  });
  const extraSelectors = [
    'h1', '.hero .role', '.portal-copy small', '.portal-copy strong', '.portal-copy em',
    '.profile-entry span:first-child'
  ];
  const extraFields = [...document.querySelectorAll(extraSelectors.join(','))].filter(field => !baseFields.includes(field));
  extraFields.forEach((field, index) => {
    if (!field.dataset.edit) field.dataset.edit = `extra-${String(index + 1).padStart(3, '0')}`;
    field.spellcheck = true;
  });
  const fields = [...baseFields, ...extraFields];

  const cleanHTML = value => {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    [...template.content.querySelectorAll('*')].reverse().forEach(element => {
      if (!['STRONG', 'EM', 'BR'].includes(element.tagName)) {
        element.replaceWith(...element.childNodes);
        return;
      }
      [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
    });
    return template.innerHTML;
  };

  const applyContent = content => {
    if (!content || typeof content !== 'object') return;
    fields.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(content, field.dataset.edit)) {
        field.innerHTML = cleanHTML(content[field.dataset.edit]);
      }
    });
  };

  const serializeFields = () => Object.fromEntries(fields.map(field => [field.dataset.edit, cleanHTML(field.innerHTML)]));

  try {
    const response = await (window.__contentPromise || fetch(`/api/editor?lang=${language}`, { cache: 'no-store', credentials: 'same-origin' }));
    if (response?.ok) applyContent((await response.json()).content);
  } catch (_) {
    // The HTML copy remains a complete fallback when the online content is unavailable.
  } finally {
    if (!ownerRequested) revealContent();
  }

  if (!ownerRequested) return;

  const tools = document.getElementById('ownerTools');
  const login = document.getElementById('ownerLogin');
  const form = document.getElementById('ownerLoginForm');
  const password = document.getElementById('ownerPassword');
  const error = document.getElementById('ownerLoginError');
  const toggle = document.getElementById('toggleEdit');
  const publish = document.getElementById('publishEdits');

  const showNote = message => {
    const note = document.createElement('div');
    note.className = 'edit-note';
    note.setAttribute('role', 'status');
    note.textContent = message;
    document.body.append(note);
    window.setTimeout(() => note.remove(), 2800);
  };

  const saveDraft = () => localStorage.setItem(copy.draftKey, JSON.stringify(serializeFields()));

  const loadDraft = () => {
    try {
      const draft = localStorage.getItem(copy.draftKey) || localStorage.getItem(copy.legacyKey);
      if (draft) applyContent(JSON.parse(draft));
    } catch (_) {
      localStorage.removeItem(copy.draftKey);
    }
  };

  const setEditing = active => {
    document.body.classList.toggle('owner-mode', active);
    fields.forEach(field => field.contentEditable = active ? 'true' : 'false');
    toggle.textContent = active ? copy.editOn : copy.editOff;
  };

  const unlock = () => {
    login.hidden = true;
    tools.classList.add('visible');
    loadDraft();
    setEditing(true);
  };

  const showLogin = () => {
    login.hidden = false;
    window.setTimeout(() => password.focus(), 40);
  };

  try {
    const status = await fetch('/api/editor?action=status', { cache: 'no-store', credentials: 'same-origin' });
    if (status.ok) unlock(); else showLogin();
  } catch (_) {
    showLogin();
  } finally {
    revealContent();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch('/api/editor', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', password: password.value })
      });
      if (response.ok) {
        password.value = '';
        unlock();
      } else {
        error.textContent = response.status === 503 ? copy.unavailable : copy.wrongPassword;
        password.select();
      }
    } catch (_) {
      error.textContent = copy.unavailable;
    } finally {
      submit.disabled = false;
    }
  });

  let autosaveTimer;
  document.addEventListener('input', event => {
    if (!event.target.closest('[data-edit]')) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(saveDraft, 350);
  });
  window.addEventListener('beforeunload', saveDraft);

  document.addEventListener('click', event => {
    const field = event.target.closest('[data-edit]');
    if (field && document.body.classList.contains('owner-mode')) {
      event.preventDefault();
      event.stopPropagation();
      field.focus();
    }
  }, true);

  document.addEventListener('paste', event => {
    if (!event.target.closest('[data-edit]') || !document.body.classList.contains('owner-mode')) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });

  toggle.addEventListener('click', () => setEditing(!document.body.classList.contains('owner-mode')));

  publish.addEventListener('click', async () => {
    saveDraft();
    publish.disabled = true;
    publish.textContent = copy.publishing;
    try {
      const response = await fetch('/api/editor', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', language, content: serializeFields() })
      });
      if (!response.ok) throw new Error('save-failed');
      localStorage.removeItem(copy.draftKey);
      localStorage.removeItem(copy.legacyKey);
      showNote(copy.published);
    } catch (_) {
      showNote(copy.saveFailed);
    } finally {
      publish.disabled = false;
      publish.textContent = copy.publish;
    }
  });

  document.getElementById('ownerLogout').addEventListener('click', async () => {
    saveDraft();
    try {
      await fetch('/api/editor', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
      });
    } finally {
      window.location.href = window.location.pathname;
    }
  });
})();
