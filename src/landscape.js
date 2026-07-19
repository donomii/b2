export const LANDSCAPE_STORAGE_KEY = 'b2.landscape.v1';
export const LANDSCAPE_VERSION = 1;
export const MAX_USER_ROCKS = 8;
export const USER_ROCK_SURFACE_OFFSET = 0.8;

const MAX_RAY_STEPS = 96;
const MAX_RAY_DISTANCE = 100;
const SURFACE_DISTANCE = 0.005;

function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(vector, scalar) {
    return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function normalize(vector, name) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (length <= 1e-9) throw new Error(`${name} must have non-zero length; received ${JSON.stringify(vector)}`);
    return multiply(vector, 1 / length);
}

function fract(value) {
    return value - Math.floor(value);
}

function mix(a, b, amount) {
    return a * (1 - amount) + b * amount;
}

function hash(point, seed) {
    const p = point.map((value) => fract((value + seed) * 0.3183099 + 0.1) * 17);
    return fract(p[0] * p[1] * p[2] * (p[0] + p[1] + p[2]));
}

function noise(point, seed) {
    const cell = point.map(Math.floor);
    const local = point.map((value) => {
        const fraction = fract(value);
        return fraction * fraction * (3 - 2 * fraction);
    });
    const sample = (x, y, z) => hash([cell[0] + x, cell[1] + y, cell[2] + z], seed);
    const lowY = mix(sample(0, 0, 0), sample(1, 0, 0), local[0]);
    const highY = mix(sample(0, 1, 0), sample(1, 1, 0), local[0]);
    const lowZ = mix(lowY, highY, local[1]);
    const farLowY = mix(sample(0, 0, 1), sample(1, 0, 1), local[0]);
    const farHighY = mix(sample(0, 1, 1), sample(1, 1, 1), local[0]);
    const highZ = mix(farLowY, farHighY, local[1]);
    return mix(lowZ, highZ, local[2]);
}

function fbm(point, octaves, seed, ridged) {
    let value = 0;
    let amplitude = 0.5;
    let samplePoint = point;
    for (let octave = 0; octave < octaves; octave += 1) {
        const sample = noise(samplePoint, seed);
        value += (ridged ? 1 - Math.abs(sample * 2 - 1) : sample) * amplitude;
        samplePoint = multiply(samplePoint, 2);
        amplitude *= 0.5;
    }
    return value;
}

export function terrainDistanceAt(point, settings) {
    const scaled = multiply(point, settings.scale);
    const offsetX = fbm(multiply(scaled, 0.5), 4, settings.seed, false);
    const offsetY = fbm(add(multiply(scaled, 0.5), [5.2, 1.3, 2.8]), 4, settings.seed, false);
    const warped = add(scaled, [offsetX * 0.5, offsetY * 0.5, 0]);
    const ridges = fbm(warped, 8, settings.seed, true) * settings.height;
    const broad = fbm(add(multiply(scaled, 0.2), [10, 10, 10]), 4, settings.seed, false) * settings.height * 0.5;
    return point[1] - ridges - broad;
}

export function screenRay(clientX, clientY, bounds, cameraPosition, cameraLookAt) {
    if (!(bounds.width > 0) || !(bounds.height > 0)) {
        throw new Error(`canvas bounds must have positive width and height; received ${JSON.stringify(bounds)}`);
    }
    const uvX = ((clientX - bounds.left) / bounds.width - 0.5) * 2 * bounds.width / bounds.height;
    const uvY = (0.5 - (clientY - bounds.top) / bounds.height) * 2;
    const forward = normalize(subtract(cameraLookAt, cameraPosition), 'camera direction');
    const right = normalize(cross([0, 1, 0], forward), 'camera right vector');
    const up = cross(forward, right);
    return normalize(add(forward, add(multiply(right, uvX), multiply(up, uvY))), 'screen ray');
}

export function terrainHit(origin, direction, settings) {
    let travelled = 0;
    for (let step = 0; step < MAX_RAY_STEPS; step += 1) {
        const point = add(origin, multiply(direction, travelled));
        const distance = terrainDistanceAt(point, settings);
        if (distance < SURFACE_DISTANCE * (1 + travelled * 0.1)) return point;
        travelled += distance;
        if (!Number.isFinite(travelled) || travelled < 0 || travelled > MAX_RAY_DISTANCE) return null;
    }
    return null;
}

function describe(value) {
    try {
        return JSON.stringify(value);
    } catch (_error) {
        return String(value);
    }
}

