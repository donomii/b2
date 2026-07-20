import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    MAX_USER_ROCKS,
    LANDSCAPE_VERSION,
    screenRay,
    terrainDistanceAt,
    terrainHit,
    validateLandscape
} from '../src/landscape.js';

function landscapeData() {
    return {
        version: LANDSCAPE_VERSION,
        camera: { position: [0, 15, 30], lookAt: [0, 0, 0] },
        terrain: { scale: 0.15, height: 8, octaves: 8, detail: 0.5, seed: 42 },
        environment: { sun: [1, 0.5, 0.5], fog: 0.015, clouds: 0.5, waterLevel: 1, fractal: 0, monolith: 0, storm: 0 },
        bloom: { strength: 1.5, radius: 0.4, threshold: 0.85 },
        colors: { sky: '#80b3ff', terrain: '#664d33', snow: '#e6e6e6', water: '#1a4d80' },
        rocks: []
    };
}

test('the centre click ray follows the camera look-at direction', () => {
    const ray = screenRay(400, 300, { left: 0, top: 0, width: 800, height: 600 }, [0, 15, 30], [0, 0, 0]);
    assert.deepEqual(ray, [0, -0.447213595499958, -0.894427190999916]);
});

test('horizontal click position follows the shader horizontal basis', () => {
    const bounds = { left: 0, top: 0, width: 800, height: 600 };
    const left = screenRay(200, 300, bounds, [0, 15, 30], [0, 0, 0]);
    const right = screenRay(600, 300, bounds, [0, 15, 30], [0, 0, 0]);
    assert.ok(left[0] > 0, `screen-left should use the shader's positive world-X ray; received x=${left[0]}`);
    assert.ok(right[0] < 0, `screen-right should use the shader's negative world-X ray; received x=${right[0]}`);
});

test('terrain ray marching returns the clicked terrain surface', () => {
    const origin = [0, 15, 30];
    const settings = { scale: 0.15, height: 8, seed: 42 };
    const direction = screenRay(400, 300, { left: 0, top: 0, width: 800, height: 600 }, origin, [0, 0, 0]);
    const hit = terrainHit(origin, direction, settings);
    assert.ok(hit, 'the centre camera ray should hit generated terrain');
    assert.ok(Math.abs(terrainDistanceAt(hit, settings)) < 0.02, `hit should lie on terrain; received distance=${terrainDistanceAt(hit, settings)}`);
});

test('landscape validation accepts the complete exported format', () => {
    const landscape = landscapeData();
    landscape.rocks = [[1, 2, 3], [-4, 5, 6]];
    assert.deepEqual(validateLandscape(landscape), landscape);
});

test('landscape validation rejects unknown fields and excess rocks', () => {
    const unknownField = landscapeData();
    unknownField.unexpected = true;
    assert.throws(() => validateLandscape(unknownField), /must contain exactly/);

    const excessRocks = landscapeData();
    excessRocks.rocks = Array.from({ length: MAX_USER_ROCKS + 1 }, () => [0, 0, 0]);
    assert.throws(() => validateLandscape(excessRocks), /at most 8 positions/);
});

test('browser runtime dependencies are complete and local', async () => {
    const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(index, /"three": "\/vendor\/three\/three\.module\.js"/);
    assert.doesNotMatch(main, /from\s+['"]https?:\/\//);

    const vendoredModules = [
        '../vendor/three/three.module.js',
        '../vendor/three/addons/controls/OrbitControls.js',
        '../vendor/three/addons/postprocessing/EffectComposer.js',
        '../vendor/three/addons/postprocessing/RenderPass.js',
        '../vendor/three/addons/postprocessing/UnrealBloomPass.js',
        '../vendor/three/addons/postprocessing/Pass.js',
        '../vendor/three/addons/postprocessing/ShaderPass.js',
        '../vendor/three/addons/postprocessing/MaskPass.js',
        '../vendor/three/addons/shaders/CopyShader.js',
        '../vendor/three/addons/shaders/LuminosityHighPassShader.js',
        '../vendor/lil-gui/lil-gui.esm.js'
    ];
    for (const modulePath of vendoredModules) {
        const moduleUrl = new URL(modulePath, import.meta.url);
        const source = await readFile(moduleUrl, 'utf8');
        for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
            const dependency = match[1];
            if (dependency === 'three') {
                assert.match(index, /"three": "\/vendor\/three\/three\.module\.js"/);
            } else {
                assert.ok(dependency.startsWith('.'), `${modulePath} has non-local dependency ${dependency}`);
                await readFile(new URL(dependency, moduleUrl), 'utf8');
            }
        }
    }

    const threeSource = await readFile(new URL('../vendor/three/three.module.js', import.meta.url), 'utf8');
    const guiSource = await readFile(new URL('../vendor/lil-gui/lil-gui.esm.js', import.meta.url), 'utf8');
    assert.match(threeSource, /const REVISION = '160';/);
    assert.match(guiSource, /@version 0\.19\.0/);
});
