# Porta-Pola

Take photos in your browser and drop them straight into a polaroid or photobooth frame.

The frame is the viewfinder: your live camera shows inside the next empty photo window, and the shutter fills it and moves on.

- **Polaroid** — one square photo, with a caption in the margin.
- **Photobooth** — a 4-photo strip, a 3-photo strip, or a 2×2 grid.
- **Filters** — ten retro looks (Instant, CCD, Flash, Gold, Verde, Dream, Mono, Sepia, Cool) with film grain, vignette and light leaks, live in the viewfinder. An optional orange date stamp goes on every photo.
- **Timer** — off, 3, 5 or 10 seconds. In photobooth mode one press shoots the whole strip hands-free.
- **Flash** — lights the shot just before it is taken. On the selfie side the screen glows warm white; on a rear camera it uses the phone's torch where the browser allows it (Android Chrome).
- **Volume button** — take photos with a volume key or an earphone / Bluetooth remote button. Browsers don't expose hardware volume keys to web pages and iOS never does, so this listens for the key events on browsers that do send them, and for headset buttons through the Media Session API (which needs a silent audio track, so it is an opt-in switch).
- **Caption fonts** — pen, marker, scrawl, type, clean, and Apple's SF family (sf, sf rounded, sf mono, new york). SF can't be bundled, so those use the system fonts: real SF on iPhone, iPad and Mac, the device's default font elsewhere.
- The print looks like card stock (paper grain, fibres, a raised edge) and carries the porta·pola logo, which you can switch off.
- **Save** — exports the finished frame as a JPEG. On a phone it opens the share sheet (choose "Save Image" for Photos); on a computer it downloads.
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
assets/           logo (logo.svg, logo-mark.svg), favicon.svg, favicon-32.png, apple-touch-icon.png
css/style.css     look and layout
js/camera.js      getUserMedia, camera switching, ?fakecam demo camera
js/filters.js     the retro filter engine (per-pixel, runs live and on save)
js/logo.js        the logo as path data, drawn onto the print in the frame's ink colour
js/buttons.js     volume keys and earphone / remote buttons
js/render.js      frame geometry, paper texture, caption fonts, the canvas compositor, date stamp
js/app.js         state, controls, shutter flow
scripts/fetch-fonts.mjs   re-downloads the fonts (dev only)
```

## Not built yet

Printing, an in-app album of past frames, and props (hats, glasses, stickers).
