import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'https://esm.sh/lil-gui@0.19.0';

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
uniform float uExposure;
uniform float uChromaticAberration;
uniform float uVignette;
uniform float uFilmGrain;
uniform vec3 uUserObjects[8];
uniform float uNumUserObjects;

const int MAX_STEPS = 110;
const float MAX_DIST = 200.0;
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

// Demoscene 2D value noise + analytical gradient for IQ/Elevated-style erosion terrain
vec3 noised2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    float a = hash(vec3(i + vec2(0.0, 0.0), 0.0));
    float b = hash(vec3(i + vec2(1.0, 0.0), 0.0));
    float c = hash(vec3(i + vec2(0.0, 1.0), 0.0));
    float d = hash(vec3(i + vec2(1.0, 1.0), 0.0));
    float k0 = a;
    float k1 = b - a;
    float k2 = c - a;
    float k4 = a - b - c + d;
    return vec3(
        k0 + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
        du * (vec2(k1, k2) + k4 * u.yx)
    );
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

float WaterHeight(vec2 p) {
    float h = uWaterLevel;
    h += 0.08 * sin(p.x * 1.2 + iTime * 0.8) * sin(p.y * 0.9 + iTime * 0.6);
    h += 0.04 * sin(p.x * 2.5 - iTime * 1.1) * sin(p.y * 3.1 + iTime * 0.9);
    h += 0.02 * noise(vec3(p * 3.0, iTime * 0.5));
    return h;
}

vec3 WaterNormal(vec2 p) {
    float e = 0.01;
    float h  = WaterHeight(p);
    float hx = WaterHeight(p + vec2(e, 0.0));
    float hz = WaterHeight(p + vec2(0.0, e));
    return normalize(vec3(h - hx, e, h - hz));
}

vec2 opU(vec2 d1, vec2 d2) {
    return (d1.x < d2.x) ? d1 : d2;
}

float TerrainHeight(vec2 xz) {
    // Organic coastline distortion so the island has coves, peninsulas, and a lagoon bay
    float angle = atan(xz.y, xz.x);
    float coastWarp = (noise(vec3(xz * 0.08, 1.0)) - 0.5) * 6.0
                    + sin(angle * 3.0 + uSeed) * 2.2
                    + cos(angle * 5.0 - uSeed * 0.7) * 1.4;
    float dist = length(xz) + coastWarp;

    float islandMask = 1.0 - smoothstep(4.0, 18.5, dist);
    float shelfMask  = 1.0 - smoothstep(14.0, 25.0, dist);

    // Secondary sea-stack / islet off to the side
    float isletDist = length(xz - vec2(-16.0, -6.0));
    float isletMask = 1.0 - smoothstep(1.5, 5.5, isletDist);

    // Demoscene IQ/Elevated-style derivative-eroded mountain FBM
    vec2 p = xz * uTerrainScale * 0.55;
    vec2 p0 = p;
    vec2 warp = vec2(
        noise(vec3(p * 0.6, 3.1)) - 0.5,
        noise(vec3(p * 0.6 + 15.7, 7.4)) - 0.5
    );
    p += warp * 1.1;

    float h = 0.0;
    float amp = 0.55;
    vec2 dsum = vec2(0.0);
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 8; i++) {
        if (i >= uOctaves) break;
        vec3 n = noised2(p);
        dsum += n.yz * amp;
        float rVal = n.x * 2.0 - 1.0;
        float ridge = 1.0 - sqrt(rVal * rVal + 0.015);
        ridge = ridge * ridge;
        float erosion = 1.0 / (1.0 + 1.8 * dot(dsum, dsum));
        h += amp * mix(n.x, ridge, 0.75) * erosion;
        p = rot * p * 2.08;
        amp *= 0.5;
    }

    float centerPeak = (1.0 - smoothstep(0.0, 11.0, length(xz))) * 0.45;
    float sVal = noise(vec3(p0 * 1.4, 2.0)) * 2.0 - 1.0;
    float spires = pow(max(0.0, 1.0 - sqrt(sVal * sVal + 0.02)), 3.0) * 0.28;

    float landH = (h * 1.35 + centerPeak + spires) * uTerrainHeight * islandMask;
    float coastalShelf = shelfMask * 1.65;
    float isletH = isletMask * uTerrainHeight * 0.55 * (0.5 + 0.5 * noise(vec3(xz * 0.4, 9.0)));
    float seabed = -2.2 * (1.0 - shelfMask);

    return coastalShelf + landH + isletH + seabed;
}

