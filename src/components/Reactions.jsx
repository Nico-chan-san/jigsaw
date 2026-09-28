import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Smile } from './icons.jsx'

const REACTIONS = [
  { kind: 'party', emoji: '🎉', label: 'Celebrate' },
  { kind: 'heart', emoji: '❤️', label: 'Love' },
  { kind: 'laugh', emoji: '😂', label: 'Laugh' },
  { kind: 'fire', emoji: '🔥', label: 'Fire' },
]
const EMOJI = Object.fromEntries(REACTIONS.map((r) => [r.kind, r.emoji]))

// While the pointer is held down, this many reactions are thrown every TICK_MS.
const TICK_MS = 60
const PER_TICK = 1
// Upper bound on reactions in the air at once, so a crowd can't bog the page down.
const MAX = 240

// One reaction, thrown up and outwards from (sx, sy) and falling back under gravity.
function spawn(layer, emoji, sx, sy) {
  if (layer.childElementCount >= MAX) return
  const el = document.createElement('span')
  el.className = 'reaction'
  el.textContent = emoji
  layer.appendChild(el)
  const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
  const v = 260 + Math.random() * 260
  const vx = Math.cos(a) * v
  const vy = Math.sin(a) * v
  const ms = 1100 + Math.random() * 500
  const spin = (Math.random() - 0.5) * 540
  const size = 0.7 + Math.random() * 0.7
  const frames = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    const s = (t * ms) / 1000
    const x = sx + vx * s
    const y = sy + vy * s + 450 * s * s
    frames.push({
      transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${spin * t}deg) scale(${i ? size : size * 0.3})`,
      opacity: t > 0.7 ? (1 - t) / 0.3 : 1,
    })
  }
  el.animate(frames, { duration: ms }).onfinish = () => el.remove()
}

// Header button with a drop-down of reactions. With one picked, pressing on the board pours it
// out of the pointer, for everyone in the room.
export default function Reactions({ engine, busRef }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState(null)
  const wrap = useRef(null)
  const layer = useRef(null)
  const host = engine.canvas.parentElement

  const burst = (k, sx, sy) => {
    const emoji = EMOJI[k]
    if (!emoji || !layer.current) return
    for (let i = 0; i < PER_TICK; i++) spawn(layer.current, emoji, sx, sy)
  }

  useEffect(() => {
    busRef.current = (msg) => {
      const { cam, vw, vh } = engine
      burst(msg.kind, (msg.x - cam.x) * cam.z + vw / 2, (msg.y - cam.y) * cam.z + vh / 2)
    }
    return () => (busRef.current = null)
  }, [engine, busRef])

  // Close the drop-down on a press anywhere else.
  useEffect(() => {
    if (!open) return
    const away = (e) => !wrap.current?.contains(e.target) && setOpen(false)
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [open])

  // With a reaction picked, a left press on the board pours it instead of reaching the engine.
  useEffect(() => {
    if (!kind) return
    const c = engine.canvas
    let stop = null
    const down = (e) => {
      if (e.target !== c || e.button !== 0 || !e.isPrimary || stop) return
      e.stopPropagation()
      e.preventDefault()
      let [sx, sy] = engine.pos(e)
      const move = (ev) => {
        if (ev.pointerId === e.pointerId) [sx, sy] = engine.pos(ev)
      }
      const up = (ev) => ev.pointerId === e.pointerId && stop()
      const emit = () => {
        burst(kind, sx, sy)
        const [x, y] = engine.toWorld(sx, sy)
        engine.send({ type: 'react', kind, x: Math.round(x), y: Math.round(y) })
      }
      emit()
      const timer = setInterval(emit, TICK_MS)
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      stop = () => {
        clearInterval(timer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        stop = null
      }
    }
    const key = (e) => e.key === 'Escape' && setKind(null)
    host.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      host.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
      stop?.()
    }
  }, [engine, host, kind])

  const pick = REACTIONS.find((r) => r.kind === kind)

  return (
    <span className="react-pick" ref={wrap}>
      <button
        className={`icon-btn${kind ? ' on' : ''}`}
        // With a reaction picked, the button turns it off; otherwise it opens the drop-down.
        onClick={() => {
          if (kind) {
            setKind(null)
            setOpen(false)
          } else setOpen((o) => !o)
        }}
        aria-label="Reactions"
        aria-expanded={open}
        aria-pressed={!!kind}
        title={pick ? `${pick.label}: press on the board to react. Click to stop` : 'Reactions'}
      >
        {pick ? <span className="react-emoji">{pick.emoji}</span> : <Smile />}
      </button>
      {open && (
        <div className="react-menu" role="menu">
          {REACTIONS.map((r) => (
            <button
              key={r.kind}
              className={`icon-btn${r.kind === kind ? ' on' : ''}`}
              role="menuitemradio"
              aria-checked={r.kind === kind}
              aria-label={r.label}
              title={r.label}
              onClick={() => {
                setKind((k) => (k === r.kind ? null : r.kind))
                setOpen(false)
              }}
            >
              <span className="react-emoji">{r.emoji}</span>
            </button>
          ))}
        </div>
      )}
      {createPortal(<div ref={layer} className="reactions" />, host)}
    </span>
  )
}
