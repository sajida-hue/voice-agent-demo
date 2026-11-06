# Draft: migrate Sajida's Node/browser audio path to Realtime GA

Base: main
Head: sajida-ai-development
Status: partial implementation; not ready to merge or deploy.

The browser and Node relay depended on the obsolete Realtime Beta SDK. Use
the GA WebSocket wire protocol, nested PCM audio settings, and
response.output_audio.delta events instead. Initialize the session before
starting microphone streaming and the greeting. Handle interruption with
playback offsets and conversation.item.truncate.

The relay bounds pending audio and outbound backpressure, times out upstream
startup, closes paired connections on failure, and avoids logging raw events
or upstream exception details. The browser releases audio resources on failure
and unmount, and no longer renders the relay URL or its token.

## Validation

- Node relay: 10 offline tests pass (GA handshake, queue ordering, audio
  forwarding, malformed events, queue limit, failure redaction, timeout,
  backpressure).
- Client: TypeScript/Vite production build passes.
- Client: ESLint passes with one existing unused-disable warning in wav_recorder.js.
- node --check node-server/index.js and git diff --check pass.
- No live OpenAI API call, Recall API call, deployment, or meeting was started.
- Browser audio behavior has not been verified end to end.

## Remaining work — merge blockers

- Connect the regional Recall.ai MCP mandated by AGENTS.md. No Recall MCP
  tools or documents were available, so Recall request fields and bot behavior
  have deliberately not been changed or claimed as validated.
- Replace the inherited static query-token authorization with scoped,
  short-lived authorization; implement verified webhook handling as appropriate
  after consulting Recall MCP.
- Implement and test current Recall Output Media integration and explicit
  operator-confirmed test bot creation. No test bot has been created.
- Supply a Google Meet test URL and explicit join approval before any live test.
- Migrate or retire the Python server, which still uses the legacy protocol
  and must not be deployed.
- Add cloud deployment packaging and perform a confirmed end-to-end test.
- Repository write access is now available. This file records the draft review
  scope; the actual PR status is tracked on GitHub.

## OpenAI references

- https://developers.openai.com/api/reference/resources/realtime/client-events
- https://developers.openai.com/api/docs/guides/realtime-conversations

No credentials were added. Keep provider keys server-side in deployment secrets.
Do not merge this draft until the security and Recall blockers are resolved.
