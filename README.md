# b2

Real-time 3D landscape renderer inspired by Bryce 3D. Procedurally generates terrain using ray marching in WebGL, with an interactive GUI for tweaking every parameter live.

## Quick start

```
npm install
npm run dev
```

Open the URL printed by Vite (default `http://localhost:5173`).

## Build

```
npm run build    # output in dist/
npm run preview  # serve the production build locally
```

## Controls

Everything is adjusted through the in-browser GUI panel. There are no config files.

### Camera
| Parameter | Range | Effect |
|-----------|-------|--------|
| Pos X / Y / Z | -50 – 50 | Camera position in world space |

### Terrain
| Parameter | Range | Effect |
|-----------|-------|--------|
| Scale | 0.01 – 2.0 | Noise frequency — lower = broader features |
| Height | 0 – 40 | Maximum terrain elevation |
| Octaves | 1 – 12 | Noise detail passes — higher = more complexity |
| Detail | 0 – 2.0 | Tri-planar texture blending strength |
| Seed | 0 – 100 | Regenerates the landscape with a different random seed |

### Environment
| Parameter | Range | Effect |
|-----------|-------|--------|
| Sun X / Y / Z | -1 – 1 | Sun direction vector |
| Fog | 0 – 0.1 | Atmospheric fog density |
| Water Level | -5 – 5 | Height of the water plane |
| Fractal | 0 – 1 | Fades in a Mandelbulb fractal object |

### Bloom
| Parameter | Range | Effect |
|-----------|-------|--------|
| Strength | 0 – 3 | Bloom intensity |
| Radius | 0 – 1 | Bloom spread |
| Threshold | 0 – 1 | Minimum brightness to bloom |

### Colors
Three presets (Alpine, Mars, Arctic) set sky, terrain, snow, and water colors together. Individual color pickers let you override any of them.

### Placing objects
Click anywhere on the rendered scene to drop a rock at that location (up to 8 total). **Clear Placed Objects** removes them all.

## How it works

The fragment shader ray-marches signed distance functions (SDFs) to render everything on the GPU:

- **Terrain** — fractional Brownian motion (FBM) + ridged noise for mountain shapes
- **Water** — separate ray-plane intersection with Fresnel reflections
- **Trees** — cylinder trunk + cone foliage, placed in a 4×4 unit grid, culled beyond 30 units
- **Rocks** — noise-displaced spheres; up to 8 user-placed instances
- **Mandelbulb** — iterative fractal SDF, toggled by the Fractal slider
- **Lighting** — shadow rays, ambient occlusion, slope-based snow/rock material blending, specular snow
- **Post-processing** — UnrealBloomPass via Three.js EffectComposer

The entire application is `src/main.ts` (one file, ~500 lines).

## Stack

- [Three.js](https://threejs.org/) — WebGL renderer + post-processing
- [lil-gui](https://lil-gui.georgealways.com/) — parameter GUI
- [Vite](https://vitejs.dev/) — dev server and bundler
- TypeScript (strict)
