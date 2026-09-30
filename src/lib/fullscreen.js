import { useEffect, useState } from 'react'

// Fullscreen for the whole page (Safari still only has the prefixed version).
export const fullscreenEl = () => document.fullscreenElement || document.webkitFullscreenElement || null
export const canFullscreen = () => {
  const el = document.documentElement
  return !!(el.requestFullscreen || el.webkitRequestFullscreen)
}
export function toggleFullscreen() {
  if (fullscreenEl()) return (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
  const el = document.documentElement
  const go = el.requestFullscreen || el.webkitRequestFullscreen
  const done = go?.call(el, { navigationUI: 'hide' })
  // Normally Escape always leaves fullscreen. Where the browser lets us keep it (Chrome, Edge),
  // Escape clears the selection first (see Room), and holding it down leaves fullscreen.
  done?.then?.(() => navigator.keyboard?.lock?.(['Escape']).catch(() => {}), () => {})
}

// Browsers report no safe area for the notch on MacBooks, even in fullscreen. Those screens are
// 16:10 plus a strip at the top for the notch (1512x982 is 1512x945 and 37 more, at any scaling),
// so on a Mac the extra height over 16:10, if it is a few percent, is the notch.
function notchHeight() {
  if (!/Mac/.test(navigator.platform) || navigator.maxTouchPoints > 1) return 0
  const extra = screen.height - screen.width / 1.6
  return extra > screen.height * 0.025 && extra < screen.height * 0.055 ? Math.round(extra) : 0
}

export function useFullscreen() {
  const [on, setOn] = useState(() => !!fullscreenEl())
  useEffect(() => {
    const change = () => {
      setOn(!!fullscreenEl())
      if (!fullscreenEl()) navigator.keyboard?.unlock?.()
    }
    document.addEventListener('fullscreenchange', change)
    document.addEventListener('webkitfullscreenchange', change)
    return () => {
      document.removeEventListener('fullscreenchange', change)
      document.removeEventListener('webkitfullscreenchange', change)
    }
  }, [])
  return on
}

// The notch's height in px while in fullscreen on a MacBook that has one, otherwise 0.
export function useNotch() {
  return useFullscreen() ? notchHeight() : 0
}
