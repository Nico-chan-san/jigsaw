import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Back, Close } from './icons.jsx'

// Every window over the board: a title with actions (buttons) and close at the top, an optional
// bar under it (for tabs and buttons that stay put), and a body that scrolls. Rendered on the
// body, so a panel it opens from can't contain it. Without onClose it can't be dismissed.
// Escape closes it, except in a text field with keepTyping (so a half filled form isn't lost).
export default function Dialog({
  title,
  label = title,
  className = '',
  bodyClass = '',
  bg = '',
  onBack,
  backTitle = 'Back',
  onClose,
  closing,
  closeButton = true,
  keepTyping = false,
  actions,
  bar,
  footer,
  children,
}) {
  useEffect(() => {
    if (!onClose || closing) return
    const key = (e) => {
      if (e.key !== 'Escape') return
      if (keepTyping && e.target?.closest?.('input, textarea')) return
      onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, closing, keepTyping])

  return createPortal(
    <div
      className={`modal-bg${bg ? ` ${bg}` : ''}${closing ? ' closing' : ''}`}
      onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className={`modal dialog ${className}`} role="dialog" aria-label={label}>
        <div className="dialog-head">
          <div className="dialog-title">
            {onBack && (
              <button type="button" className="icon-btn" onClick={onBack} aria-label="Back" title={backTitle}>
                <Back />
              </button>
            )}
            {title && <h1>{title}</h1>}
          </div>
          <div className="dialog-actions">
            {actions}
            {onClose && closeButton && (
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
                <Close />
              </button>
            )}
          </div>
        </div>
        {bar && <div className="dialog-bar">{bar}</div>}
        <div className={`dialog-body ${bodyClass}`}>{children}</div>
        {footer}
      </div>
    </div>,
    document.body,
  )
}

// Tabs in a row, one of them on. tabs is a list of { key, title, hint }.
export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`tab${t.key === value ? ' on' : ''}`}
          role="tab"
          aria-selected={t.key === value}
          onClick={() => onChange(t.key)}
          title={t.hint || t.title}
        >
          {t.title}
        </button>
      ))}
    </div>
  )
}
