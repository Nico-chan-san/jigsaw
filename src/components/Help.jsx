import { useEffect } from 'react'
import { Close } from './icons.jsx'

const Key = ({ children }) => <kbd className="key">{children}</kbd>

const SECTIONS = [
  {
    title: 'Mouse',
    rows: [
      [<Key key="lp">Drag a piece</Key>, 'Move it'],
      [<Key key="lc">Click a piece</Key>, 'Select it (and turn it face up in hardcore mode)'],
      [<Key key="lt">Drag the table</Key>, 'Select'],
      [<Key key="r">Right drag</Key>, 'Pan'],
      [<Key key="rc">Right click while dragging</Key>, 'Rotate held pieces'],
      [<Key key="w">Scroll</Key>, 'Zoom'],
    ],
  },
  {
    title: 'Keyboard',
    rows: [
      [
        <>
          <Key>W</Key>
          <Key>A</Key>
          <Key>S</Key>
          <Key>D</Key>
        </>,
        'Pan (arrow keys too)',
      ],
      [<Key key="sp">Space</Key>, 'Rotate held or selected pieces'],
      [
        <>
          <Key>Shift</Key>
          <Key>Space</Key>
        </>,
        'Rotate them all together, around their centre',
      ],
      [<Key key="g">G</Key>, 'Sort selected pieces into a grid'],
      [
        <>
          <Key>+</Key>
          <Key>-</Key>
        </>,
        'Zoom',
      ],
      [<Key key="c">C</Key>, 'Fit to screen'],
      [<Key key="h">H</Key>, 'This help'],
      [<Key key="v">V</Key>, 'View mode: dragging only moves the table'],
      [<Key key="m">M</Key>, 'Side menu: modules, notes and images'],
      [<Key key="p">P</Key>, 'Players'],
      [<Key key="n">N</Key>, 'New note'],
      [<Key key="i">I</Key>, 'New image'],
      [<Key key="r">R</Key>, 'Reactions'],
      [<Key key="sh">Shift</Key>, 'Add to selection'],
      [
        <>
          <Key>Cmd</Key>
          <Key>A</Key>
        </>,
        'Select everything (Ctrl A on Windows)',
      ],
      [<Key key="e">Esc</Key>, 'Clear selection'],
      [
        <>
          <Key>Delete</Key>
          <Key>Backspace</Key>
        </>,
        'Remove selected notes and images',
      ],
    ],
  },
  {
    title: 'Touch',
    rows: [
      [<Key key="tp">Drag a piece</Key>, 'Move it'],
      [<Key key="tt">Drag the table</Key>, 'Pan, pinch to zoom'],
      [<Key key="t2">2nd finger tap</Key>, 'Rotate held pieces'],
    ],
  },
]

export default function Help({ onClose, closing }) {
  useEffect(() => {
    if (closing) return
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, closing])

  return (
    <div className={`modal-bg${closing ? ' closing' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help" role="dialog" aria-label="How to play">
        <div className="help-head">
          <h1>How to play</h1>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Close />
          </button>
        </div>
        <div className="help-body">
          {SECTIONS.map((s) => (
            <section key={s.title} className={`help-${s.title.toLowerCase()}`}>
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