float Terrain(vec3 p) {
    return p.y - TerrainHeight(p.xz);
}

vec2 GetDist(vec3 p) {
    vec2 res = vec2(1e10, -1.0);
    res = opU(res, vec2(Terrain(p), 0.0));
    res = opU(res, vec2(RockSDF(p - vec3(6.0, TerrainHeight(vec2(6.0, 8.0)) + 0.4, 8.0), 0.9), 1.0));
    res = opU(res, vec2(RockSDF(p - vec3(-8.0, TerrainHeight(vec2(-8.0, 6.0)) + 0.3, 6.0), 0.7), 1.0));
    res = opU(res, vec2(RockSDF(p - vec3(11.0, TerrainHeight(vec2(11.0, 3.0)) + 0.3, 3.0), 0.75), 1.0));

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
    if (distToCam < 55.0) {
        vec2 grid = vec2(3.5);
        vec2 id = floor(p.xz / grid);
        float j = hash(vec3(id, 123.45));
        if (j > 0.62) {
            vec2 treeXZ = id * grid + grid * 0.5 + (j - 0.5) * 2.0;
            float actualH = TerrainHeight(treeXZ);
            if (actualH > uWaterLevel + 0.5 && actualH < uTerrainHeight * 0.7) {
                res = opU(res, vec2(TreeSDF(p - vec3(treeXZ.x, actualH, treeXZ.y), 0.28 + 0.22 * fract(j * 17.3)), 2.0));
            }
        }
    }
    return res;
}

float RayMarch(vec3 ro, vec3 rd) {
    float dO = 0.0;
    float prevDO = 0.0;
    for(int i=0; i<MAX_STEPS; i++) {
        vec3 p = ro + rd * dO;
        float dS = GetDist(p).x;
        if(dS < 0.0) {
            // Demoscene interval bisection refinement to eliminate overstepping holes
            float a = prevDO;
            float b = dO;
            for(int j=0; j<4; j++) {
                float mid = 0.5 * (a + b);
                if (GetDist(ro + rd * mid).x < 0.0) b = mid;
                else a = mid;
            }
            dO = 0.5 * (a + b);
            break;
        }
        if(dS < SURF_DIST * (1.0 + dO * 0.05)) break;
        prevDO = dO;
        dO += max(dS * 0.55, 0.015);
        if(dO > MAX_DIST) break;
    }
    return dO;
}

