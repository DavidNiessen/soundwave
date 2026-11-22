import * as THREE from 'three';
import { COMMON, OUTPUT, shared } from './shared';

/**
 * The night sky: a deep blue gradient soaked in the stage's light on its side, stars, a crescent
 * moon low over the far shore, faint curtains of aurora, now and then a shooting star, drifting
 * clouds with lit edges in front of all that, and three ridges of hills closing the horizon.
 */
export function buildSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: shared,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // The dome travels with the camera, so it is always infinitely far away.
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyGradient(d);
        float stars = 0.0;
        vec3 sp = d * 190.0;
        float r = hash31(floor(sp));
        if (r > 0.972) {
          float s = smoothstep(0.32, 0.0, length(fract(sp) - 0.5));
          stars = s * (0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 90.0)) * (r - 0.972) * 50.0;
        }
        float az = atan(d.z, d.x + 1e-5);
        // Aurora: two slow curtains, brighter in rays.
        float curtain = 0.0;
        for (int i = 0; i < 2; i++) {
          float fi = float(i);
          float mid = 0.36 + 0.17 * fi + 0.07 * sin(az * 2.0 + uTime * 0.03 + fi * 2.0) + 0.05 * vnoise(vec2(az * 5.0 + fi * 9.0, uTime * 0.02));
          float q = (d.y - mid) / 0.075;
          curtain += exp(-q * q) * (0.4 + 0.6 * vnoise(vec2(az * 36.0 + fi * 5.0, uTime * 0.1))) * (1.0 - 0.4 * fi);
        }
        col += mix(vec3(0.1, 0.9, 0.55), vec3(0.5, 0.3, 1.0), smoothstep(0.3, 0.62, d.y)) * curtain * 0.05 * uAuroraLevel * (0.7 + 0.3 * sin(uTime * 0.06));
        // A shooting star every so often.
        float turn = uTime / 23.0;
        float id = floor(turn);
        float ph = fract(turn) * 23.0;
        if (ph < 0.8) {
          vec3 from = normalize(vec3(hash11(id * 3.1) - 0.5, 0.42 + 0.3 * hash11(id * 7.7), -0.8));
          vec3 way = normalize(vec3(0.7 * (hash11(id * 5.3) - 0.5), -0.3, 0.1));
          vec3 rel = d - normalize(from + way * ph * 0.3);
          float behind = -dot(rel, way);
          float off = length(rel + way * behind);
          stars += smoothstep(0.0016, 0.0, off) * smoothstep(0.1, 0.0, behind) * step(0.0, behind) * sin(ph / 0.8 * 3.14159) * 1.6;
        }
        // The moon: a crescent with a halo.
        float away = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
        vec3 beside = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        float shade = acos(clamp(dot(d, normalize(uMoonDir + beside * 0.017 + vec3(0.0, 0.006, 0.0))), -1.0, 1.0));
        float disc = smoothstep(0.0285, 0.0262, away);
        vec3 moon = vec3(1.0, 0.97, 0.9) * disc * (0.1 + 0.9 * smoothstep(0.023, 0.0265, shade)) * 1.7 + uMoonCol * (exp(-away * 24.0) * 0.3 + exp(-away * 5.0) * 0.06);
        col += moon;
        if (d.y > 0.0) {
          vec2 p = d.xz / (d.y + 0.16) * 1.15 + vec2(uTime * 0.004, uTime * 0.0015);
          vec2 warp = vec2(fbm(p * 1.6 + 3.1), fbm(p * 1.6 - 5.2));
          float n = fbm(p + 0.75 * warp);
          float cover = smoothstep(0.46, 0.72, n);
          float edge = smoothstep(0.46, 0.56, n) * (1.0 - smoothstep(0.56, 0.8, n));
          float toStage = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), vec3(0.0, 0.0, -1.0)));
          vec3 body = mix(vec3(0.022, 0.055, 0.2), vec3(0.006, 0.014, 0.07), smoothstep(0.55, 0.9, n));
          vec3 cloud = body + (vec3(0.035, 0.09, 0.3) + uHazeNear * (0.1 + 0.9 * pow(toStage, 2.0)) + uMoonCol * exp(-away * 4.5) * 0.7) * edge;
          float fade = smoothstep(0.0, 0.2, d.y);
          col = mix(col, cloud, cover * fade * 0.92 * uCloudLevel);
          stars *= 1.0 - cover * uCloudLevel;
        }
        col += vec3(0.8, 0.9, 1.0) * stars * smoothstep(0.02, 0.2, d.y);
        // Three ridges of hills close the horizon, each nearer one darker.
        float far = 0.03 + 0.06 * fbm(vec2(az * 2.6, 9.3));
        col = mix(uHazeFar * 1.15, col, smoothstep(far - 0.003, far + 0.003, d.y));
        float mid = 0.016 + 0.04 * fbm(vec2(az * 5.0, 1.7));
        col = mix(uHazeFar * 0.75, col, smoothstep(mid - 0.002, mid + 0.002, d.y));
        float near = 0.006 + 0.02 * fbm(vec2(az * 9.0, 5.1)) + 0.006 * vnoise(vec2(az * 90.0, 4.0));
        col = mix(uHazeFar * 0.42, col, smoothstep(near - 0.0015, near + 0.0015, d.y));
        gl_FragColor = vec4(col * uSkyLevel, 1.0);
        ${OUTPUT}
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}