function requireObject(value, path, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path} must be an object with fields ${fields.join(', ')}; received ${describe(value)}`);
    }
    const received = Object.keys(value).sort();
    const expected = [...fields].sort();
    if (received.length !== expected.length || received.some((field, index) => field !== expected[index])) {
        throw new Error(`${path} must contain exactly ${expected.join(', ')}; received ${received.join(', ') || 'no fields'}`);
    }
    return value;
}

function requireNumber(value, path, minimum, maximum) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${path} must be a number from ${minimum} to ${maximum}; received ${describe(value)}`);
    }
    return value;
}

function requireInteger(value, path, minimum, maximum) {
    const number = requireNumber(value, path, minimum, maximum);
    if (!Number.isInteger(number)) throw new Error(`${path} must be an integer; received ${describe(value)}`);
    return number;
}

function requireVector(value, path, minimum, maximum) {
    if (!Array.isArray(value) || value.length !== 3) {
        throw new Error(`${path} must be an array of three numbers; received ${describe(value)}`);
    }
    return value.map((component, index) => requireNumber(component, `${path}[${index}]`, minimum, maximum));
}

function requireColor(value, path) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        throw new Error(`${path} must be a six-digit hexadecimal colour such as #80b3ff; received ${describe(value)}`);
    }
    return value;
}

export function validateLandscape(value) {
    const landscape = requireObject(value, 'landscape', ['version', 'camera', 'terrain', 'environment', 'bloom', 'colors', 'rocks']);
    if (landscape.version !== LANDSCAPE_VERSION) {
        throw new Error(`landscape.version must be ${LANDSCAPE_VERSION}; received ${describe(landscape.version)}`);
    }
    const camera = requireObject(landscape.camera, 'landscape.camera', ['position', 'lookAt']);
    const terrain = requireObject(landscape.terrain, 'landscape.terrain', ['scale', 'height', 'octaves', 'detail', 'seed']);
    const environment = requireObject(landscape.environment, 'landscape.environment', ['sun', 'fog', 'clouds', 'waterLevel', 'fractal', 'monolith', 'storm']);
    const bloom = requireObject(landscape.bloom, 'landscape.bloom', ['strength', 'radius', 'threshold']);
    const colors = requireObject(landscape.colors, 'landscape.colors', ['sky', 'terrain', 'snow', 'water']);
    if (!Array.isArray(landscape.rocks) || landscape.rocks.length > MAX_USER_ROCKS) {
        throw new Error(`landscape.rocks must be an array with at most ${MAX_USER_ROCKS} positions; received ${describe(landscape.rocks)}`);
    }
    return {
        version: LANDSCAPE_VERSION,
        camera: {
            position: requireVector(camera.position, 'landscape.camera.position', -50, 50),
            lookAt: requireVector(camera.lookAt, 'landscape.camera.lookAt', -50, 50)
        },
        terrain: {
            scale: requireNumber(terrain.scale, 'landscape.terrain.scale', 0.01, 2),
            height: requireNumber(terrain.height, 'landscape.terrain.height', 0, 40),
            octaves: requireInteger(terrain.octaves, 'landscape.terrain.octaves', 1, 12),
            detail: requireNumber(terrain.detail, 'landscape.terrain.detail', 0, 2),
            seed: requireNumber(terrain.seed, 'landscape.terrain.seed', 0, 100)
        },
        environment: {
            sun: requireVector(environment.sun, 'landscape.environment.sun', -1, 1),
            fog: requireNumber(environment.fog, 'landscape.environment.fog', 0, 0.1),
            clouds: requireNumber(environment.clouds, 'landscape.environment.clouds', 0, 1),
            waterLevel: requireNumber(environment.waterLevel, 'landscape.environment.waterLevel', -5, 5),
            fractal: requireNumber(environment.fractal, 'landscape.environment.fractal', 0, 1),
            monolith: requireNumber(environment.monolith, 'landscape.environment.monolith', 0, 1),
            storm: requireNumber(environment.storm, 'landscape.environment.storm', 0, 1)
        },
        bloom: {
            strength: requireNumber(bloom.strength, 'landscape.bloom.strength', 0, 3),
            radius: requireNumber(bloom.radius, 'landscape.bloom.radius', 0, 1),
            threshold: requireNumber(bloom.threshold, 'landscape.bloom.threshold', 0, 1)
        },
        colors: {
            sky: requireColor(colors.sky, 'landscape.colors.sky'),
            terrain: requireColor(colors.terrain, 'landscape.colors.terrain'),
            snow: requireColor(colors.snow, 'landscape.colors.snow'),
            water: requireColor(colors.water, 'landscape.colors.water')
        },
        rocks: landscape.rocks.map((rock, index) => requireVector(rock, `landscape.rocks[${index}]`, -100, 100))
    };
}
