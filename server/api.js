// Vite plugin that exposes a small JSON/WebSocket API backed by SQLite (node:sqlite).
// Runs inside the Vite dev/preview server, so no separate backend process is needed.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { attachWebSocket } from './ws.js'
import { WORDS } from './words.js'

function openDb(file) {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created INTEGER NOT NULL,
      cols INTEGER NOT NULL,
      rows INTEGER NOT NULL,
      shape TEXT NOT NULL,
      seed INTEGER NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      image BLOB NOT NULL,
      image_type TEXT NOT NULL,
      thumb TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pieces (
      room_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      r INTEGER NOT NULL,
      g INTEGER NOT NULL,
      by TEXT,
      PRIMARY KEY (room_id, idx)
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL,
      created INTEGER NOT NULL,
      PRIMARY KEY (room_id, id)
    );
    CREATE TABLE IF NOT EXISTS times (
      room_id TEXT NOT NULL,
      user TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (room_id, user)
    );
  `)
  migrate(db)
  return db
}

// Applies server/migrations/NNN-name.sql files in order, once each, tracked with PRAGMA user_version.
// The CREATE statements above are the baseline schema and must not change; add a migration instead.
function migrate(db) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  let files = []
  try {
    files = readdirSync(dir).filter((f) => /^\d+-.+\.sql$/.test(f))
  } catch {
    return
  }
  files.sort((a, b) => parseInt(a) - parseInt(b))
  const current = db.prepare('PRAGMA user_version').get().user_version
  for (const f of files) {
    const v = parseInt(f)
    if (v <= current) continue
    db.exec('BEGIN')
    try {
      db.exec(readFileSync(join(dir, f), 'utf8'))
      db.exec(`PRAGMA user_version = ${v}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`migration ${f} failed: ${e.message}`)
    }
  }
}

function readJson(req, limit = 40 * 1024 * 1024) {
  return new Promise((ok, fail) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        fail(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        fail(e)
      }
    })
    req.on('error', fail)
  })
}

// Passphrases are compared case and spacing blind: "Otter  maple-moon Jolly" is "otter maple moon jolly".
const normalize = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter(Boolean).join(' ')
const hashSecret = (s) => createHash('sha256').update(normalize(s)).digest('hex')
const cleanName = (s) => String(s || '').trim().slice(0, 32)

