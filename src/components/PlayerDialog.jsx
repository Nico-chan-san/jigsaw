import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useApp } from '../App.jsx'
import { formatTime } from '../lib/time.js'
import { Card } from '../pages/Rooms.jsx'
import Dialog from './Dialog.jsx'
import { Dot } from './Players.jsx'
import { Clock, Crown, Piece } from './icons.jsx'

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

// A player's window, from their circle in the header: who they are, what they did in this jigsaw,
// and the other jigsaws they've played. Private jigsaws only show if this player has them too (the
// server checks). p is the player as the header knows them: { id, name, pieces, seconds }.
export default function PlayerDialog({ p, here, owner, me, onClose, closing }) {
  const { player, roomId, openRoom } = useApp()
  const [info, setInfo] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let dead = false
    setInfo(null)
    setFailed(false)
    api
      .player(p.id, player?.passphrase)
      .then((d) => !dead && setInfo(d))
      .catch(() => !dead && setFailed(true))
    return () => {
      dead = true
    }
  }, [p.id, player?.passphrase])

  const others = info?.rooms.filter((r) => r.id !== roomId) || []
  const since = info?.created ? new Date(info.created).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''
  const open = (id) => {
    onClose()
    openRoom(id)
  }

  return (
    <Dialog title={p.name} label={`${p.name}, player`} className="profile" onClose={onClose} closing={closing}>
      <div className="profile-head">
        <Dot p={p} here={here} big you={p.id === me} />
        <div className="profile-who">
          <span className="profile-status">
            <span className={`presence${here ? ' here' : ''}`} />
            {here ? 'Here now' : 'Away'}
            {p.id === me && ' · you'}
          </span>
          {since && <span className="profile-since">Playing since {since}</span>}
        </div>
      </div>

      <section>
        <h2 className="label">This jigsaw</h2>
        <div className="profile-stats">
          {p.id === owner && (
            <span className="profile-stat owner">
              <Crown />
              Made it
            </span>
          )}
          <span className="profile-stat">
            <Piece />
            {plural(p.pieces, 'piece')} connected
          </span>
          <span className="profile-stat">
            <Clock />
            {formatTime(p.seconds)} spent
          </span>
        </div>
      </section>

      <section>
        <h2 className="label">
          Other jigsaws
          {info && <span className="n">{others.length}</span>}
        </h2>
        {failed ? (
          <p className="profile-empty">Couldn't load their other jigsaws.</p>
        ) : !info ? (
          <span className="spin" />
        ) : !others.length ? (
          <p className="profile-empty">No other jigsaws you can see.</p>
        ) : (
          <div className="grid">
            {others.map((r) => (
              <div key={r.id} className="profile-room">
                <Card r={r} onOpen={open} />
                <span className="profile-share">
                  {r.owner === p.id && (
                    <span title="Made this jigsaw">
                      <Crown className="crown" />
                    </span>
                  )}
                  <span title="Pieces they connected">
                    <Piece />
                    {r.pieces}
                  </span>
                  <span title="Time they spent">
                    <Clock />
                    {formatTime(r.time)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Dialog>
  )
}
