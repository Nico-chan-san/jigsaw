import { formatTime } from '../lib/time.js'
import { Clock, Crown, Piece } from './icons.jsx'

// Everyone who has done something in this jigsaw, most pieces connected first, then most time.
// Players are kept apart by id, since two of them can share a name.
export function rankPlayers({ stats, times, nameOf }) {
  const map = new Map()
  const get = (id) => {
    if (!map.has(id)) map.set(id, { id, name: nameOf(id), pieces: 0, seconds: 0 })
    return map.get(id)
  }
  for (const s of stats.values()) get(s.id).pieces = s.pieces
  for (const [id, seconds] of Object.entries(times)) if (seconds > 0) get(id).seconds = seconds

  return [...map.values()].sort(
    (a, b) =>
      b.pieces - a.pieces ||
      b.seconds - a.seconds ||
      a.name.localeCompare(b.name),
  )
}

// "Currently playing", or when they were last in this jigsaw (if known).
function lastPlayed(id, online, seen) {
  if (online.has(id)) return 'Currently playing'
  if (!seen[id]) return ''
  const when = new Date(seen[id]).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `Last played ${when}`
}

// owner is the id of the player who made the jigsaw, marked with a crown. online is a Set of the
// player ids here now, seen when the others were last here (ms by id).
export default function Players({ open, stats, times, me, owner, nameOf, online, seen }) {
  const list = rankPlayers({ stats, times, nameOf })

  return (
    <aside className={`players${open ? ' open' : ''}`}>
      <h2 className="label">Players</h2>
      <p className="ptotal" title="Total time, all players">
        <Clock />
        Total time {formatTime(Object.values(times).reduce((a, b) => a + b, 0))}
      </p>
      <ol>
        {list.map((p) => (
          <li key={p.id} className={p.id === me ? 'me' : ''}>
            <span
              className="pname"
              title={[p.id === owner ? `${p.name}, made this jigsaw` : p.name, lastPlayed(p.id, online, seen)]
                .filter(Boolean)
                .join('\n')}
            >
              {p.id === owner && (
                <span className="pcreator" title={`${p.name} created this room`}>
                  <Crown />
                </span>
              )}
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
          </li>
        ))}
      </ol>
    </aside>
  )
}
