import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../App.jsx'
import { Changelog as ChangelogIcon, External, Gear, GitHub, Lock, Logout, Moon, Sound, User } from './icons.jsx'
import Changelog from './Changelog.jsx'
import AccountDialog, { LogoutConfirm } from './AccountDialog.jsx'
import { useLinger } from '../lib/linger.js'
import PrivateRoom from './PrivateRoom.jsx'

// Header button that toggles a small settings panel: account, dark mode, sounds, changelog, source link and log out.
// In a private jigsaw it also has a button that shows its link.
export default function Settings({ privateRoom = false }) {
  const { theme, toggleTheme, sound, toggleSound, player, roomId } = useApp()
  const [sharing, setSharing] = useState(false)
  const closeSharing = useCallback(() => setSharing(false), [])
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState(false)
  const closeAccount = useCallback(() => setAccount(false), [])
  const [accountShown, accountClosing] = useLinger(account)
  const [changelog, setChangelog] = useState(false)
  const closeChangelog = useCallback(() => setChangelog(false), [])
  const [changelogShown, changelogClosing] = useLinger(changelog)
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
          <button className="settings-row" role="menuitemcheckbox" aria-checked={sound} onClick={toggleSound}>
            <Sound />
            <span>Sounds</span>
            <span className={`switch${sound ? ' on' : ''}`} aria-hidden="true" />
          </button>
          <button
            className="settings-row"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setChangelog(true)
            }}
          >
            <ChangelogIcon />
            <span>Changelog</span>
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
      {changelogShown && <Changelog onClose={closeChangelog} closing={changelogClosing} />}
      {leaving && <LogoutConfirm onDone={stay} />}
    </span>
  )
}
