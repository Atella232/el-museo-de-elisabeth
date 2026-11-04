// Carga una sala exportada desde Blender (web/public/salas/<sala>/): el edificio, las esculturas
// escaneadas, sus lightmaps y las imágenes de las obras. Solo hay una sala cargada a la vez:
// liberar() suelta todo lo de la GPU antes de cargar la siguiente.
// Las esculturas traen la luz horneada en los vértices (COLOR_0) en vez de en una lightmap.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;
const CON_IMAGEN = new Set([undefined, 'cuadro', 'foto']); // obras que llevan una imagen en la pared

export const urlSala = (id) => `${BASE}salas/${id}/`;

// Si la sala ya está exportada (las que aún no se han montado no tienen escena.json).
export async function salaDisponible(id) {
  try {
    const r = await fetch(`${urlSala(id)}escena.json`, { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

// Descarga en segundo plano los archivos de una sala para que estén en la caché del navegador
// cuando se entre en ella, sin descodificar nada ni subirlo a la GPU.
export async function precargarSala(id, calidad) {
  try {
    const escena = await (await fetch(`${urlSala(id)}escena.json`)).json();
    const urls = [
      ...(escena.modelos ?? []).map((m) => `${urlSala(id)}${m}`),
      ...Object.values(escena.lightmaps).filter((lm) => !lm.vertices).map((lm) => `${urlSala(id)}${lm.archivos[calidad.texturas]}`),
      ...escena.obras.filter((o) => CON_IMAGEN.has(o.tipo)).map((o) => `${BASE}obras/${o.id}-${calidad.texturas}.webp`),
    ];
    for (const url of urls) await fetch(url, { priority: 'low' }).then((r) => r.blob());
  } catch {
    // es solo una ayuda: si falla, la sala se descargará al entrar
  }
}

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

export async function cargarSala(id, { renderer, calidad, alProgreso }) {
  const gestor = new THREE.LoadingManager();
  gestor.onProgress = (_url, hechos, total) => alProgreso?.(hechos / total);
  const raiz = urlSala(id);

  const escena = await (await fetch(`${raiz}escena.json`)).json();
  const cargadorGltf = new GLTFLoader(gestor).setMeshoptDecoder(MeshoptDecoder);
  const cargadorTex = new THREE.TextureLoader(gestor);
  const anisotropia = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const lightmaps = Object.fromEntries(await Promise.all(
    Object.entries(escena.lightmaps).map(async ([grupo, lm]) => {
      if (lm.vertices) return [grupo, { vertices: true, intensidad: lm.escala * Math.PI }];
      const t = await cargarTextura(cargadorTex, `${raiz}${lm.archivos[calidad.texturas]}`);
      t.flipY = false; // mismas UV que glTF
      t.channel = 1; // TEXCOORD_1
      return [grupo, { textura: t, intensidad: lm.escala * Math.PI }];
    }),
  ));

  const obras = Object.fromEntries(await Promise.all(
    escena.obras.filter((o) => CON_IMAGEN.has(o.tipo)).map(async (o) => {
      const t = await cargarTextura(cargadorTex, `${BASE}obras/${o.id}-${calidad.texturas}.webp`, { anisotropia });
      t.flipY = false;
      return [o.id, t];
    }),
  ));

  const modelo = new THREE.Group();
  modelo.name = `sala_${id}`;
  for (const archivo of escena.modelos ?? ['sala.glb']) {
    modelo.add((await cargadorGltf.loadAsync(`${raiz}${archivo}`)).scene);
  }
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

  function liberar() {
    const texturas = new Set([...Object.values(obras), ...Object.values(lightmaps).map((l) => l.textura).filter(Boolean)]);
    modelo.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry.dispose();
      for (const m of [obj.material].flat()) {
        for (const v of Object.values(m)) if (v?.isTexture) texturas.add(v);
        m.dispose();
      }
    });
    for (const t of texturas) t.dispose();
    modelo.removeFromParent();
  }

  return { id, modelo, escena, mallasPorGrupo, texturasObras: obras, liberar };
}