// The machine's first network address, so a phone on the same network can open the app.
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function createApi(dbFile) {
  const db = openDb(dbFile)
  const sockets = new Map() // roomId -> Set<ws>

  const q = {
    list: db.prepare(`
      SELECT r.id, r.name, r.created, r.cols, r.rows, r.shape, r.thumb, r.owner,
             COUNT(p.idx) AS n, COUNT(DISTINCT p.g) AS groups,
             (SELECT COALESCE(SUM(t.seconds), 0) FROM times t WHERE t.room_id = r.id) AS seconds
      FROM rooms r LEFT JOIN pieces p ON p.room_id = r.id
      GROUP BY r.id ORDER BY r.created DESC`),
    room: db.prepare(
      'SELECT id, name, created, cols, rows, shape, seed, width, height, annoying, owner FROM rooms WHERE id = ?',
    ),
    image: db.prepare('SELECT image, image_type FROM rooms WHERE id = ?'),
    pieces: db.prepare('SELECT idx AS i, x, y, r, g, by, f FROM pieces WHERE room_id = ? ORDER BY idx'),
    insertRoom: db.prepare(`
      INSERT INTO rooms (id, name, created, cols, rows, shape, seed, width, height, image, image_type, thumb, annoying, owner)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertPiece: db.prepare(
      'INSERT INTO pieces (room_id, idx, x, y, r, g, by, f) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    updatePiece: db.prepare(
      'UPDATE pieces SET x = ?, y = ?, r = ?, g = ?, by = COALESCE(?, by), f = COALESCE(?, f) WHERE room_id = ? AND idx = ?',
    ),
    deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
    deletePieces: db.prepare('DELETE FROM pieces WHERE room_id = ?'),
    notes: db.prepare('SELECT id, x, y, text, author, created FROM notes WHERE room_id = ? ORDER BY created'),
    upsertNote: db.prepare(`
      INSERT INTO notes (id, room_id, x, y, text, author, created) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (room_id, id) DO UPDATE SET x = excluded.x, y = excluded.y, text = excluded.text`),
    note: db.prepare('SELECT id, x, y, text, author, created FROM notes WHERE room_id = ? AND id = ?'),
    deleteNote: db.prepare('DELETE FROM notes WHERE room_id = ? AND id = ?'),
    deleteNotes: db.prepare('DELETE FROM notes WHERE room_id = ?'),
    times: db.prepare('SELECT user, seconds FROM times WHERE room_id = ?'),
    addTime: db.prepare(`
      INSERT INTO times (room_id, user, seconds) VALUES (?, ?, ?)
      ON CONFLICT (room_id, user) DO UPDATE SET seconds = seconds + excluded.seconds
      RETURNING seconds`),
    deleteTimes: db.prepare('DELETE FROM times WHERE room_id = ?'),
    refs: db.prepare('SELECT id, x, y, w, author, created FROM refs WHERE room_id = ? ORDER BY created'),
    upsertRef: db.prepare(`
      INSERT INTO refs (id, room_id, x, y, w, author, created) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (room_id, id) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w`),
    ref: db.prepare('SELECT id, x, y, w, author, created FROM refs WHERE room_id = ? AND id = ?'),
    deleteRef: db.prepare('DELETE FROM refs WHERE room_id = ? AND id = ?'),
    deleteRefs: db.prepare('DELETE FROM refs WHERE room_id = ?'),
    player: db.prepare('SELECT id, name FROM players WHERE id = ?'),
    playerBySecret: db.prepare('SELECT id, name FROM players WHERE secret = ?'),
    unclaimed: db.prepare('SELECT id, name FROM players WHERE name = ? AND secret IS NULL ORDER BY created LIMIT 1'),
    secretTaken: db.prepare('SELECT 1 FROM players WHERE secret = ?'),
    named: db.prepare('SELECT 1 FROM players WHERE name = ? LIMIT 1'),
    insertPlayer: db.prepare('INSERT INTO players (id, name, secret, created) VALUES (?, ?, ?, ?)'),
    setSecret: db.prepare('UPDATE players SET secret = ? WHERE id = ?'),
    renamePlayer: db.prepare('UPDATE players SET name = ? WHERE secret = ? RETURNING id, name'),
    // Everyone who has left a mark on a room, so their names can be shown.
    roomPlayers: db.prepare(`
      SELECT id, name FROM players WHERE id IN (
        SELECT "by" FROM pieces WHERE room_id = ?1
        UNION SELECT author FROM notes WHERE room_id = ?1
        UNION SELECT author FROM refs WHERE room_id = ?1
        UNION SELECT user FROM times WHERE room_id = ?1
      )`),
  }

  // A fresh passphrase of four words that no other player has.
  function newSecret() {
    for (;;) {
      const words = Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join(' ')
      if (!q.secretTaken.get(hashSecret(words))) return words
    }
  }

  function createPlayer(name) {
    const id = randomBytes(8).toString('hex')
    const passphrase = newSecret()
    q.insertPlayer.run(id, name, hashSecret(passphrase), Date.now())
    return { id, name, passphrase }
  }

  // Failed logins per address, to keep passphrases from being guessed: ip -> { n, t }.
  const failures = new Map()
  const LOGIN_TRIES = 20
  const LOGIN_WINDOW = 10 * 60 * 1000
  const blocked = (ip) => {
    const f = failures.get(ip)
    if (f && Date.now() - f.t > LOGIN_WINDOW) failures.delete(ip)
    return (failures.get(ip)?.n || 0) >= LOGIN_TRIES
  }
  const failed = (ip) => {
    const f = failures.get(ip) || { n: 0, t: Date.now() }
    f.n++
    failures.set(ip, f)
  }

  function tx(fn) {
    db.exec('BEGIN')
    try {
      fn()
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  function broadcast(roomId, msg, except) {
    const set = sockets.get(roomId)
    if (!set) return
    const data = JSON.stringify(msg)
    for (const ws of set) if (ws !== except) ws.send(data)
  }

  // Only real player ids are stored as authors; anything else (such as a name sent by a page from
  // before players) is dropped.
  const playerId = (v) => (v && q.player.get(String(v)) ? String(v) : null)

  function saveMoves(roomId, pieces) {
    const known = new Map()
    const by = (v) => {
      if (v == null) return null
      if (!known.has(v)) known.set(v, playerId(v))
      return known.get(v)
    }
    tx(() => {
      for (const p of pieces) {
        p.by = by(p.by)
        q.updatePiece.run(p.x, p.y, p.r, p.g, p.by, p.f == null ? null : p.f ? 1 : 0, roomId, p.i)
      }
    })
  }

  const cleanNote = (b) => ({
    id: String(b?.id || '').slice(0, 40),
    x: +b?.x || 0,
    y: +b?.y || 0,
    text: String(b?.text || '').slice(0, 2000),
    author: String(b?.author || '').slice(0, 32),
  })
  const cleanRef = (b) => ({
    id: String(b?.id || '').slice(0, 40),
    x: +b?.x || 0,
    y: +b?.y || 0,
    w: Math.max(1, +b?.w || 0),
    author: String(b?.author || '').slice(0, 32),
  })

  // Notes and reference images: live=true only relays (while dragging), otherwise it's saved.
  function putNote(roomId, b, live) {
    const n = cleanNote(b)
    if (!n.id) return null
    if (live) return { ...n, created: +b.created || 0 }
    n.author = playerId(n.author) || ''
    q.upsertNote.run(n.id, roomId, n.x, n.y, n.text, n.author, Date.now())
    return q.note.get(roomId, n.id)
  }
  function putRef(roomId, b, live) {
    const r = cleanRef(b)
    if (!r.id) return null
    if (live) return { ...r, created: +b.created || 0 }
    r.author = playerId(r.author) || ''
    q.upsertRef.run(r.id, roomId, r.x, r.y, r.w, r.author, Date.now())
    return q.ref.get(roomId, r.id)
  }

  // One socket per open room. Live drag messages ("grab", "live") are only relayed;
  // "moves" are the final positions after a drop and get persisted.
  function connect(ws, url) {
    const roomId = url.searchParams.get('room') || ''
    const client = url.searchParams.get('client') || ''
    if (!q.room.get(roomId)) return ws.closed()
    if (!sockets.has(roomId)) sockets.set(roomId, new Set())
    sockets.get(roomId).add(ws)
    // Tell the room who just arrived, so their name shows on whatever they do.
    const player = q.player.get(url.searchParams.get('player') || '')
    ws.player = player || null
    if (player) broadcast(roomId, { type: 'player', client, player: { id: player.id, name: player.name } }, ws)
    ws.handler = (text) => {
      try {
        handle(JSON.parse(text))
      } catch {}
    }
    const handle = (m) => {
      // The player on this socket logged in, out or signed up.
      if (m.type === 'hello') {
        const p = q.player.get(String(m.player || ''))
        ws.player = p || null
        if (p) broadcast(roomId, { type: 'player', client, player: { id: p.id, name: p.name } }, ws)
      } else if (m.type === 'moves' && Array.isArray(m.pieces)) {
        saveMoves(roomId, m.pieces)
        broadcast(roomId, { type: 'moves', client, pieces: m.pieces }, ws)
      } else if (m.type === 'grab' || m.type === 'live' || m.type === 'cursor') {
        broadcast(roomId, { ...m, client }, ws)
      } else if (m.type === 'react' && isFinite(m.x) && isFinite(m.y)) {
        broadcast(roomId, { type: 'react', client, kind: String(m.kind || '').slice(0, 16), x: +m.x, y: +m.y }, ws)
      } else if (m.type === 'note' || m.type === 'ref') {
        const item = (m.type === 'note' ? putNote : putRef)(roomId, m[m.type], !!m.live)
        if (item) broadcast(roomId, { type: m.type, client, live: !!m.live, [m.type]: item }, ws)
      } else if (m.type === 'note-delete' || m.type === 'ref-delete') {
        const id = String(m.id || '')
        ;(m.type === 'note-delete' ? q.deleteNote : q.deleteRef).run(roomId, id)
        broadcast(roomId, { type: m.type, client, id }, ws)
      }
    }
    ws.onclose = () => {
      sockets.get(roomId)?.delete(ws)
      broadcast(roomId, { type: 'gone', client })
    }
  }

  const middleware = async function middleware(req, res, next) {
    const url = new URL(req.url, 'http://x')
    if (!url.pathname.startsWith('/api/')) return next()
    const parts = url.pathname.slice(5).split('/').filter(Boolean)

    try {
      // /api/image?url=... fetches a remote image server side, avoiding CORS-tainted canvases.
      if (parts[0] === 'image' && req.method === 'GET') {
        const target = url.searchParams.get('url') || ''
        if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'bad url' })
        const r = await fetch(target, {
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'Mozilla/5.0 (jigsaw image fetch)', Accept: 'image/*' },
        })
        const type = r.headers.get('content-type') || ''
        if (!r.ok || !type.startsWith('image/')) return send(res, 400, { error: 'not an image' })
        const buf = Buffer.from(await r.arrayBuffer())
        if (buf.length > 40 * 1024 * 1024) return send(res, 400, { error: 'too large' })
        res.setHeader('Content-Type', type)
        return res.end(buf)
      }

      // /api/lan: where phones on the same network can reach this server.
      if (parts[0] === 'lan' && req.method === 'GET') return send(res, 200, { address: lanAddress() })

      // /api/players: sign up with a name, log in with a passphrase, rename.
      if (parts[0] === 'players' && req.method === 'POST') {
        const b = await readJson(req, 64 * 1024)
        if (parts.length === 1) {
          const name = cleanName(b.name)
          if (!name) return send(res, 400, { error: 'name required' })
          return send(res, 200, createPlayer(name))
        }
        // Browsers from before passphrases only know a name: the first to ask gets the player made
        // for that name. Once it has a passphrase, other browsers with the name must log in with it
        // (409), so one person's devices don't split into separate players.
        if (parts[1] === 'claim') {
          const name = cleanName(b.name)
          if (!name) return send(res, 400, { error: 'name required' })
          const old = q.unclaimed.get(name)
          if (!old) {
            if (q.named.get(name)) return send(res, 409, { error: 'taken' })
            return send(res, 200, createPlayer(name))
          }
          const passphrase = newSecret()
          q.setSecret.run(hashSecret(passphrase), old.id)
          return send(res, 200, { id: old.id, name: old.name, passphrase })
        }
        if (parts[1] === 'login') {
          const ip = req.socket.remoteAddress || ''
          if (blocked(ip)) return send(res, 429, { error: 'too many tries, wait a few minutes' })
          const p = normalize(b.passphrase) && q.playerBySecret.get(hashSecret(b.passphrase))
          if (!p) {
            failed(ip)
            return send(res, 404, { error: 'unknown passphrase' })
          }
          return send(res, 200, { ...p, passphrase: normalize(b.passphrase) })
        }
        if (parts[1] === 'rename') {
          const name = cleanName(b.name)
          if (!name) return send(res, 400, { error: 'name required' })
          const p = q.renamePlayer.get(name, hashSecret(b.passphrase))
          if (!p) return send(res, 404, { error: 'unknown passphrase' })
          for (const [roomId, set] of sockets) {
            for (const ws of set) if (ws.player?.id === p.id) ws.player = p
            broadcast(roomId, { type: 'player', player: p })
          }
          return send(res, 200, p)
        }
        return send(res, 404, { error: 'not found' })
      }

      // /api/rooms
      if (parts[0] !== 'rooms') return send(res, 404, { error: 'not found' })

      if (parts.length === 1) {
        if (req.method === 'GET') {
          const rows = q.list.all().map((r) => ({
            ...r,
            progress: r.n > 1 ? (r.n - r.groups) / (r.n - 1) : 0,
            done: r.n > 0 && r.groups === 1,
          }))
          return send(res, 200, rows)
        }
        if (req.method === 'POST') {
          const b = await readJson(req)
          const m = /^data:([^;]+);base64,(.*)$/s.exec(b.image || '')
          if (!m || !Array.isArray(b.pieces) || !b.pieces.length) {
            return send(res, 400, { error: 'bad request' })
          }
          // The creator proves who they are with their passphrase, and becomes the owner.
          const owner = b.passphrase ? q.playerBySecret.get(hashSecret(b.passphrase)) : null
          if (!owner) return send(res, 403, { error: 'log in to create a jigsaw' })
          const id = randomUUID().slice(0, 8)
          tx(() => {
            q.insertRoom.run(
              id,
              String(b.name || 'Jigsaw').slice(0, 80),
              Date.now(),
              b.cols | 0,
              b.rows | 0,
              String(b.shape),
              b.seed | 0,
              +b.width,
              +b.height,
              Buffer.from(m[2], 'base64'),
              m[1],
              String(b.thumb || ''),
              b.annoying ? 1 : 0,
              owner.id,
            )
            for (const p of b.pieces) q.insertPiece.run(id, p.i, p.x, p.y, p.r, p.g, null, p.f ? 1 : 0)
          })
          return send(res, 200, { id })
        }
      }

      const id = parts[1]
      const room = q.room.get(id)
      if (!room) return send(res, 404, { error: 'not found' })

      if (parts.length === 2) {
        if (req.method === 'GET') {
          const players = new Map(q.roomPlayers.all(id).map((p) => [p.id, p]))
          for (const ws of sockets.get(id) || []) if (ws.player) players.set(ws.player.id, ws.player)
          return send(res, 200, {
            ...room,
            pieces: q.pieces.all(id),
            notes: q.notes.all(id),
            refs: q.refs.all(id),
            times: q.times.all(id),
            players: [...players.values()],
          })
        }
        if (req.method === 'DELETE') {
          // Only the player who created the jigsaw may delete it; old jigsaws have no owner.
          const b = await readJson(req, 64 * 1024)
          const who = b.passphrase ? q.playerBySecret.get(hashSecret(b.passphrase)) : null
          if (!room.owner || !who || who.id !== room.owner) {
            return send(res, 403, { error: 'only the player who made this jigsaw can delete it' })
          }
          tx(() => {
            q.deletePieces.run(id)
            q.deleteNotes.run(id)
            q.deleteRefs.run(id)
            q.deleteTimes.run(id)
            q.deleteRoom.run(id)
          })
          broadcast(id, { type: 'deleted' })
          return send(res, 200, { ok: true })
        }
      }

      if (parts[2] === 'image' && req.method === 'GET') {
        const img = q.image.get(id)
        res.setHeader('Content-Type', img.image_type)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        return res.end(Buffer.from(img.image))
      }

      if (parts[2] === 'time' && req.method === 'POST') {
        const b = await readJson(req)
        const user = playerId(b.user)
        const secs = Math.max(0, Math.min(300, Math.round(+b.seconds || 0)))
        if (!user || !secs) return send(res, 200, { ok: true })
        const { seconds } = q.addTime.get(id, user, secs)
        broadcast(id, { type: 'time', client: b.client, user, seconds })
        return send(res, 200, { seconds })
      }

      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 500, { error: String(e.message || e) })
    }
  }

  return { middleware, connect }
}

export default function sqliteApi(options = {}) {
  const file = resolve(options.file || 'data/puzzle.db')
  let api
  const mount = (server) => {
    api ??= createApi(file)
    server.middlewares.use(api.middleware)
    if (server.httpServer) attachWebSocket(server.httpServer, '/api/ws', api.connect)
  }
  return {
    name: 'sqlite-api',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}
