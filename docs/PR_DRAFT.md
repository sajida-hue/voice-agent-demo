# Secure Sajida browser voice pilot with Realtime GA and Surabhi

Replace the shared URL token and misleading WebSocket Connected status with a
private password login, a revocable 15-minute cookie session and explicit
conversation controls. When an ElevenLabs key is configured, Sajida defaults to
Surabhi — Warm Indian Female; Marin, Cedar and Coral remain selectable.

## Behavior

- Node serves the client, login/session/logout endpoints and authenticated voice
  WebSocket on one origin. Production cookies are host-only, Secure, HttpOnly and
  SameSite=Strict. Exact origin checks, bounded login attempts and one active
  voice connection protect the single-operator pilot. Restart revokes sessions.
- For Surabhi, OpenAI Realtime accepts microphone audio and produces text. The
  server streams text to ElevenLabs Flash v2.5 and sends 24 kHz PCM to the browser.
  The default voice ID is ch9J8IB6HKlEHQaWQFdk. Provider keys remain on the server.
  Availability in the UI means a key is configured, not that its quota or voice
  access has been verified.
- Synthesis opens only after Start and only for Surabhi, with one connection per
  reply. Close, logout, expiry, errors and interruption close paired transports.
  Playback stays alive between chunks and drains the final partial buffer.
- On barge-in, late audio is ignored. Manual VAD response creation waits for
  playback reconciliation and cancellation. The previous assistant item is
  replaced with its aligned heard prefix; missing alignment/acknowledgement
  conservatively omits the interrupted reply, which can lose heard context.
- Fixed error messages and random references distinguish OpenAI and ElevenLabs
  failures. Logs use allowlisted codes and numeric statuses. No raw error messages,
  provider bodies, credentials or conversation content are logged.
- The client identifies Sajida as AI and explains paid usage and the provider
  processing before Start. English, warm calm delivery and conversational
  sentences are requested. The revised prompt favors direct answers, concrete
  design judgement, occasional kind humor and purposeful questions; it removes
  the fixed intake flow and routine paraphrasing. AI identity is introduced once.
  Surabhi stability is 0.40 (from 0.45), similarity is 0.75, and speed is 1.08
  (from 0.98, for a faster-speech listening trial).
  Voice quality is evaluated by listening, not guaranteed by these settings.

## Validation

- 47 server tests: real local HTTP/WebSocket authentication; two local provider
  WebSocket doubles exercising text-to-speech routing and PCM delivery; bounded
  streaming, cancellation/history repair, HTTP/provider error redaction, timeout
  and cleanup; actual worklet execution across gaps, partial buffers and barge-in.
- 14 client tests: login and session lifecycle, default Surabhi/native selection,
  disclosure, GA readiness, PCM playback completion, interruption, late chunk
  rejection, error cleanup and pending microphone permission cancellation.
- TypeScript/Vite production build passes. ESLint has no errors and one existing
  unused-disable warning in the recording utility.
- Automated checks make no paid provider calls. The operator confirmed native
  OpenAI speech after replacing an invalid key, then confirmed Surabhi speech
  after enabling a paid ElevenLabs plan. The revised style and detailed live
  interruption checklist still need operator testing; no subjective quality
  claim is inferred from the regression tests.
- Render deployment and public health/configuration checks are separate from
  proving live voice quality. Main remains unmerged.

## Limits and remaining work

This is a private browser pilot with in-memory sessions and one server instance.
Keep the PR draft until the live acceptance checklist is complete. ElevenLabs
provider data policies still apply; the application stores no recordings or
transcripts. Text and recent alignment are kept only in bounded session memory.
The TTS WebSocket supports Flash/Multilingual models, not the v3/v4 dialogue
protocol; changing the model variable alone does not migrate the protocol.

Recall.ai list_regions confirmed us-east-1. No Recall API fields, webhooks,
recording settings, bots or meeting behavior were changed. Meeting media and
short-lived bot-specific authorization remain separate work. Python is legacy.

## References

- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/api/docs/guides/voice-prompting
- https://elevenlabs.io/docs/api-reference/voices/settings/get
- https://developers.openai.com/api/reference/resources/realtime/client-events
- https://developers.openai.com/api/reference/resources/realtime/server-events
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts
- https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
- https://render.com/docs/monorepo-support
