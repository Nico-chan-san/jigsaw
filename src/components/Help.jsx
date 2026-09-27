import { useEffect } from 'react'
import { Close } from './icons.jsx'

const Key = ({ children }) => <kbd className="key">{children}</kbd>

const SECTIONS = [
  {
    title: 'Pieces',
    rows: [
      [<Key key="d">Drag</Key>, 'Pick up a piece or module and move it'],
      [
        <>
          <Key>←</Key>
          <Key>→</Key>
        </>,
        'While holding a piece, rotate it 90°',
      ],
      [<Key key="t">2nd finger</Key>, 'On touch screens, tap with a second finger to rotate'],
    ],
  },
  {
    title: 'Who did what',
    rows: [
      [<Key key="c">Hover a piece</Key>, 'Shows who connected it'],
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
