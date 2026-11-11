# Sajida browser voice pilot on Render

This branch prepares a private, single-operator browser voice pilot. It does not
create Recall bots or join meetings. The operator confirmed native OpenAI voice
playback and subsequently confirmed Surabhi speech after enabling a paid ElevenLabs
plan. The revised conversational style and full interruption checklist need listening tests.

## Configuration for the existing Web Service

Prepare these settings together before deploying this branch. Changing settings
can trigger a deploy; disable automatic deploys while staging the configuration.
Do not merge the draft PR to main just to test it.

| Setting | Value |
| --- | --- |
| Branch | `sajida-ai-development` |
| Root Directory | Empty (repository root, not `node-server`) |
| Build Command | `npm ci --prefix node-server && npm ci --prefix client --include=dev && npm run build --prefix client` |
| Start Command | `node node-server/index.js` |
| Health Check Path | `/healthz` |
| Node version | Node 22 LTS or newer supported LTS |

The repository root is required because the server serves `client/dist` from the
same origin as `/api` and `/voice`. Render excludes files outside a configured
root directory: https://render.com/docs/monorepo-support

Set these **server environment variables**, entering secrets only in Render:

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | Your OpenAI project API key; paid usage starts only after Start conversation |
| `APP_PASSWORD` | A new random access password, at least 16 characters; use 32+ from a password manager |
| `PUBLIC_ORIGIN` | `https://sajida-ai-designer.onrender.com` (exact actual service origin, no trailing slash) |
| `OPENAI_REALTIME_MODEL` | Optional; defaults to `gpt-realtime` |

Render supplies `PORT`. No `VITE_*` secret is needed. The old
`AGENT_ACCESS_TOKEN` is no longer used. Remove it after the old deployment is no
longer needed for rollback. Recall REST/MCP keys are not required for this browser
pilot; never put them in this page or its URL.

After an explicitly chosen deployment, open the **Web Service address**, not the
old standalone Static Site. Sign in with `APP_PASSWORD` and click Start
conversation. The microphone is requested only on Start. Select Surabhi, Marin,
Cedar or Coral between conversations. Surabhi is the default when an ElevenLabs
key is configured; otherwise Marin is the default. Sajida speaks English in a
soft, warm, calm style. Voice quality and accent require listening, not just tests.

The conversational instructions live in `client/src/conversation_config.ts`.
They favor direct answers, concrete design suggestions, occasional kind humor,
and questions that advance a decision, rather than repeated acknowledgements,
paraphrases, or a fixed intake script. Introduce the AI identity once at the start.
For Surabhi, the relay sends stability 0.40, similarity 0.75, and speed 0.98.
The stability adjustment from 0.45 is a listening experiment, not a guarantee of
more natural speech. End any current conversation and reload after deployment
so a new session uses the updated instructions and voice settings.

The standalone Static Site can remain unchanged during this pilot, but cannot
authenticate against this same-origin cookie setup. Old `?wss=...&token=...`
links are not a supported login method.

## Surabhi through ElevenLabs

Set these server variables in the same Web Service:

| Variable | Value |
| --- | --- |
| ELEVENLABS_API_KEY | Secret ElevenLabs key with Text to Speech access; never put it in browser code |
| ELEVENLABS_VOICE_ID | Optional; defaults to ch9J8IB6HKlEHQaWQFdk, Surabhi — Warm Indian Female |
| ELEVENLABS_MODEL | Optional; defaults to eleven_flash_v2_5 |

The current TTS WebSocket integration supports the Flash/Multilingual TTS family;
Eleven v3/v4 require the separate Text to Dialogue protocol and cannot be enabled
by changing this variable alone. The selected voice must be available to the
account that owns the key, with sufficient provider quota.

The public session response exposes only a boolean indicating whether the server
has an ElevenLabs key. It does not validate the key or voice in advance and never
returns credentials. No provider request is made merely by viewing this page.

For Surabhi, OpenAI receives microphone audio and generates text. The Node relay
sends reply text to ElevenLabs and relays 24 kHz PCM speech to the browser.
One synthesis connection is opened per reply and closed on completion,
interruption, logout, expiry or transport failure. Marin, Cedar and Coral continue
to use OpenAI speech directly, without contacting ElevenLabs.

