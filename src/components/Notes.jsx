import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Close, Note as NoteIcon } from './icons.jsx'
import PlaceButton from './PlaceButton.jsx'

// Note size, in units of the jigsaw's piece size.
const NOTE_W = 2.6

// Live note drags are sent at most this often (ms).
const LIVE_MS = 33

// Note text size range, in piece size units. Text is as big as fits, shrinking as it grows.
const FONT_MAX = 0.8
const FONT_MIN = 0.1

// Sets the largest font size at which the text fits the text area, without scrolling or words
// running over the edge. At the smallest size, long words may break so nothing is ever hidden.
function fitText(el, unit) {
  const fits = (f) => {
    el.style.fontSize = `${f * unit}px`
    return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1
  }
  el.style.overflowWrap = 'normal'
  let lo = FONT_MIN
  let hi = FONT_MAX
  if (fits(hi)) return
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  if (!fits(lo)) el.style.overflowWrap = 'anywhere'
}

function Note({ note, engine, focus, selected, canEdit, author, ensureName, onChange, onSave, onLive, onDelete }) {
  const area = useRef(null)
  const saveTimer = useRef(0)

  useEffect(() => {
    if (focus) area.current?.focus()
  }, [focus])

  const unit = engine.geo.S
  useLayoutEffect(() => {
    if (area.current) fitText(area.current, unit)
  }, [note.text, unit])

  // Drag anywhere on the note to move it; a click without moving starts editing.
  // While editing, the text area behaves normally and the note's rim still drags.
  const startMove = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return
    if (e.target === area.current && document.activeElement === area.current) return
    e.preventDefault()
    if (!ensureName()) return
    // Shift-click adds the note to the selection; dragging a selected note carries the whole selection.
    if (e.shiftKey) return engine.toggleNote(note.id)
    if (selected && engine.selCount > 1) return engine.grabSelection(e, { note: note.id })
    if (engine.selCount && !selected) engine.setSelection(new Set())
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
      className={`note${selected ? ' sel' : ''}`}
      style={{ left: note.x, top: note.y }}
      data-note={note.id}
      onPointerMove={(e) => {
        if (e.buttons) return engine.showTip(null)
        const r = engine.canvas.getBoundingClientRect()
        engine.showTip({ text: author, sx: e.clientX - r.left, sy: e.clientY - r.top })
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

export function NotesLayer({ engine, roomId, me, nameOf, initial, busRef, createRef, onNotes, ensureName, requireName }) {
  const [notes, setNotes] = useState(initial)
  const [focusId, setFocusId] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const layer = useRef(null)
  const latest = useRef(notes)
  latest.current = notes
  const S = engine.geo.S

  useEffect(() => {
    onNotes?.(notes)
  }, [notes, onNotes])

  useEffect(() => {
    const el = layer.current
    const off = engine.addView((cam, vw, vh) => {
      el.style.transform = `translate(${vw / 2 - cam.x * cam.z}px, ${vh / 2 - cam.y * cam.z}px) scale(${cam.z})`
    })
    const wheel = (e) => engine.h.wheel(e)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      off()
      el.removeEventListener('wheel', wheel)
    }
  }, [engine])

  // Lets the engine select notes with the selection box and carry them along with a drag.
  useEffect(() => {
    engine.notes = {
      get: () =>
        latest.current.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          w: NOTE_W * S,
          h: layer.current?.querySelector(`[data-note="${n.id}"]`)?.offsetHeight || S,
        })),
      // send: null moves locally only, 'live' also relays, 'save' also stores.
      move: (list, send) => {
        const at = new Map(list.map((p) => [p.id, p]))
        setNotes((ns) => ns.map((n) => (at.has(n.id) ? { ...n, x: at.get(n.id).x, y: at.get(n.id).y } : n)))
        if (!send) return
        for (const n of latest.current) {
          const p = at.get(n.id)
          if (p) api.saveNote(roomId, { ...n, x: p.x, y: p.y }, send === 'live')
        }
      },
      select: (ids) => setSelected(new Set(ids)),
      remove: (ids) => {
        const gone = new Set(ids)
        setNotes((ns) => ns.filter((n) => !gone.has(n.id)))
        for (const id of gone) api.deleteNote(roomId, id)
      },
      focus: (id) => {
        const a = layer.current?.querySelector(`[data-note="${id}"] textarea`)
        if (!a) return
        a.focus()
        a.setSelectionRange(a.value.length, a.value.length)
      },
    }
    return () => (engine.notes = null)
  }, [engine, roomId, S])

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
    if (engine.selNotes.has(id)) engine.toggleNote(id)
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
          selected={selected.has(n.id)}
          canEdit={!!me}
          author={nameOf(n.author)}
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
export function NoteButton({ createRef, hint }) {
  return (
    <PlaceButton
      onPlace={(x, y) => createRef.current?.(x, y)}
      ghost="note-ghost"
      label="Note"
      shortcut="N"
      title="Drag a note onto the board (N)"
    >
      <NoteIcon />
      {hint}
    </PlaceButton>
  )
}
