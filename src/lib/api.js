export const clientId = Math.random().toString(36).slice(2)

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
  moves: (id, pieces, live = false) =>
    fetch(`/api/rooms/${id}/moves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: clientId, live, pieces }),
      keepalive: !live && pieces.length < 400,
    }).catch(() => {}),
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
  saveNote: (id, note) =>
    fetch(`/api/rooms/${id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: clientId, ...note }),
      keepalive: true,
    }).catch(() => {}),
  deleteNote: (id, noteId) =>
    fetch(`/api/rooms/${id}/notes/${noteId}?client=${clientId}`, { method: 'DELETE' }).catch(() => {}),
  events: (id, onMessage) => {
    const es = new EventSource(`/api/rooms/${id}/events`)
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.client !== clientId) onMessage(msg)
    }
    return () => es.close()
  },
}
