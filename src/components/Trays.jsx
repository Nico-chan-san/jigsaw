import { Tray as TrayIcon } from './icons.jsx'
import PlaceButton from './PlaceButton.jsx'

// Toolbar button: drag it onto the board to put a tray there, or click to put one in the middle.
export function TrayButton({ engine, hint }) {
  const place = (x, y) => {
    if (x == null) return engine.addTray()
    const r = engine.canvas.getBoundingClientRect()
    engine.addTray(x - r.left, y - r.top)
  }
  return (
    <PlaceButton onPlace={place} ghost="tray-ghost" label="Tray" shortcut="T" title="Drag a tray onto the board (T)">
      <TrayIcon />
      {hint}
    </PlaceButton>
  )
}
