import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import TextField from './TextField.jsx'
import { TRAY_COLORS } from '../lib/engine.js'

// The right click menu on a piece, tray, image or note: its actions with their shortcuts. A tray's
// menu starts with its name and colour, an image's with its opacity.
export default function ContextMenu({ engine, at, onClose }) {
  const ref = useRef(null)
  const nameRef = useRef(null)
  const [pos, setPos] = useState({ left: at.x, top: at.y })
  const r = engine.canvas.getBoundingClientRect()

  const tray = at.kind === 'tray' && engine.trays.find((t) => t.id === at.id)
  const empty = at.kind === 'tray' && !tray?.pieces.length
  const [name, setName] = useState(tray?.name || '')
  const [color, setColor] = useState(tray?.color)
  // The name being typed, saved on Enter, when the field loses focus or when the menu closes; null
  // once saved, or when Escape drops it.
  const draft = useRef(null)
  const saveName = () => {
    if (draft.current === null) return
    engine.setTrayLook(at.id, { name: draft.current.trim() })
    draft.current = null
  }
  const image = at.kind === 'ref' && engine.refs.find((r) => r.id === at.id)
  const [opacity, setOpacity] = useState(image?.opacity ?? 1)
  // The opacity being slid to, saved when the slider is let go or the menu closes; null once saved.
  const fade = useRef(null)
  const saveOpacity = () => {
    if (fade.current === null) return
    engine.setRefOpacity(at.id, fade.current)
    fade.current = null
  }
  useEffect(
    () => () => {
      saveName()
      saveOpacity()
    },
    [],
  )
  const turn = [
    { label: 'Turn', keys: 'Space', run: () => engine.rotateSelection(1), off: empty },
    { label: 'Turn as one', keys: 'Shift + Space', run: () => engine.rotateSelection(1, true), off: empty },
    { label: 'Sort into a grid', keys: 'G', run: () => engine.sortSelection(), off: empty },
    { label: 'Sort in random order', keys: 'Shift + G', run: () => engine.sortSelection(true), off: empty },
  ]
  const remove = (label) => ({ label, keys: 'Del', run: () => engine.removeSelected() })
  const items =
    at.kind === 'piece'
      ? [
          ...turn,
          ...engine.trays
            .filter((t) => t.num)
            .sort((a, b) => a.num - b.num)
            .map((t) => ({ label: `Send to tray ${t.num}`, keys: String(t.num), run: () => engine.sendToTray(t.num) })),
          { label: 'Select all', keys: 'Ctrl + A', run: () => engine.selectAll() },
        ]
      : at.kind === 'tray'
        ? [...turn, { label: 'Auto sort', keys: tray?.auto ? 'On' : 'Off', run: () => engine.setTrayAuto(at.id, !tray?.auto) }, remove('Remove tray')]
        : at.kind === 'ref'
          ? [remove('Remove image')]
          : [remove('Remove note')]

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    setPos({
      left: Math.max(4, Math.min(at.x, r.width - m.offsetWidth - 4)),
      top: Math.max(4, Math.min(at.y, r.height - m.offsetHeight - 4)),
    })
  }, [at, r.width, r.height])

  // While open on a tray or image, its buttons stay shown.
  useEffect(() => {
    engine.setMenuFor(at.kind, at.id)
    return () => engine.setMenuFor(null)
  }, [engine, at.kind, at.id])

  useEffect(() => {
    const away = (e) => !ref.current?.contains(e.target) && onClose()
    const key = (e) => {
      if (e.key !== 'Escape') return
      if (e.target === nameRef.current) draft.current = null
      e.stopImmediatePropagation()
      onClose()
    }
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
      {tray && (
        <div className="menu-look tray-look">
          <TextField
            ref={nameRef}
            compact
            value={name}
            maxLength={40}
            placeholder="Name this tray"
            aria-label="Tray name"
            onChange={(e) => {
              setName(e.target.value)
              draft.current = e.target.value
            }}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && onClose()}
          />
          <div className="tray-colors" role="radiogroup" aria-label="Tray colour">
            {Object.entries(TRAY_COLORS).map(([key, hex]) => (
              <button
                key={key}
                role="radio"
                aria-checked={color === key}
                aria-label={key}
                title={key[0].toUpperCase() + key.slice(1)}
                style={{ '--c': hex }}
                onClick={() => {
                  setColor(key)
                  engine.setTrayLook(at.id, { color: key })
                }}
              />
            ))}
          </div>
        </div>
      )}
      {image && (
        <label className="menu-look ref-look">
          <span>Opacity</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(opacity * 100)}
            aria-label="Image opacity"
            onChange={(e) => {
              const v = e.target.value / 100
              setOpacity(v)
              fade.current = v
              engine.setRefOpacity(at.id, v, true)
            }}
            onPointerUp={saveOpacity}
            onKeyUp={saveOpacity}
            onBlur={saveOpacity}
          />
          <span className="ref-pct">{Math.round(opacity * 100)}%</span>
        </label>
      )}
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
