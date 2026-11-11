import express from 'express';
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { attachRelay } from './relay.js';

const digest = value => createHash('sha256').update(value).digest();
const cookieKey = value => digest(value).toString('hex');

// Single operator, one Render instance. Restarting the server revokes all sessions.
export function createApplication({ apiKey, password, publicOrigin, model = 'gpt-realtime',
  elevenlabsApiKey, elevenlabsVoiceId = 'ch9J8IB6HKlEHQaWQFdk', elevenlabsModel = 'eleven_flash_v2_5',
  sessionTtlMs = 15 * 60 * 1000, now = Date.now, relay = attachRelay,
  distPath = fileURLToPath(new URL('../client/dist/', import.meta.url)),
} = {}) {
  if (!apiKey || typeof password !== 'string' || password.length < 16 || password.length > 1024) {
    throw new Error('Missing server credentials');
  }
  const origin = new URL(publicOrigin);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.origin !== publicOrigin || origin.username || origin.password) {
    throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  const cookieName = local ? 'sajida_session' : '__Host-sajida_session';
  const expectedPassword = digest(password);
  const sessions = new Map();
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  let loginWindow = 0;
  let loginAttempts = 0;

  function cookie(token, maxAge) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
  }
  function lookup(req) {
    const entries = (req.headers.cookie || '').split(';').map(part => part.trim());
    const value = entries.find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
    const key = cookieKey(value);
    const session = sessions.get(key);
    if (!session || session.expiresAt <= now()) return null;
    return { key, session };
  }
  function revoke(key, reason = 'Session ended') {
    const session = sessions.get(key);
    if (!session) return;
    clearTimeout(session.timer);
    sessions.delete(key);
    for (const ws of session.sockets) {
      ws.close(1008, reason);
      const timer = setTimeout(() => ws.terminate(), 1000);
      timer.unref();
      ws.once('close', () => clearTimeout(timer));
    }
  }
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'microphone=(self), camera=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' blob:; style-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.headers.origin !== publicOrigin) return res.sendStatus(403);
    next();
  });
  app.use(express.json({ limit: '2kb', strict: true }));
  app.get('/api/session', (req, res) => {
    const found = lookup(req);
    res.json({ authenticated: !!found, expiresAt: found?.session.expiresAt ?? null,
      ...(elevenlabsApiKey ? { surabhiAvailable: true } : {}) });
  });
  app.post('/api/login', (req, res) => {
    // Bounded global limiter: does not trust spoofable forwarding headers.
    if (now() >= loginWindow) { loginWindow = now() + 5 * 60 * 1000; loginAttempts = 0; }
    if (++loginAttempts > 20) { res.set('Retry-After', String(Math.ceil((loginWindow - now()) / 1000))); return res.sendStatus(429); }
    const supplied = req.body?.password;
    if (typeof supplied !== 'string' || supplied.length > 1024 || !timingSafeEqual(digest(supplied), expectedPassword)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const previous = lookup(req);
    if (previous) revoke(previous.key);
    for (const [key, session] of sessions) if (session.expiresAt <= now()) revoke(key);
    if (sessions.size >= 100) return res.sendStatus(503);
    const token = randomBytes(32).toString('hex');
    const key = cookieKey(token);
    const expiresAt = now() + sessionTtlMs;
    const timer = setTimeout(() => revoke(key, 'Session expired'), sessionTtlMs);
    timer.unref();
    sessions.set(key, { expiresAt, timer, sockets: new Set() });
    res.set('Set-Cookie', cookie(token, Math.floor(sessionTtlMs / 1000)));
    return res.json({ authenticated: true, expiresAt, ...(elevenlabsApiKey ? { surabhiAvailable: true } : {}) });
  });
  app.post('/api/logout', (req, res) => {
    const found = lookup(req);
    if (found) revoke(found.key);
    res.set('Set-Cookie', cookie('', 0)).sendStatus(204);
  });
  app.use('/api', (_req, res) => res.sendStatus(404));
  app.use(express.static(distPath, { index: 'index.html', dotfiles: 'deny', cacheControl: false }));
  app.use((_req, res) => res.sendStatus(404));
  app.use((_error, _req, res, _next) => res.status(400).json({ error: 'Invalid request' }));

  server.on('upgrade', (req, socket, head) => {
    const found = lookup(req);
    const reject = code => { socket.end(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`); };
    // Exact origin prevents cross-site WebSocket hijacking. No URL credentials.
    if (req.url !== '/voice' || req.headers.origin !== publicOrigin || !found) return reject('401 Unauthorized');
    if (wss.clients.size) return reject('409 Conflict');
    wss.handleUpgrade(req, socket, head, ws => {
      found.session.sockets.add(ws);
      ws.once('close', () => found.session.sockets.delete(ws));
      try { relay(ws, { apiKey, model, elevenlabsApiKey, elevenlabsVoiceId, elevenlabsModel }); }
      catch { ws.close(1011, 'Voice service unavailable'); }
    });
  });
  server.on('close', () => {
    for (const key of sessions.keys()) revoke(key);
    wss.close();
  });
  return { app, server, wss };
}
