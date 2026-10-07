import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Engine } from '../lib/engine.js'
import { navigate, store, useApp } from '../App.jsx'
import {
  ExitFullscreen,
  Fit,
  Fullscreen,
  Hand,
  Help as HelpIcon,
  Minus,
  Picture,
  Plus,
  Redo,
  Rooms,
  Share,
  Check,
  Undo,
} from '../components/icons.jsx'
import Help from '../components/Help.jsx'
import Settings from '../components/Settings.jsx'
import Players, { rankPlayers } from '../components/Players.jsx'
import Podium, { PodiumIcon } from '../components/Podium.jsx'
import Reactions from '../components/Reactions.jsx'
import Timers from '../components/Timers.jsx'
import Celebration from '../components/Celebration.jsx'
import Spectate from '../components/Spectate.jsx'
import DevMenu from '../components/DevMenu.jsx'
import { useLinger } from '../lib/linger.js'
import { NoteButton, NotesLayer } from '../components/Notes.jsx'
import ContextMenu from '../components/ContextMenu.jsx'
import { TrayButton } from '../components/Trays.jsx'
import { renderShare, shareImage } from '../lib/share.js'
import { playSnap } from '../lib/sound.js'
import { canFullscreen, fullscreenEl, toggleFullscreen, useFullscreen, useNotch } from '../lib/fullscreen.js'

// A shortcut key shown in the corner of the button it belongs to.
const KeyHint = ({ k }) => (
  <span className="kbd-hint" aria-hidden="true">
    {k}
  </span>
)

// Undo and redo shortcuts as the platform writes them.
const MAC = /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = MAC ? '⌘' : 'Ctrl+'
const REDO_KEY = MAC ? '⇧Z' : 'Y'

// The controls fade away after this long without the pointer moving or a key being pressed.
const IDLE_MS = 3000

