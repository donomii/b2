# b2 behavior specification

## Summary

b2 is an interactive procedural-landscape designer rendered in a browser. The user changes the camera, terrain, atmosphere, bloom, and colours while the scene updates continuously. The user can place up to eight rocks directly on visible terrain, keep the current design across browser reloads, and exchange complete designs as JSON files.

## Startup and files

The launcher is `/Users/jer/mygit/b2/start`. Running it serves the project at `http://localhost:8080` with no flags or configuration required.

The browser loads `/Users/jer/mygit/b2/index.html`, which starts `/Users/jer/mygit/b2/src/main.js`. Terrain intersection and landscape-format behavior live in `/Users/jer/mygit/b2/src/landscape.js`. Three.js 0.160.0, its required addons, and lil-gui 0.19.0 are stored beneath `/Users/jer/mygit/b2/vendor`, so rendering and every editor control work without an internet connection.

On startup, the application reads browser storage key `b2.landscape.v1`. A valid saved landscape replaces the defaults before the controls appear. Missing storage keeps the defaults. Unreadable or invalid storage is rejected, the defaults remain active, and Save Status explains the failure.

## Default landscape

- Camera position: `(0, 15, 30)`, looking at `(0, 0, 0)`.
- Terrain scale: `0.15`; height: `8`; octaves: `8`; detail: `0.5`; seed: a generated number from `0` through `100`.
- Sun direction: `(1, 0.5, 0.5)`; fog: `0.015`; clouds: `0.5`; water level: `1`; fractal amount: `0`; monolith amount: `0`; storm intensity: `0`.
- Bloom strength: `1.5`; radius: `0.4`; threshold: `0.85`.
- Colours: Custom sky `#bcdaff`, terrain `#aa957c`, snow `#f3f3f3`, and water `#5995bc`.
- Placed rocks: none, with a maximum of eight.

## User interactions

### Camera

Pos X moves the camera left or right, Pos Y raises or lowers it, and Pos Z moves it forward or backward. Each value ranges from `-50` through `50` and is saved after editing finishes.

### Terrain

Scale ranges from `0.01` through `2`; low values produce broad landforms and high values produce tighter features. Height ranges from `0` through `40`. Octaves ranges from `1` through `12` in whole steps. Detail ranges from `0` through `2`. Seed ranges from `0` through `100` and identifies the repeatable terrain variation. Each value is saved after editing finishes.

### Editor

Clicking visible ground casts a ray through the clicked canvas point and intersects only the generated terrain. A successful hit places the next rock at that terrain X/Z point, with its centre raised `0.8` world units so it rests on the surface. A click that misses terrain places nothing and explains the miss in Save Status. Once eight rocks exist, further clicks place nothing until Clear Rocks is used.

Clear Rocks removes all placed rocks and saves the result. Rock Count reports occupied slots as `count / 8 rocks placed`.

Save Now writes the complete current landscape to browser storage. Export JSON downloads the complete current landscape and refreshes browser storage. Import JSON accepts one `.json` file, validates every field before changing the scene, applies a valid design, and saves it to browser storage. Forget Autosave removes only the stored copy and does not change the visible landscape. Save Status reports the result of the latest placement, save, import, export, or storage action.

Randomize Seed chooses and saves a new terrain seed. Reset Camera restores position `(0, 15, 30)` looking at `(0, 0, 0)` and saves the landscape. Capture Render downloads the currently rendered frame as `bryce-render.png`.

### Environment

Sun X, Sun Y, and Sun Z each range from `-1` through `1` and aim the light. Fog ranges from `0` through `0.1` and controls distance fade. Clouds ranges from `0` through `1` and controls sky coverage. Water Level ranges from `-5` through `5`. Fractal ranges from `0` through `1` and fades the central fractal in or out. Monoliths ranges from `0` through `1` and controls the procedural monolith field. Storm Intensity ranges from `0` through `1` and controls storm sky, cloud, and lighting effects.

### Bloom

Strength ranges from `0` through `3` and controls glow intensity. Radius ranges from `0` through `1` and controls glow spread. Threshold ranges from `0` through `1` and sets the minimum brightness that glows.

### Colours

Preset offers Custom, Alpine, Mars, Arctic, and Tropical. Choosing a named preset sets sky, terrain, snow, and water together. Editing any individual six-digit hexadecimal colour keeps that value and changes the preset readout to Custom. Colour changes are saved after editing finishes.

Every control and readout has a hover explanation describing its effect and use.

## Landscape data types and JSON format

`Landscape` is the top-level exported and stored object. It contains exactly these fields:

- `version`: format version, currently `1`.
- `camera`: `CameraDesign`.
- `terrain`: `TerrainDesign`.
- `environment`: `EnvironmentDesign`.
- `bloom`: `BloomDesign`.
- `colors`: `ColourDesign`.
- `rocks`: a list of zero through eight `WorldPosition` values.

`WorldPosition` is a list of three finite world-coordinate numbers: X, Y, and Z.

`CameraDesign` contains `position` and `lookAt`, both `WorldPosition` values whose components range from `-50` through `50`.

`TerrainDesign` contains `scale`, `height`, `octaves`, `detail`, and `seed`, with the same ranges as the Terrain controls.

`EnvironmentDesign` contains `sun`, `fog`, `clouds`, `waterLevel`, `fractal`, `monolith`, and `storm`, with the same ranges as the Environment controls. `sun` is a `WorldPosition` whose components range from `-1` through `1`.

`BloomDesign` contains `strength`, `radius`, and `threshold`, with the same ranges as the Bloom controls.

`ColourDesign` contains `sky`, `terrain`, `snow`, and `water`. Every value is a string beginning with `#` followed by exactly six hexadecimal digits.

Each rock `WorldPosition` component ranges from `-100` through `100`. Unknown fields, missing fields, values of the wrong kind, non-finite numbers, out-of-range numbers, unsupported versions, and more than eight rocks make the entire landscape invalid. Invalid data is not partially applied or rewritten.

## Terrain click algorithm

The click position is converted to the same aspect-correct screen coordinates used by the landscape shader. The camera forward, horizontal, and vertical basis vectors produce a normalized world ray. The terrain distance function uses the saved terrain scale, height, octaves, and seed and matches the shader's value-noise, broad-noise, ridged-noise, and domain-warp calculations. The requested octave count controls ridged terrain detail from 1 through 12; domain-warp and broad-shape noise use the smaller of the requested count and 4. Rendering and click intersection use this same stationary surface, so placed rocks are anchored to the visible terrain at the selected octave setting.

The ray advances by the terrain distance for at most 96 samples or 100 world units. It succeeds when the distance is below the distance-adjusted surface tolerance. Non-finite travel, travel behind the camera, or travel beyond 100 world units is a miss.

## Persistence and export failures

Browser-storage read, write, and removal failures do not stop rendering. Save Status reports the underlying error. Export creation failures report the underlying error. Import parse, validation, file-read, and storage failures identify the selected filename and the underlying error. A rejected import leaves the previous landscape active.
