/* Camera access. Also offers a synthetic camera (?fakecam) so the whole
 * capture flow can be exercised on machines without a webcam. */
(function (PP) {
  'use strict';

  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.autoplay = true;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);

  const useFake = new URLSearchParams(location.search).has('fakecam');
  let stream = null;
  let fakeTimer = 0;
  let starting = 0; // token to discard superseded start() calls

  class CameraError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  function classify(err) {
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return new CameraError('denied', 'Camera access is blocked.');
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return new CameraError('none', 'No camera found.');
    if (n === 'NotReadableError' || n === 'AbortError') return new CameraError('busy', 'The camera is in use by another app.');
    return new CameraError('error', (err && err.message) || 'The camera could not start.');
  }

  function fakeStream() {
    const cv = document.createElement('canvas');
    cv.width = 1280; cv.height = 720;
    const ctx = cv.getContext('2d');
    const t0 = performance.now();
    function frame() {
      const t = (performance.now() - t0) / 1000;
      const g = ctx.createLinearGradient(0, 0, 1280, 720);
      g.addColorStop(0, `hsl(${(200 + t * 12) % 360} 70% 62%)`);
      g.addColorStop(1, `hsl(${(330 + t * 12) % 360} 75% 68%)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath(); ctx.arc(1030 + Math.sin(t) * 60, 170 + Math.cos(t * 1.3) * 30, 90, 0, 7); ctx.fill();
      ctx.fillStyle = '#3b8f5a';
      ctx.beginPath(); ctx.ellipse(300, 760, 620, 190, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(1000, 780, 520, 150, 0, 0, 7); ctx.fill();
      const bob = Math.sin(t * 3) * 14;
      ctx.fillStyle = '#2b2f6b';
      ctx.beginPath(); ctx.ellipse(640, 640 + bob, 190, 200, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#f5c9a0';
      ctx.beginPath(); ctx.arc(640, 340 + bob, 130, 0, 7); ctx.fill();
      ctx.fillStyle = '#20222b';
      ctx.beginPath(); ctx.arc(595, 320 + bob, 14, 0, 7); ctx.arc(685, 320 + bob, 14, 0, 7); ctx.fill();
      ctx.lineWidth = 12; ctx.strokeStyle = '#20222b'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(640, 350 + bob, 62, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.font = '600 34px monospace';
      ctx.fillText('DEMO CAMERA  ' + t.toFixed(1) + 's', 36, 60);
    }
    frame();
    fakeTimer = setInterval(frame, 33);
    return cv.captureStream(30);
  }

  /** opts: { facing: 'user'|'environment', deviceId } */
  async function start(opts) {
    opts = opts || {};
    const token = ++starting;
    stop();
    if (useFake) {
      stream = fakeStream();
    } else {
      if (!window.isSecureContext) throw new CameraError('insecure', 'The camera needs https or localhost.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new CameraError('unsupported', 'This browser has no camera access.');
      const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      let constraints;
      if (opts.deviceId) constraints = { audio: false, video: Object.assign({ deviceId: { exact: opts.deviceId } }, base) };
      else constraints = { audio: false, video: Object.assign({ facingMode: { ideal: opts.facing || 'user' } }, base) };
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        if (err && err.name === 'OverconstrainedError') {
          try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); }
          catch (e2) { throw classify(e2); }
        } else throw classify(err);
      }
    }
    if (token !== starting) { stopTracks(stream); throw new CameraError('superseded', 'Superseded'); }
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay quirks: the metadata wait below still works */ }
    if (!video.videoWidth) {
      await new Promise(res => { video.onloadedmetadata = res; setTimeout(res, 3000); });
    }
    if (!video.videoWidth) throw new CameraError('error', 'The camera did not produce video.');
    const track = stream.getVideoTracks()[0];
    const s = track && track.getSettings ? track.getSettings() : {};
    return { facing: s.facingMode || (opts.facing || 'user'), facingKnown: !!s.facingMode, deviceId: s.deviceId };
  }

  function stopTracks(s) { if (s) s.getTracks().forEach(t => t.stop()); }

  function stop() {
    clearInterval(fakeTimer);
    stopTracks(stream);
    stream = null;
    video.srcObject = null;
  }

  async function videoInputs() {
    if (useFake) return [{ deviceId: 'fake-a' }, { deviceId: 'fake-b' }];
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); }
    catch (e) { return []; }
  }

  PP.camera = {
    video, start, stop, videoInputs, CameraError,
    get active() { return !!stream; },
    get fake() { return useFake; },
  };
})(window.PP = window.PP || {});
