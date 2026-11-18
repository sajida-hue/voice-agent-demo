# Sajida — AI design voice assistant

This development branch provides a **private voice pilot for the browser and
Google Meet** using OpenAI Realtime GA with optional ElevenLabs speech. The client
and authenticated WebSocket share one Node/Render origin.

## Run and deploy

Use [the Render/browser setup guide](docs/RENDER_BROWSER_SETUP.md) for exact
environment variables, build/start commands, security limits and the live test
checklist. Use Node 22 LTS or a newer supported LTS.

- Sign in with a private access password; the browser receives a 15-minute session.
- Start conversation explicitly enables the microphone and paid provider connections.
- End conversation releases audio devices; Sign out also revokes the session.
- English is the default. The requested style is soft, warm, calm and unhurried.
- When the server has an ElevenLabs key, Surabhi (warm Indian English) is the
  initial voice. Marin, Cedar and Coral remain available between conversations.
- Surabhi — Expressive (preview) is an explicit choice for conversational pauses,
  small hesitations and vocal reactions through Eleven v4 Turbo dialogue streaming.
  Test it with Start conversation before sending the selected voice to Meet.
  Availability, voice compatibility and usage rates depend on the ElevenLabs account.
- For Surabhi, microphone audio goes to OpenAI and generated reply text goes to
  ElevenLabs. Both credentials stay on the server. The app saves neither speech
  nor transcripts; provider account data policies still apply.
- No permanent tokens, API keys, or relay addresses belong in page URLs.

## Offline validation

```sh
npm ci --prefix node-server
npm test --prefix node-server
npm ci --prefix client
npm test --prefix client
npm run build --prefix client
npm run lint --prefix client
```

Server tests use local HTTP/WebSocket connections and no provider credentials.
Client tests use a simulated DOM, microphone and transport. They do not establish
real voice quality, browser autoplay behavior or meeting compatibility.

## Google Meet voice

Use [the Meet voice setup guide](docs/MEET_VOICE_SETUP.md). Connect prepares a
signed-in Recall bot whose Output Media webpage automatically listens and speaks
in the call. A separate one-use capability authorizes the bot; the operator's
password and provider keys are never put in webpage URLs. Recall live capture uses
explicit Zero Data Retention, so meeting media is processed without storage on
Recall. The voice connection is limited to 15 minutes for this pilot.

Without a server Recall key, run the prepared Terminal command and enter the
current Recall key locally. With a server key, the app sends the bot directly.
This feature does not add Gmail/Calendar access. Live conversation quality and
Recall microphone/autoplay behavior still require the acceptance test in the guide.
The Python implementation remains legacy and must not be deployed for this work.

## Acknowledgements

The original Recall.ai demo incorporates code from
[OpenAI's realtime console](https://github.com/openai/openai-realtime-console)
under the MIT License. [Original demo video](https://www.loom.com/share/2a02fac2643441c1990da861e829892c).

