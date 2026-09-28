import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import { api } from '../lib/api.js'
import { useApp } from '../App.jsx'
import { useLinger } from '../lib/linger.js'
import { Passphrase } from './Account.jsx'
import { Close, Key, User } from './icons.jsx'

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

// The player's name, shown on their cursor, notes and connected pieces. Saved on Enter or leaving the field.
function NameField() {
  const { name, setName } = useApp()
  const [value, setValue] = useState(name || '')
  useEffect(() => setValue(name || ''), [name])
  const save = () => {
    const v = value.trim().slice(0, 32)
    if (v && v !== name) setName(v).catch(() => setValue(name || ''))
    else setValue(name || '')
  }
  return (
    <input
      className="text"
      value={value}
      maxLength={32}
      placeholder="Your name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label="Name"
      title="Your name"
    />
  )
}

// The QR code as one SVG path, a square per dark module, with the usual quiet zone around it.
function QrCode({ text }) {
  const { d, size } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
    return { d, size: n + 8 }
  }, [text])
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}

// A QR code that opens this page on a phone, logged in as this player if they like.
function PhoneLink({ player }) {
  const [origin, setOrigin] = useState(LOCAL.has(location.hostname) ? null : location.origin)
  const [noLan, setNoLan] = useState(false)
  const [withLogin, setWithLogin] = useState(true)

  // "localhost" means nothing to a phone, so use this machine's address on the network instead.
  useEffect(() => {
    if (origin) return
    api
      .lan()
      .then(({ address }) => {
        if (address) setOrigin(`${location.protocol}//${address}${location.port ? `:${location.port}` : ''}`)
        else {
          setNoLan(true)
          setOrigin(location.origin)
        }
      })
      .catch(() => setOrigin(location.origin))
  }, [origin])

  const url = origin && `${origin}${location.pathname}`
  const link = url && (player && withLogin ? `${url}#login=${encodeURIComponent(player.passphrase)}` : url)

  return (
    <>
      <p className="modal-text">Scan the code with your phone's camera to open this jigsaw there.</p>
      <div className="qr-wrap">{link ? <QrCode text={link} /> : <span className="spin" />}</div>
      {noLan && <p className="modal-error">This computer isn't on a network, so a phone may not be able to reach it.</p>}
      {player && (
        <button
          className={`toggle${withLogin ? ' on' : ''}`}
          role="switch"
          aria-checked={withLogin}
          onClick={() => setWithLogin((v) => !v)}
          title="Log in on the phone"
        >
          <span className="toggle-text">
            <span>Log in as {player.name}</span>
            <span className="toggle-hint">The code carries your passphrase, so only show it to your own phone.</span>
          </span>
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
        </button>
      )}
    </>
  )
}

// Icon button that opens the account dialog.
export function AccountButton() {
  const { name } = useApp()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const [shown, closing] = useLinger(open)
  return (
    <>
      <button
        className={`icon-btn${open ? ' on' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Account"
        title={name ? `Account: ${name}` : 'Account'}
      >
        <User />
      </button>
      {shown && <AccountDialog onClose={close} closing={closing} />}
    </>
  )
}

// Everything about who you are: name, passphrase, and a QR code to carry on on your phone.
export default function AccountDialog({ onClose, closing }) {
  const { player, requireName, openLogin } = useApp()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  // Rendered on the body: the settings panel it opens from would otherwise contain it.
  return createPortal(
    <div className={`modal-bg${closing ? ' closing' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal account" role="dialog" aria-label="Account">
        <div className="help-head">
          <h1>Account</h1>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Close />
          </button>
        </div>
        <div className="account-body">
          {player ? (
            <>
              <section className="field">
                <h2 className="label">Name</h2>
                <NameField />
              </section>
              <section className="field">
                <h2 className="label">Passphrase</h2>
                {shown ? (
                  <>
                    <Passphrase value={player.passphrase} />
                    <p className="modal-note">Your login. Use it to play as yourself on another device.</p>
                  </>
                ) : (
                  <button className="secondary" onClick={() => setShown(true)}>
                    <Key />
                    Show passphrase
                  </button>
                )}
              </section>
            </>
          ) : (
            <section className="field">
              <h2 className="label">Not logged in</h2>
              <div className="row">
                <button className="secondary" onClick={() => (onClose(), requireName())}>
                  <User />
                  Pick a name
                </button>
                <button className="secondary" onClick={() => (onClose(), openLogin())}>
                  <Key />
                  Log in
                </button>
              </div>
            </section>
          )}
          <section className="field">
            <h2 className="label">Phone</h2>
            <PhoneLink player={player} />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
