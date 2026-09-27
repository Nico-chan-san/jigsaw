import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Engine } from '../lib/engine.js'
import { ThemeButton, navigate, store, useApp } from '../App.jsx'
import { Fit, Help as HelpIcon, Layers, Minus, Plus, Rooms, Users } from '../components/icons.jsx'
import Help from '../components/Help.jsx'
import Players from '../components/Players.jsx'
import Timers from '../components/Timers.jsx'
import { NoteButton, NotesLayer } from '../components/Notes.jsx'

function Thumb({ engine, g, stamp }) {
  const ref = useRef(null)
  useEffect(() => {
    engine.thumb(g, ref.current, 150)
  }, [engine, g, stamp])
  return <canvas ref={ref} />
}

function Sidebar({ engine, groups, open, ready }) {
  return (
    <aside className={`side${open ? ' open' : ''}`}>
      {groups.map((grp) => (
        <button key={grp.g} onClick={() => engine.focusGroup(grp.g)} title={`${grp.size} pieces`}>
          <Thumb engine={engine} g={grp.g} stamp={`${grp.key}:${ready}`} />
          <span className="n">{grp.size}</span>
        </button>
      ))}
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
  }
}

export default function Room({ id }) {
  const { name, theme, ensureName, requireName } = useApp()
  const canvas = useRef(null)
  const tip = useRef(null)
  const [engine, setEngine] = useState(null)
  const [data, setData] = useState(null)
  const [done, setDone] = useState(false)
  const timeBus = useRef(null)
  const noteBus = useRef(null)
  const createNote = useRef(null)
  const [groups, setGroups] = useState([])
  const [stats, setStats] = useState(() => new Map())
  const [times, setTimes] = useState({})
  const [notes, setNotes] = useState([])
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
    let stop = null
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
          user: name,
          guard: ensureName,
          tooltip: tip.current,
          send: (pieces, live) => api.moves(id, pieces, live),
          onGroups: (g) => {
            setGroups(g)
            setStats(eng.contributors())
          },
          onReady: () => setReady(true),
          onComplete: () => setDone(true),
        })
        eng.setColors(readColors())
        setGroups(eng.groups())
        setStats(eng.contributors())
        setDone(eng.isComplete())
        setData({ notes: room.notes || [], times: room.times || [] })
        setEngine(eng)
        stop = api.events(id, (msg) => {
          if (msg.type === 'deleted') navigate('/rooms')
          else if (msg.type === 'time') timeBus.current?.(msg)
          else if (msg.type === 'note' || msg.type === 'note-delete') noteBus.current?.(msg)
          else if (msg.pieces) eng.applyRemote(msg.pieces, msg.type === 'live')
        })
      } catch {
        if (!dead) {
          if (store.get('lastRoom') === id) store.set('lastRoom', null)
          setError(true)
        }
      }
    })()
    return () => {
      dead = true
      stop?.()
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
        <button className="icon-btn" onClick={() => navigate('/rooms')} aria-label="Rooms" title="All jigsaw puzzles">
          <Rooms />
        </button>
        <button className={`icon-btn${side ? ' on' : ''}`} onClick={() => setSide((s) => !s)} aria-label="Groups" title="Groups">
          <Layers />
        </button>
        <button
          className={`icon-btn${players ? ' on' : ''}`}
          onClick={() => setPlayers((s) => !s)}
          aria-label="Players"
          title="Players"
        >
          <Users />
        </button>
      </div>
      {engine && (
        <div className="float tc">
          <Timers roomId={id} name={name} initial={data.times} busRef={timeBus} stopped={done} onTimes={onTimes} />
          <span className="sep" />
          <NoteButton createRef={createNote} />
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
      <div className="float tr">
        <button className="icon-btn" onClick={() => setHelp(true)} aria-label="How to play" title="How to play">
          <HelpIcon />
        </button>
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
      {engine && <Sidebar engine={engine} groups={groups} open={side} ready={ready} />}
      {engine && <Players open={players} stats={stats} times={times} notes={notes} me={name} />}
    </div>
  )
}
