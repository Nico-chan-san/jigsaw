import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Engine } from '../lib/engine.js'
import { ThemeButton, navigate, store, useApp } from '../App.jsx'
import { Back, Fit, GitHub, Help as HelpIcon, Layers, Minus, Picture, Plus } from '../components/icons.jsx'
import Help from '../components/Help.jsx'
import Players from '../components/Players.jsx'
import Reactions from '../components/Reactions.jsx'
import Timers from '../components/Timers.jsx'
import { NoteButton, NotesLayer } from '../components/Notes.jsx'

function Thumb({ engine, g, stamp }) {
  const ref = useRef(null)
  useEffect(() => {
    engine.thumb(g, ref.current, 150)
  }, [engine, g, stamp])
  return <canvas ref={ref} />
}

function Section({ title, count, empty, children }) {
  return (
    <section>
      <h2>
        {title}
        <span className="n">{count}</span>
      </h2>
      {count ? children : <p className="side-empty">{empty}</p>}
    </section>
  )
}

function Sidebar({ engine, roomId, groups, notes, refs, open, ready }) {
  return (
    <aside className={`side${open ? ' open' : ''}`}>
      <Section title="Groups" count={groups.length} empty="No pieces">
        {groups.map((grp) => (
          <button key={grp.g} onClick={() => engine.focusGroup(grp.g)} title={`${grp.size} pieces`}>
            <Thumb engine={engine} g={grp.g} stamp={`${grp.key}:${ready}`} />
            <span className="n">{grp.size}</span>
          </button>
        ))}
      </Section>
      <Section title="Notes" count={notes.length} empty="No notes yet">
        {notes.map((n) => (
          <button key={n.id} className="side-note" onClick={() => engine.focusNote(n.id)} title={n.author ? `Note by ${n.author}` : 'Note'}>
            <span className="side-note-text">{n.text.trim() || 'Empty note'}</span>
            {n.author && <span className="side-note-by">{n.author}</span>}
          </button>
        ))}
      </Section>
      <Section title="Images" count={refs.length} empty="No images yet">
        {refs.map((r) => (
          <button key={r.id} onClick={() => engine.focusRef(r.id)} title={r.author ? `Image added by ${r.author}` : 'Image'}>
            <img src={api.imageUrl(roomId)} alt="" draggable={false} />
          </button>
        ))}
      </Section>
    </aside>
  )
}

function readColors() {
  const s = getComputedStyle(document.documentElement)
  return {
    bg: s.getPropertyValue('--canvas').trim(),
    dot: s.getPropertyValue('--dot').trim(),
    shadow: s.getPropertyValue('--shadow').trim(),
    line: s.getPropertyValue('--fg').trim(),
    sel: s.getPropertyValue('--sel').trim(),
  }
}

// Reference images used to be kept per browser; these get uploaded to the room once.
function takeLocalRefs(id) {
  try {
    const list = JSON.parse(store.get(`refs:${id}`))
    store.set(`refs:${id}`, null)
    return Array.isArray(list) ? list.filter((r) => r && r.id && r.w > 0) : []
  } catch {
    return []
  }
}

