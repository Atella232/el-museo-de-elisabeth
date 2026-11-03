// Motas de polvo que flotan despacio dentro de los haces de luz.
import * as THREE from 'three';
import { CAPA_AIRE } from './hacesLuz.js';

const vertice = /* glsl */ `
uniform float uTiempo;
uniform float uTam;
attribute vec4 aFase;
varying float vBrillo;
void main() {
  vec3 p = position;
  float t = uTiempo * aFase.w;
  p += vec3( sin( t + aFase.x ), sin( t * 0.7 + aFase.y ) * 0.6 - 0.15 * fract( t * 0.02 + aFase.z ), cos( t * 0.8 + aFase.z ) ) * 0.12;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uTam / max( 0.2, -mv.z );
  vBrillo = 0.55 + 0.45 * sin( t * 3.0 + aFase.x * 5.0 );
  vBrillo *= smoothstep( 0.25, 1.0, -mv.z );
}`;

const fragmento = /* glsl */ `
varying float vBrillo;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep( 0.5, 0.0, length( c ) );
  gl_FragColor = vec4( vec3( 1.0, 0.88, 0.7 ) * a * vBrillo * 0.55, 1.0 );
}`;

export function crearPolvo(focos, { porFoco = 220, pixelRatio = 1 } = {}) {
  const posiciones = [];
  const fases = [];
  const eje = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const f of focos) {
    const a = new THREE.Vector3().fromArray(f.posicion);
    const b = new THREE.Vector3().fromArray(f.objetivo);
    eje.subVectors(b, a);
    const largo = eje.length();
    eje.normalize();
    u.set(0, 1, 0).cross(eje).normalize();
    v.crossVectors(eje, u);
    const tanAng = Math.tan(THREE.MathUtils.degToRad(f.angulo / 2)) * 0.75;
    const n = Math.round(porFoco * (f.intensidad ?? 1));
    for (let i = 0; i < n; i++) {
      const t = 0.15 + 0.6 * Math.random();
      const r = tanAng * largo * t * Math.sqrt(Math.random());
      const ang = Math.random() * Math.PI * 2;
      const p = a.clone().addScaledVector(eje, largo * t)
        .addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r);
      posiciones.push(p.x, p.y, p.z);
      fases.push(Math.random() * 6.28, Math.random() * 6.28, Math.random(), 0.15 + Math.random() * 0.25);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geo.setAttribute('aFase', new THREE.Float32BufferAttribute(fases, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertice,
    fragmentShader: fragmento,
    uniforms: { uTiempo: { value: 0 }, uTam: { value: 5 * pixelRatio } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const puntos = new THREE.Points(geo, mat);
  puntos.name = 'polvo';
  puntos.frustumCulled = false;
  puntos.renderOrder = 11;
  puntos.layers.set(CAPA_AIRE);
  puntos.actualizar = (t) => { mat.uniforms.uTiempo.value = t; };
  return puntos;
}
