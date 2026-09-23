# Porta-Pola

Take photos in your browser and drop them straight into a polaroid or photobooth frame.

The frame is the viewfinder: your live camera shows inside the next empty photo window, and the shutter fills it and moves on.

- **Polaroid** — one square photo, with a caption in the margin.
- **Photobooth** — a 4-photo strip, a 3-photo strip, or a 2×2 grid.
- Tap a finished photo to retake just that one. Pick a frame color, add a caption, flip cameras, mirror on or off.

No build step and no dependencies: plain HTML, CSS and JavaScript. Fonts are self-hosted in `fonts/`.

## Run it

The camera only works on `https` or `localhost`, so serve the folder instead of opening the file directly:

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>.

### On your phone

Phone browsers only allow the camera on `https`, and "localhost" on a phone is the phone itself, so serve over HTTPS on your Wi-Fi instead:

```bash
node scripts/serve-https.mjs
```

Open the `https://<your-pc-ip>:8443` address it prints, on a phone that is on the same Wi-Fi. The browser warns about the certificate (it is self-signed, created locally in `.certs/`); choose Advanced, then continue. If the page never loads, allow Node.js through Windows Firewall on private networks.

No webcam handy? Open <http://localhost:5173/?fakecam> for a built-in demo camera.

## Layout

```
index.html        page
css/style.css     look and layout
js/camera.js      getUserMedia, camera switching, ?fakecam demo camera
js/render.js      frame geometry and the canvas compositor
js/app.js         state, controls, shutter flow
scripts/fetch-fonts.mjs   re-downloads the fonts (dev only)
```

## Not built yet

Saving or printing the finished frame, an album, filters, and a self-timer. The compositor in `js/render.js` already draws the whole frame to a canvas, so export is the natural next step.