export default function Room({ id }) {
  const { name, theme, ensureName, requireName } = useApp()
  const canvas = useRef(null)
  const tip = useRef(null)
  const cursors = useRef(null)
  const [engine, setEngine] = useState(null)
  const [data, setData] = useState(null)
  const [done, setDone] = useState(false)
  const timeBus = useRef(null)
  const noteBus = useRef(null)
  const reactBus = useRef(null)
  const createNote = useRef(null)
  const [groups, setGroups] = useState([])
  const [stats, setStats] = useState(() => new Map())
  const [times, setTimes] = useState({})
  const [notes, setNotes] = useState([])
  const [refs, setRefs] = useState([])
  const [players, setPlayers] = useState(() => store.get('players') === '1')
  // Shown automatically the first time this player opens each jigsaw.
  const [help, setHelp] = useState(() => !store.get(`help:${id}`))
  const closeHelp = useCallback(() => {
    store.set(`help:${id}`, '1')
    setHelp(false)
  }, [id])
  const onTimes = useCallback((t) => setTimes(t), [])
  const onNotes = useCallback((n) => setNotes(n), [])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [side, setSide] = useState(() => store.get('side') === '1')

  useEffect(() => {
    let dead = false
    let eng = null
    let sock = null
    ;(async () => {
      try {
        const room = await api.room(id)
        const image = new Image()
        image.src = api.imageUrl(id)
        await image.decode()
        if (dead) return
        store.set('lastRoom', id)
        eng = new Engine(canvas.current, {
          room,
          image,
          pieces: room.pieces,
          refs: room.refs || [],
          overlay: cursors.current,
          user: name,
          guard: ensureName,
          tooltip: tip.current,
          send: (msg) => sock?.send(msg),
          onRef: (ref, live) => api.saveRef(id, ref, live),
          onRefDelete: (refId) => api.deleteRef(id, refId),
          onRefs: (list) => setRefs(list.map((r) => ({ id: r.id, author: r.author }))),
          onGroups: (g) => {
            setGroups(g)
            setStats(eng.contributors())
          },
          onReady: () => setReady(true),
          onComplete: () => setDone(true),
        })
        eng.setColors(readColors())
        setGroups(eng.groups())
        setRefs(eng.refs.map((r) => ({ id: r.id, author: r.author })))
        setStats(eng.contributors())
        setDone(eng.isComplete())
        setData({ notes: room.notes || [], times: room.times || [] })
        setEngine(eng)
        sock = api.socket(id, {
          onMessage: (msg) => {
            if (msg.type === 'deleted') navigate('/rooms')
            else if (msg.type === 'time') timeBus.current?.(msg)
            else if (msg.type === 'note' || msg.type === 'note-delete') noteBus.current?.(msg)
            else if (msg.type === 'react') reactBus.current?.(msg)
            else if (msg.type === 'ref') eng.remoteRef(msg.ref)
            else if (msg.type === 'ref-delete') eng.removeRef(msg.id, true)
            else eng.remoteMessage(msg)
          },
          onOpen: async (reconnect) => {
            if (!reconnect) return
            const fresh = await api.room(id).catch(() => null)
            if (!fresh || dead) return
            eng.resync(fresh.pieces)
            eng.setRefs(fresh.refs || [])
            noteBus.current?.({ type: 'notes-reset', notes: fresh.notes || [] })
          },
        })
        for (const ref of takeLocalRefs(id)) {
          eng.remoteRef(ref)
          api.saveRef(id, ref)
        }
      } catch {
        if (!dead) {
          if (store.get('lastRoom') === id) store.set('lastRoom', null)
          setError(true)
        }
      }
    })()
    return () => {
      dead = true
      sock?.close()
      eng?.destroy()
    }
  }, [id])

  useEffect(() => {
    if (engine) engine.user = name
  }, [engine, name])

  useEffect(() => {
    engine?.setColors(readColors())
  }, [engine, theme])

  useEffect(() => {
    store.set('side', side ? '1' : '0')
  }, [side])

  useEffect(() => {
    store.set('players', players ? '1' : '0')
  }, [players])

  useEffect(() => {
    if (error) navigate('/rooms')
  }, [error])

  return (
    <div className="room">
      <canvas ref={canvas} className="board" tabIndex={0} />
      <div ref={tip} className="tip" />
      {!engine && (
        <div className="center">
          <span className="spin" />
        </div>
      )}
      <div className="float tl">
        <button className="icon-btn" onClick={() => navigate('/rooms')} aria-label="Back" title="Back to all jigsaws">
          <Back />
        </button>
      </div>
      <div className="float tl2">
        <button className={`icon-btn${side ? ' on' : ''}`} onClick={() => setSide((s) => !s)} aria-label="Overview" title="Groups, notes and images">
          <Layers />
        </button>
      </div>
      {engine && (
        <div className="float tc">
          <Reactions engine={engine} busRef={reactBus} />
          <span className="sep" />
          <button
            className={`stats-btn${players ? ' on' : ''}`}
            onClick={() => setPlayers((s) => !s)}
            aria-pressed={players}
            title={players ? 'Hide players' : 'Show players'}
          >
            <Timers roomId={id} name={name} initial={data.times} busRef={timeBus} stopped={done} onTimes={onTimes} />
          </button>
          <span className="sep" />
          <NoteButton createRef={createNote} />
          <button
            className="icon-btn"
            onClick={() => engine.addRef()}
            aria-label="Reference image"
            title="Add the reference image to the board"
          >
            <Picture />
          </button>
        </div>
      )}
      {engine && (
        <NotesLayer
          engine={engine}
          roomId={id}
          name={name}
          initial={data.notes}
          busRef={noteBus}
          ensureName={ensureName}
          requireName={requireName}
          createRef={createNote}
          onNotes={onNotes}
        />
      )}
      <canvas ref={cursors} className="cursors" />
      <div className="float tr">
        <button className="icon-btn" onClick={() => setHelp(true)} aria-label="How to play" title="How to play">
          <HelpIcon />
        </button>
        <a
          className="icon-btn"
          href="https://github.com/mebn/jigsaw"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          title="GitHub"
        >
          <GitHub />
        </a>
        <ThemeButton />
      </div>
      {help && <Help onClose={closeHelp} />}
      <div className="float br">
        <button className="icon-btn" onClick={() => engine?.zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
          <Minus />
        </button>
        <button className="icon-btn" onClick={() => engine?.fit()} aria-label="Fit" title="Fit to screen">
          <Fit />
        </button>
        <button className="icon-btn" onClick={() => engine?.zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
          <Plus />
        </button>
      </div>
      {engine && (
        <Sidebar engine={engine} roomId={id} groups={groups} notes={notes} refs={refs} open={side} ready={ready} />
      )}
      {engine && <Players open={players} stats={stats} times={times} notes={notes} me={name} />}
    </div>
  )
}
