// Captura la sala ya iluminada en un cubemap y lo usa como reflejo de los metales
// (marcos dorados, bronce y latón). Solo los metales: en los materiales no metálicos
// el entorno sumaría luz difusa a la que ya traen las lightmaps.
import * as THREE from 'three';

export function capturarEntorno(renderer, escena3d, posicion, { resolucion = 256, intensidad = 1 } = {}) {
  const metales = new Set();
  const mallasMetal = [];
  escena3d.traverse((o) => {
    if (o.isMesh && o.material.metalness > 0.5) {
      metales.add(o.material);
      mallasMetal.push(o);
    }
  });

  const objetivo = new THREE.WebGLCubeRenderTarget(resolucion, { type: THREE.HalfFloatType });
  const camara = new THREE.CubeCamera(0.05, 80, objetivo);
  camara.position.copy(posicion);
  // Sin entorno todavía los metales saldrían negros en su propio reflejo: se ocultan.
  for (const m of mallasMetal) m.visible = false;
  camara.update(renderer, escena3d);
  for (const m of mallasMetal) m.visible = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const entorno = pmrem.fromCubemap(objetivo.texture).texture;
  pmrem.dispose();
  objetivo.dispose();
  for (const m of metales) {
    m.envMap = entorno;
    m.envMapIntensity = intensidad;
    m.needsUpdate = true;
  }
  return entorno;
}
