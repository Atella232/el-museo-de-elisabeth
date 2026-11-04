// Reflejo planar del suelo pulido.
//
// Una cámara espejo (como la de Reflector de Three.js) renderiza la sala reflejada en el
// plano y = 0 a una textura de menor resolución con mipmaps. El material del suelo la muestrea
// con un poco de desenfoque y la suma a su luz según el ángulo de visión (fresnel).
import * as THREE from 'three';

const _normal = new THREE.Vector3(0, 1, 0);
const _posCam = new THREE.Vector3();
const _mira = new THREE.Vector3();
const _vista = new THREE.Vector3();
const _objetivo = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _plano = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

export class ReflejoSuelo {
  constructor(renderer, mallas, { resolucion = 0.5, fuerza = 1, desenfoque = 1.2 } = {}) {
    this.renderer = renderer;
    this.mallas = mallas;
    this.resolucion = resolucion;
    this.camara = new THREE.PerspectiveCamera();
    this.matriz = new THREE.Matrix4();
    this.objetivo = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.uniformes = {
      tReflejo: { value: this.objetivo.texture },
      mReflejo: { value: this.matriz },
      uFuerza: { value: fuerza },
      uDesenfoque: { value: desenfoque },
    };
    const vistos = new Set();
    for (const malla of mallas) {
      if (vistos.has(malla.material)) continue;
      vistos.add(malla.material);
      this.#parchear(malla.material);
    }
  }

  #parchear(material) {
    const u = this.uniformes;
    material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'uniform mat4 mReflejo;\nvarying vec4 vReflejo;\n' + sh.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n\tvReflejo = mReflejo * modelMatrix * vec4( transformed, 1.0 );',
      );
      sh.fragmentShader = 'uniform sampler2D tReflejo;\nuniform float uFuerza;\nuniform float uDesenfoque;\nvarying vec4 vReflejo;\n' +
        sh.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
	{
		vec2 uvR = vReflejo.xy / vReflejo.w;
		vec3 reflejo = textureLod( tReflejo, uvR, uDesenfoque ).rgb;
		float nv = clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );
		float fresnel = mix( 0.045, 0.75, pow( 1.0 - nv, 4.0 ) );
		outgoingLight += reflejo * fresnel * uFuerza;
	}
	#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'reflejoSuelo';
    material.needsUpdate = true;
  }

  liberar() {
    this.objetivo.dispose();
  }

  ajustarTamano(ancho, alto) {
    const pr = this.renderer.getPixelRatio();
    this.objetivo.setSize(Math.max(1, Math.round(ancho * pr * this.resolucion)), Math.max(1, Math.round(alto * pr * this.resolucion)));
  }

  // Lógica de la cámara espejo tomada de three/examples/jsm/objects/Reflector.js,
  // con el plano fijo en y = 0 y la matriz en coordenadas de mundo.
  actualizar(escena, camara) {
    _posCam.setFromMatrixPosition(camara.matrixWorld);
    if (_posCam.y <= 0) return;
    // Reflejar en y = 0 es cambiar el signo de y.
    _vista.set(_posCam.x, -_posCam.y, _posCam.z);
    _rot.extractRotation(camara.matrixWorld);
    _mira.set(0, 0, -1).applyMatrix4(_rot).add(_posCam);
    _objetivo.set(_mira.x, -_mira.y, _mira.z);

    const cv = this.camara;
    cv.position.copy(_vista);
    cv.up.set(0, 1, 0).applyMatrix4(_rot);
    cv.up.y = -cv.up.y;
    cv.lookAt(_objetivo);
    cv.far = camara.far;
    cv.near = camara.near;
    cv.updateMatrixWorld();
    cv.projectionMatrix.copy(camara.projectionMatrix);

    this.matriz.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matriz.multiply(cv.projectionMatrix).multiply(cv.matrixWorldInverse);

    // Plano de recorte oblicuo para no reflejar lo que queda bajo el suelo.
    _plano.setFromNormalAndCoplanarPoint(_normal, new THREE.Vector3(0, 0.001, 0)).applyMatrix4(cv.matrixWorldInverse);
    _clip.set(_plano.normal.x, _plano.normal.y, _plano.normal.z, _plano.constant);
    const p = cv.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + p[8]) / p[0], (Math.sign(_clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    p[10] = _clip.z + 1;
    p[14] = _clip.w;

    const r = this.renderer;
    const anterior = r.getRenderTarget();
    const sombra = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    for (const m of this.mallas) m.visible = false;
    r.setRenderTarget(this.objetivo);
    r.clear();
    r.render(escena, cv);
    for (const m of this.mallas) m.visible = true;
    r.setRenderTarget(anterior);
    r.shadowMap.autoUpdate = sombra;
  }
}
