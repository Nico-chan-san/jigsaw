import { formatTime } from '../lib/time.js'
import { Clock, Note, Piece } from './icons.jsx'

// Everyone who has done something in this jigsaw, most pieces connected first.
export default function Players({ open, stats, times, notes, me }) {
  const map = new Map()
  const get = (name) => {
    if (!map.has(name)) map.set(name, { name, pieces: 0, seconds: 0, notes: 0 })
    return map.get(name)
  }
  for (const s of stats.values()) (get(s.name).pieces = s.pieces)
  for (const [name, seconds] of Object.entries(times)) if (seconds > 0) get(name).seconds = seconds
  for (const n of notes) if (n.author) get(n.author).notes++

  const list = [...map.values()].sort(
    (a, b) =>
      b.pieces - a.pieces ||
      b.seconds - a.seconds ||
      a.name.localeCompare(b.name),
  )

  return (
    <aside className={`players${open ? ' open' : ''}`}>
      <h2 className="label">Players</h2>
      <ol>
        {list.map((p) => (
          <li key={p.name} className={p.name === me ? 'me' : ''}>
            <span className="pname" title={p.name}>
              {p.name}
            </span>
            <span className="pstats">
              <span title="Pieces connected">
                <Piece />
                {p.pieces}
              </span>
              <span className="ptime" title="Time spent">
                <Clock />
                {formatTime(p.seconds)}
              </span>
            </span>
            {p.notes > 0 && (
              <span className="psub">
                <span title="Notes written">
                  <Note />
                  {p.notes}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  )
}
