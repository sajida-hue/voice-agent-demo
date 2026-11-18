# Sajida voice in Google Meet

The signed-in Recall bot and the voice service are separate connections. The
operator pastes a Meet link into the existing password-protected Sajida app.
Recall opens `/meet/agent` inside its own cloud browser. That page automatically
receives mixed meeting audio through `getUserMedia()`, sends 24 kHz PCM through
the authenticated Node relay to OpenAI Realtime, and plays replies into Meet.
Surabhi replies still use server-side ElevenLabs Flash with the existing voice
and speed settings. Recall converts the page's output into the meeting format.
Its microphone feed excludes the bot's own output, avoiding an audio loop.

The bot's camera shows the operator-provided portrait and the name Sajida on a
black background. Status and provider labels are not shown in the meeting tile.
The model opens with "Hello, my name is Sajida. I'm a graphic designer and AI
designer. It's lovely to meet you." It then waits for the other person and can
respond to ordinary small talk without immediately pitching design services.
The current conversational style is warm and expressive, with everyday wording,
short emotional reactions and occasional gentle design humor. Interview answers
remain clear and adapt to the speaker's formality. Text does not include smile or
laughter stage directions for the speech engine to read aloud. Voice expressiveness
still needs listening acceptance with the selected speech provider.
It remains an AI representative and answers honestly if asked about that.
Its instructions include
Sajida's supplied professional profile and portfolio examples; disputed dates,
language-level labels, unverified performance metrics and private contact data
are excluded. Daydrate is explicitly a concept project. This does not add Gmail,
Calendar, portfolio screen sharing or an avatar.

## Server configuration

Keep the existing `PUBLIC_ORIGIN`, `APP_PASSWORD`, `OPENAI_API_KEY` and
ElevenLabs variables. Add these server-only settings on the same Render service:

```dotenv
RECALL_REGION=us-east-1
RECALL_GOOGLE_LOGIN_GROUP_ID=YOUR_GOOGLE_LOGIN_GROUP_UUID
# Optional; omit to keep the Recall key only in the operator's Terminal:
# RECALL_API_KEY=YOUR_RECALL_API_KEY
```

Use a group from the same Recall region/workspace as the API key, and set its
Login Mode to `always` when testing the signed-in identity. The Google Login
must already be ready, with the dedicated Workspace's Legacy SSO configured.
Google uses the signed-in account's name and image, regardless of `bot_name`.

- Without `RECALL_API_KEY`, Connect prepares a command. Copy it into Terminal,
  enter the current Recall key at the hidden prompt, then admit the bot in Meet.
  The app never receives or saves that key. The command does not put the key in
  shell history or curl's process arguments. Run the command only once.
- With `RECALL_API_KEY`, Connect sends the Create Bot request on the server.
  Stop Meet voice also asks that bot to leave through Recall's documented API.
  The application never retries a potentially non-idempotent bot creation.

## Access and lifetime

Only a logged-in operator with an exact same-origin POST can prepare a bot.
Each prepared connection reserves the single active voice slot and creates a
random 256-bit, five-minute, single-use capability in the webpage URL fragment.
Fragments are not included in HTTP URLs or Referer headers. The page removes it
from browser history and exchanges it in a POST body for a separate Secure,
HttpOnly, SameSite=Strict cookie. Only hashes of capabilities/cookies are kept.
This cookie authorizes `/meet/voice`, not the operator session or another bot.
Cookies and tickets cannot be supplied in WebSocket URLs. Exact-origin checks,
one active transport, bounded queues and existing provider error redaction apply.

Voice access ends 15 minutes after activation, on Stop, on socket closure or on
server restart. Closing the operator's page or signing out does not disconnect
the independent bot. The operator can sign back in to stop it. In manual mode,
Stop ends the voice connection; remove the participant in Meet to immediately
end the bot's visit. Recall is also configured to exit after 15 minutes if live
capture has not started, 120 seconds in a waiting room, or 120 seconds alone. Its exit
can take a few additional seconds. These are separate timers, not an absolute
end-to-end runtime guarantee. A new conversation needs a fresh connection.

## Audio and privacy

