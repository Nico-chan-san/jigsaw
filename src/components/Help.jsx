import { useEffect } from 'react'
import { Close } from './icons.jsx'

const Key = ({ children }) => <kbd className="key">{children}</kbd>

const SECTIONS = [
  {
    title: 'Mouse',
    rows: [
      [<Key key="lp">Left drag on a piece</Key>, 'Pick up the piece (or its whole module) and move it'],
      [<Key key="lc">Click a piece</Key>, 'In annoying mode, flip a loose piece over'],
      [<Key key="lt">Left drag on the table</Key>, 'Draw a box to select pieces, images and notes'],
      [<Key key="ls">Left drag on a selection</Key>, 'Move everything selected at once, images and notes included'],
      [<Key key="r">Right drag</Key>, 'Move around the table'],
      [<Key key="w">Scroll wheel</Key>, 'Zoom in and out'],
    ],
  },
  {
    title: 'Keyboard',
    rows: [
      [
        <>
          <Key>←</Key>
          <Key>→</Key>
        </>,
        'While holding pieces, rotate each piece (or module) 90° in place',
      ],
      [<Key key="r">R</Key>, 'While holding pieces, rotate them 90° to the right'],
      [<Key key="sh">Shift</Key>, 'Hold while clicking a piece, image or note, or drawing a box, to add to the selection'],
      [<Key key="e">Esc</Key>, 'Clear the selection'],
    ],
  },
  {
    title: 'Touch screens',
    rows: [
      [<Key key="tp">Drag a piece</Key>, 'Move it'],
      [<Key key="tc">Tap a piece</Key>, 'In annoying mode, flip a loose piece over'],
      [<Key key="tt">Drag the table</Key>, 'Move around the table; pinch to zoom'],
      [<Key key="t2">2nd finger</Key>, 'While holding pieces, tap with a second finger to rotate them in place'],
    ],
  },
]

export default function Help({ onClose }) {
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help" role="dialog" aria-label="How to play">
        <div className="help-head">
          <h1>How to play</h1>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Close />
          </button>
        </div>
        <div className="help-body">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="label">{s.title}</h2>
              <dl>
                {s.rows.map(([k, text], i) => (
                  <div key={i} className="help-row">
                    <dt>{k}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <button className="primary wide" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  )
}
