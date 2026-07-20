import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/addons/controls/OrbitControls.js';
import { EffectComposer } from '/vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/three/addons/postprocessing/UnrealBloomPass.js';
import GUI from '/vendor/lil-gui/lil-gui.esm.js';
import {
    LANDSCAPE_STORAGE_KEY,
    LANDSCAPE_VERSION,
    MAX_USER_ROCKS,
    USER_ROCK_SURFACE_OFFSET,
    screenRay,
    terrainHit,
    validateLandscape
} from './landscape.js';

const COLOR_PRESETS = {
    Alpine: { sky: '#80b3ff', terrain: '#664d33', snow: '#e6e6e6', water: '#1a4d80' },
    Mars: { sky: '#ff9966', terrain: '#802b00', snow: '#ffccb3', water: '#4d1a00' },
    Arctic: { sky: '#e6f2ff', terrain: '#b3ccd9', snow: '#ffffff', water: '#80b3cc' },
    Tropical: { sky: '#00ccff', terrain: '#1a4d00', snow: '#ffffff', water: '#00ffcc' }
};

console.log("BryceApp: Modules loaded");

const vertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

const fragmentShader = `
varying vec2 vUv;
uniform float iTime;
uniform vec2 iResolution;
uniform vec3 iCameraPos;
uniform mat4 iCameraMatrix;

uniform float uTerrainScale;
uniform float uTerrainHeight;
uniform int uOctaves;

uniform vec3 uSunDir;
uniform float uFogDensity;
uniform float uCloudDensity;
uniform vec3 uSkyColor;
uniform vec3 uTerrainColor;
uniform vec3 uSnowColor;

uniform float uWaterLevel;
uniform vec3 uWaterColor;
uniform float uTerrainDetail;
uniform float uSeed;
uniform float uFractalAmount;
uniform float uMonolithAmount;
uniform float uStormAmount;
uniform vec3 uUserObjects[8];
uniform float uNumUserObjects;

const int MAX_STEPS = 64;
const float MAX_DIST = 100.0;
const float SURF_DIST = 0.01;

float hash(vec3 p) {
    p += uSeed;
    vec3 p3 = fract(p * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 8; i++) {
        if(i >= octaves) break;
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

float ridgedFbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 8; i++) {
        if(i >= octaves) break;
        float n = noise(p);
        n = 1.0 - abs(n * 2.0 - 1.0);
        value += n * amplitude;
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

float triPlanarNoise(vec3 p, vec3 n) {
    vec3 m = pow(abs(n), vec3(8.0));
    float sum = m.x + m.y + m.z;
    m /= (sum + 0.0001);
    float x = noise(vec3(p.yz * 8.0, 0.0));
    float y = noise(vec3(p.xz * 8.0, 0.0));
    float z = noise(vec3(p.xy * 8.0, 0.0));
    return x * m.x + y * m.y + z * m.z;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdCylinder(vec3 p, float h, float r) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdCone(vec3 p, vec2 c, float h) {
    float q = length(p.xz);
    return max(dot(c.xy, vec2(q, p.y)), -h - p.y);
}

float TreeSDF(vec3 p, float scale) {
    float trunk = sdCylinder(p - vec3(0, 0.5 * scale, 0), 0.5 * scale, 0.1 * scale);
    float foliage = sdCone(p - vec3(0, 2.0 * scale, 0), vec2(0.8, 0.6), 1.5 * scale);
    return min(trunk, foliage);
}

float sdHexPrism(vec3 p, vec2 h) {
    const vec3 k = vec3(-0.8660254, 0.5, 0.5773502);
    p = abs(p);
    p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
    vec2 d = vec2(
        length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x),
        p.z - h.y
    );
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float Mandelbulb(vec3 p) {
    vec3 w = p;
    float m = dot(w, w);
    float dz = 1.0;
    for (int i = 0; i < 8; i++) {
        dz = 8.0 * pow(m, 3.5) * dz + 1.0;
        float r = length(w);
        float b = 8.0 * acos(w.y / r);
        float a = 8.0 * atan(w.x, w.z);
        w = p + pow(r, 8.0) * vec3(sin(b) * sin(a), cos(b), sin(b) * cos(a));
        m = dot(w, w);
        if (m > 256.0) break;
    }
    return 0.25 * log(m) * sqrt(m) / dz;
}

float RockSDF(vec3 p, float s) {
    float dSphere = length(p) - s * 1.5;
    if (dSphere > 1.0) return dSphere;
    float d = length(p) - s;
    d += noise(p * 2.0) * 0.4 * s;
    d += noise(p * 5.0) * 0.1 * s;
    return d;
}

vec2 opU(vec2 d1, vec2 d2) {
    return (d1.x < d2.x) ? d1 : d2;
}

float Terrain(vec3 p) {
    vec2 p2 = p.xz;
    float dist = length(p2);
    float islandMask = smoothstep(60.0, 15.0, dist);

    // Domain warping
    vec3 pWarp = p * uTerrainScale;
    float w1 = fbm(pWarp * 0.3 + iTime * 0.02, 3);
    float w2 = fbm(pWarp * 0.3 + vec3(12.4, 5.2, 1.3), 3);
    pWarp += vec3(w1, w2, 0.0) * 0.8;

    float h = ridgedFbm(pWarp, 8) * uTerrainHeight;
    h += fbm(pWarp * 0.5 + 20.0, 4) * uTerrainHeight * 0.3;

    // Base shape
    h = h * islandMask;

    // Add some "Bryce" spikes
    float spikes = pow(noise(pWarp * 2.0), 4.0) * uTerrainHeight * 0.5;
    h += spikes * islandMask;

    return p.y - h;
}

vec2 GetDist(vec3 p) {
    vec2 res = vec2(1e10, -1.0);
    res = opU(res, vec2(Terrain(p), 0.0));
    res = opU(res, vec2(RockSDF(p - vec3(2.0, 3.5, 0.0), 1.2), 1.0));
    res = opU(res, vec2(RockSDF(p - vec3(-4.0, 2.8, 3.0), 0.8), 1.0));
    res = opU(res, vec2(sdBox(p - vec3(0.0, 5.0, -5.0), vec3(1.0)), 1.0));

    if (uFractalAmount > 0.01) {
        vec3 fPos = vec3(0.0, 15.0, 0.0);
        float dFractal = Mandelbulb((p - fPos) * 0.5) * 2.0;
        res = opU(res, vec2(dFractal, 3.0));
    }

    if (uMonolithAmount > 0.01) {
        vec2 grid = vec2(30.0);
        vec2 id = floor((p.xz + grid*0.5) / grid);
        float h = 5.0 + hash(vec3(id, 789.0)) * 15.0;
        vec3 mPos = vec3(id.x * grid.x, h * 0.5, id.y * grid.y);
        float dMonolith = sdHexPrism((p - mPos).xzy, vec2(1.5, h * 0.5));
        res = opU(res, vec2(dMonolith, 3.0));
    }

    for (int i = 0; i < 8; i++) {
        if (float(i) >= uNumUserObjects) break;
        res = opU(res, vec2(RockSDF(p - uUserObjects[i], 1.0), 1.0));
    }

    float distToCam = length(p - iCameraPos);
    if (distToCam < 30.0) {
        vec2 grid = vec2(6.0);
        vec2 id = floor(p.xz / grid);
        float j = hash(vec3(id, 123.45));
        if (j > 0.6) {
            vec2 treeXZ = id * grid + grid * 0.5 + (j - 0.5) * 2.0;
            vec3 treePos = vec3(treeXZ.x, 0.0, treeXZ.y);
            float actualH = -Terrain(treePos);
            if (actualH > uWaterLevel + 0.5 && actualH < uTerrainHeight * 0.7) {
                res = opU(res, vec2(TreeSDF(p - vec3(treeXZ.x, actualH, treeXZ.y), 0.5), 2.0));
            }
        }
    }
    return res;
}

float RayMarch(vec3 ro, vec3 rd) {
    float dO = 0.0;
    for(int i=0; i<MAX_STEPS; i++) {
        vec3 p = ro + rd * dO;
        float dS = GetDist(p).x;
        if(dS < SURF_DIST * (1.0 + dO * 0.1)) break;
        dO += dS;
        if(dO > MAX_DIST) break;
    }
    return dO;
}

float GetShadow(vec3 ro, vec3 rd, float mint, float tmax) {
    float res = 1.0;
    float t = mint;
    for(int i=0; i<16; i++) {
        float h = GetDist(ro + rd * t).x;
        res = min(res, 8.0 * h / t);
        t += clamp(h, 0.02, 0.5);
        if(res < 0.01 || t > tmax) break;
    }
    return clamp(res, 0.0, 1.0);
}

float GetAO(vec3 p, vec3 n) {
    float occ = 0.0;
    float sca = 1.0;
    for(int i=0; i<5; i++) {
        float h = 0.01 + 0.15 * float(i) / 4.0;
        float d = GetDist(p + n * h).x;
        occ += (h - d) * sca;
        sca *= 0.95;
    }
    return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
}

vec3 GetNormal(vec3 p) {
    float d = GetDist(p).x;
    vec2 e = vec2(0.01, 0);
    vec3 n = d - vec3(
        GetDist(p-e.xyy).x,
        GetDist(p-e.yxy).x,
        GetDist(p-e.yyx).x
    );
    if (length(n) < 0.0001) return vec3(0, 1, 0);
    return normalize(n);
}

vec3 GetSkyColor(vec3 rd, vec3 sunDir) {
    float sun = max(0.0, dot(rd, sunDir));
    vec3 zenith = mix(uSkyColor, vec3(0.05, 0.05, 0.1), uStormAmount);
    vec3 horizon = mix(mix(uSkyColor, vec3(0.7, 0.8, 1.0), 0.5), vec3(0.1, 0.1, 0.15), uStormAmount);
    vec3 col = mix(horizon, zenith, pow(max(0.0, rd.y), 0.5));
    col += 0.3 * vec3(1.0, 0.7, 0.4) * pow(sun, 8.0) * (1.0 - uStormAmount);
    col += 0.5 * vec3(1.0, 0.9, 0.7) * pow(sun, 500.0) * (1.0 - uStormAmount);
    if (rd.y > 0.0) {
        vec2 uv = rd.xz / (rd.y + 0.001);
        float cl = 0.0;
        float amp = 0.5;
        vec2 p = uv * 0.05 + iTime * 0.01;
        for(int i=0; i<5; i++) {
            cl += amp * noise(vec3(p.x, 0.0, p.y));
            p *= 2.2;
            amp *= 0.45;
        }
        float dens = mix(uCloudDensity, uCloudDensity * 2.0, uStormAmount);
        float cloudMask = smoothstep(1.1 - dens, 1.3 - dens, cl);
        vec3 cloudCol = mix(vec3(1.0), vec3(0.2, 0.2, 0.25), uStormAmount);
        col = mix(col, cloudCol, cloudMask * rd.y);
    }
    if (uStormAmount > 0.1) {
        float flashTime = iTime * 3.0;
        float flash = step(0.96, hash(vec3(floor(flashTime), 0.0, 0.0)));
        if (flash > 0.5) {
            float seed = floor(flashTime);
            vec2 boltPos = (vec2(hash(vec3(seed, 1.0, 2.0)), hash(vec3(seed, 3.0, 4.0))) - 0.5) * 40.0;
            float d = length(rd.xz * 10.0 - boltPos);
            col += vec3(0.7, 0.85, 1.0) * exp(-d * 0.5) * smoothstep(0.0, 0.2, rd.y);

            float bolt = smoothstep(0.05, 0.0, abs(rd.x * 15.0 - boltPos.x));
            col += vec3(0.9, 0.95, 1.0) * bolt * flash * smoothstep(0.0, 0.3, rd.y);
        }
    }
    return col;
}

vec3 Render(vec3 ro, vec3 rd, vec3 sunDir) {
    float d = RayMarch(ro, rd);
    if(d < MAX_DIST) {
        vec3 p = ro + rd * d;
        vec3 n = GetNormal(p);
        float detail = triPlanarNoise(p, n);
        vec2 res = GetDist(p);
        vec3 tCol = vec3(0.5);
        float slope = 1.0 - n.y;
        float h = p.y;
        float isSnow = 0.0;
        if (res.y < 0.5) {
            vec3 sand = vec3(0.8, 0.7, 0.5);
            vec3 grass = vec3(0.2, 0.4, 0.1);
            vec3 forest = vec3(0.05, 0.15, 0.05);
            vec3 rock = vec3(0.3, 0.28, 0.25);
            vec3 snowCol = uSnowColor;
            float grassMask = smoothstep(uWaterLevel + 0.2, uWaterLevel + 2.0, h);
            float forestMask = smoothstep(uWaterLevel + 3.0, uWaterLevel + 8.0, h);
            float rockMask = smoothstep(uTerrainHeight * 0.5, uTerrainHeight * 0.8, h);
            float snowMask = smoothstep(uTerrainHeight * 0.7, uTerrainHeight * 0.9, h);
            tCol = mix(sand, grass, grassMask);
            tCol = mix(tCol, forest, forestMask);
            float slopeRock = smoothstep(0.3, 0.6, slope + detail * 0.1);
            tCol = mix(tCol, rock, slopeRock);
            tCol = mix(tCol, rock, rockMask);
            isSnow = snowMask * (1.0 - smoothstep(0.4, 0.8, slope));
            tCol = mix(tCol, snowCol * (0.9 + 0.1 * detail), isSnow);
        } else if (res.y > 0.5 && res.y < 1.5) {
            tCol = vec3(0.35, 0.3, 0.25);
        } else if (res.y > 1.5 && res.y < 2.5) {
            tCol = mix(vec3(0.05, 0.1, 0.02), vec3(0.2, 0.1, 0.05), smoothstep(0.0, 0.2, p.y - Terrain(p)));
        } else if (res.y > 2.5) {
            tCol = vec3(0.5, 0.2, 0.8) * (0.5 + 0.5 * sin(iTime + p.y));
        }
        tCol *= (0.8 + 0.4 * detail * uTerrainDetail);
        float dif = clamp(dot(n, sunDir), 0.0, 1.0);
        float shadow = GetShadow(p + n * SURF_DIST * 2.0, sunDir, 0.1, 30.0);
        float ao = GetAO(p, n);
        vec3 skyLight = mix(vec3(0.05, 0.1, 0.2), uSkyColor, n.y * 0.5 + 0.5);
        float amb = 0.5 + 0.5 * n.y;
        float bac = clamp(dot(n, normalize(vec3(-sunDir.x, 0.0, -sunDir.z))), 0.0, 1.0) * 0.2;
        vec3 lin = vec3(0.0);
        lin += dif * shadow * vec3(1.2, 1.1, 1.0) * (1.0 - uStormAmount);
        lin += skyLight * ao * 0.5;
        lin += amb * vec3(0.1, 0.08, 0.05) * ao;
        lin += bac * ao * 0.1;
        if (uStormAmount > 0.1) {
            float flash = step(0.96, hash(vec3(floor(iTime * 3.0), 0.0, 0.0)));
            lin += flash * vec3(1.0, 1.1, 1.5) * ao * 3.0;
        }
        vec3 col = tCol * lin;
        if (isSnow > 0.1 && res.y < 0.5) {
            vec3 ref = reflect(rd, n);
            float spec = pow(clamp(dot(ref, sunDir), 0.0, 1.0), 32.0);
            col += uSnowColor * spec * shadow * isSnow;
        }
        float fogAmount = 1.0 - exp(-d * uFogDensity);
        return mix(col, uSkyColor, fogAmount);
    }
    return GetSkyColor(rd, sunDir);
}

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= iResolution.x / iResolution.y;
    vec3 ro = iCameraPos;
    vec3 rd = normalize((iCameraMatrix * vec4(uv.x, uv.y, -1.5, 0.0)).xyz);
    vec3 sunDir = normalize(uSunDir);
    float dTerrain = RayMarch(ro, rd);
    float dWater = (uWaterLevel - ro.y) / rd.y;
    vec3 col;
    if(dWater > 0.0 && (dWater < dTerrain || dTerrain >= MAX_DIST)) {
        vec3 p = ro + rd * dWater;
        vec3 n = normalize(vec3(0, 1, 0));
        vec3 refRD = reflect(rd, n);
        vec3 refCol = GetSkyColor(refRD, sunDir);
        float fresnel = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 5.0);
        col = mix(uWaterColor, refCol, 0.1 + 0.9 * fresnel);
        col = mix(col, uSkyColor, 1.0 - exp(-dWater * uFogDensity));
    } else {
        col = Render(ro, rd, sunDir);
    }
    gl_FragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}
`;

