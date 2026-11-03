// Postproceso suave: bloom en las lentes de los focos, tonemapping AgX, viñeta y grano fino.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const VinetaGrano = {
  uniforms: { tDiffuse: { value: null }, uTiempo: { value: 0 }, uVineta: { value: 0.35 }, uGrano: { value: 0.025 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTiempo;
    uniform float uVineta;
    uniform float uGrano;
    varying vec2 vUv;
    float azar( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVineta * smoothstep( 0.25, 0.85, dot( d, d ) * 2.2 );
      c.rgb += ( azar( vUv * 913.0 + fract( uTiempo ) * 71.0 ) - 0.5 ) * uGrano;
      gl_FragColor = c;
    }`,
};

export function crearPostproceso(renderer, escena3d, camara, { bloom = true } = {}) {
  const objetivo = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, objetivo);
  composer.addPass(new RenderPass(escena3d, camara));
  const pasoBloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 2.2);
  pasoBloom.enabled = bloom;
  composer.addPass(pasoBloom);
  composer.addPass(new OutputPass());
  const vineta = new ShaderPass(VinetaGrano);
  composer.addPass(vineta);
  return {
    composer,
    ajustarTamano(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    render(t) {
      vineta.uniforms.uTiempo.value = t;
      composer.render();
    },
  };
}
