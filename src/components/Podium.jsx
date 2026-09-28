import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatTime } from '../lib/time.js'
import { Clock, Piece } from './icons.jsx'

// Places in the order they stand, left to right: second, first, third.
const STANDS = [1, 0, 2]

// The little podium drawn on the button that opens the real one.
export function PodiumIcon() {
  return (
    <span className="podium-icon" aria-hidden="true">
      <span className="p2">2</span>
      <span className="p1">1</span>
      <span className="p3">3</span>
    </span>
  )
}

// The top three players of a finished jigsaw, as a sticker: no dialog box, no dimmed background.
// Clicking anywhere or Escape puts it away.
export default function Podium({ ranked, closing, onClose }) {
  useEffect(() => {
    if (closing) return
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, closing])

  const top = ranked.slice(0, 3)
  return createPortal(
    <div className={`modal-bg podium-bg${closing ? ' closing' : ''}`} onPointerDown={onClose}>
      <div className="podium" role="dialog" aria-label="Podium">
        {STANDS.filter((place) => top[place]).map((place) => {
          const p = top[place]
          return (
            <div key={p.id} className={`stand place-${place + 1}`}>
              <span className="stand-name" title={p.name}>
                {p.name}
              </span>
              <div className="stand-block">
                <span className="stand-rank">{place + 1}</span>
                <span className="stand-stat" title="Pieces connected">
                  <Piece />
                  {p.pieces}
                </span>
                <span className="stand-stat" title="Time spent">
                  <Clock />
                  {formatTime(p.seconds)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
