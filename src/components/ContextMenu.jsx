import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// The right click menu on a piece, tray, image or note: its actions with their shortcuts.
export default function ContextMenu({ engine, at, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: at.x, top: at.y })
  const r = engine.canvas.getBoundingClientRect()

  const deselect = () => {
    engine.setSelection(new Set())
    engine.selectRef(null)
    engine.selectTray(null)
  }
  const tray = at.kind === 'tray' && engine.trays.find((t) => t.id === at.id)
  const empty = at.kind === 'tray' && !tray?.pieces.length
  const turn = [
    { label: 'Turn', keys: 'Space', run: () => engine.rotateSelection(1), off: empty },
    { label: 'Turn as one', keys: 'Shift + Space', run: () => engine.rotateSelection(1, true), off: empty },
    { label: 'Sort into a grid', keys: 'G', run: () => engine.sortSelection(), off: empty },
    { label: 'Sort in random order', keys: 'Shift + G', run: () => engine.sortSelection(true), off: empty },
  ]
  const remove = (label) => ({ label, keys: 'Del', run: () => engine.removeSelected() })
  const end = { label: 'Deselect', keys: 'Esc', run: deselect }
  const items =
    at.kind === 'piece'
      ? [
          ...turn,
          ...engine.trays
            .filter((t) => t.num)
            .sort((a, b) => a.num - b.num)
            .map((t) => ({ label: `Send to tray ${t.num}`, keys: String(t.num), run: () => engine.sendToTray(t.num) })),
          { label: 'Select all', keys: 'Ctrl + A', run: () => engine.selectAll() },
          end,
        ]
      : at.kind === 'tray'
        ? [...turn, { label: 'Auto sort', keys: tray?.auto ? 'On' : 'Off', run: () => engine.setTrayAuto(at.id, !tray?.auto) }, remove('Remove tray'), end]
        : at.kind === 'ref'
          ? [remove('Remove image'), end]
          : [remove('Remove note'), end]

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    setPos({
      left: Math.max(4, Math.min(at.x, r.width - m.offsetWidth - 4)),
      top: Math.max(4, Math.min(at.y, r.height - m.offsetHeight - 4)),
    })
  }, [at, r.width, r.height])

  useEffect(() => {
    const away = (e) => !ref.current?.contains(e.target) && onClose()
    const key = (e) => e.key === 'Escape' && (e.stopImmediatePropagation(), onClose())
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('wheel', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('wheel', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: pos.left + r.left, top: pos.top + r.top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          disabled={it.off}
          onClick={() => {
            onClose()
            it.run()
          }}
        >
          <span>{it.label}</span>
          <kbd>{it.keys}</kbd>
        </button>
      ))}
    </div>
  )
}
