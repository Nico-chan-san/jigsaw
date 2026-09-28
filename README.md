# Jigsaw

A multiplayer jigsaw puzzle app. The frontend is React, built with Vite. The backend is a small JSON and WebSocket API backed by SQLite, which runs as a Vite plugin (`server/api.js`), so there is no separate backend process to start.

## Requirements

- Node.js 22.13 or newer (the server uses the built-in `node:sqlite` module)
- npm

## Running the server

Install dependencies first:

```sh
npm install
```

### Development

```sh
npm run dev
```

Starts the Vite dev server with hot reload at http://localhost:5173. The `--host` flag is set, so it is also reachable from other devices on your network.

### Production

```sh
npm run start
```

Builds the app into `dist/` and serves it with `vite preview` at http://localhost:4173, also listening on all network interfaces.

To use a different port, pass it after `--`, for example `npm run dev -- --port 3000`.

## Data

- The SQLite database lives at `data/puzzle.db` and is created automatically on first start. The `data/` directory is git ignored.
- The API is served under `/api`, with the WebSocket endpoint at `/api/ws`.
- Schema migrations in `server/migrations/` run automatically, in order, each time the server starts. See `AGENTS.md` for the rules on adding migrations.
