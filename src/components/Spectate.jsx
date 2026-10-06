import { useEffect, useRef } from 'react'
import { Spectator } from '../lib/spectate.js'

// The spectator screens over the table, see lib/spectate.js. The screens are made there, in here.
export default function Spectate({ engine }) {
  const host = useRef(null)
  useEffect(() => {
    const s = new Spectator(engine, host.current)
    return () => s.destroy()
  }, [engine])
  return <div ref={host} className="spectate" />
}
