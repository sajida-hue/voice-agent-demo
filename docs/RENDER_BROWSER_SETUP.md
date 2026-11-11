# Sajida browser voice pilot on Render

This branch prepares a private, single-operator browser voice pilot. It does not
create Recall bots or join meetings. Live OpenAI audio still needs operator testing.

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
conversation. The microphone is requested only on Start. Select Marin, Cedar or
Coral between conversations; the default is Marin. Sajida speaks English in a
soft, warm, calm style. Voice quality and accent require listening, not just tests.

The standalone Static Site can remain unchanged during this pilot, but cannot
authenticate against this same-origin cookie setup. Old `?wss=...&token=...`
links are not a supported login method.

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
- The app does not save recordings, transcripts or conversation history. Audio is
  processed in memory and sent to OpenAI; OpenAI's account data policies still apply.
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

## Live acceptance (not yet performed)

1. `/healthz` returns `ok`, and the login page loads at the Web Service address.
2. Wrong password fails; correct password reveals Start conversation.
3. Before Start, no microphone capture or paid Realtime connection exists.
4. Start, allow the microphone, hear the AI introduction and ask a short question.
5. Interrupt the reply: old playback stops and the assistant listens.
6. End: the microphone indicator clears and the provider connection closes.
7. Repeat with a different voice, then sign out. Expired sessions cannot reconnect.

Recall meeting media, bot creation, webhook verification, and a test meeting are
separate remaining work. The legacy Python server must not be deployed for this pilot.

OpenAI protocol reference used:
https://developers.openai.com/api/docs/guides/realtime-conversations
