// Sound effects, made on the fly with Web Audio (no files to load). Off with the Sounds setting.
let ctx = null
let on = true

export const setSound = (v) => {
  on = v
}

// The audio context. Browsers only let it play once the player has pressed something on the page,
// so it's started on the first press, ready for the first click. Until then this stays quiet.
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx.state === 'running' ? ctx : null
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => on && audio(), { capture: true, passive: true })

// A short wooden click, like two pieces pressed together. Bigger joins (more seams at once) sound a
// little lower and fuller; other players' joins are quieter than your own.
export function playSnap({ seams = 1, local = true } = {}) {
  if (!on) return
  const a = audio()
  if (!a) return
  const t = a.currentTime + 0.01
  const size = Math.min(1, (seams - 1) / 8)
  const volume = (local ? 0.5 : 0.18) * (1 + size * 0.4)
  const pitch = (1 - size * 0.25) * (0.94 + Math.random() * 0.12)

  const out = a.createGain()
  out.gain.value = volume
  out.connect(a.destination)

  // The knock: a tone that drops fast.
  const tone = a.createOscillator()
  const toneGain = a.createGain()
  tone.type = 'triangle'
  tone.frequency.setValueAtTime(1100 * pitch, t)
  tone.frequency.exponentialRampToValueAtTime(420 * pitch, t + 0.05)
  toneGain.gain.setValueAtTime(0.0001, t)
  toneGain.gain.exponentialRampToValueAtTime(1, t + 0.003)
  toneGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
  tone.connect(toneGain).connect(out)
  tone.start(t)
  tone.stop(t + 0.1)

  // The click: a burst of filtered noise on top.
  const len = Math.round(a.sampleRate * 0.03)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  const noise = a.createBufferSource()
  noise.buffer = buf
  const band = a.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2600 * pitch
  band.Q.value = 1.2
  const noiseGain = a.createGain()
  noiseGain.gain.value = 0.7
  noise.connect(band).connect(noiseGain).connect(out)
  noise.start(t)

  tone.onended = () => out.disconnect()
}
