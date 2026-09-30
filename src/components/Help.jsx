import Dialog from './Dialog.jsx'

const Key = ({ children }) => <kbd className="key">{children}</kbd>

const SECTIONS = [
  {
    title: 'Mouse',
    rows: [
      [<Key key="lp">Drag a piece</Key>, 'Move it'],
      [<Key key="lc">Click a piece</Key>, 'Select it (and turn it face up in hardcore mode)'],
      [<Key key="lt">Drag the table</Key>, 'Select'],
      [<Key key="tr">Drag a tray</Key>, 'Move it, with the pieces in it'],
      [<Key key="tc">Click a tray</Key>, 'Select it: space, G and Delete then work on it'],
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
        'Pan (arrow keys too), faster the longer you hold',
      ],
      [<Key key="sp">Space</Key>, "Rotate held or selected pieces, or a selected tray's"],
      [
        <>
          <Key>Shift</Key>
          <Key>Space</Key>
        </>,
        'Rotate them all together, around their centre',
      ],
      [<Key key="g">G</Key>, "Sort selected pieces into a grid, or a selected tray's"],
      [
        <>
          <Key>Shift</Key>
          <Key>G</Key>
        </>,
        'Sort them into a grid in random order',
      ],
      [
        <>
          <Key>+</Key>
          <Key>-</Key>
        </>,
        'Zoom',
      ],
      [<Key key="c">C</Key>, 'Fit to screen'],
      [<Key key="f">F</Key>, 'Fullscreen'],
      [<Key key="h">H</Key>, 'This help'],
      [<Key key="v">V</Key>, 'View mode: dragging only moves the table'],
      [<Key key="p">P</Key>, 'Players'],
      [<Key key="n">N</Key>, 'New note'],
      [<Key key="t">T</Key>, 'New tray, to sort pieces into (around the selected pieces, if any)'],
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
        'Remove selected notes, images and tray',
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
  return (
    <Dialog
      title="How to play"
      className="help"
      bodyClass="help-body"
      onClose={onClose}
      closing={closing}
      footer={
        <button className="primary wide" onClick={onClose}>
          Got it
        </button>
      }
    >
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
    </Dialog>
  )
}
