import { useEffect } from 'react'
import Dialog from './Dialog.jsx'

const Key = ({ children }) => <kbd className="key">{children}</kbd>

const IS_MAC = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '')
const MOD = IS_MAC ? 'Cmd' : 'Ctrl'

// Keys pressed together, shown as Shift + Space.
const Combo = ({ keys }) =>
  keys.map((k, i) => (
    <span key={k} className="key-group">
      {i > 0 && <span className="key-sep">+</span>}
      <Key>{k}</Key>
    </span>
  ))

// Keys that each do the same thing, shown as Delete / Backspace.
const Either = ({ keys }) =>
  keys.map((k, i) => (
    <span key={k} className="key-group">
      {i > 0 && <span className="key-sep">/</span>}
      <Key>{k}</Key>
    </span>
  ))

// A range of keys, shown as 1 - 9.
const Range = ({ from, to }) => (
  <span className="key-group">
    <Key>{from}</Key>
    <span className="key-sep">-</span>
    <Key>{to}</Key>
  </span>
)

const SECTIONS = [
  {
    title: 'Mouse',
    rows: [
      [<Key key="lp">Drag a piece</Key>, 'Move'],
      [<Key key="lc">Click a piece</Key>, 'Select'],
      [<Key key="lt">Drag the table</Key>, 'Select an area'],
      [<Combo key="sc" keys={['Shift', 'Click']} />, 'Add to selection'],
      [<Combo key="st" keys={['Shift', 'Drag a tray']} />, 'Move the tray'],
      [<Combo key="ir" keys={['Shift', 'Drag an image']} />, 'Resize'],
      [<Combo key="ia" keys={['Alt', 'Drag an image']} />, 'Fade'],
      [<Key key="nc">Double click a note</Key>, 'Edit'],
      [<Key key="r">Right drag</Key>, 'Pan'],
      [<Key key="rc">Right click while dragging</Key>, 'Rotate'],
      [<Key key="w">Scroll</Key>, 'Zoom'],
    ],
  },
  {
    title: 'Keyboard',
    rows: [
      [
        <span key="pan" className="key-stack">
          <span className="key-group">
            <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key>
          </span>
          <span className="key-group">
            <Key>↑</Key>
            <Key>←</Key>
            <Key>↓</Key>
            <Key>→</Key>
          </span>
        </span>,
        'Pan',
      ],
      [<Key key="sp">Space</Key>, 'Rotate'],
      [<Combo key="ss" keys={['Shift', 'Space']} />, 'Rotate together'],
      [<Key key="g">G</Key>, 'Sort into a grid'],
      [<Combo key="sg" keys={['Shift', 'G']} />, 'Shuffle into a grid'],
      [<Range key="tn" from="1" to="9" />, 'Send to tray'],
      [<Combo key="sa" keys={[MOD, 'A']} />, 'Select all'],
      [<Key key="e">Esc</Key>, 'Deselect'],
      [<Either key="del" keys={['Delete', 'Backspace']} />, 'Remove'],
      [<Combo key="un" keys={[MOD, 'Z']} />, 'Undo'],
      [<Combo key="re" keys={[MOD, 'Shift', 'Z']} />, 'Redo'],
    ],
  },
  {
    title: 'Tools',
    rows: [
      [<Key key="t">T</Key>, 'New tray'],
      [<Key key="i">I</Key>, 'New image'],
      [<Key key="n">N</Key>, 'New note'],
      [<Key key="r">R</Key>, 'Reactions'],
      [<Key key="v">V</Key>, 'View mode'],
      [<Key key="p">P</Key>, 'Players'],
      [<Key key="h">H</Key>, 'Help'],
      [<Either key="z" keys={['+', '-']} />, 'Zoom'],
      [<Key key="c">C</Key>, 'Fit to screen'],
      [<Key key="f">F</Key>, 'Fullscreen'],
    ],
  },
  {
    title: 'Touch',
    rows: [
      [<Key key="tp">Drag a piece</Key>, 'Move'],
      [<Key key="tt">Drag the table</Key>, 'Pan'],
      [<Key key="tz">Pinch</Key>, 'Zoom'],
      [<Key key="t2">2nd finger tap</Key>, 'Rotate'],
    ],
  },
]

// Touch screens get the touch gestures, everything else the mouse and keyboard ones.
const TOUCH = window.matchMedia('(hover: none)').matches

export default function Help({ onClose, closing }) {
  // H opens the help (see Room.jsx) and closes it again.
  useEffect(() => {
    if (closing) return
    const key = (e) => {
      if (e.key.toLowerCase() !== 'h' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, closing])

  return (
    <Dialog
      title="How to play"
      className="help"
      bodyClass="help-body"
      onClose={onClose}
      closing={closing}
    >
      {SECTIONS.filter((s) => (s.title === 'Touch') === TOUCH).map((s) => (
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
    </Dialog>
  )
}