// True once nothing has happened for IDLE_MS. Stays false while the pointer is over the controls,
// a menu or dialog is open, or the last input was touch (a tap on a hidden button would reach the
// table instead).
function useIdle() {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = 0
    let over = false
    let touch = false
    const busy = () => over || touch || document.querySelector('.modal-bg, .settings-menu, .float :focus-visible')
    const sleep = () => (busy() ? (timer = setTimeout(sleep, IDLE_MS)) : setIdle(true))
    const wake = (e) => {
      if (e.type !== 'keydown') over = !!e.target?.closest?.('.float, .players, .podium-btn, .share-btn')
      if (e.pointerType) touch = e.pointerType === 'touch'
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(sleep, IDLE_MS)
    }
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown']
    for (const ev of events) window.addEventListener(ev, wake, { capture: true, passive: true })
    timer = setTimeout(sleep, IDLE_MS)
    return () => {
      clearTimeout(timer)
      for (const ev of events) window.removeEventListener(ev, wake, { capture: true, passive: true })
    }
  }, [])
  return idle
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
  const { name, player, playerId, theme, ensureName, requireName, setDialog, devMenu, spectate } = useApp()
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
  const [stats, setStats] = useState(() => new Map())
  const [times, setTimes] = useState({})
  const [notes, setNotes] = useState([])
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
  const fullscreen = useFullscreen()
  const notch = useNotch()
  const idle = useIdle()
  const [error, setError] = useState(false)
  // Why the table can't be drawn here (WebGPU didn't start), shown instead of it.
  const [gpuError, setGpuError] = useState(null)
  // View mode: dragging with the left button (or a finger) moves the table, never pieces or notes.
  const [panMode, setPanMode] = useState(() => store.get('panMode') === '1')
  const [hist, setHist] = useState({ undo: false, redo: false })
  const [menu, setMenu] = useState(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const [podium, setPodium] = useState(false)
  const closePodium = useCallback(() => setPodium(false), [])
  // After sharing: what happened, for a moment ('copied' or 'saved').
  const [shared, setShared] = useState(null)
  const [podiumShown, podiumClosing] = useLinger(podium)
  const [party, setParty] = useState(false)
  // Bumped to play the celebration again from the start, see the dev menu.
  const [partyKey, setPartyKey] = useState(0)
  // After the celebration, bring up the podium.
  const endParty = useCallback(() => {
    setParty(false)
    setPodium(true)
  }, [])
  const celebrate = useCallback(() => {
    setPodium(false)
    setPartyKey((k) => k + 1)
    setParty(true)
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
          trays: room.trays || [],
          overlay: cursors.current,
          user: playerId,
          userName: name,
          nameOf,
          guard: ensureName,
          tooltip: tip.current,
          send: (msg) => sock?.send(msg),
          onRef: (ref, live) => api.saveRef(id, ref, live),
          onRefDelete: (refId) => api.deleteRef(id, refId),
          // What's in a tray only changes on a drop, so live updates (while dragging) leave it out.
          onTray: (tray, live) => api.saveTray(id, live ? { ...tray, pieces: undefined } : tray, live),
          onTrayDelete: (trayId) => api.deleteTray(id, trayId),
          onStats: () => setStats(eng.contributors()),
          onSnap: playSnap,
          onMenu: (x, y, kind, id) => setMenu({ x, y, kind, id }),
          onHistory: setHist,
          onComplete: () => {
            setDone(true)
            // Celebrate once per player and jigsaw, whoever placed the last piece.
            if (store.get(`celebrated:${id}`)) return
            store.set(`celebrated:${id}`, '1')
            setParty(true)
          },
        })
        try {
          await eng.ready
        } catch (err) {
          if (!dead) setGpuError(String(err?.message || err))
          return
        }
        if (dead) return
        learn(room.players)
        setOnline(new Set(room.online || []))
        setSeen(room.seen || {})
        eng.setColors(readColors())
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
            else if (msg.type === 'tray') eng.remoteTray(msg.tray)
            else if (msg.type === 'tray-delete') eng.removeTray(msg.id, true)
            else eng.remoteMessage(msg)
          },
          onOpen: async (reconnect) => {
            if (!reconnect) return
            const fresh = await api.room(id).catch(() => null)
            if (!fresh || dead) return
            eng.resync(fresh.pieces)
            eng.setRefs(fresh.refs || [])
            eng.setTrays(fresh.trays || [])
            learn(fresh.players)
            setOnline(new Set(fresh.online || []))
            setSeen(fresh.seen || {})
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

  // Escape in fullscreen (when the browser passes it on, see toggleFullscreen): anything open or
  // selected goes first, as usual. With nothing left for it to do, it leaves fullscreen. This runs
  // in the capture phase, so it sees the state from before the other handlers clear it.
  useEffect(() => {
    if (!engine) return
    const key = (e) => {
      if (e.key !== 'Escape' || e.repeat || !fullscreenEl()) return
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return
      if (document.querySelector('.modal-bg, .settings-menu, .react-pick [aria-pressed="true"]')) return
      if (engine.drag || engine.selCount || engine.refSel) return
      toggleFullscreen()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [engine])

  // Other players only see our cursor while we're playing, not while a dialog is open or we spectate.
  useEffect(() => {
    if (!engine) return
    const check = () => engine.setAway(spectate || !!document.querySelector('.modal-bg'))
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true })
    check()
    return () => mo.disconnect()
  }, [engine, spectate])

  // H help, V view mode, P players, N note, T tray, I image, + and - zoom, C centres, F fullscreen. Arrow keys and WASD pan (see the engine). New notes, trays and images go under the pointer when it's on the table.
  useEffect(() => {
    if (!engine || spectate) return
    const key = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return
      // While holding pieces, G gathers them (see the engine), and dialogs keep the keyboard.
      if (engine.drag || document.querySelector('.modal-bg')) return
      const r = engine.canvas.getBoundingClientRect()
      const p = engine.pointerAt
      const el = p && document.elementFromPoint(p[0] + r.left, p[1] + r.top)
      const over = el && !el.closest('.float, .players') ? p : null
      const k = e.key.toLowerCase()
      if (k === 'h') setHelp(true)
      else if (k === 'v') setPanMode((v) => !v)
      else if (k === 'p') setPlayers((s) => !s)
      else if (k === 'n') createNote.current?.(over ? over[0] + r.left : null, over ? over[1] + r.top : null)
      else if (k === 't') (over ? engine.addTray(...over) : engine.addTray())
      else if (k === 'i') (over ? engine.addRef(...over) : engine.addRef())
      else if (k === '+' || k === '=') engine.zoomBy(1.4)
      else if (k === '-' || k === '_') engine.zoomBy(1 / 1.4)
      else if (k === 'c') engine.fit()
      else if (k === 'f' && canFullscreen()) toggleFullscreen()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [engine, spectate])

  // The toolbar buttons, in four groups: in the corners and at the top middle, where the play tools
  // are three bars side by side.
  const nav = (
    <button className="icon-btn" onClick={() => setDialog('rooms')} aria-label="All jigsaws" title="All jigsaws">
      <Rooms />
    </button>
  )
  const play = engine && !spectate && (
    <>
      <div className="float">
        <button className="icon-btn" onClick={() => engine.undo()} disabled={!hist.undo} aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" title={`Undo (${MOD}Z)`}>
          <Undo />
        </button>
        <button className="icon-btn" onClick={() => engine.redo()} disabled={!hist.redo} aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" title={`Redo (${MOD}${REDO_KEY})`}>
          <Redo />
        </button>
      </div>
      <div className="float">
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
      </div>
      <div className="float">
        <TrayButton engine={engine} hint={<KeyHint k="T" />} />
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
        <NoteButton createRef={createNote} hint={<KeyHint k="N" />} />
      </div>
    </>
  )
  const account = (
    <>
      {!spectate && (
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
      )}
      {engine && (
        <button
          hidden={spectate}
          className={`icon-btn${players ? ' on' : ''}`}
          onClick={() => setPlayers((s) => !s)}
          aria-pressed={players}
          aria-label="Players"
          aria-keyshortcuts="P"
          title={players ? 'Hide players (P)' : 'Show players (P)'}
        >
          <Timers roomId={id} me={playerId} initial={data.times} busRef={timeBus} stopped={done || spectate} onTimes={onTimes} />
          <KeyHint k="P" />
        </button>
      )}
      <Settings privateRoom={!!data?.private} />
    </>
  )
  const zoom = (
    <>
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
    </>
  )
  const full = canFullscreen() && !spectate && (
    <button
      className={`icon-btn${fullscreen ? ' on' : ''}`}
      onClick={toggleFullscreen}
      aria-pressed={fullscreen}
      aria-label="Fullscreen"
      aria-keyshortcuts="F"
      title={fullscreen ? 'Leave fullscreen (F)' : 'Fullscreen (F)'}
    >
      {fullscreen ? <ExitFullscreen /> : <Fullscreen />}
      <KeyHint k="F" />
    </button>
  )

  return (
    <div
      className={`room${spectate ? ' spectating' : ''}${panMode ? ' pan-mode' : ''}${idle ? ' idle' : ''}${notch ? ' notch' : ''}`}
    >
      <canvas ref={canvas} className="board" tabIndex={0} />
      <div ref={tip} className="tip" />
      {!engine && (
        <div className="center">
          {gpuError ? (
            <p className="gpu-error">
              This browser can't draw the jigsaw: it needs WebGPU, which didn't start here ({gpuError}). Try another browser,
              or turn on hardware acceleration in this one.
            </p>
          ) : (
            <span className="spin" />
          )}
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
      <div className="float tl">{nav}</div>
      {play && <div className="play-tools tc">{play}</div>}
      {!spectate && (
        <div className="br">
          <div className="float">{zoom}</div>
          {full && <div className="float">{full}</div>}
        </div>
      )}
      <div className="float tr">{account}</div>
      {engine && spectate && <Spectate engine={engine} />}
      {menu && engine && !spectate && <ContextMenu key={`${menu.kind}:${menu.id}:${menu.x}:${menu.y}`} engine={engine} at={menu} onClose={closeMenu} />}
      {helpShown && !spectate && <Help onClose={closeHelp} closing={helpClosing} />}
      {party && <Celebration key={partyKey} onDone={endParty} />}
      {import.meta.env.DEV && devMenu && engine && !spectate && (
        <DevMenu
          onConnect={() => engine.devConnect()}
          onRestart={() => {
            engine.devRestart()
            store.set(`celebrated:${id}`, null)
            setDone(false)
            setParty(false)
            setPodium(false)
          }}
          onSolve={() => {
            // Celebrate as if for the first time.
            store.set(`celebrated:${id}`, null)
            engine.devSolve()
          }}
          onCelebrate={() => {
            engine.fit()
            celebrate()
          }}
        />
      )}
      {engine && done && !spectate && (
        <button className="podium-btn" onClick={() => setPodium(true)} aria-label="Podium" title="Top players">
          <PodiumIcon />
        </button>
      )}
      {engine && done && !spectate && (
        <button
          className="share-btn"
          onClick={async () => {
            const picture = renderShare({
              image: engine.refImg,
              ranked: rankPlayers({ stats, times, notes, nameOf }),
            })
            const result = await shareImage(picture, engine.room?.name).catch(() => null)
            setShared(result)
            if (result) setTimeout(() => setShared(null), 2500)
          }}
          aria-label="Share"
          title={shared === 'copied' ? 'Copied to the clipboard' : shared === 'saved' ? 'Saved as an image' : 'Copy a picture of the finished jigsaw and the podium'}
        >
          {shared ? <Check /> : <Share />}
        </button>
      )}
      {shared && (
        <div className="toast" role="status" key={shared + Date.now()}>
          {shared === 'copied' ? 'Image copied to the clipboard' : 'Image saved'}
        </div>
      )}
      {podiumShown && (
        <Podium
          ranked={rankPlayers({ stats, times, notes, nameOf })}
          closing={podiumClosing}
          onClose={closePodium}
        />
      )}
      {engine && !spectate && <Players open={players} stats={stats} times={times} notes={notes} me={playerId} owner={data?.owner} nameOf={nameOf} online={online} seen={seen} />}
    </div>
  )
}
