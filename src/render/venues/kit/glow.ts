import * as THREE from 'three';
import { COMMON, OUTPUT, shared } from '../../aurora/shared';

/**
 * Something that glows by itself (a lamp, a tube, a sign): its colour times `level`, with the haze
 * over it. Per-instance colours when drawn instanced.
 */
export function glow(color: THREE.ColorRepresentation = 0xffffff, level = 1, instanced = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'glow',
    uniforms: { ...shared, uColor: { value: new THREE.Color(color) }, uLevel: { value: level } },
    defines: instanced ? { INSTANCED: '' } : {},
    vertexShader: /* glsl */ `
      varying vec3 vWPos; varying vec3 vCol; varying vec3 vN;
      void main() {
        #ifdef INSTANCED
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vCol = instanceColor;
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vec4 w = modelMatrix * vec4(position, 1.0);
          vCol = vec3(1.0);
          vN = normalize(mat3(modelMatrix) * normal);
        #endif
        vWPos = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uColor;
      uniform float uLevel;
      varying vec3 vWPos; varying vec3 vCol; varying vec3 vN;
      void main() {
        vec3 v = normalize(cameraPosition - vWPos);
        // A tube is brightest where it faces the camera, softer at its edges.
        float face = 0.55 + 0.45 * abs(dot(normalize(vN), v));
        vec3 col = uColor * vCol * uLevel * face;
        gl_FragColor = vec4(applyHaze(col, vWPos) + col * 0.15, 1.0);
        ${OUTPUT}
      }`,
  });
}
