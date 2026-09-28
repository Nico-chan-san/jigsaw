export const clientId = Math.random().toString(36).slice(2)

// Open room sockets, by room id.
const sockets = new Map()
// Messages that only matter while they're fresh; everything else is queued while offline.
const transient = (msg) => msg.live || msg.type === 'live' || msg.type === 'grab' || msg.type === 'cursor'

async function json(res) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
}

export const api = {
  rooms: () => fetch('/api/rooms').then(json),
  room: (id) => fetch(`/api/rooms/${id}`).then(json),
  imageUrl: (id) => `/api/rooms/${id}/image`,
  create: (body) =>
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json),
  remove: (id) => fetch(`/api/rooms/${id}`, { method: 'DELETE' }).then(json),
  time: (id, user, seconds, beacon = false) => {
    const body = JSON.stringify({ client: clientId, user, seconds })
    if (beacon && navigator.sendBeacon) return navigator.sendBeacon(`/api/rooms/${id}/time`, body)
    return fetch(`/api/rooms/${id}/time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  },
  // Notes and reference images go over the room socket; live=true is a drag in progress (not saved).
  saveNote: (id, note, live = false) => sockets.get(id)?.send({ type: 'note', live, note }),
  deleteNote: (id, noteId) => sockets.get(id)?.send({ type: 'note-delete', id: noteId }),
  saveRef: (id, ref, live = false) => sockets.get(id)?.send({ type: 'ref', live, ref }),
  deleteRef: (id, refId) => sockets.get(id)?.send({ type: 'ref-delete', id: refId }),
  // Live room channel. Reconnects on its own; onOpen(reconnect) fires on every connect.
  // Changes made while disconnected are queued and sent once the socket is back.
  socket: (id, { onMessage, onOpen }) => {
    let ws = null
    let dead = false
    let retry = 0
    let timer = 0
    let opened = false
    const queue = []
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const open = () => {
      ws = new WebSocket(`${proto}//${location.host}/api/ws?room=${id}&client=${clientId}`)
      ws.onopen = () => {
        retry = 0
        for (const msg of queue.splice(0)) ws.send(JSON.stringify(msg))
        onOpen?.(opened)
        opened = true
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.client !== clientId) onMessage(msg)
      }
      ws.onclose = () => {
        if (dead) return
        timer = setTimeout(open, Math.min(5000, 300 * 2 ** retry++))
      }
    }
    open()
    const handle = {
      send: (msg) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
        else if (!transient(msg)) queue.push(msg)
      },
      close: () => {
        dead = true
        clearTimeout(timer)
        ws?.close()
        if (sockets.get(id) === handle) sockets.delete(id)
      },
    }
    sockets.set(id, handle)
    return handle
  },
}
