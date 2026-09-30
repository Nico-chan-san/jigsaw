import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Engine } from '../lib/engine.js'
import { navigate, store, useApp } from '../App.jsx'
import { Fit, Hand, Help as HelpIcon, Layers, Minus, Picture, Plus, Rooms } from '../components/icons.jsx'
import Help from '../components/Help.jsx'
import Settings from '../components/Settings.jsx'
import { AccountButton } from '../components/AccountDialog.jsx'
import Players, { rankPlayers } from '../components/Players.jsx'
import Podium, { PodiumIcon } from '../components/Podium.jsx'
import Reactions from '../components/Reactions.jsx'
import Timers from '../components/Timers.jsx'
import Celebration from '../components/Celebration.jsx'
import { useLinger } from '../lib/linger.js'
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

function Sidebar({ engine, roomId, groups, notes, refs, open, ready, nameOf }) {
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
          <button
            key={n.id}
            className="side-note"
            onClick={() => engine.focusNote(n.id)}
            title={n.author ? `Note by ${nameOf(n.author)}` : 'Note'}
          >
            <span className="side-note-text">{n.text.trim() || 'Empty note'}</span>
            {n.author && <span className="side-note-by">{nameOf(n.author)}</span>}
          </button>
        ))}
      </Section>
      <Section title="Images" count={refs.length} empty="No images yet">
        {refs.map((r) => (
          <button key={r.id} onClick={() => engine.focusRef(r.id)} title={r.author ? `Image added by ${nameOf(r.author)}` : 'Image'}>
            <img src={api.imageUrl(roomId)} alt="" draggable={false} />
          </button>
        ))}
      </Section>
    </aside>
  )
}

