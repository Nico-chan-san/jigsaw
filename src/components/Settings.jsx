import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import { External, Gear, GitHub, Lock, Logout, Moon, User } from './icons.jsx'
import AccountDialog from './AccountDialog.jsx'
import { useLinger } from '../lib/linger.js'
import { Passphrase } from './Account.jsx'
import Confirm from './Confirm.jsx'
import PrivateRoom from './PrivateRoom.jsx'

// Header button that toggles a small settings panel: account, dark mode, source link and log out.
// In a private jigsaw it also has a button that shows its link.
export default function Settings({ privateRoom = false }) {
  const { theme, toggleTheme, player, logout, roomId } = useApp()
  const [sharing, setSharing] = useState(false)
  const closeSharing = useCallback(() => setSharing(false), [])
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState(false)
  const closeAccount = useCallback(() => setAccount(false), [])
  const [accountShown, accountClosing] = useLinger(account)
  const [leaving, setLeaving] = useState(false)
  const stay = useCallback(() => setLeaving(false), [])
  const wrap = useRef(null)
  const dark = theme === 'dark'

  // Close on a press anywhere else, or Escape.
  useEffect(() => {
    if (!open) return
    const away = (e) => !wrap.current?.contains(e.target) && setOpen(false)
    const key = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <span className="settings" ref={wrap}>
      <button
        className={`icon-btn${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        aria-expanded={open}
        title="Settings"
      >
        <Gear />
      </button>
      {open && (
        <div className="settings-menu" role="menu">
          <h2 className="label">Settings</h2>
          <button
            className="settings-row"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setAccount(true)
            }}
          >
            <User />
            <span>Account</span>
          </button>
          {privateRoom && (
            <button
              className="settings-row"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                setSharing(true)
              }}
            >
              <Lock />
              <span>Private room</span>
            </button>
          )}
          <button className="settings-row" role="menuitemcheckbox" aria-checked={dark} onClick={toggleTheme}>
            <Moon />
            <span>Dark mode</span>
            <span className={`switch${dark ? ' on' : ''}`} aria-hidden="true" />
          </button>
          <a
            className="settings-row"
            role="menuitem"
            href="https://github.com/mebn/jigsaw"
            title="Opens in a new tab"
            aria-label="Source on GitHub (opens in a new tab)"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHub />
            <span>Source on GitHub</span>
            <External className="settings-ext" />
          </a>
          {player && (
            <button
              className="settings-row danger"
              onClick={() => {
                setOpen(false)
                setLeaving(true)
              }}
            >
              <Logout />
              <span>Log out</span>
            </button>
          )}
        </div>
      )}
      {sharing && roomId && <PrivateRoom id={roomId} onClose={closeSharing} />}
      {accountShown && <AccountDialog onClose={closeAccount} closing={accountClosing} />}
      {leaving && player && (
        <Confirm
          title={`Log out ${player.name}?`}
          text={
            player.email
              ? `You can log back in with ${player.email} and your password.`
              : 'You can log back in with your passphrase:'
          }
          action="Log out"
          danger
          onCancel={stay}
          onConfirm={() => {
            logout()
            setLeaving(false)
          }}
        >
          {!player.email && <Passphrase value={player.passphrase} />}
        </Confirm>
      )}
    </span>
  )
}
