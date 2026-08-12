import { get, put } from '@vercel/blob';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = '__Host-kp_owner';
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 8;
const loginAttempts = new Map();
const CONTENT_PATHS = {
  pl: 'content/profile-pl.json',
  en: 'content/profile-en.json',
};

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function safeEqual(left, right) {
  const leftHash = createHash('sha256').update(String(left)).digest();
  const rightHash = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function signSession() {
  const secret = process.env.EDITOR_SESSION_SECRET;
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function hasValidSession(request) {
  const secret = process.env.EDITOR_SESSION_SECRET;
  const token = parseCookies(request.headers.get('cookie'))[COOKIE_NAME];
  if (!secret || !token) return false;
  const [payload, providedSignature] = token.split('.');
  if (!payload || !providedSignature) return false;
  const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(providedSignature, expectedSignature)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.version === 1 && Number(session.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

function loginKey(request) {
  return (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

function loginAllowed(request) {
  const key = loginKey(request);
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (!state || state.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  return state.count < LOGIN_ATTEMPT_LIMIT;
}

function recordFailedLogin(request) {
  const key = loginKey(request);
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (!state || state.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  state.count += 1;
}

function clearFailedLogins(request) {
  loginAttempts.delete(loginKey(request));
}

function sanitizeContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.length > 500) return null;
  const clean = {};
  for (const [key, value] of entries) {
    if (!/^[a-z0-9-]{1,64}$/i.test(key) || typeof value !== 'string' || value.length > 12000) return null;
    const withoutAllowedTags = value.replace(/<\/?(?:strong|em)>|<br\s*\/?\s*>/gi, '');
    if (/[<>]/.test(withoutAllowedTags)) return null;
    clean[key] = value;
  }
  return clean;
}

async function readContent(language) {
  try {
    const result = await get(CONTENT_PATHS[language], { access: 'private', useCache: false });
    if (!result?.stream) return { content: {}, storageReady: true };
    const payload = JSON.parse(await new Response(result.stream).text());
    return {
      content: sanitizeContent(payload.content) || {},
      updatedAt: payload.updatedAt || null,
      storageReady: true,
    };
  } catch (error) {
    if (error?.name === 'BlobNotFoundError') return { content: {}, storageReady: true };
    return { content: {}, storageReady: false };
  }
}

async function writeContent(language, content) {
  await put(CONTENT_PATHS[language], JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    content,
  }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 60,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const language = url.searchParams.get('lang');
    const action = url.searchParams.get('action');

    if (request.method === 'GET') {
      if (action === 'status') return json({ authenticated: hasValidSession(request) }, hasValidSession(request) ? 200 : 401);
      if (!CONTENT_PATHS[language]) return json({ error: 'Unsupported language.' }, 400);
      return json(await readContent(language));
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
    if (!isSameOrigin(request)) return json({ error: 'Invalid origin.' }, 403);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }

    if (body.action === 'login') {
      const ownerPassword = process.env.EDITOR_OWNER_PASSWORD;
      const token = signSession();
      if (!ownerPassword || !token) return json({ error: 'Editor is not configured.' }, 503);
      if (!loginAllowed(request)) return json({ error: 'Too many login attempts. Try again later.' }, 429);
      if (typeof body.password !== 'string' || body.password.length > 128 || !safeEqual(body.password, ownerPassword)) {
        recordFailedLogin(request);
        return json({ error: 'Invalid credentials.' }, 401);
      }
      clearFailedLogins(request);
      return json({ authenticated: true }, 200, {
        'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
      });
    }

    if (body.action === 'logout') {
      return json({ authenticated: false }, 200, {
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      });
    }

    if (body.action === 'save') {
      if (!hasValidSession(request)) return json({ error: 'Authentication required.' }, 401);
      if (!CONTENT_PATHS[body.language]) return json({ error: 'Unsupported language.' }, 400);
      const content = sanitizeContent(body.content);
      if (!content || JSON.stringify(content).length > 180000) return json({ error: 'Invalid content.' }, 400);
      try {
        await writeContent(body.language, content);
        return json({ saved: true, updatedAt: new Date().toISOString() });
      } catch {
        return json({ error: 'Unable to save content.' }, 500);
      }
    }

    return json({ error: 'Unsupported action.' }, 400);
  },
};
