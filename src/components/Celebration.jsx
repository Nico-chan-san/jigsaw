import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const EMOJI = '🎉'
// Emojis shot from each bottom corner, and emojis raining from the top.
const CANNON = 70
const RAIN = 90
const MS = 4200

// One emoji following a thrown arc: starts at (x, y) with velocity (vx, vy) px/s under gravity g.
function arc(layer, { x, y, vx, vy, g, ms, delay, size, spin }) {
  const el = document.createElement('span')
  el.className = 'reaction'
  el.textContent = EMOJI
  layer.appendChild(el)
  const frames = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const s = (t * ms) / 1000
    frames.push({
      transform: `translate(${x + vx * s}px, ${y + vy * s + (g * s * s) / 2}px) translate(-50%, -50%) rotate(${spin * t}deg) scale(${size})`,
      opacity: t > 0.85 ? (1 - t) / 0.15 : 1,
    })
  }
  const anim = el.animate(frames, { duration: ms, delay, fill: 'backwards' })
  anim.onfinish = () => el.remove()
}

// A full screen burst of party poppers, played once when a jigsaw is finished.
export default function Celebration({ onDone }) {
  const layer = useRef(null)

  useEffect(() => {
    const el = layer.current
    const W = window.innerWidth
    const H = window.innerHeight
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const k = calm ? 0.25 : 1
    const g = H * 1.1
    for (const side of [-1, 1]) {
      for (let i = 0; i < CANNON * k; i++) {
        // Aim up and in towards the middle, high enough to reach most of the screen.
        const a = -Math.PI / 2 - side * (0.15 + Math.random() * 0.55)
        const v = Math.sqrt(2 * g * H * (0.55 + Math.random() * 0.45))
        arc(el, {
          x: side < 0 ? 0 : W,
          y: H,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          g,
          ms: 2200 + Math.random() * 900,
          delay: Math.random() * 700,
          size: 0.9 + Math.random() * 1.1,
          spin: (Math.random() - 0.5) * 900,
        })
      }
    }
    for (let i = 0; i < RAIN * k; i++) {
      arc(el, {
        x: Math.random() * W,
        y: -40,
        vx: (Math.random() - 0.5) * 80,
        vy: 60 + Math.random() * 120,
        g: H * 0.35,
        ms: 2600 + Math.random() * 1200,
        delay: 500 + Math.random() * 1400,
        size: 0.8 + Math.random() * 0.9,
        spin: (Math.random() - 0.5) * 600,
      })
    }
    const timer = setTimeout(onDone, MS)
    return () => clearTimeout(timer)
  }, [onDone])

  return createPortal(<div ref={layer} className="celebration" aria-hidden="true" />, document.body)
}
