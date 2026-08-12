(() => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const params = new URLSearchParams(window.location.search);
  if (params.get('owner') !== '1') return;

  const isPolish = document.documentElement.lang === 'pl';
  const copy = isPolish ? {
    key: 'kp-site-pl-edits',
    editOn: 'Zakończ edycję',
    editOff: 'Włącz edycję',
    saved: 'Wersja robocza została zapisana na tym urządzeniu.',
    wrongPassword: 'Nieprawidłowe hasło. Spróbuj ponownie.',
    downloaded: 'Pobrano plik gotowy do publikacji.',
    fileName: 'profile.html'
  } : {
    key: 'kp-site-en-edits',
    editOn: 'Finish editing',
    editOff: 'Enable editing',
    saved: 'The draft was saved on this device.',
    wrongPassword: 'Incorrect password. Please try again.',
    downloaded: 'A publication-ready file has been downloaded.',
    fileName: 'profile-en.html'
  };

  const selectors = [
    'nav.links a', '.lang-switch a', '.eyebrow', 'h2', 'h3.sub-heading',
    '.about-copy p', '.about-fact span', '.about-fact strong', '.about-details h3',
    '.research-list span', '.membership-area li', '.tl-date', '.tl-title', '.tl-org', '.tl-desc',
    '.simple-list li', '.rg-stat .num', '.rg-stat .label', '.pub-meta span', '.pub-title a',
    '.pub-authors', '.pub-link', 'details.conf summary', '.conf-authors', '.conf-title', '.conf-venue',
    '.contact-card .name', '.contact-card .handle', '.footer-rights', '.built-by'
  ];
  const fields = [...document.querySelectorAll(selectors.join(','))];
  fields.forEach((field, index) => {
    if (!field.dataset.edit) field.dataset.edit = `content-${String(index + 1).padStart(3, '0')}`;
    field.spellcheck = true;
  });

  const tools = document.getElementById('ownerTools');
  const login = document.getElementById('ownerLogin');
  const form = document.getElementById('ownerLoginForm');
  const password = document.getElementById('ownerPassword');
  const error = document.getElementById('ownerLoginError');
  const toggle = document.getElementById('toggleEdit');
  const expectedHash = 'fb646552381f1756be722c2f511f18ec408c63d9493fae644749114661311452';

  const showNote = message => {
    const note = document.createElement('div');
    note.className = 'edit-note';
    note.setAttribute('role', 'status');
    note.textContent = message;
    document.body.append(note);
    window.setTimeout(() => note.remove(), 2600);
  };

  const saveFields = () => {
    const data = Object.fromEntries(fields.map(field => [field.dataset.edit, field.innerHTML]));
    localStorage.setItem(copy.key, JSON.stringify(data));
  };

  const loadFields = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(copy.key) || '{}');
      fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(saved, field.dataset.edit)) {
          field.innerHTML = saved[field.dataset.edit];
        }
      });
    } catch (_) {
      localStorage.removeItem(copy.key);
    }
  };

  const setEditing = active => {
    document.body.classList.toggle('owner-mode', active);
    fields.forEach(field => field.contentEditable = active ? 'true' : 'false');
    toggle.textContent = active ? copy.editOn : copy.editOff;
  };

  const unlock = () => {
    sessionStorage.setItem('kp-owner-session', 'active');
    login.hidden = true;
    tools.classList.add('visible');
    loadFields();
    setEditing(true);
  };

  const hashPassword = async value => {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  };

  if (sessionStorage.getItem('kp-owner-session') === 'active') {
    unlock();
  } else {
    login.hidden = false;
    window.setTimeout(() => password.focus(), 40);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    const enteredHash = await hashPassword(password.value);
    if (enteredHash !== expectedHash) {
      error.textContent = copy.wrongPassword;
      password.select();
      return;
    }
    password.value = '';
    unlock();
  });

  let autosaveTimer;
  document.addEventListener('input', event => {
    if (!event.target.closest('[data-edit]')) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(saveFields, 300);
  });
  window.addEventListener('beforeunload', saveFields);

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
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  toggle.addEventListener('click', () => {
    setEditing(!document.body.classList.contains('owner-mode'));
  });

  document.getElementById('saveEdits').addEventListener('click', () => {
    saveFields();
    showNote(copy.saved);
  });

  document.getElementById('downloadPage').addEventListener('click', () => {
    saveFields();
    setEditing(false);
    tools.classList.remove('visible');
    login.hidden = true;
    const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    tools.classList.add('visible');
    const url = URL.createObjectURL(new Blob([html], {type: 'text/html'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = copy.fileName;
    link.click();
    URL.revokeObjectURL(url);
    showNote(copy.downloaded);
  });

  document.getElementById('ownerLogout').addEventListener('click', () => {
    saveFields();
    sessionStorage.removeItem('kp-owner-session');
    setEditing(false);
    window.location.href = window.location.pathname;
  });
})();
