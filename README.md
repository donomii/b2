# Modern Bryce3D Procedural Engine

A modern, WebGL-based procedural landscape generator inspired by the classic Bryce3D software. This engine uses raymarching, Signed Distance Fields (SDFs), and demoscene techniques to create infinite, interactive vistas.

## Features

- **Infinite Procedural Terrain:** Jagged mountains using Ridged fBm and domain warping with distance-based LOD.
- **Dynamic Atmosphere:** Procedural sky with moving clouds, a dynamic sun, and exponential fog.
- **Recursive Reflections:** Realistic water plane with procedural waves and Fresnel-based reflections of the environment.
- **Advanced Lighting:** Multi-component model featuring hemisphere sky lighting, ground bounce, soft shadows, and ambient occlusion to avoid stark shadows.
- **Procedural Objects:** Conical trees, Mandelbulb fractals, and hexagonal Monoliths.
- **Interactive Editor:** Navigate freely with mouse click-and-drag (OrbitControls) and click anywhere on the landscape to place rocks.
- **Real-time Controls:** Adjustable environment parameters and color presets (Alpine, Mars, Arctic) via a GUI.
- **Cinematic Output:** ACES filmic tone mapping with an adjustable exposure control, plus UnrealBloom, for highlights that compress instead of clipping to white.
- **Image Export:** One-click (or one-keypress) PNG snapshots of the final render, plus a programmatic capture API for headless verification.

## Quick Start

This project requires no build steps or dependencies. It uses standard JavaScript and ESM imports from CDNs.

To run the application locally, you just need a simple HTTP server. You can use the provided start script:

```bash
./start
```

Or run manually with Python:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Exporting Images

Capture a PNG snapshot of the current render in any of three ways:

- Click **Capture Render** in the Colors folder of the GUI.
- Press the **P** key.
- Programmatically: `window.bryceApp.captureDataURL()` returns a `data:image/png` URL,
  and `window.bryceApp.downloadImage('name.png')` triggers a download. This is handy for
  automated/headless verification that the scene is actually drawing.

The renderer is created with `preserveDrawingBuffer: true` so the back buffer stays
readable for export. If the host window reports a zero size (some embedded/headless
contexts), the canvas falls back to 1280x720 so snapshots are never blank.


## Technical Details

- **Language:** Vanilla JavaScript (ESM)
- **Engine:** Three.js (Raymarching via Fragment Shader)
- **Techniques:** SDF Primitives, Fractal Brownian Motion, Tri-planar Mapping, ACES filmic tone mapping, and UnrealBloom post-processing.
