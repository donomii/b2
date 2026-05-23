import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'https://esm.sh/lil-gui@0.19.0';

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

const int MAX_STEPS = 96;
const float MAX_DIST = 100.0;
const float SURF_DIST = 0.005;

// Hash function for noise
float hash(vec3 p) {
    p += uSeed;
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// 3D Value Noise
float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// Fractal Brownian Motion with LOD
float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 12; i++) {
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
    for (int i = 0; i < 12; i++) {
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
    m /= (m.x + m.y + m.z);
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

    // Radial mask to create an island
    float islandMask = smoothstep(50.0, 10.0, dist);

    vec3 pScaled = p * uTerrainScale;
    float n1 = fbm(pScaled * 0.5, 4);
    float n2 = fbm(pScaled * 0.5 + vec3(5.2, 1.3, 2.8), 4);
    vec3 offset = vec3(n1, n2, 0.0) * 0.5;

    float h = ridgedFbm(pScaled + offset, 8) * uTerrainHeight;
    h += fbm(pScaled * 0.2 + 10.0, 4) * uTerrainHeight * 0.5;

    // Apply island mask and add a small base pedestal
    h = h * islandMask + (islandMask * 0.5);

    return p.y - h;
}

vec2 GetDist(vec3 p) {
    vec2 res = vec2(1e10, -1.0);

    // Terrain (ID 0)
    res = opU(res, vec2(Terrain(p), 0.0));

    // Procedural Rocks (ID 1)
    res = opU(res, vec2(RockSDF(p - vec3(2.0, 3.5, 0.0), 1.2), 1.0));
    res = opU(res, vec2(RockSDF(p - vec3(-4.0, 2.8, 3.0), 0.8), 1.0));

    // Primitive Box (ID 1)
    res = opU(res, vec2(sdBox(p - vec3(0.0, 5.0, -5.0), vec3(1.0)), 1.0));

    // Fractal (ID 3)
    if (uFractalAmount > 0.01) {
        vec3 fPos = vec3(0.0, 15.0, 0.0);
        float dFractal = Mandelbulb((p - fPos) * 0.5) * 2.0;
        res = opU(res, vec2(dFractal, 3.0));
    }

    // Monoliths & Crystals (ID 3)
    if (uMonolithAmount > 0.01) {
        vec2 grid = vec2(40.0);
        vec2 id = floor(p.xz / grid);
        float h = 10.0 + hash(vec3(id, 789.0)) * 15.0;
        float dMonolith = sdHexPrism(p.xzy - vec3(id.x * grid.x, 0.0, id.y * grid.y), vec2(2.0, h));
        res = opU(res, vec2(dMonolith, 3.0));
    }

    // User Objects (ID 1)
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uNumUserObjects) break;
        res = opU(res, vec2(RockSDF(p - uUserObjects[i], 1.0), 1.0));
    }

    // Vegetation (ID 2)
    vec2 treeP = p.xz;
    float dist = length(p - iCameraPos);
    if (dist < 30.0) {
        vec2 grid = vec2(4.0);
        vec2 id = floor(treeP / grid);
        vec2 q = mod(treeP, grid) - 0.5 * grid;
        float j = hash(vec3(id, 123.45));

        if (j > 0.6) {
            vec3 treeBase = vec3(id * grid + (j-0.5)*2.0, 0.0).xzy;
            float actualH = -Terrain(treeBase);
            if (actualH > uWaterLevel + 0.5 && actualH < uTerrainHeight * 0.6) {
                res = opU(res, vec2(TreeSDF(p - vec3(treeBase.x, actualH, treeBase.z), 0.5), 2.0));
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
    for(int i=0; i<32; i++) {
        float h = GetDist(ro + rd * t).x;
        res = min(res, 16.0 * h / t);
        t += clamp(h, 0.01, 0.2);
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
    return normalize(n);
}

vec3 GetSkyColor(vec3 rd, vec3 sunDir) {
    float sun = max(0.0, dot(rd, sunDir));

    // Stormy sky color
    vec3 zenith = mix(uSkyColor, vec3(0.05, 0.05, 0.1), uStormAmount);
    vec3 horizon = mix(mix(uSkyColor, vec3(0.7, 0.8, 1.0), 0.5), vec3(0.1, 0.1, 0.15), uStormAmount);
    vec3 col = mix(horizon, zenith, pow(max(0.0, rd.y), 0.5));

    col += 0.3 * vec3(1.0, 0.7, 0.4) * pow(sun, 8.0) * (1.0 - uStormAmount);
    col += 0.5 * vec3(1.0, 0.9, 0.7) * pow(sun, 500.0) * (1.0 - uStormAmount);

    // Procedural Clouds
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

    // Lightning Bolt in Sky
    if (uStormAmount > 0.1) {
        float flashTime = iTime * 2.0;
        float flash = step(0.98, fract(sin(floor(flashTime) * 456.789)));
        if (flash > 0.5) {
            float seed = floor(flashTime);
            vec2 boltPos = (vec2(fract(sin(seed*12.3)), fract(cos(seed*45.6))) - 0.5) * 50.0;
            float d = length(rd.xz * 20.0 - boltPos);
            col += vec3(0.8, 0.9, 1.0) * exp(-d * 2.0) * rd.y;
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

        // Advanced Multi-layered Biome Coloring
        vec3 tCol;
        float slope = 1.0 - n.y;
        float h = p.y;

        if (res.y < 0.5) { // Terrain
            // Base Layers
            vec3 sand = vec3(0.8, 0.7, 0.5);
            vec3 grass = vec3(0.2, 0.4, 0.1);
            vec3 forest = vec3(0.05, 0.15, 0.05);
            vec3 rock = vec3(0.3, 0.28, 0.25);
            vec3 snow = uSnowColor;

            // Height-based blending
            float beachMask = smoothstep(uWaterLevel - 0.2, uWaterLevel + 0.5, h);
            float grassMask = smoothstep(uWaterLevel + 0.2, uWaterLevel + 2.0, h);
            float forestMask = smoothstep(uWaterLevel + 3.0, uWaterLevel + 8.0, h);
            float rockMask = smoothstep(uTerrainHeight * 0.5, uTerrainHeight * 0.8, h);
            float snowMask = smoothstep(uTerrainHeight * 0.7, uTerrainHeight * 0.9, h);

            tCol = mix(sand, grass, grassMask);
            tCol = mix(tCol, forest, forestMask);

            // Slope-based transitions
            float slopeRock = smoothstep(0.3, 0.6, slope + detail * 0.1);
            tCol = mix(tCol, rock, slopeRock);

            // High altitude rock/snow
            tCol = mix(tCol, rock, rockMask);

            // Snow accumulation (only on flatter areas at peak)
            float actualSnow = snowMask * (1.0 - smoothstep(0.4, 0.8, slope));
            tCol = mix(tCol, snow * (0.9 + 0.1 * detail), actualSnow);

        } else if (res.y > 0.5 && res.y < 1.5) {
            tCol = vec3(0.35, 0.3, 0.25); // Rocks/User Objects
        } else if (res.y > 1.5 && res.y < 2.5) {
            tCol = mix(vec3(0.05, 0.1, 0.02), vec3(0.2, 0.1, 0.05), smoothstep(0.0, 0.2, p.y - Terrain(p))); // Trees
        } else if (res.y > 2.5) {
            tCol = vec3(0.5, 0.2, 0.8) * (0.5 + 0.5 * sin(iTime + p.y)); // Special objects
        }

        tCol *= (0.8 + 0.4 * detail * uTerrainDetail);

        float dif = clamp(dot(n, sunDir), 0.0, 1.0);
        float shadow = GetShadow(p + n * SURF_DIST * 2.0, sunDir, 0.1, 30.0);
        float ao = GetAO(p, n);

        // Hemisphere lighting (Sky color from above, Ground color from below)
        vec3 skyLight = mix(vec3(0.05, 0.1, 0.2), uSkyColor, n.y * 0.5 + 0.5);
        float amb = 0.5 + 0.5 * n.y;

        // Back light to fill in silhouettes
        float bac = clamp(dot(n, normalize(vec3(-sunDir.x, 0.0, -sunDir.z))), 0.0, 1.0) * 0.2;

        // Combine lighting components
        vec3 lin = vec3(0.0);

        // Sun light (reduced in storm)
        lin += dif * shadow * vec3(1.2, 1.1, 1.0) * (1.0 - uStormAmount);

        // Sky/Ambient
        lin += skyLight * ao * 0.5;
        lin += amb * vec3(0.1, 0.08, 0.05) * ao;
        lin += bac * ao * 0.1;

        // Lightning Flash on Terrain
        if (uStormAmount > 0.1) {
            float flash = step(0.98, fract(sin(floor(iTime * 2.0) * 456.789)));
            lin += flash * vec3(1.0, 1.1, 1.5) * ao * 2.0;
        }

        vec3 col = tCol * lin;
        if (snow > 0.5 && res.y < 0.5) {
            vec3 ref = reflect(rd, n);
            float spec = pow(clamp(dot(ref, sunDir), 0.0, 1.0), 32.0);
            col += uSnowColor * spec * shadow * snow;
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
        float wave = fbm(vec3(p.xz * 0.5, iTime * 0.2), 4) * 0.1;
        vec3 n = normalize(vec3(0, 1, 0)); // simplified normal for brevity
        vec3 refRD = reflect(rd, n);
        vec3 refCol = Render(p + n * SURF_DIST * 2.0, refRD, sunDir);
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
        this.scene = new THREE.Scene();
        this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 15, 30);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        document.getElementById('app')?.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 200;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent going below ground

        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.quadCamera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            1.5, 0.4, 0.85
        );
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
                uUserObjects: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
                uNumUserObjects: { value: 0 },
                uStormAmount: { value: 0.0 }
            }
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.scene.add(quad);
        this.gui = new GUI();
        this.setupGUI();
        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.domElement.addEventListener('click', this.onMouseClick.bind(this));
        this.animate();
    }

    onMouseClick(event) {
        if (this.material.uniforms.uNumUserObjects.value >= 8) return;

        // Mouse NDC
        const mouse = new THREE.Vector2(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        const ray = raycaster.ray;

        // Intersect with estimated terrain plane
        const targetY = this.material.uniforms.uTerrainHeight.value * 0.4;
        let t = (targetY - ray.origin.y) / ray.direction.y;

        if (t < 0 || t > 200) t = 20; // Fallback

        const pos = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, t);

        const idx = this.material.uniforms.uNumUserObjects.value;
        this.material.uniforms.uUserObjects.value[idx].copy(pos);
        this.material.uniforms.uNumUserObjects.value++;

        // Ensure Three.js notices the array change
        this.material.uniforms.uUserObjects.value = [...this.material.uniforms.uUserObjects.value];
    }

    setupGUI() {
        const terrainFolder = this.gui.addFolder('Terrain');
        terrainFolder.add(this.material.uniforms.uTerrainScale, 'value', 0.01, 2.0).name('Scale');
        terrainFolder.add(this.material.uniforms.uTerrainHeight, 'value', 0.0, 40.0).name('Height');
        terrainFolder.add(this.material.uniforms.uOctaves, 'value', 1, 12, 1).name('Octaves');
        terrainFolder.add(this.material.uniforms.uTerrainDetail, 'value', 0, 2.0).name('Detail');
        terrainFolder.add(this.material.uniforms.uSeed, 'value', 0, 100).name('Seed').listen();
        const editorFolder = this.gui.addFolder('Editor');
        editorFolder.add({ clear: () => { this.material.uniforms.uNumUserObjects.value = 0; } }, 'clear').name('Clear Placed Objects');
        editorFolder.add({ info: 'Click scene to place rocks' }, 'info').name('Usage:').disable();

        const envFolder = this.gui.addFolder('Environment');
        envFolder.add(this.material.uniforms.uSunDir.value, 'x', -1, 1).name('Sun X');
        envFolder.add(this.material.uniforms.uSunDir.value, 'y', -1, 1).name('Sun Y');
        envFolder.add(this.material.uniforms.uSunDir.value, 'z', -1, 1).name('Sun Z');
        envFolder.add(this.material.uniforms.uFogDensity, 'value', 0, 0.1).name('Fog');
        envFolder.add(this.material.uniforms.uWaterLevel, 'value', -5, 5).name('Water Level');
        envFolder.add(this.material.uniforms.uFractalAmount, 'value', 0, 1).name('Fractal');
        envFolder.add(this.material.uniforms.uMonolithAmount, 'value', 0, 1).name('Monoliths');
        envFolder.add(this.material.uniforms.uStormAmount, 'value', 0, 1).name('Storm Intensity');

        const bloomFolder = this.gui.addFolder('Bloom');
        bloomFolder.add(this.bloomPass, 'strength', 0, 3).name('Strength');
        bloomFolder.add(this.bloomPass, 'radius', 0, 1).name('Radius');
        bloomFolder.add(this.bloomPass, 'threshold', 0, 1).name('Threshold');

        const colorFolder = this.gui.addFolder('Colors');
        const colorParams = { sky: '#80b3ff', terrain: '#664d33', snow: '#e6e6e6', water: '#1a4d80', presets: 'Alpine' };
        const presets = {
            'Alpine': { sky: '#80b3ff', terrain: '#664d33', snow: '#e6e6e6', water: '#1a4d80' },
            'Mars': { sky: '#ff9966', terrain: '#802b00', snow: '#ffccb3', water: '#4d1a00' },
            'Arctic': { sky: '#e6f2ff', terrain: '#b3ccd9', snow: '#ffffff', water: '#80b3cc' },
            'Tropical': { sky: '#00ccff', terrain: '#1a4d00', snow: '#ffffff', water: '#00ffcc' }
        };
        colorFolder.add(colorParams, 'presets', Object.keys(presets)).onChange((v) => {
            const p = presets[v];
            this.material.uniforms.uSkyColor.value.set(p.sky);
            this.material.uniforms.uTerrainColor.value.set(p.terrain);
            this.material.uniforms.uSnowColor.value.set(p.snow);
            this.material.uniforms.uWaterColor.value.set(p.water);

            for (const folder of this.gui.folders) {
                for (const controller of folder.controllers) {
                    controller.updateDisplay();
                }
            }
            for (const controller of this.gui.controllers) {
                controller.updateDisplay();
            }
        });
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
        this.material.uniforms.iCameraPos.value.copy(this.camera.position);
        this.material.uniforms.iCameraMatrix.value.copy(this.camera.matrixWorld);

        this.composer.render();
    }
}

new BryceApp();
