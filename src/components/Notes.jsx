import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api.js'
import { Close, Note as NoteIcon } from './icons.jsx'

// Note size, in units of the jigsaw's piece size.
const NOTE_W = 2.6

// Live note drags are sent at most this often (ms).
const LIVE_MS = 33

function Note({ note, engine, focus, canEdit, ensureName, onChange, onSave, onLive, onDelete }) {
  const area = useRef(null)
  const saveTimer = useRef(0)

  useEffect(() => {
    if (focus) area.current?.focus()
  }, [focus])

  // Drag anywhere on the note to move it; a click without moving starts editing.
  // While editing, the text area behaves normally and the note's rim still drags.
  const startMove = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return
    if (e.target === area.current && document.activeElement === area.current) return
    e.preventDefault()
    if (!ensureName()) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const start = { sx: e.clientX, sy: e.clientY, x: note.x, y: note.y }
    let pos = null
    let last = 0
    let timer = 0
    const live = () => {
      last = performance.now()
      onLive({ ...note, ...pos })
    }
    const move = (ev) => {
      if (!pos && Math.hypot(ev.clientX - start.sx, ev.clientY - start.sy) < 4) return
      pos = {
        x: start.x + (ev.clientX - start.sx) / engine.cam.z,
        y: start.y + (ev.clientY - start.sy) / engine.cam.z,
      }
      onChange(note.id, pos)
      clearTimeout(timer)
      const wait = LIVE_MS - (performance.now() - last)
      if (wait <= 0) live()
      else timer = setTimeout(live, wait)
    }
    const up = () => {
      clearTimeout(timer)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (pos) return onSave({ ...note, ...pos })
      const a = area.current
      a.focus()
      a.setSelectionRange(a.value.length, a.value.length)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const edit = (e) => {
    const text = e.target.value
    onChange(note.id, { text })
    onLive({ ...note, text })
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onSave({ ...note, text }), 400)
  }

  return (
    <div
      className="note"
      style={{ left: note.x, top: note.y }}
      data-note={note.id}
      onPointerMove={(e) => {
        if (e.buttons) return engine.showTip(null)
        const r = engine.canvas.getBoundingClientRect()
        engine.showTip({ text: note.author, sx: e.clientX - r.left, sy: e.clientY - r.top })
      }}
      onPointerLeave={() => engine.showTip(null)}
      onPointerDown={startMove}
    >
      <button
        className="note-del"
        onClick={() => ensureName() && onDelete(note.id)}
        aria-label="Delete note"
        title="Delete note"
      >
        <Close />
      </button>
      <textarea
        ref={area}
        readOnly={!canEdit}
        value={note.text}
        onChange={edit}
        onBlur={() => {
          clearTimeout(saveTimer.current)
          onSave(note)
        }}
        spellCheck={false}
        maxLength={2000}
        aria-label="Note"
      />
    </div>
  )
}

export function NotesLayer({ engine, roomId, name, initial, busRef, createRef, onNotes, ensureName, requireName }) {
  const [notes, setNotes] = useState(initial)
  const [focusId, setFocusId] = useState(null)
  const layer = useRef(null)
  const S = engine.geo.S

  useEffect(() => {
    onNotes?.(notes)
  }, [notes, onNotes])

  useEffect(() => {
    const el = layer.current
    engine.onView = (cam, vw, vh) => {
      el.style.transform = `translate(${vw / 2 - cam.x * cam.z}px, ${vh / 2 - cam.y * cam.z}px) scale(${cam.z})`
    }
    engine.invalidate()
    const wheel = (e) => engine.h.wheel(e)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      engine.onView = null
      el.removeEventListener('wheel', wheel)
    }
  }, [engine])

  useEffect(() => {
    busRef.current = (msg) => {
      if (msg.type === 'note-delete') return setNotes((ns) => ns.filter((n) => n.id !== msg.id))
      if (msg.type === 'notes-reset') {
        // Keep the text of a note that's being edited right now.
        const editing = document.activeElement?.closest?.('[data-note]')?.dataset.note
        return setNotes((ns) =>
          msg.notes.map((n) => (n.id === editing ? { ...n, text: ns.find((o) => o.id === n.id)?.text ?? n.text } : n)),
        )
      }
      const incoming = msg.note
      setNotes((ns) => {
        const editing = document.activeElement?.closest?.(`[data-note="${incoming.id}"]`)
        const i = ns.findIndex((n) => n.id === incoming.id)
        if (i < 0) return [...ns, incoming]
        const next = [...ns]
        next[i] = editing ? { ...incoming, text: ns[i].text } : incoming
        return next
      })
    }
    return () => (busRef.current = null)
  }, [busRef])

  useEffect(() => {
    createRef.current = async (clientX, clientY) => {
      const rect = engine.canvas.getBoundingClientRect()
      const sx = clientX == null ? rect.width / 2 : clientX - rect.left
      const sy = clientY == null ? rect.height / 2 : clientY - rect.top
      const [wx, wy] = engine.toWorld(sx, sy)
      const author = await requireName()
      if (!author) return
      const note = {
        id: Math.random().toString(36).slice(2, 10),
        x: wx - (NOTE_W * S) / 2,
        y: wy - S * 0.2,
        text: '',
        author,
        created: Date.now(),
      }
      setNotes((ns) => [...ns, note])
      setFocusId(note.id)
      api.saveNote(roomId, note)
    }
    return () => (createRef.current = null)
  }, [engine, roomId, S, createRef, requireName])

  const change = (id, patch) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)))
  const save = (note) => api.saveNote(roomId, note)
  const live = (note) => api.saveNote(roomId, note, true)
  const remove = (id) => {
    setNotes((ns) => ns.filter((n) => n.id !== id))
    api.deleteNote(roomId, id)
  }

  return (
    <div ref={layer} className="notes" style={{ '--u': `${S}px`, '--nw': NOTE_W }}>
      {notes.map((n) => (
        <Note
          key={n.id}
          note={n}
          engine={engine}
          focus={focusId === n.id}
          canEdit={!!name}
          ensureName={ensureName}
          onChange={change}
          onSave={save}
          onLive={live}
          onDelete={remove}
        />
      ))}
    </div>
  )
}

// Header button: drag it onto the board to drop a note there, or click to drop one in the centre.
export function NoteButton({ createRef }) {
  const [ghost, setGhost] = useState(null)

  const down = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = [e.clientX, e.clientY]
    let moved = false
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 4) moved = true
      if (moved) setGhost([ev.clientX, ev.clientY])
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setGhost(null)
      if (!moved) return createRef.current?.(null, null)
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      if (el && !el.closest('.float, .side')) createRef.current?.(ev.clientX, ev.clientY)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      <button className="icon-btn" onPointerDown={down} aria-label="Note" title="Drag a note onto the board">
        <NoteIcon />
      </button>
      {ghost &&
        createPortal(
          <div className="note-ghost" style={{ transform: `translate(${ghost[0]}px, ${ghost[1]}px)` }} />,
          document.body,
        )}
    </>
  )
}
