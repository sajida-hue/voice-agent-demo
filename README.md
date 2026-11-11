# Sajida — AI design voice assistant

This development branch prepares a **private browser voice pilot** using OpenAI
Realtime GA. The client and authenticated WebSocket share one Node/Render origin.
The existing main deployment is separate and has not been updated.

## Run and deploy

Use [the Render/browser setup guide](docs/RENDER_BROWSER_SETUP.md) for exact
environment variables, build/start commands, security limits and the live test
checklist. Use Node 22 LTS or a newer supported LTS.

- Sign in with a private access password; the browser receives a 15-minute session.
- Start conversation explicitly enables the microphone and paid OpenAI connection.
- End conversation releases audio devices; Sign out also revokes the session.
- English is the default. The requested style is soft, warm, calm and unhurried.
- Marin is the initial voice; Cedar and Coral are available between conversations.
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

## Recall meeting integration: still pending

Recall.ai MCP is connected and was queried for the authorized region. This change
does not create bots, join meetings, configure webhooks or implement meeting media.
The new human login is for the browser pilot; unattended Recall media will need
separate narrowly scoped, short-lived authorization. Do not put the operator's
password or a session cookie into a Recall webpage URL.

The previous meeting quickstart is not applicable to this authenticated pilot.
The Python implementation remains legacy and must not be deployed for this work.

## Acknowledgements

The original Recall.ai demo incorporates code from
[OpenAI's realtime console](https://github.com/openai/openai-realtime-console)
under the MIT License. [Original demo video](https://www.loom.com/share/2a02fac2643441c1990da861e829892c).

