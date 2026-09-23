/* Hardware shutter buttons.
 *
 * Browsers do not expose a phone's volume keys to web pages, and iOS never does. This covers what
 * is possible:
 *   - keydown events for volume keys, on the browsers and devices that pass them through, and
 *   - earphone / Bluetooth-remote buttons (play, pause, next, previous) through the Media Session API.
 *     Those only reach a page while it is playing audio, so this plays a silent track. That can pause
 *     other audio on the phone, which is why it is a switch the person turns on.
 */
(function (PP) {
  'use strict';

  const KEYS = new Set(['AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown']);
  const CODES = new Set([24, 25, 174, 175]); // Android and Windows volume key codes
  const ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack'];

  let onPress = null, enabled = false, audio = null, url = null;

  document.addEventListener('keydown', (e) => {
    if (!enabled || !onPress || e.repeat) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (KEYS.has(e.key) || CODES.has(e.keyCode)) { e.preventDefault(); onPress(); }
  });

  /** Ten seconds of silence: Chrome only shows media controls for tracks of a few seconds or more. */
  function silentWav() {
    const rate = 8000, n = rate * 10, bytes = new Uint8Array(44 + n).fill(0x80);
    const v = new DataView(bytes.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true);
    return new Blob([bytes], { type: 'audio/wav' });
  }

  function keepPlaying() { if (audio && audio.paused) audio.play().catch(() => { /* needs a tap first */ }); }

  function startSession() {
    if (!('mediaSession' in navigator)) return false;
    url = URL.createObjectURL(silentWav());
    audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.05;
    audio.play().catch(() => { /* blocked until the page has been tapped; the next tap retries */ });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Take a photo', artist: 'Porta-Pola' });
      navigator.mediaSession.playbackState = 'playing';
      ACTIONS.forEach(a => navigator.mediaSession.setActionHandler(a, () => { if (onPress) onPress(); keepPlaying(); }));
    } catch (e) { return false; }
    return true;
  }

  function stopSession() {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
    if (url) { URL.revokeObjectURL(url); url = null; }
    if ('mediaSession' in navigator) {
      try {
        ACTIONS.forEach(a => navigator.mediaSession.setActionHandler(a, null));
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      } catch (e) { /* ignore */ }
    }
  }

  // no silent audio (and no lock-screen controls) while the page is in the background
  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.pause(); else keepPlaying();
  });

  PP.buttons = {
    get enabled() { return enabled; },
    /** Start listening; call from a tap so the browser lets the silent track play. */
    enable(fn) { onPress = fn; enabled = true; stopSession(); startSession(); },
    disable() { enabled = false; stopSession(); },
  };
})(window.PP = window.PP || {});