class BryceApp {
    constructor() {
        console.log("BryceApp: Initializing");
        this.scene = new THREE.Scene();
        this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 15, 30);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.setClearColor(0x000000);
        const container = document.getElementById('app');
        if (container) {
            container.appendChild(this.renderer.domElement);
        } else {
            document.body.appendChild(this.renderer.domElement);
        }

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.quadCamera));
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 0.85);
        this.composer.addPass(this.bloomPass);

        this.startTime = Date.now();
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                iTime: { value: 0 },
                iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                iCameraPos: { value: new THREE.Vector3() },
                iCameraMatrix: { value: new THREE.Matrix4() },
                uTerrainScale: { value: 0.15 },
                uTerrainHeight: { value: 8.0 },
                uOctaves: { value: 8 },
                uSunDir: { value: new THREE.Vector3(1, 0.5, 0.5) },
                uFogDensity: { value: 0.015 },
                uCloudDensity: { value: 0.5 },
                uSkyColor: { value: new THREE.Color(0.5, 0.7, 1.0) },
                uTerrainColor: { value: new THREE.Color(0.4, 0.3, 0.2) },
                uSnowColor: { value: new THREE.Color(0.9, 0.9, 0.9) },
                uWaterLevel: { value: 1.0 },
                uWaterColor: { value: new THREE.Color(0.1, 0.3, 0.5) },
                uTerrainDetail: { value: 0.5 },
                uSeed: { value: Math.random() * 100 },
                uFractalAmount: { value: 0.0 },
                uMonolithAmount: { value: 0.0 },
                uUserObjects: { value: Array.from({ length: MAX_USER_ROCKS }, () => new THREE.Vector3()) },
                uNumUserObjects: { value: 0 },
                uStormAmount: { value: 0.0 }
            }
        });
        this.colorParams = {
            preset: 'Custom',
            sky: `#${this.material.uniforms.uSkyColor.value.getHexString()}`,
            terrain: `#${this.material.uniforms.uTerrainColor.value.getHexString()}`,
            snow: `#${this.material.uniforms.uSnowColor.value.getHexString()}`,
            water: `#${this.material.uniforms.uWaterColor.value.getHexString()}`
        };
        this.colorParams.preset = this.colorPresetName();
        this.editorReadouts = {
            usage: 'Click visible terrain to place a rock.',
            rocks: `0 / ${MAX_USER_ROCKS} rocks placed.`,
            storage: 'No browser autosave found.'
        };
        this.restoreLandscape();
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.scene.add(quad);
        try {
            this.gui = new GUI();
            this.setupGUI();
            this.updateRockReadout();
        } catch (error) {
            console.error('GUI failed to load', error);
        }
        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.domElement.addEventListener('click', this.onMouseClick.bind(this));

        console.log("BryceApp: Setup complete, starting animation");
        this.animate();
    }

    vectorValues(vector) {
        return [vector.x, vector.y, vector.z];
    }

    terrainSettings() {
        return {
            scale: this.material.uniforms.uTerrainScale.value,
            height: this.material.uniforms.uTerrainHeight.value,
            seed: this.material.uniforms.uSeed.value
        };
    }

    landscapeData() {
        const uniforms = this.material.uniforms;
        const rockCount = uniforms.uNumUserObjects.value;
        return validateLandscape({
            version: LANDSCAPE_VERSION,
            camera: {
                position: this.vectorValues(this.camera.position),
                lookAt: this.vectorValues(this.controls.target)
            },
            terrain: {
                scale: uniforms.uTerrainScale.value,
                height: uniforms.uTerrainHeight.value,
                octaves: uniforms.uOctaves.value,
                detail: uniforms.uTerrainDetail.value,
                seed: uniforms.uSeed.value
            },
            environment: {
                sun: this.vectorValues(uniforms.uSunDir.value),
                fog: uniforms.uFogDensity.value,
                clouds: uniforms.uCloudDensity.value,
                waterLevel: uniforms.uWaterLevel.value,
                fractal: uniforms.uFractalAmount.value,
                monolith: uniforms.uMonolithAmount.value,
                storm: uniforms.uStormAmount.value
            },
            bloom: {
                strength: this.bloomPass.strength,
                radius: this.bloomPass.radius,
                threshold: this.bloomPass.threshold
            },
            colors: {
                sky: `#${uniforms.uSkyColor.value.getHexString()}`,
                terrain: `#${uniforms.uTerrainColor.value.getHexString()}`,
                snow: `#${uniforms.uSnowColor.value.getHexString()}`,
                water: `#${uniforms.uWaterColor.value.getHexString()}`
            },
            rocks: uniforms.uUserObjects.value.slice(0, rockCount).map((rock) => this.vectorValues(rock))
        });
    }

    applyLandscape(value) {
        const landscape = validateLandscape(value);
        const uniforms = this.material.uniforms;
        this.camera.position.fromArray(landscape.camera.position);
        this.controls.target.fromArray(landscape.camera.lookAt);
        this.controls.update();
        uniforms.uTerrainScale.value = landscape.terrain.scale;
        uniforms.uTerrainHeight.value = landscape.terrain.height;
        uniforms.uOctaves.value = landscape.terrain.octaves;
        uniforms.uTerrainDetail.value = landscape.terrain.detail;
        uniforms.uSeed.value = landscape.terrain.seed;
        uniforms.uSunDir.value.fromArray(landscape.environment.sun);
        uniforms.uFogDensity.value = landscape.environment.fog;
        uniforms.uCloudDensity.value = landscape.environment.clouds;
        uniforms.uWaterLevel.value = landscape.environment.waterLevel;
        uniforms.uFractalAmount.value = landscape.environment.fractal;
        uniforms.uMonolithAmount.value = landscape.environment.monolith;
        uniforms.uStormAmount.value = landscape.environment.storm;
        this.bloomPass.strength = landscape.bloom.strength;
        this.bloomPass.radius = landscape.bloom.radius;
        this.bloomPass.threshold = landscape.bloom.threshold;
        this.colorParams.sky = landscape.colors.sky;
        this.colorParams.terrain = landscape.colors.terrain;
        this.colorParams.snow = landscape.colors.snow;
        this.colorParams.water = landscape.colors.water;
        uniforms.uSkyColor.value.set(landscape.colors.sky);
        uniforms.uTerrainColor.value.set(landscape.colors.terrain);
        uniforms.uSnowColor.value.set(landscape.colors.snow);
        uniforms.uWaterColor.value.set(landscape.colors.water);
        for (const rock of uniforms.uUserObjects.value) rock.set(0, 0, 0);
        landscape.rocks.forEach((rock, index) => uniforms.uUserObjects.value[index].fromArray(rock));
        uniforms.uNumUserObjects.value = landscape.rocks.length;
        this.colorParams.preset = this.colorPresetName();
        this.updateRockReadout();
        return landscape;
    }

    colorPresetName() {
        const match = Object.entries(COLOR_PRESETS).find(([_name, colors]) =>
            colors.sky === this.colorParams.sky
            && colors.terrain === this.colorParams.terrain
            && colors.snow === this.colorParams.snow
            && colors.water === this.colorParams.water
        );
        return match ? match[0] : 'Custom';
    }

    setStorageStatus(message) {
        this.editorReadouts.storage = message;
        this.storageStatusController?.updateDisplay();
    }

    updateRockReadout() {
        const count = this.material.uniforms.uNumUserObjects.value;
        this.editorReadouts.rocks = `${count} / ${MAX_USER_ROCKS} rocks placed.`;
        this.rockCountController?.updateDisplay();
    }

    refreshGui() {
        const refreshFolder = (folder) => {
            for (const controller of folder.controllers || []) controller.updateDisplay();
            for (const child of folder.folders || []) refreshFolder(child);
        };
        refreshFolder(this.gui);
    }

    saveLandscape(message = 'Saved the current landscape in this browser.') {
        try {
            window.localStorage.setItem(LANDSCAPE_STORAGE_KEY, JSON.stringify(this.landscapeData()));
            this.setStorageStatus(message);
            return true;
        } catch (error) {
            this.setStorageStatus(`Could not save the landscape: ${error?.message || error}`);
            return false;
        }
    }

    restoreLandscape() {
        let saved;
        try {
            saved = window.localStorage.getItem(LANDSCAPE_STORAGE_KEY);
        } catch (error) {
            this.setStorageStatus(`Could not read browser storage: ${error?.message || error}`);
            return false;
        }
        if (!saved) return false;
        try {
            this.applyLandscape(JSON.parse(saved));
            this.setStorageStatus('Restored the browser autosave.');
            return true;
        } catch (error) {
            this.setStorageStatus(`Saved landscape is invalid and was not loaded: ${error?.message || error}`);
            return false;
        }
    }

    clearRocks() {
        this.material.uniforms.uNumUserObjects.value = 0;
        for (const rock of this.material.uniforms.uUserObjects.value) rock.set(0, 0, 0);
        this.updateRockReadout();
        this.saveLandscape('Cleared all placed rocks and saved the landscape.');
    }

    clearSavedLandscape() {
        try {
            window.localStorage.removeItem(LANDSCAPE_STORAGE_KEY);
            this.setStorageStatus('Removed the browser autosave; the current landscape is unchanged.');
        } catch (error) {
            this.setStorageStatus(`Could not remove the browser autosave: ${error?.message || error}`);
        }
    }

    exportLandscape() {
        try {
            const landscape = this.landscapeData();
            const blob = new Blob([`${JSON.stringify(landscape, null, 2)}\n`], { type: 'application/json' });
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const downloadUrl = URL.createObjectURL(blob);
            link.href = downloadUrl;
            link.download = `b2-landscape-${timestamp}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
            this.saveLandscape('Exported the landscape as JSON and refreshed the browser autosave.');
        } catch (error) {
            this.setStorageStatus(`Could not export the landscape: ${error?.message || error}`);
        }
    }

    chooseLandscapeFile() {
        if (!this.importInput) {
            this.importInput = document.createElement('input');
            this.importInput.type = 'file';
            this.importInput.accept = 'application/json,.json';
            this.importInput.addEventListener('change', () => this.importSelectedLandscape());
        }
        this.importInput.click();
    }

    async importSelectedLandscape() {
        const file = this.importInput?.files?.[0];
        if (!file) return;
        try {
            this.applyLandscape(JSON.parse(await file.text()));
            this.refreshGui();
            this.saveLandscape(`Imported ${file.name} and saved it in this browser.`);
        } catch (error) {
            this.setStorageStatus(`Could not import ${file.name}: ${error?.message || error}`);
        } finally {
            this.importInput.value = '';
        }
    }

    explain(controller, explanation, autosave = false) {
        controller.domElement.title = explanation;
        if (autosave) controller.onFinishChange(() => this.saveLandscape('Autosaved the current landscape in this browser.'));
        return controller;
    }

    onMouseClick(event) {
        if (this.material.uniforms.uNumUserObjects.value >= MAX_USER_ROCKS) {
            this.setStorageStatus(`Rock limit reached: use Clear Rocks before placing more than ${MAX_USER_ROCKS}.`);
            return;
        }
        const bounds = this.renderer.domElement.getBoundingClientRect();
        const cameraPosition = this.vectorValues(this.camera.position);
        const cameraLookAt = this.vectorValues(this.controls.target);
        const direction = screenRay(event.clientX, event.clientY, bounds, cameraPosition, cameraLookAt);
        const hit = terrainHit(cameraPosition, direction, this.terrainSettings());
        if (!hit) {
            this.setStorageStatus('That click did not intersect terrain; click a visible ground surface.');
            return;
        }
        const idx = this.material.uniforms.uNumUserObjects.value;
        this.material.uniforms.uUserObjects.value[idx].set(hit[0], hit[1] + USER_ROCK_SURFACE_OFFSET, hit[2]);
        this.material.uniforms.uNumUserObjects.value = idx + 1;
        this.updateRockReadout();
        this.saveLandscape(`Placed rock ${idx + 1} at terrain point (${hit.map((value) => value.toFixed(2)).join(', ')}).`);
    }

    setupGUI() {
        const camFolder = this.gui.addFolder('Camera');
        this.explain(camFolder.add(this.camera.position, 'x', -50, 50).name('Pos X'), 'Moves the camera left or right in world space.', true);
        this.explain(camFolder.add(this.camera.position, 'y', -50, 50).name('Pos Y'), 'Raises or lowers the camera in world space.', true);
        this.explain(camFolder.add(this.camera.position, 'z', -50, 50).name('Pos Z'), 'Moves the camera forward or backward in world space.', true);

        const terrainFolder = this.gui.addFolder('Terrain');
        this.explain(terrainFolder.add(this.material.uniforms.uTerrainScale, 'value', 0.01, 2.0).name('Scale'), 'Controls terrain feature frequency: low values make broad landforms; high values make tighter features.', true);
        this.explain(terrainFolder.add(this.material.uniforms.uTerrainHeight, 'value', 0.0, 40.0).name('Height'), 'Sets the maximum vertical range of the generated terrain.', true);
        this.explain(terrainFolder.add(this.material.uniforms.uOctaves, 'value', 1, 12, 1).name('Octaves'), 'Sets how many terrain noise detail layers are requested.', true);
        this.explain(terrainFolder.add(this.material.uniforms.uTerrainDetail, 'value', 0, 2.0).name('Detail'), 'Controls the strength of small surface texture variation.', true);
        this.explain(terrainFolder.add(this.material.uniforms.uSeed, 'value', 0, 100).name('Seed').listen(), 'Selects the repeatable terrain variation saved with the landscape.', true);

        const editorFolder = this.gui.addFolder('Editor');
        const editorActions = {
            clear: () => this.clearRocks(),
            save: () => this.saveLandscape(),
            export: () => this.exportLandscape(),
            import: () => this.chooseLandscapeFile(),
            forget: () => this.clearSavedLandscape(),
            randomize: () => {
                this.material.uniforms.uSeed.value = Math.random() * 100;
                this.saveLandscape('Randomized the terrain seed and saved the landscape.');
            },
            resetCamera: () => {
                this.camera.position.set(0, 15, 30);
                this.controls.target.set(0, 0, 0);
                this.controls.update();
                this.refreshGui();
                this.saveLandscape('Reset the camera and saved the landscape.');
            },
            capture: () => {
                this.composer.render();
                const link = document.createElement('a');
                link.download = 'bryce-render.png';
                link.href = this.renderer.domElement.toDataURL('image/png');
                link.click();
                this.setStorageStatus('Captured the current render as a PNG file.');
            }
        };
        this.explain(editorFolder.add(editorActions, 'clear').name('Clear Rocks'), `Removes all ${MAX_USER_ROCKS} possible placed rocks and saves the change.`);
        this.explain(editorFolder.add(editorActions, 'save').name('Save Now'), 'Stores all camera, terrain, environment, colour, bloom, and rock settings in this browser.');
        this.explain(editorFolder.add(editorActions, 'export').name('Export JSON'), 'Downloads the complete designed landscape as a validated JSON file.');
        this.explain(editorFolder.add(editorActions, 'import').name('Import JSON'), 'Loads a previously exported landscape after validating every field, then saves it in this browser.');
        this.explain(editorFolder.add(editorActions, 'forget').name('Forget Autosave'), 'Removes the browser autosave without changing the landscape currently on screen.');
        this.explain(editorFolder.add(editorActions, 'randomize').name('Randomize Seed'), 'Chooses a new terrain seed and saves the resulting landscape.');
        this.explain(editorFolder.add(editorActions, 'resetCamera').name('Reset Camera'), 'Returns the camera to the default position and aim, then saves the landscape.');
        this.explain(editorFolder.add(editorActions, 'capture').name('Capture Render'), 'Downloads the current rendered frame as a PNG file.');
        this.explain(editorFolder.add(this.editorReadouts, 'usage').name('How to Place').disable(), 'Click visible ground in the rendered scene; the rock is anchored to the terrain point under the cursor.');
        this.rockCountController = this.explain(editorFolder.add(this.editorReadouts, 'rocks').name('Rock Count').disable(), `Shows how many of the ${MAX_USER_ROCKS} available rock slots are occupied.`);
        this.storageStatusController = this.explain(editorFolder.add(this.editorReadouts, 'storage').name('Save Status').disable(), 'Reports the result of the latest placement, save, import, export, or browser-storage action.');

        const envFolder = this.gui.addFolder('Environment');
        this.explain(envFolder.add(this.material.uniforms.uSunDir.value, 'x', -1, 1).name('Sun X'), 'Aims sunlight along the east-west axis.', true);
        this.explain(envFolder.add(this.material.uniforms.uSunDir.value, 'y', -1, 1).name('Sun Y'), 'Controls how high or low the sun points.', true);
        this.explain(envFolder.add(this.material.uniforms.uSunDir.value, 'z', -1, 1).name('Sun Z'), 'Aims sunlight along the north-south axis.', true);
        this.explain(envFolder.add(this.material.uniforms.uFogDensity, 'value', 0, 0.1).name('Fog'), 'Controls how quickly distant terrain fades into the sky.', true);
        this.explain(envFolder.add(this.material.uniforms.uCloudDensity, 'value', 0, 1).name('Clouds'), 'Controls how much procedural cloud cover appears in the sky.', true);
        this.explain(envFolder.add(this.material.uniforms.uWaterLevel, 'value', -5, 5).name('Water Level'), 'Raises or lowers the reflective water plane.', true);
        this.explain(envFolder.add(this.material.uniforms.uFractalAmount, 'value', 0, 1).name('Fractal'), 'Fades the central Mandelbulb object in or out.', true);
        this.explain(envFolder.add(this.material.uniforms.uMonolithAmount, 'value', 0, 1).name('Monoliths'), 'Controls how strongly the procedural monolith field appears.', true);
        this.explain(envFolder.add(this.material.uniforms.uStormAmount, 'value', 0, 1).name('Storm Intensity'), 'Darkens the sky, thickens clouds, and adds storm lighting.', true);

        const bloomFolder = this.gui.addFolder('Bloom');
        this.explain(bloomFolder.add(this.bloomPass, 'strength', 0, 3).name('Strength'), 'Controls the intensity of glow around bright areas.', true);
        this.explain(bloomFolder.add(this.bloomPass, 'radius', 0, 1).name('Radius'), 'Controls how far bloom spreads from bright areas.', true);
        this.explain(bloomFolder.add(this.bloomPass, 'threshold', 0, 1).name('Threshold'), 'Sets the minimum brightness that produces bloom.', true);

        const colorFolder = this.gui.addFolder('Colors');
        const presetController = colorFolder.add(this.colorParams, 'preset', ['Custom', ...Object.keys(COLOR_PRESETS)]).name('Preset');
        presetController.onChange((name) => {
            const colors = COLOR_PRESETS[name];
            if (!colors) return;
            Object.assign(this.colorParams, colors);
            this.material.uniforms.uSkyColor.value.set(colors.sky);
            this.material.uniforms.uTerrainColor.value.set(colors.terrain);
            this.material.uniforms.uSnowColor.value.set(colors.snow);
            this.material.uniforms.uWaterColor.value.set(colors.water);
            this.refreshGui();
        });
        this.explain(presetController, 'Applies a coordinated set of sky, terrain, snow, and water colours; Custom preserves individual choices.', true);
        const addColor = (property, uniform, name, explanation) => {
            const controller = colorFolder.addColor(this.colorParams, property).name(name);
            controller.onChange((value) => {
                uniform.value.set(value);
                this.colorParams.preset = this.colorPresetName();
                presetController.updateDisplay();
            });
            this.explain(controller, explanation, true);
        };
        addColor('sky', this.material.uniforms.uSkyColor, 'Sky', 'Sets the sky and distance-fog colour.');
        addColor('terrain', this.material.uniforms.uTerrainColor, 'Terrain', 'Sets the base colour of level ground.');
        addColor('snow', this.material.uniforms.uSnowColor, 'Snow', 'Sets the colour of high, gently sloped snow.');
        addColor('water', this.material.uniforms.uWaterColor, 'Water', 'Sets the base colour beneath water reflections.');
    }

    onWindowResize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.material.uniforms.iResolution.value.set(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.material.uniforms.iTime.value = (Date.now() - this.startTime) / 1000;
        this.controls.update();
        this.camera.updateMatrixWorld();
        this.material.uniforms.iCameraPos.value.copy(this.camera.position);
        this.material.uniforms.iCameraMatrix.value.copy(this.camera.matrixWorld);

        this.composer.render();
    }
}

new BryceApp();