// A shortcut key shown in the corner of the button it belongs to.
const KeyHint = ({ k }) => (
  <span className="kbd-hint" aria-hidden="true">
    {k}
  </span>
)

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
  const { name, player, playerId, theme, ensureName, requireName, setDialog } = useApp()
  const me = useRef(playerId)
  me.current = playerId
  const sockRef = useRef(null)
  // Player names by id. Names aren't unique, so everything is stored by player id and looked up here.
  const names = useRef(new Map())
  const [, setNamesVer] = useState(0)
  const learn = useCallback((list) => {
    for (const p of list || []) if (p?.id) names.current.set(p.id, String(p.name || '').slice(0, 32))
    setNamesVer((v) => v + 1)
  }, [])
  const nameOf = useCallback((pid) => (pid ? names.current.get(pid) || 'Someone' : ''), [])
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
  // Player ids in the room right now, and when the others were last here.
  const [online, setOnline] = useState(() => new Set())
  const [seen, setSeen] = useState({})
  const [players, setPlayers] = useState(() => store.get('players') === '1')
  // Shown automatically the first time this player opens each jigsaw.
  const [help, setHelp] = useState(() => !store.get(`help:${id}`))
  const [helpShown, helpClosing] = useLinger(help)
  const closeHelp = useCallback(() => {
    store.set(`help:${id}`, '1')
    setHelp(false)
  }, [id])
  const onTimes = useCallback((t) => setTimes(t), [])
  const onNotes = useCallback((n) => setNotes(n), [])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [side, setSide] = useState(() => store.get('side') === '1')
  // View mode: dragging with the left button (or a finger) moves the table, never pieces or notes.
  const [panMode, setPanMode] = useState(() => store.get('panMode') === '1')
  const [podium, setPodium] = useState(false)
  const closePodium = useCallback(() => setPodium(false), [])
  const [podiumShown, podiumClosing] = useLinger(podium)
  const [party, setParty] = useState(false)
  // After the celebration, bring up the podium.
  const endParty = useCallback(() => {
    setParty(false)
    setPodium(true)
  }, [])

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
          user: playerId,
          userName: name,
          nameOf,
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
          onComplete: () => {
            setDone(true)
            // Celebrate once per player and jigsaw, whoever placed the last piece.
            if (store.get(`celebrated:${id}`)) return
            store.set(`celebrated:${id}`, '1')
            setParty(true)
          },
        })
        learn(room.players)
        setOnline(new Set(room.online || []))
        setSeen(room.seen || {})
        eng.setColors(readColors())
        setGroups(eng.groups())
        setRefs(eng.refs.map((r) => ({ id: r.id, author: r.author })))
        setStats(eng.contributors())
        setDone(eng.isComplete())
        // Already finished before this player opened it: nothing left to celebrate.
        if (eng.isComplete()) store.set(`celebrated:${id}`, '1')
        setData({ notes: room.notes || [], times: room.times || [], private: !!room.private, owner: room.owner })
        setEngine(eng)
        sock = sockRef.current = api.socket(id, {
          player: () => me.current,
          onMessage: (msg) => {
            if (msg.type === 'deleted') {
              if (store.get('lastRoom') === id) store.set('lastRoom', null)
              navigate('/rooms')
            }
            else if (msg.type === 'player') {
              learn([msg.player])
              eng.invalidate()
            } else if (msg.type === 'presence') {
              setOnline(new Set(msg.online || []))
              setSeen((s) => ({ ...s, ...msg.seen }))
            } else if (msg.type === 'time') timeBus.current?.(msg)
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
            learn(fresh.players)
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
      sockRef.current = null
      eng?.destroy()
    }
  }, [id])

  // Logging in, out or renaming: act as the new player from here on, and tell the room.
  useEffect(() => {
    if (playerId) learn([{ id: playerId, name }])
    if (!engine) return
    engine.user = playerId
    engine.userName = name
    engine.invalidate()
  }, [engine, playerId, name, learn])
  useEffect(() => {
    if (engine) sockRef.current?.send({ type: 'hello', player: playerId })
  }, [engine, playerId])
  // Opening a private jigsaw's link (or logging in while here) adds it to this player's list.
  useEffect(() => {
    if (data?.private && player?.passphrase) api.join(id, player.passphrase).catch(() => {})
  }, [id, data?.private, player?.passphrase])

  useEffect(() => {
    engine?.setColors(readColors())
  }, [engine, theme])

  useEffect(() => {
    store.set('side', side ? '1' : '0')
  }, [side])

  useEffect(() => {
    store.set('panMode', panMode ? '1' : '0')
    if (!engine) return
    engine.panMode = panMode
    engine.canvas.style.cursor = panMode ? 'grab' : ''
    engine.setHighlight(null)
  }, [engine, panMode])

  useEffect(() => {
    store.set('players', players ? '1' : '0')
  }, [players])

  useEffect(() => {
    if (error) navigate('/rooms')
  }, [error])

  // H help, V view mode, M side menu (modules, notes, images), P players, N note, I image, + and - zoom, C centres. Arrow keys and WASD pan (see the engine). New notes and images go under the pointer when it's on the table.
  useEffect(() => {
    if (!engine) return
    const key = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return
      // While holding pieces, G gathers them (see the engine), and dialogs keep the keyboard.
      if (engine.drag || document.querySelector('.modal-bg')) return
      const r = engine.canvas.getBoundingClientRect()
      const p = engine.pointerAt
      const el = p && document.elementFromPoint(p[0] + r.left, p[1] + r.top)
      const over = el && !el.closest('.float, .side, .players') ? p : null
      const k = e.key.toLowerCase()
      if (k === 'h') setHelp(true)
      else if (k === 'v') setPanMode((v) => !v)
      else if (k === 'm') setSide((s) => !s)
      else if (k === 'p') setPlayers((s) => !s)
      else if (k === 'n') createNote.current?.(over ? over[0] + r.left : null, over ? over[1] + r.top : null)
      else if (k === 'i') (over ? engine.addRef(...over) : engine.addRef())
      else if (k === '+' || k === '=') engine.zoomBy(1.4)
      else if (k === '-' || k === '_') engine.zoomBy(1 / 1.4)
      else if (k === 'c') engine.fit()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [engine])

  return (
    <div className={`room${panMode ? ' pan-mode' : ''}`}>
      <canvas ref={canvas} className="board" tabIndex={0} />
      <div ref={tip} className="tip" />
      {!engine && (
        <div className="center">
          <span className="spin" />
        </div>
      )}
      <div className="float tl">
        <button className="icon-btn" onClick={() => setDialog('rooms')} aria-label="All jigsaws" title="All jigsaws">
          <Rooms />
        </button>
        <button
          className={`icon-btn${side ? ' on' : ''}`}
          onClick={() => setSide((s) => !s)}
          aria-label="Overview"
          aria-keyshortcuts="M"
          title="Groups, notes and images (M)"
        >
          <Layers />
          <KeyHint k="M" />
        </button>
      </div>
      {engine && (
        <div className="float tc">
          <button
            className={`icon-btn view-btn${panMode ? ' on' : ''}`}
            onClick={() => setPanMode((v) => !v)}
            aria-pressed={panMode}
            aria-label="View mode"
            aria-keyshortcuts="V"
            title={panMode ? 'View mode on: dragging moves the table (V)' : 'View mode: drag to move the table (V)'}
          >
            <Hand />
            <KeyHint k="V" />
          </button>
          <Reactions engine={engine} busRef={reactBus} hint={<KeyHint k="R" />} />
          <span className="sep" />
          <button
            className={`stats-btn${players ? ' on' : ''}`}
            onClick={() => setPlayers((s) => !s)}
            aria-pressed={players}
            aria-keyshortcuts="P"
            title={players ? 'Hide players (P)' : 'Show players (P)'}
          >
            <Timers roomId={id} me={playerId} initial={data.times} busRef={timeBus} stopped={done} onTimes={onTimes} />
            <KeyHint k="P" />
          </button>
          <span className="sep" />
          <NoteButton createRef={createNote} hint={<KeyHint k="N" />} />
          <button
            className="icon-btn"
            onClick={() => engine.addRef()}
            aria-label="Reference image"
            aria-keyshortcuts="I"
            title="Add the reference image to the board (I)"
          >
            <Picture />
            <KeyHint k="I" />
          </button>
        </div>
      )}
      {engine && (
        <NotesLayer
          engine={engine}
          roomId={id}
          me={playerId}
          nameOf={nameOf}
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
        <button
          className="icon-btn"
          onClick={() => setHelp(true)}
          aria-label="How to play"
          aria-keyshortcuts="H"
          title="How to play (H)"
        >
          <HelpIcon />
          <KeyHint k="H" />
        </button>
        <AccountButton />
        <Settings privateRoom={!!data?.private} />
      </div>
      {helpShown && <Help onClose={closeHelp} closing={helpClosing} />}
      {party && <Celebration onDone={endParty} />}
      {engine && done && (
        <button className="podium-btn" onClick={() => setPodium(true)} aria-label="Podium" title="Top players">
          <PodiumIcon />
        </button>
      )}
      {podiumShown && (
        <Podium
          ranked={rankPlayers({ stats, times, notes, nameOf })}
          closing={podiumClosing}
          onClose={closePodium}
        />
      )}
      <div className="float br">
        <button
          className="icon-btn"
          onClick={() => engine?.zoomBy(1 / 1.4)}
          aria-label="Zoom out"
          aria-keyshortcuts="-"
          title="Zoom out (-)"
        >
          <Minus />
          <KeyHint k="-" />
        </button>
        <button className="icon-btn" onClick={() => engine?.fit()} aria-label="Fit" aria-keyshortcuts="C" title="Fit to screen (C)">
          <Fit />
          <KeyHint k="C" />
        </button>
        <button
          className="icon-btn"
          onClick={() => engine?.zoomBy(1.4)}
          aria-label="Zoom in"
          aria-keyshortcuts="+"
          title="Zoom in (+)"
        >
          <Plus />
          <KeyHint k="+" />
        </button>
      </div>
      {engine && (
        <Sidebar engine={engine} roomId={id} groups={groups} notes={notes} refs={refs} open={side} ready={ready} nameOf={nameOf} />
      )}
      {engine && <Players open={players} stats={stats} times={times} notes={notes} me={playerId} owner={data?.owner} nameOf={nameOf} online={online} seen={seen} />}
    </div>
  )
}
