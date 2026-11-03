// Carga el museo exportado desde Blender: el modelo, sus lightmaps y las imágenes de las obras.
// Las esculturas traen la luz horneada en los vértices (COLOR_0) en vez de en una lightmap.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;

// Busca una propiedad de Blender (extras de glTF) en la malla o en su nodo padre:
// las mallas con varios materiales llegan como un grupo con una malla por material.
function propiedad(obj, nombre) {
  return obj.userData[nombre] ?? obj.parent?.userData[nombre];
}

function cargarTextura(cargador, url, { srgb = true, anisotropia = 1 } = {}) {
  return cargador.loadAsync(url).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropia;
    return t;
  });
}

// La luz de vértice llega normalizada y en sRGB, como las lightmaps: se descodifica y se suma
// como irradiancia, en lugar de multiplicar el color del material como haría Three.js.
function luzDeVertices(material, intensidad) {
  material.vertexColors = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.intensidadLuzVertices = { value: intensidad };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float intensidadLuzVertices;\nvoid main() {')
      .replace('#include <color_fragment>', '')
      // clamp: con MSAA el color se extrapola un poco fuera del triángulo en los bordes, y un
      // pow() de un valor negativo da NaN, que el bloom esparce en grandes manchas negras.
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        vec3 luzV = clamp(vColor.rgb, 0.0, 1.0);
        luzV = mix(luzV / 12.92, pow((luzV + 0.055) / 1.055, vec3(2.4)), step(0.04045, luzV));
        irradiance += luzV * intensidadLuzVertices;`);
  };
}

export async function cargarMuseo({ renderer, calidad, alProgreso }) {
  const gestor = new THREE.LoadingManager();
  gestor.onProgress = (_url, hechos, total) => alProgreso?.(hechos / total);

  const escena = await (await fetch(`${BASE}modelos/escena.json`)).json();
  const cargadorGltf = new GLTFLoader(gestor).setMeshoptDecoder(MeshoptDecoder);
  const cargadorTex = new THREE.TextureLoader(gestor);
  const anisotropia = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const lightmaps = Object.fromEntries(await Promise.all(
    Object.entries(escena.lightmaps).map(async ([grupo, lm]) => {
      if (lm.vertices) return [grupo, { vertices: true, intensidad: lm.escala * Math.PI }];
      const t = await cargarTextura(cargadorTex, `${BASE}lightmaps/${lm.archivos[calidad.texturas]}`);
      t.flipY = false; // mismas UV que glTF
      t.channel = 1; // TEXCOORD_1
      return [grupo, { textura: t, intensidad: lm.escala * Math.PI }];
    }),
  ));

  const obras = Object.fromEntries(await Promise.all(
    escena.obras.filter((o) => o.tipo !== 'escultura').map(async (o) => {
      const t = await cargarTextura(cargadorTex, `${BASE}obras/${o.id}-${calidad.texturas}.webp`, { anisotropia });
      t.flipY = false;
      return [o.id, t];
    }),
  ));

  const gltf = await cargadorGltf.loadAsync(`${BASE}modelos/museo.glb`);
  const modelo = gltf.scene;
  const clones = new Map();
  const mallasPorGrupo = {};

  modelo.traverse((obj) => {
    if (!obj.isMesh) return;
    const grupo = propiedad(obj, 'lightmap');
    const obra = propiedad(obj, 'obra');
    if (obj.material.map) obj.material.map.anisotropy = anisotropia;
    if (grupo && lightmaps[grupo]) {
      // Un material puede repetirse en varios grupos (y los lienzos comparten uno solo tras
      // la optimización): se clona uno por grupo y por obra.
      const clave = `${obj.material.uuid}:${grupo}:${obra ?? ''}`;
      if (!clones.has(clave)) {
        const m = obj.material.clone();
        if (lightmaps[grupo].vertices) {
          luzDeVertices(m, lightmaps[grupo].intensidad);
        } else {
          m.lightMap = lightmaps[grupo].textura;
          m.lightMapIntensity = lightmaps[grupo].intensidad;
        }
        if (obra) m.map = obras[obra];
        clones.set(clave, m);
      }
      obj.material = clones.get(clave);
      (mallasPorGrupo[grupo] ??= []).push(obj);
    }
    obj.userData.obra = obra;
  });

  return { modelo, escena, mallasPorGrupo, texturasObras: obras };
}
