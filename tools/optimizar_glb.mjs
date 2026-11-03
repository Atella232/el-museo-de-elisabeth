// Lleva lo que exporta Blender (build/) a la web (web/public/):
//   build/museo.glb            → web/public/modelos/museo.glb   (comprimido con meshopt)
//   build/escena.json          → web/public/modelos/escena.json
//   build/lightmaps/<g>.png    → web/public/lightmaps/<g>-alta.webp y <g>-media.webp
// y comprueba que cada malla con lightmap conserva su segundo mapa UV (TEXCOORD_1), o su
// color de vértice (COLOR_0) si la luz se horneó en los vértices (las esculturas).
//
// Uso: npm run optimizar
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(raiz, 'build');
const publico = path.join(raiz, 'web/public');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

await fs.mkdir(path.join(publico, 'modelos'), { recursive: true });
await fs.mkdir(path.join(publico, 'lightmaps'), { recursive: true });

const escena = JSON.parse(await fs.readFile(path.join(build, 'escena.json'), 'utf8'));
const lightmaps = escena.lightmaps ?? {};

// --- Modelo
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(path.join(build, 'museo.glb'));
await doc.transform(
  dedup(),
  // keepAttributes: sin él, prune borra TEXCOORD_1 porque ningún material glTF lo usa.
  prune({ keepAttributes: true, keepExtras: true }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeTexcoord: 16, quantizePosition: 16 }),
);

const sinLuz = [];
let conLightmap = 0;
for (const nodo of doc.getRoot().listNodes()) {
  const grupo = nodo.getExtras()?.lightmap;
  const malla = nodo.getMesh();
  if (!grupo || !malla) continue;
  conLightmap++;
  const atributo = lightmaps[grupo]?.vertices ? 'COLOR_0' : 'TEXCOORD_1';
  for (const prim of malla.listPrimitives()) {
    if (!prim.getAttribute(atributo)) sinLuz.push(`${nodo.getName()} (${grupo}, sin ${atributo})`);
  }
}
if (sinLuz.length) {
  console.error('✗ Mallas que han perdido su luz horneada:', sinLuz.join(', '));
  process.exit(1);
}
const destinoGlb = path.join(publico, 'modelos/museo.glb');
await io.write(destinoGlb, doc);
const antes = (await fs.stat(path.join(build, 'museo.glb'))).size;
const despues = (await fs.stat(destinoGlb)).size;
console.log(`✓ museo.glb ${kb(antes)} → ${kb(despues)} · ${conLightmap} nodos con luz horneada, ninguno la ha perdido`);

// --- Escena
for (const [grupo, lm] of Object.entries(lightmaps)) {
  if (lm.vertices) continue; // va dentro del modelo
  const origen = path.join(build, 'lightmaps', lm.archivo);
  const exr = await fs.stat(origen.replace(/\.png$/, '.exr')).then((s) => s.size, () => 0);
  const variantes = { alta: lm.resolucion, media: Math.max(256, lm.resolucion / 2) };
  const tamaños = [];
  for (const [calidad, res] of Object.entries(variantes)) {
    const destino = path.join(publico, 'lightmaps', `${grupo}-${calidad}.webp`);
    // Sin pérdida: con compresión con pérdida aparecen bloques en los degradados suaves de la luz.
    await sharp(origen).resize(res, res).webp({ lossless: true, effort: 6 }).toFile(destino);
    tamaños.push(`${calidad} ${kb((await fs.stat(destino)).size)}`);
  }
  lm.archivos = { alta: `${grupo}-alta.webp`, media: `${grupo}-media.webp` };
  console.log(`✓ lightmap ${grupo} ${lm.resolucion}px · ${tamaños.join(' · ')} (EXR de referencia ${kb(exr)})`);
}
await fs.writeFile(path.join(publico, 'modelos/escena.json'), JSON.stringify(escena));
console.log('✓ escena.json');
