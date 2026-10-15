# nightwire

`nightwire` is a local WebSocket debugger written in TypeScript.

It connects to any `ws://` or `wss://` endpoint and opens a local dashboard for inspecting, filtering, sending, recording and replaying WebSocket frames.

## Features

- live incoming and outgoing frames
- JSON / text / binary classification
- full payload inspector
- payload and direction filters
- manual message sending
- replay of captured text / JSON frames
- automatic reconnect with exponential backoff
- manual reconnect and disconnect
- native WebSocket ping / pong latency
- custom request headers
- WebSocket subprotocols
- JSONL session recording
- local web dashboard
- Server-Sent Events for the dashboard stream
- no database
- Node.js 20+

## Quick start

```bash
npm install
npm run build
node dist/cli.js ws://localhost:9001
```

Open:

```text
http://127.0.0.1:7331
```

## Demo WebSocket server

```bash
npx tsx examples/echo-server.ts
```

Then in another terminal:

```bash
npm run dev -- ws://localhost:9001
```

## Authentication

```bash
nightwire wss://api.example.com/socket \
  --header "Authorization: Bearer TOKEN"
```

Multiple headers are supported. Do not commit real credentials.

## Recording

```bash
nightwire ws://localhost:9001 \
  --record sessions/debug.jsonl
```

Each captured frame is appended as one JSON object per line.

## Session replay

Recorded JSONL sessions can be replayed directly from the dashboard.

Enter a local file such as:

```text
sessions/debug.jsonl
```

Then choose a speed:

```text
0.5x   1x   2x   5x
```

Nightwire preserves the original delay between recorded frames and scales it by the selected speed. Outgoing frames are the default because that is the usual way to reproduce a client scenario. Incoming-only and both-directions modes are also available for diagnostics.

Binary frames are skipped in this version, and a running replay can be cancelled from the dashboard.

## Reconnect

Automatic reconnect is enabled by default. The delay grows exponentially from 500ms up to 10 seconds.

Disable it:

```bash
nightwire ws://localhost:9001 --no-reconnect
```

## Latency

Nightwire sends native WebSocket ping frames every 5 seconds and measures pong latency.

Disable checks:

```bash
nightwire ws://localhost:9001 --ping-interval 0
```

## CLI

```text
nightwire <url>

-p, --port <number>
--host <host>
-H, --header <header...>
--protocol <protocol...>
--no-reconnect
--reconnect-delay <ms>
--max-reconnect-delay <ms>
--ping-interval <ms>
--record <file>
--max-frames <number>
```

## Architecture

```text
remote WebSocket
       |
       v
  Nightwire core
       |
       +-- frame capture
       +-- ping / pong
       +-- reconnect
       +-- JSONL recorder
       +-- replay
       |
       v
 local HTTP server
       |
       +-- REST actions
       +-- Server-Sent Events
       |
       v
 browser dashboard
```

The dashboard never connects directly to the remote WebSocket. The TypeScript process owns the connection, so custom headers and backend-only endpoints work normally.

## Privacy

Nightwire is local-first. Frames are kept in memory unless `--record` is supplied. Recorded WebSocket payloads can contain secrets or personal data, so inspect JSONL files before sharing them.

## Project structure

```text
nightwire/
├── src/
│   ├── core/
│   │   ├── nightwire.ts
│   │   ├── recorder.ts
│   │   └── types.ts
│   ├── dashboard/
│   │   └── html.ts
│   ├── cli.ts
│   └── server.ts
├── examples/
│   └── echo-server.ts
├── tests/
│   └── package.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