The bot request sets `recording_config: { "retention": null }`. This is Recall's
Zero Data Retention mode: live capture remains active for the Output Media
microphone, but recording media is processed in memory without storage on Recall.
Setting `recording_config` itself to `null` disables capture and is incompatible
with interactive Output Media; it can leave a bot speaking its greeting without
hearing subsequent questions. Do not replace the explicit zero-retention object
with `null` or omit retention (which would apply normal storage defaults).
No Recall transcription or separate participant-event stream is configured.
The app does not persist audio, meeting URLs, transcripts or participant data.
Only bounded runtime state needed for the live session is kept in memory.
Meeting audio is processed by OpenAI and Surabhi reply text by ElevenLabs.
Provider processing policies still apply. Let participants know Sajida is AI
before starting. The host's waiting-room and meeting rules still apply.

## Validation and live acceptance

Offline checks cover HTTP/cookie separation, ticket replay and expiry, exact
origin, valid Meet URLs, bounded duplicate starts, operator logout independence,
shutdown/Stop, optional Create/Leave calls, zero retention in both launch paths,
secret redaction and a greeting followed by a user turn and second reply through
the real local WebSocket path and provider doubles. Client checks cover the
explicit operator action, automatic bot-page startup, GA readiness and cleanup.
These checks do not prove Recall's live microphone/autoplay behavior or voice
quality. No paid provider calls are made by the automated tests.
The additional local Chromium check could not run because this workspace denies
Chromium's process-singleton socket; browser-level acceptance remains pending.

Live acceptance still requires the operator to launch a fresh test bot, admit
Sajida, hear the opening AI greeting, speak and receive a relevant response,
interrupt her, check that she does not hear herself, and stop the connection.
Confirm that the bot uses the intended signed-in account and `retention: null`.
Recall can show recording/status metadata in ZDR mode; this does not mean media
is stored. The existing Render free instance can cold-start; a deploy or restart
revokes all in-memory connections.

## Voice failure diagnostics

The relay records safe provider classifications and the session stage. A
`conversation` stage means OpenAI already acknowledged the session configuration;
an invalid request at that point does not establish a startup-settings failure.
For future errors, the relay correlates OpenAI's `error.event_id` with a bounded
in-memory map and logs only a reviewed operation name such as
`conversation.item.delete`. Request contents, provider messages and event IDs are
not logged. The last eight audio requests and 64 control requests have separate
correlation maps, so continuous PCM cannot evict control operations. Each request
has a unique event ID. Both maps are cleared when the connection closes.

Surabhi playback cancellation is idempotent for each reply. Repeated VAD starts
before a new reply must not return the same interrupted record for another
history deletion. A stateful regression test rejects duplicate deletions and
verifies that a later reply still emits audio.

Official OpenAI references: [client events](https://developers.openai.com/api/reference/resources/realtime/client-events)
for history deletion semantics, and [server events](https://developers.openai.com/api/reference/resources/realtime/server-events)
for error-event correlation. Automated tests use local provider doubles; a fresh
live voice test is still needed to confirm the reported production failure is resolved.

## Authoritative implementation references

Recall MCP v1.11 docs fetched for this change:

- `stream-media` — Output Media camera webpage, automatic meeting microphone,
  output conversion and self-audio exclusion (updated 2026-11-05).
- `google-meet-login-getting-started` — signed-in Google Login Group on Create
  Bot and identity verification (updated 2026-11-11).
- `bot_create` — POST `/api/v1/bot/`, output media and recording configuration.
- `zero-data-retention` — `recording_config.retention: null`, in-memory processing
  and the explicit warning that `recording_config: null` does not work with
  Output Media (updated 2026-11-12).
- `storage-and-playback` — explicit recording-media retention and the scope of
  separately retained operational metadata (updated 2026-11-12).
- `automatic-leaving-behavior` — non-recording/waiting-room/alone limits.
- `bot_leave_call_create` — POST `/api/v1/bot/{id}/leave_call/`.

Official OpenAI documentation: https://developers.openai.com/api/docs/guides/realtime-conversations
Recall guide: https://docs.recall.ai/docs/stream-media
