import { createHash, randomBytes } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const voices = new Set(['surabhi', 'marin', 'cedar', 'coral']);
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const token = () => randomBytes(32).toString('hex');

export class MeetError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// One operator/instance. Tickets, bot IDs and audio session state are memory-only.
// Output Media's getUserMedia is independent of recording-based event streams.
export function createMeetBridge({ publicOrigin, googleLoginGroupId, recallRegion = 'us-east-1',
  recallApiKey, elevenlabsAvailable, now = Date.now, fetchImpl = fetch,
  ticketTtlMs = 5 * 60 * 1000, voiceTtlMs = 15 * 60 * 1000,
  isBusy = () => false,
} = {}) {
  if (!['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'].includes(recallRegion)) {
    throw new Error('Invalid RECALL_REGION');
  }
  if (googleLoginGroupId && !uuid.test(googleLoginGroupId)) throw new Error('Invalid Google Login Group');
  const base = `https://${recallRegion}.recall.ai/api/v1/bot/`;
  const cookieName = publicOrigin.startsWith('https:') ? '__Host-sajida_meet' : 'sajida_meet';
  let current = null;

  const enabled = !!googleLoginGroupId;
  function state() {
    return { configured: enabled, directLaunch: !!recallApiKey, status: current?.status ?? 'idle',
      expiresAt: current?.expiresAt ?? null, voice: current?.voice ?? null };
  }
  function closeVoice(record, reason) {
    clearTimeout(record.timer);
    record.socket?.close(1000, reason);
    if (record.socket) {
      const timer = setTimeout(() => record.socket?.terminate(), 1000);
      timer.unref();
      record.socket.once('close', () => clearTimeout(timer));
    }
  }
  function expire(record) {
    if (current !== record) return;
    current = null;
    closeVoice(record, 'Meet voice expired');
  }
  async function request(path, payload) {
    let response;
    try {
      response = await fetchImpl(base + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Token ${recallApiKey}`, 'Content-Type': 'application/json' },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
    } catch { throw new MeetError(502, 'Recall did not confirm the request. Check Recall before sending another bot.'); }
    if (!response.ok) {
      await response.body?.cancel();
      const message = response.status === 401 || response.status === 403
        ? 'Recall could not authorize the request. Check its server configuration.'
        : response.status === 507 ? 'Recall has no bot available right now. Try again shortly.'
          : 'Recall could not complete the request. Check Recall before trying again.';
      throw new MeetError(502, message);
    }
    try { return await response.json(); }
    catch { throw new MeetError(502, 'Recall returned an unexpected response. Check Recall before trying again.'); }
  }
  async function prepare({ meetingUrl, voice = 'surabhi' } = {}) {
    if (!enabled) throw new MeetError(503, 'The Google Meet connection is not configured yet.');
    if (current || isBusy()) throw new MeetError(409, 'End the current voice connection before starting another.');
    if (!voices.has(voice) || (voice === 'surabhi' && !elevenlabsAvailable)) {
      throw new MeetError(400, 'Choose an available voice.');
    }
    // Only ordinary Meet links; no credentials, alternate hosts, ports or arbitrary URLs.
    if (typeof meetingUrl !== 'string' || !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(meetingUrl.trim())) {
      throw new MeetError(400, 'Enter a Google Meet link such as https://meet.google.com/abc-defg-hij.');
    }
    const ticket = token();
    const record = { ticketHash: hash(ticket), voice, status: 'prepared',
      expiresAt: now() + ticketTtlMs, socket: null, cookieHash: null, botId: null };
    current = record; // Reserve before any await so duplicate clicks cannot launch two bots.
    record.timer = setTimeout(() => expire(record), ticketTtlMs);
    record.timer.unref();
    const payload = {
      meeting_url: meetingUrl.trim(),
      google_meet: { google_login_group_id: googleLoginGroupId },
      recording_config: null,
      output_media: { camera: { kind: 'webpage', config: { url: `${publicOrigin}/meet/agent#ticket=${ticket}` } } },
      automatic_leave: { waiting_room_timeout: 120, noone_joined_timeout: 120,
        in_call_not_recording_timeout: Math.ceil(voiceTtlMs / 1000) },
    };
    if (recallApiKey) {
      record.status = 'joining';
      try {
        const response = await request('', payload);
        if (!uuid.test(response.id ?? '')) throw new MeetError(502, 'Recall did not confirm a bot ID. Check Recall before trying again.');
        record.botId = response.id;
        return state();
      } catch (error) {
        // Invalidate the capability even when a timed-out POST may have created a bot.
        expire(record);
        throw error;
      }
    }
    const command = `(
  printf 'Recall API key (hidden): '
  IFS= read -r -s sajida_recall_key
  printf '\\n'
  [ -n "$sajida_recall_key" ] || exit 1
  printf 'Authorization: Token %s\\n' "$sajida_recall_key" |
    curl --silent --show-error --request POST ${quote(base)} \\
      --header @- --header 'Content-Type: application/json' \\
      --write-out '\\nHTTP %{http_code}\\n' \\
      --data-raw ${quote(JSON.stringify(payload, null, 2))}
)`;
    return { ...state(), command };
  }
  function lookup(req) {
    const value = (req.headers.cookie || '').split(';').map(v => v.trim())
      .find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!current || !value || !/^[a-f0-9]{64}$/.test(value) || current.expiresAt <= now()
      || current.cookieHash !== hash(value)) return null;
    return current;
  }
  function activate(req, res, ticket) {
    if (lookup(req)) return { voice: current.voice, expiresAt: current.expiresAt };
    if (!current || current.expiresAt <= now() || current.cookieHash || isBusy()
      || typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket) || hash(ticket) !== current.ticketHash) {
      throw new MeetError(401, 'This meeting connection has expired or has already been used.');
    }
    const secret = token();
    current.cookieHash = hash(secret);
    current.ticketHash = null; // A copied URL cannot claim another session.
    current.status = 'connecting';
    current.expiresAt = now() + voiceTtlMs;
    clearTimeout(current.timer);
    const record = current;
    current.timer = setTimeout(() => expire(record), voiceTtlMs);
    current.timer.unref();
    res.set('Set-Cookie', `${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(voiceTtlMs / 1000)}${publicOrigin.startsWith('https:') ? '; Secure' : ''}`);
    return { voice: current.voice, expiresAt: current.expiresAt };
  }
  function attach(record, socket) {
    record.socket = socket;
    socket.once('close', () => { if (current === record) expire(record); });
  }
  function ready(req) {
    const record = lookup(req);
    if (!record?.socket || record.socket.readyState !== 1) throw new MeetError(401, 'No meeting voice connection.');
    record.status = 'ready';
  }
  async function end() {
    const record = current;
    if (!record) return { ...state(), leftCall: false };
    const botId = record.botId;
    expire(record);
    if (botId) {
      await request(`${botId}/leave_call/`);
      return { ...state(), leftCall: true };
    }
    return { ...state(), leftCall: false };
  }
  return { state, prepare, lookup, activate, attach, ready, end, close: () => { if (current) expire(current); } };
}
