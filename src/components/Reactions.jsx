import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const KIND = 'party'
const EMOJI = '👍'

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

// Header button that turns the celebration on. While it is on, pressing on the board pours confetti
// out of the pointer, for everyone in the room.
export default function Reactions({ engine, busRef, hint }) {
  const [on, setOn] = useState(false)
  const layer = useRef(null)
  const host = engine.canvas.parentElement

  const burst = (sx, sy) => {
    if (!layer.current) return
    for (let i = 0; i < PER_TICK; i++) spawn(layer.current, EMOJI, sx, sy)
  }

  useEffect(() => {
    busRef.current = (msg) => {
      const { cam, vw, vh } = engine
      burst((msg.x - cam.x) * cam.z + vw / 2, (msg.y - cam.y) * cam.z + vh / 2)
    }
    return () => (busRef.current = null)
  }, [engine, busRef])

  // R turns reactions on or off.
  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'r' && e.key !== 'R') return
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return
      if (document.querySelector('.modal-bg')) return
      setOn((v) => !v)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // While on, a left press on the board pours it instead of reaching the engine.
  useEffect(() => {
    if (!on) return
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
        burst(sx, sy)
        const [x, y] = engine.toWorld(sx, sy)
        engine.send({ type: 'react', kind: KIND, x: Math.round(x), y: Math.round(y) })
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
    const key = (e) => e.key === 'Escape' && setOn(false)
    host.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      host.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
      stop?.()
    }
  }, [engine, host, on])

  return (
    <span className="react-pick">
      <button
        className={`icon-btn${on ? ' on' : ''}`}
        onClick={() => setOn((v) => !v)}
        aria-label="Celebrate"
        aria-pressed={on}
        aria-keyshortcuts="R"
        title={on ? 'Celebrate: press on the board to throw confetti. Click to stop (R)' : 'Celebrate (R)'}
      >
        <span className="react-emoji">{EMOJI}</span>
        {hint}
      </button>
      {createPortal(<div ref={layer} className="reactions" />, host)}
    </span>
  )
}
