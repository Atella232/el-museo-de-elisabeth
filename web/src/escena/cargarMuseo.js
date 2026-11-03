// Carga el museo exportado desde Blender: el modelo, sus lightmaps y las imágenes de las obras.
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

export async function cargarMuseo({ renderer, calidad, alProgreso }) {
  const gestor = new THREE.LoadingManager();
  gestor.onProgress = (_url, hechos, total) => alProgreso?.(hechos / total);

  const escena = await (await fetch(`${BASE}modelos/escena.json`)).json();
  const cargadorGltf = new GLTFLoader(gestor).setMeshoptDecoder(MeshoptDecoder);
  const cargadorTex = new THREE.TextureLoader(gestor);
  const anisotropia = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const lightmaps = Object.fromEntries(await Promise.all(
    Object.entries(escena.lightmaps).map(async ([grupo, lm]) => {
      const t = await cargarTextura(cargadorTex, `${BASE}lightmaps/${lm.archivos[calidad.texturas]}`);
      t.flipY = false; // mismas UV que glTF
      t.channel = 1; // TEXCOORD_1
      return [grupo, { textura: t, intensidad: lm.escala * Math.PI }];
    }),
  ));

  const obras = Object.fromEntries(await Promise.all(
    escena.obras.map(async (o) => {
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
        m.lightMap = lightmaps[grupo].textura;
        m.lightMapIntensity = lightmaps[grupo].intensidad;
        if (obra) m.map = obras[obra];
        clones.set(clave, m);
      }
      obj.material = clones.get(clave);
      (mallasPorGrupo[grupo] ??= []).push(obj);
    }
    obj.userData.obra = obra;
  });

  return { modelo, escena, mallasPorGrupo };
}