Both the microphone audio and generated text are processed by their respective
providers under the account's provider data policies. The application does not
write audio, transcripts or alignment to disk or logs. Recent alignment is held
only in bounded memory to reconcile interrupted speech.

On interruption, synthesis stops and late audio is discarded. Before the next
response, the relay replaces the interrupted assistant item with the text that
ElevenLabs alignment indicates was played. If alignment or the browser
acknowledgement is unavailable, the unverified reply is omitted instead.
This conservative fallback can lose the heard portion of an interrupted reply.
Playback keeps its worklet alive across network gaps and explicitly drains the
last partial audio buffer.

## Security and lifecycle

- Login is a same-origin HTTPS POST. Passwords never enter URLs or localStorage.
- The server returns an opaque HttpOnly, Secure, SameSite=Strict host-only cookie.
  The server stores only a digest of its random value, not the bearer value.
- Sessions expire after 15 minutes, including active voice connections. Logout
  revokes the session and closes its connection. Restarting Render revokes all
  sessions; this in-memory store is intentionally for one instance only.
- One voice connection is allowed across this instance. A second tab is rejected.
- Cross-origin login/logout and WebSocket upgrades fail closed. The login endpoint
  permits at most 20 attempts per five-minute window globally; the limiter resets
  on process restart. This is a private pilot, not multi-user identity management.
- The app does not save recordings, transcripts or conversation history. Audio
  goes to OpenAI, and Surabhi reply text goes to ElevenLabs; provider account data
  policies still apply.
- End conversation releases the microphone and playback and closes the relay.
- The UI reports Ready only after OpenAI acknowledges the audio configuration.
- Local HTTP is supported only for localhost/127.0.0.1. Production requires HTTPS.

## Local checks

```sh
npm ci --prefix node-server
npm test --prefix node-server
npm ci --prefix client
npm test --prefix client
npm run build --prefix client
npm run lint --prefix client
```

For a live local test, copy `node-server/.env.example` to a private `.env` in
`node-server`, fill the credentials locally, set `PUBLIC_ORIGIN=http://localhost:3000`,
then change into `node-server` and run `npm start`. Open http://localhost:3000 after building the client.

## Safe voice diagnostics

If Start conversation fails, the page reports a fixed error category and a random
reference. Search the Render application logs for that reference or
`realtime_error`. Logs include only reviewed error codes, known configuration
field names, the connection stage, and an HTTP status when available. Provider
messages, response bodies, credentials, audio and transcripts are not logged.
Unknown provider strings are replaced with `unknown_error`.

The message distinguishes authentication, quota, rate limits, model access,
session configuration, provider failures and connection failures. An HTTP 429
without a provider event cannot distinguish rate limits from quota. Do not change
keys or billing based solely on the old generic error message. Share the new
category and reference rather than a key or password.

## Live acceptance

The Web Service was deployed and its login page and `/healthz` were checked on
2026-11-11. Safe diagnostics identified an invalid OpenAI API key. After replacing
the key, the operator confirmed that Sajida spoke with the native voice, and later
confirmed Surabhi speech after enabling a paid ElevenLabs plan. Detailed live
interruption and the revised conversational style remain to be evaluated.

1. `/healthz` returns `ok`, and the login page loads at the Web Service address.
2. Wrong password fails; correct password reveals Start conversation.
3. Before Start, no microphone capture or paid Realtime connection exists.
4. Start, allow the microphone, hear the AI introduction and ask a short question.
5. Interrupt the reply: old playback stops and the assistant listens.
6. End: the microphone indicator clears and the provider connection closes.
7. Repeat with Surabhi and Marin, then sign out. Expired sessions cannot reconnect.
8. For Surabhi, verify a warm Indian English voice, interruption during synthesis,
   a follow-up question and a pause between streamed audio chunks. Inspect only
   safe diagnostics if speech fails; never share an API key or raw provider body.
9. For the conversational style, try a vague brief, reject the first suggestion,
   ask why she prefers one direction, and ask for a simpler explanation. Listen
   over several turns: direct answers, useful design reasoning, no recurring
   acknowledgement or paraphrase, no compulsory question or joke after each reply.
   Compare the same brief across fresh conversations; subjective quality is not
   established by offline tests.

Recall meeting media, bot creation, webhook verification, and a test meeting are
separate remaining work. The legacy Python server must not be deployed for this pilot.

OpenAI protocol reference used:
https://developers.openai.com/api/docs/guides/realtime-conversations
