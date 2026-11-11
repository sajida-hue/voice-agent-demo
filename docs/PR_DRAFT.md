# Private Sajida browser voice pilot with Realtime GA

The deployed client can open a WebSocket without being authorized, then display a
misleading Connected status while the relay rejects it. This change replaces the
shared query-string token with password login and a revocable 15-minute cookie
session, and waits for the Realtime audio configuration acknowledgement before
reporting readiness.

## Behavior

- Node serves the built client, HTTP login/session/logout endpoints and the
  authenticated /voice upgrade on one origin.
- Production cookies are host-only, Secure, HttpOnly and SameSite=Strict.
  Same-origin checks, bounded login attempts, one active voice connection, expiry
  and logout protect the private single-operator pilot. Server restart revokes
  the in-memory sessions.
- The existing GA relay replaces the Beta SDK and bounds startup queues and
  backpressure. API credentials stay on the server.
- The client has explicit Sign in, Start, End and Sign out controls, microphone
  and playback cleanup, and errors without exposing relay URLs or secrets.
- Sajida speaks English by default in a soft, warm, calm style. Marin is the
  initial selectable voice, alongside Cedar and Coral.
- Locked dependencies and docs/RENDER_BROWSER_SETUP.md provide the one-service
  Render build and runtime configuration. The old static site is not used for
  cookie-authenticated browser sessions.

## Validation

- 21 server tests pass: real local HTTP/WebSocket auth lifecycle and offline GA
  relay transport tests. No live provider call is used.
- 9 client tests pass with simulated DOM/audio/transport: login, explicit start,
  GA readiness and audio events, interruption, error cleanup, stop, logout,
  expiry and cancellation while microphone permission is pending.
- Client TypeScript/Vite production build passes.
- ESLint passes with one pre-existing unused-disable warning in wav_recorder.js.
- Chromium could not start in the execution environment (system socket
  restriction). Actual browser audio, CSP/worklets, autoplay and voice quality
  still require the live acceptance checklist.
- No live OpenAI call, bot creation, meeting, deployment or main-branch update
  was performed.

## Remaining scope and limits

This is a private browser pilot, not the finished meeting assistant. Keep the PR
draft until the owner chooses and completes the live browser acceptance test.
The in-memory auth store and global limiter target one server instance and one
operator, not public multi-user access.

Recall.ai list_regions was queried: us-east-1 is available and the default.
No Recall API request fields, webhooks, recording settings or bot behavior were
changed. Meeting media, verified webhooks and short-lived bot-specific
authorization remain separate work. The Python implementation remains legacy.

## References

- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://render.com/docs/monorepo-support