float RayMarchRefl(vec3 ro, vec3 rd) {
    float dO = 0.0;
    for(int i=0; i<32; i++) {
        vec3 p = ro + rd * dO;
        float dS = GetDist(p).x;
        if(dS < SURF_DIST * (1.0 + dO * 0.15)) break;
        dO += dS * (1.0 + dO * 0.02);
        if(dO > 80.0) break;
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
    vec3 horizon = mix(mix(uSkyColor, vec3(0.32, 0.50, 0.82), 0.45), vec3(0.08, 0.08, 0.12), uStormAmount);
    vec3 col = mix(horizon, zenith, pow(max(0.0, rd.y), 0.5));
    col += 0.3 * vec3(1.0, 0.7, 0.4) * pow(sun, 8.0) * (1.0 - uStormAmount);
    col += 0.5 * vec3(1.0, 0.9, 0.7) * pow(sun, 500.0) * (1.0 - uStormAmount);
    // Demoscene: procedural starfield (visible when sun is low / dusk-night)
    float nightAmount = (1.0 - smoothstep(-0.1, 0.2, sunDir.y)) * (1.0 - uStormAmount);
    if (nightAmount > 0.01 && rd.y > 0.05) {
        // Layer 1: bright stars
        vec3 starUV = floor(rd * 300.0);
        float starHash = hash(starUV);
        float star = step(0.997, starHash);
        float starBright = starHash * starHash;
        // Twinkle animation
        float twinkle = 0.7 + 0.3 * sin(iTime * (2.0 + starHash * 5.0) + starHash * 100.0);
        col += star * starBright * twinkle * nightAmount * vec3(0.9, 0.9, 1.0);
        // Layer 2: dim star field
        vec3 starUV2 = floor(rd * 600.0);
        float starHash2 = hash(starUV2 + 77.0);
        float star2 = step(0.998, starHash2);
        col += star2 * starHash2 * 0.4 * nightAmount * vec3(0.7, 0.8, 1.0);
    }
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
    // Demoscene: crepuscular god-ray streaks from the sun
    if (sun > 0.1) {
        float angle = atan(rd.z - sunDir.z, rd.x - sunDir.x);
        float rays = 0.0;
        rays += pow(0.5 + 0.5 * sin(angle * 12.0 + noise(vec3(angle * 4.0, 0.0, iTime * 0.1)) * 4.0), 12.0);
        rays += 0.5 * pow(0.5 + 0.5 * sin(angle * 20.0 + 3.0), 16.0);
        float angularFade = pow(sun, 4.0);
        float heightFade = smoothstep(-0.1, 0.3, rd.y);
        col += rays * angularFade * heightFade * vec3(1.0, 0.85, 0.5) * 0.25 * (1.0 - uStormAmount);
    }
    if (uStormAmount > 0.1) {
        float flashTime = iTime * 3.0;
        float flash = step(0.96, hash(vec3(floor(flashTime), 0.0, 0.0)));
        if (flash > 0.5) {
            float seed = floor(flashTime);
            vec2 boltPos = (vec2(hash(vec3(seed, 1.0, 2.0)), hash(vec3(seed, 3.0, 4.0))) - 0.5) * 40.0;
            float d = length(rd.xz * 10.0 - boltPos);
            col += vec3(0.7, 0.85, 1.0) * exp(-d * 0.5) * smoothstep(0.0, 0.2, rd.y);

            float bolt = 1.0 - smoothstep(0.0, 0.05, abs(rd.x * 15.0 - boltPos.x));
            col += vec3(0.9, 0.95, 1.0) * bolt * flash * smoothstep(0.0, 0.3, rd.y);
        }
    }
    return col;
}

vec3 RenderRefl(vec3 ro, vec3 rd, vec3 sunDir) {
    float d = RayMarchRefl(ro, rd);
    if(d < 80.0) {
        vec3 p = ro + rd * d;
        vec3 n = GetNormal(p);
        vec2 res = GetDist(p);
        float dif = clamp(dot(n, sunDir), 0.0, 1.0);
        vec3 tCol = vec3(0.3, 0.28, 0.25);
        if (res.y < 0.5) {
            float slope = 1.0 - n.y;
            float h = p.y;
            vec3 grass = mix(vec3(0.18, 0.38, 0.10), uTerrainColor * vec3(0.8, 1.2, 0.6), 0.35);
            vec3 rock = mix(vec3(0.3, 0.28, 0.25), uTerrainColor, 0.65);
            float rockMask = smoothstep(0.3, 0.6, slope);
            tCol = mix(grass, rock, rockMask);
            float snowMask = smoothstep(uTerrainHeight * 0.82, uTerrainHeight * 1.05, h);
            tCol = mix(tCol, uSnowColor, snowMask * (1.0 - rockMask));
        }
        vec3 col = tCol * (0.3 + 0.7 * dif);
        float fogAmount = 1.0 - exp(-d * uFogDensity);
        return mix(col, uSkyColor, fogAmount);
    }
    return GetSkyColor(rd, sunDir);
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
            vec3 sand = vec3(0.45, 0.35, 0.18);
            vec3 grass = mix(vec3(0.06, 0.22, 0.04), uTerrainColor * vec3(0.7, 1.3, 0.5), 0.25);
            vec3 forest = mix(vec3(0.02, 0.09, 0.02), uTerrainColor * 0.3, 0.2);
            vec3 rock = mix(vec3(0.14, 0.12, 0.10), uTerrainColor, 0.55);
            vec3 snowCol = uSnowColor;
            float grassMask = smoothstep(uWaterLevel + 0.2, uWaterLevel + 2.0, h);
            float forestMask = smoothstep(uWaterLevel + 3.0, uWaterLevel + 8.0, h);
            float rockMask = smoothstep(uTerrainHeight * 0.5, uTerrainHeight * 0.8, h);
            float snowMask = smoothstep(uTerrainHeight * 0.82, uTerrainHeight * 1.05, h);
            tCol = mix(sand, grass, grassMask);
            tCol = mix(tCol, forest, forestMask);
            float slopeRock = smoothstep(0.3, 0.6, slope + detail * 0.1);
            tCol = mix(tCol, rock, slopeRock);
            tCol = mix(tCol, rock, rockMask);
            isSnow = snowMask * (1.0 - smoothstep(0.4, 0.8, slope)) * smoothstep(0.25, 0.6, detail);
            tCol = mix(tCol, snowCol * (0.9 + 0.1 * detail), isSnow);
            // Demoscene: animated caustics on underwater/shoreline terrain
            if (h < uWaterLevel + 1.5) {
                float caustDepth = 1.0 - smoothstep(uWaterLevel - 1.0, uWaterLevel + 1.5, h);
                float c1 = noise(vec3(p.xz * 6.0 + iTime * 0.3, iTime * 0.2));
                float c2 = noise(vec3(p.xz * 8.0 - iTime * 0.4, iTime * 0.3 + 10.0));
                float caustic = pow(max(c1 + c2 - 0.6, 0.0), 2.0) * 4.0;
                tCol += caustic * caustDepth * vec3(0.15, 0.25, 0.35) * (1.0 - uStormAmount);
            }
        } else if (res.y > 0.5 && res.y < 1.5) {
            tCol = mix(vec3(0.35, 0.3, 0.25), uTerrainColor, 0.5);
        } else if (res.y > 1.5 && res.y < 2.5) {
            tCol = mix(vec3(0.25, 0.14, 0.06), vec3(0.06, 0.30, 0.09), smoothstep(0.15, 0.35, Terrain(p)));
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
        lin += skyLight * ao * 0.35;
        lin += amb * vec3(0.1, 0.08, 0.05) * ao;
        lin += bac * ao * 0.1;
        if (uStormAmount > 0.1) {
            float flash = step(0.96, hash(vec3(floor(iTime * 3.0), 0.0, 0.0)));
            lin += flash * vec3(1.0, 1.1, 1.5) * ao * 3.0;
        }
        vec3 col = tCol * lin;
        // Demoscene: rim/silhouette lighting for dramatic terrain edges
        float rim = 1.0 - max(dot(n, -rd), 0.0);
        rim = pow(rim, 3.0);
        vec3 rimColor = mix(vec3(0.3, 0.5, 0.8), vec3(1.0, 0.6, 0.3), max(dot(sunDir, -rd), 0.0));
        col += rim * rimColor * 0.15 * ao;
        if (isSnow > 0.1 && res.y < 0.5) {
            vec3 ref = reflect(rd, n);
            float spec = pow(clamp(dot(ref, sunDir), 0.0, 1.0), 32.0);
            col += uSnowColor * spec * shadow * isSnow;
        }
        // Demoscene: atmospheric scattering (sun-colored fog instead of flat sky fog)
        float fogAmount = 1.0 - exp(-d * uFogDensity);
        float sunFog = max(dot(rd, sunDir), 0.0);
        vec3 fogColor = mix(uSkyColor, vec3(1.0, 0.7, 0.4), pow(sunFog, 4.0) * 0.6 * (1.0 - uStormAmount));
        return mix(col, fogColor, fogAmount);
    }
    return GetSkyColor(rd, sunDir);
}

vec3 acesFilm(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Demoscene: ordered Bayer dithering to break color banding
float bayerDither(vec2 coord) {
    vec2 c = floor(mod(coord, 4.0));
    float idx = c.x + c.y * 4.0;
    // 4x4 Bayer matrix encoded as threshold values
    float m;
    if      (idx <  1.0) m =  0.0; else if (idx <  2.0) m =  8.0;
    else if (idx <  3.0) m =  2.0; else if (idx <  4.0) m = 10.0;
    else if (idx <  5.0) m = 12.0; else if (idx <  6.0) m =  4.0;
    else if (idx <  7.0) m = 14.0; else if (idx <  8.0) m =  6.0;
    else if (idx <  9.0) m =  3.0; else if (idx < 10.0) m = 11.0;
    else if (idx < 11.0) m =  1.0; else if (idx < 12.0) m =  9.0;
    else if (idx < 13.0) m = 15.0; else if (idx < 14.0) m =  7.0;
    else if (idx < 15.0) m = 13.0; else                 m =  5.0;
    return (m / 16.0 - 0.5) / 128.0;
}

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= iResolution.x / iResolution.y;
    vec3 ro = iCameraPos;
    vec3 rd = normalize((iCameraMatrix * vec4(uv.x, uv.y, -1.5, 0.0)).xyz);
    vec3 sunDir = normalize(uSunDir);
    float dTerrain = RayMarch(ro, rd);
    // Iterative water intersection with waves
    float dWater = -1.0;
    if (rd.y < 0.0) {
        float tFlat = (uWaterLevel - ro.y) / rd.y;
        if (tFlat > 0.0) {
            float t = max(tFlat - 2.0, 0.0);
            for (int i = 0; i < 6; i++) {
                vec3 wp = ro + rd * t;
                float wh = WaterHeight(wp.xz);
                float diff = wp.y - wh;
                t += diff / max(-rd.y, 0.001);
            }
            if (t > 0.0) dWater = t;
        }
    }
    vec3 col;
    if(dWater > 0.0 && (dWater < dTerrain || dTerrain >= MAX_DIST)) {
        vec3 p = ro + rd * dWater;
        vec3 n = WaterNormal(p.xz);
        vec3 refRD = reflect(rd, n);
        vec3 refCol;
        if (refRD.y > 0.01) {
            refCol = RenderRefl(p + n * 0.1, refRD, sunDir);
        } else {
            refCol = GetSkyColor(refRD, sunDir);
        }
        float fresnel = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 4.0);
        vec3 deepWater = mix(uWaterColor, vec3(0.01, 0.06, 0.18), 0.5);
        vec3 shallowLagoon = vec3(0.02, 0.28, 0.34);
        float terrainH = TerrainHeight(p.xz);
        float verticalDepth = max(uWaterLevel - terrainH, 0.0);
        float lagoonFactor = exp(-verticalDepth * 0.75);
        vec3 waterBody = mix(deepWater, shallowLagoon, lagoonFactor);
        // Underwater sand & caustics visible in clear shallow water (Beer-Lambert transmittance)
        if (verticalDepth < 2.5) {
            float c1 = noise(vec3(p.xz * 5.0 + iTime * 0.35, iTime * 0.2));
            float c2 = noise(vec3(p.xz * 7.0 - iTime * 0.4, iTime * 0.3 + 10.0));
            float caust = pow(max(c1 + c2 - 0.55, 0.0), 2.0) * 3.5;
            vec3 seabedCol = vec3(0.38, 0.30, 0.16) + caust * vec3(0.10, 0.28, 0.32);
            waterBody = mix(waterBody, seabedCol, exp(-verticalDepth * 1.4) * 0.65);
        }
        col = mix(waterBody, refCol, 0.08 + 0.42 * fresnel);
        // Sun glitter / specular path on waves
        float spec = pow(max(dot(refRD, sunDir), 0.0), 96.0);
        col += vec3(1.0, 0.92, 0.75) * spec * 0.9 * (1.0 - uStormAmount);
        // Animated double-band shoreline surf & foam
        if (verticalDepth < 1.2) {
            float wavePhase = verticalDepth * 10.0 - iTime * 2.5 + noise(vec3(p.xz * 1.5, 0.0)) * 2.0;
            float surfRings = pow(max(0.0, sin(wavePhase)), 6.0) * (1.0 - smoothstep(0.0, 1.1, verticalDepth));
            float shoreEdge = (1.0 - smoothstep(0.0, 0.28, verticalDepth)) * (0.6 + 0.4 * noise(vec3(p.xz * 4.5, iTime * 0.9)));
            float foam = clamp(shoreEdge + surfRings * 0.5, 0.0, 1.0);
            col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.8);
        }
        // Sun-colored atmospheric scattering on water too
        float sunFogW = max(dot(rd, sunDir), 0.0);
        vec3 fogColorW = mix(uSkyColor, vec3(1.0, 0.7, 0.4), pow(sunFogW, 4.0) * 0.6 * (1.0 - uStormAmount));
        col = mix(col, fogColorW, 1.0 - exp(-min(dWater, 140.0) * uFogDensity * 0.55));
    } else {
        col = Render(ro, rd, sunDir);
    }
    // Storm rain streaks (screen-space)
    if (uStormAmount > 0.1) {
        float rainLayer1 = step(0.98, hash(vec3(floor(vUv.x * 120.0), floor(vUv.y * 8.0 - iTime * 12.0), 1.0)));
        float rainLayer2 = step(0.97, hash(vec3(floor(vUv.x * 80.0), floor(vUv.y * 6.0 - iTime * 8.0), 2.0)));
        float rain = (rainLayer1 + rainLayer2 * 0.5) * uStormAmount;
        col = mix(col, vec3(0.7, 0.75, 0.85), rain * 0.3);
    }
    // Demoscene: apply Bayer dithering to break banding in gradients
    vec3 tonemapped = pow(acesFilm(col * uExposure), vec3(0.4545));
    float dither = bayerDither(gl_FragCoord.xy);
    tonemapped += dither;
    // Demoscene: chromatic aberration (RGB channel offset at screen edges)
    if (uChromaticAberration > 0.001) {
        vec2 caUV = vUv - 0.5;
        float caStrength = uChromaticAberration * length(caUV) * 0.02;
        // We shift the UV and re-evaluate the tonemapped color per channel
        // Since we can't re-render, approximate by shifting the existing result
        vec2 caR = vUv + caUV * caStrength;
        vec2 caB = vUv - caUV * caStrength;
        // Apply as a color fringe using the position-based shift
        float rShift = tonemapped.r * (1.0 + caStrength * 8.0);
        float bShift = tonemapped.b * (1.0 - caStrength * 8.0);
        tonemapped.r = mix(tonemapped.r, rShift, 0.5);
        tonemapped.b = mix(tonemapped.b, bShift, 0.5);
    }
    // Demoscene: vignette (darken edges)
    if (uVignette > 0.001) {
        vec2 vigUV = vUv - 0.5;
        float vig = 1.0 - dot(vigUV, vigUV) * uVignette * 2.0;
        tonemapped *= clamp(vig, 0.0, 1.0);
    }
    // Demoscene: film grain (animated noise overlay)
    if (uFilmGrain > 0.001) {
        float grain = hash(vec3(gl_FragCoord.xy, fract(iTime * 43.17))) - 0.5;
        tonemapped += grain * uFilmGrain * 0.1;
    }
    gl_FragColor = vec4(tonemapped, 1.0);
}
`;

// Some embedded/headless hosts report a 0x0 window before layout settles. Fall back to a
// sane default so the renderer never builds a zero-sized (blank, unexportable) canvas.
function viewportSize() {
    return { w: window.innerWidth || 1280, h: window.innerHeight || 720 };
}


class BryceApp {
    constructor() {
        console.log("BryceApp: Initializing");
        const vp = viewportSize();
        this.scene = new THREE.Scene();
        this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
        this.camera = new THREE.PerspectiveCamera(45, viewportSize().w / viewportSize().h, 0.1, 1000);
        this.camera.position.set(0, 15, 30);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        this.renderer.setSize(vp.w, vp.h);
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
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(vp.w, vp.h), 0.12, 0.25, 0.95);
        this.composer.addPass(this.bloomPass);

        this.startTime = Date.now();
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                iTime: { value: 0 },
                iResolution: { value: new THREE.Vector2(vp.w, vp.h) },
                iCameraPos: { value: new THREE.Vector3() },
                iCameraMatrix: { value: new THREE.Matrix4() },
                uTerrainScale: { value: 0.15 },
                uTerrainHeight: { value: 8.0 },
                uOctaves: { value: 8 },
                uSunDir: { value: new THREE.Vector3(1, 0.5, 0.5) },
                uFogDensity: { value: 0.0035 },
                uCloudDensity: { value: 0.5 },
                uSkyColor: { value: new THREE.Color('#80b3ff') },
                uTerrainColor: { value: new THREE.Color('#664d33') },
                uSnowColor: { value: new THREE.Color('#e6e6e6') },
                uWaterLevel: { value: 1.0 },
                uWaterColor: { value: new THREE.Color('#1a4d80') },
                uTerrainDetail: { value: 0.5 },
                uSeed: { value: Math.random() * 100 },
                uFractalAmount: { value: 0.0 },
                uMonolithAmount: { value: 0.0 },
                uUserObjects: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
                uNumUserObjects: { value: 0 },
                uStormAmount: { value: 0.0 },
                uExposure: { value: 1.05 },
                uChromaticAberration: { value: 0.3 },
                uVignette: { value: 0.35 },
                uFilmGrain: { value: 0.15 }
            }
        });

        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.scene.add(quad);

        try {
            this.gui = new GUI();
            this.setupGUI();
        } catch(e) {
            console.error("GUI failed to load", e);
        }

        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.domElement.addEventListener('click', this.onMouseClick.bind(this));
        window.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') this.downloadImage();
        });
        // Expose for programmatic snapshots / verification (e.g. window.bryceApp.captureDataURL()).
        window.bryceApp = this;

        console.log("BryceApp: Setup complete, starting animation");
        this.animate();
    }

    // Render one fresh frame and return it as a PNG data URL. preserveDrawingBuffer:true
    // on the renderer keeps the back buffer readable, so this works headlessly too.
    captureDataURL() {
        this.composer.render();
        return this.renderer.domElement.toDataURL('image/png');
    }

    // Trigger a browser download of the current render.
    downloadImage(filename = 'bryce-render.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = this.captureDataURL();
        link.click();
    }


    onMouseClick(event) {
        if (this.material.uniforms.uNumUserObjects.value >= 8) return;
        const mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        const ray = raycaster.ray;
        const targetY = this.material.uniforms.uTerrainHeight.value * 0.4;
        let t = (targetY - ray.origin.y) / ray.direction.y;
        if (t < 0 || t > 200) t = 20;
        const pos = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, t);
        const idx = this.material.uniforms.uNumUserObjects.value;
        this.material.uniforms.uUserObjects.value[idx].copy(pos);
        this.material.uniforms.uNumUserObjects.value++;
        this.material.uniforms.uUserObjects.value = [...this.material.uniforms.uUserObjects.value];
    }

    setupGUI() {
        const terrainFolder = this.gui.addFolder('Terrain');
        terrainFolder.add(this.material.uniforms.uTerrainScale, 'value', 0.01, 2.0).name('Scale');
        terrainFolder.add(this.material.uniforms.uTerrainHeight, 'value', 0.0, 40.0).name('Height');
        terrainFolder.add(this.material.uniforms.uOctaves, 'value', 1, 8, 1).name('Octaves');
        terrainFolder.add(this.material.uniforms.uTerrainDetail, 'value', 0, 2.0).name('Detail');
        terrainFolder.add(this.material.uniforms.uSeed, 'value', 0, 100).name('Seed').listen();

        const envFolder = this.gui.addFolder('Environment');
        envFolder.add(this.material.uniforms.uSunDir.value, 'x', -1, 1).name('Sun X');
        envFolder.add(this.material.uniforms.uSunDir.value, 'y', -1, 1).name('Sun Y');
        envFolder.add(this.material.uniforms.uSunDir.value, 'z', -1, 1).name('Sun Z');
        envFolder.add(this.material.uniforms.uFogDensity, 'value', 0, 0.1).name('Fog');
        envFolder.add(this.material.uniforms.uWaterLevel, 'value', -5, 5).name('Water Level');
        envFolder.add(this.material.uniforms.uFractalAmount, 'value', 0, 1).name('Fractal');
        envFolder.add(this.material.uniforms.uMonolithAmount, 'value', 0, 1).name('Monoliths');
        envFolder.add(this.material.uniforms.uStormAmount, 'value', 0, 1).name('Storm Intensity');
        envFolder.add(this.material.uniforms.uExposure, 'value', 0.1, 3.0).name('Exposure');

        const fxFolder = this.gui.addFolder('Post FX');
        fxFolder.add(this.material.uniforms.uChromaticAberration, 'value', 0, 2.0).name('Chromatic Aberr.');
        fxFolder.add(this.material.uniforms.uVignette, 'value', 0, 2.0).name('Vignette');
        fxFolder.add(this.material.uniforms.uFilmGrain, 'value', 0, 1.0).name('Film Grain');

        const bloomFolder = this.gui.addFolder('Bloom');
        bloomFolder.add(this.bloomPass, 'strength', 0, 3).name('Strength');
        bloomFolder.add(this.bloomPass, 'radius', 0, 1).name('Radius');
        bloomFolder.add(this.bloomPass, 'threshold', 0, 1).name('Threshold');

        const colorFolder = this.gui.addFolder('Colors');
        const colorParams = {
            sky: '#80b3ff',
            terrain: '#664d33',
            snow: '#e6e6e6',
            water: '#1a4d80',
            presets: 'Alpine',
            randomize: () => {
                this.material.uniforms.uSeed.value = Math.random() * 100;
            },
            resetCam: () => {
                this.camera.position.set(0, 15, 30);
                this.controls.target.set(0, 0, 0);
                this.controls.update();
            },
            screenshot: () => this.downloadImage()
        };

        colorFolder.add(colorParams, 'randomize').name('Randomize Seed');
        colorFolder.add(colorParams, 'resetCam').name('Reset Camera');
        colorFolder.add(colorParams, 'screenshot').name('Capture Render');

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
            this.gui.folders.forEach(f => f.controllers.forEach(c => c.updateDisplay()));
        });
    }

    onWindowResize() {
        const vp = viewportSize();
        this.camera.aspect = vp.w / vp.h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(vp.w, vp.h);
        this.composer.setSize(vp.w, vp.h);
        this.material.uniforms.iResolution.value.set(vp.w, vp.h);
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
