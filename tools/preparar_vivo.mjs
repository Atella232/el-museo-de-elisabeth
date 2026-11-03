// Prepara un vídeo para que un cuadro «cobre vida» en el museo (web/src/escena/vivos.js):
//   1. Lo alinea con la pintura. Los modelos de vídeo recortan o reencuadran la imagen a su
//      manera, así que se busca qué rectángulo del cuadro corresponde al primer fotograma
//      (que es el propio cuadro) comparándolos a baja resolución.
//   2. Lo recodifica para la web en dos calidades (web/public/vivos/<id>-alta.mp4 y -media.mp4).
//   3. Escribe el rectángulo en "vivo.caja" de data/obras.json.
// Necesita macOS (usa AVFoundation a través de los scripts de Swift de tools/).
//
// Uso: npm run vivo -- <id de la obra> <vídeo.mp4>
//      npm run vivo -- eco tools/cache/vivos/externos/eco.mp4
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ejecutar = promisify(execFile);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id, video] = process.argv.slice(2);
if (!id || !video) {
  console.error('uso: npm run vivo -- <id de la obra> <vídeo.mp4>');
  process.exit(1);
}

// --- 1. Alinear
const tmp = path.join(os.tmpdir(), `vivo-${id}.png`);
await ejecutar('swift', [path.join(raiz, 'tools/fotograma_video.swift'), video, tmp]);
const { width: VW, height: VH } = await sharp(tmp).metadata();
// Si el vídeo trae un margen liso alrededor del cuadro (se añade para que el modelo no recorte
// la pintura), se quita antes de comparar: el margen no está en el cuadro y despista la búsqueda.
const recorte = await sharp(tmp).trim({ threshold: 12 }).png().toBuffer({ resolveWithObject: true });
const margenIzq = -(recorte.info.trimOffsetLeft ?? 0);
const margenSup = -(recorte.info.trimOffsetTop ?? 0);
const conMargen = recorte.info.width < VW * 0.96 || recorte.info.height < VH * 0.96;
const FW = conMargen ? recorte.info.width : VW;
const FH = conMargen ? recorte.info.height : VH;
const fotograma = conMargen ? recorte.data : await fs.readFile(tmp);
if (conMargen) console.log(`  margen liso quitado: ${VW}×${VH} → ${FW}×${FH}`);

// Gris normalizado (media 0, desviación 1): así cuentan igual las líneas finas de un grabado
// sobre papel blanco que los contrastes de un óleo.
const gris = async (archivo, ancho, desenfoque = 1) => {
  const { data, info } = await sharp(archivo).resize(ancho).greyscale().blur(desenfoque).raw().toBuffer({ resolveWithObject: true });
  const px = Float32Array.from(data);
  const media = px.reduce((a, b) => a + b, 0) / px.length;
  const desv = Math.sqrt(px.reduce((a, b) => a + (b - media) ** 2, 0) / px.length) || 1;
  for (let i = 0; i < px.length; i++) px[i] = (px[i] - media) / desv;
  return { px, w: info.width, h: info.height };
};
const cuadroFino = await gris(path.join(raiz, `web/public/obras/${id}-alta.webp`), 1600, 0.8);
const cuadroGrueso = await gris(path.join(raiz, `web/public/obras/${id}-alta.webp`), 720, 4);
const fotoFina = await gris(fotograma, 320, 0.8);
const fotoGruesa = await gris(fotograma, 48, 1.5);
let cuadro = cuadroGrueso;
await fs.rm(tmp);
let foto = fotoGruesa;

// Muestra bilineal del cuadro en coordenadas normalizadas (fuera, el color del borde).
function muestra(u, v) {
  const x = Math.min(cuadro.w - 1, Math.max(0, u * cuadro.w - 0.5));
  const y = Math.min(cuadro.h - 1, Math.max(0, v * cuadro.h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(cuadro.w - 1, x0 + 1);
  const y1 = Math.min(cuadro.h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const p = cuadro.px;
  return (p[y0 * cuadro.w + x0] * (1 - tx) + p[y0 * cuadro.w + x1] * tx) * (1 - ty)
    + (p[y1 * cuadro.w + x0] * (1 - tx) + p[y1 * cuadro.w + x1] * tx) * ty;
}
// Error cuadrático medio entre el fotograma y el trozo de cuadro [x, y, w, h] (fracciones del
// cuadro). Con imágenes normalizadas vale 0 si coinciden y unos 2 si no se parecen nada.
function error([x, y, w, h]) {
  let s = 0;
  for (let j = 0; j < foto.h; j++) {
    for (let i = 0; i < foto.w; i++) {
      s += (foto.px[j * foto.w + i] - muestra(x + ((i + 0.5) / foto.w) * w, y + ((j + 0.5) / foto.h) * h)) ** 2;
    }
  }
  return s / (foto.w * foto.h);
}
// Búsqueda gruesa: todas las escalas, estiramientos y posiciones razonables (en un grabado de
// líneas sobre papel, un descenso local se queda atascado enseguida). Algunos modelos no
// recortan la imagen a su proporción sino que la estiran, así que se prueba también eso.
const ra = FW / FH;
const rc = cuadro.w / cuadro.h;
let caja = null;
let mejor = Infinity;
for (let w = 0.45; w < 2.2; w *= 1.04) for (const estirado of [0.8, 0.86, 0.92, 0.96, 1, 1.04, 1.09, 1.16, 1.25, 1.35]) {
  const h = ((w * rc) / ra) * estirado;
  for (let x = 0.5 - w / 2 - 0.4; x <= 0.5 - w / 2 + 0.4; x += 0.015) {
    for (let y = 0.5 - h / 2 - 0.4; y <= 0.5 - h / 2 + 0.4; y += 0.015) {
      const e = error([x, y, w, h]);
      if (e < mejor) {
        mejor = e;
        caja = [x, y, w, h];
      }
    }
  }
}
// Ajuste fino a más resolución: descenso por coordenadas con pasos cada vez más pequeños
// (ahora ancho y alto por separado, por si el modelo estiró un poco la imagen).
foto = fotoFina;
cuadro = cuadroFino;
mejor = error(caja);
for (let paso = 0.02; paso > 0.0002; paso /= 2) {
  let mejora = true;
  while (mejora) {
    mejora = false;
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) {
        const c = [...caja];
        c[k] += s * paso;
        if (k === 2) c[0] -= (s * paso) / 2; // al cambiar el tamaño, mantener el centro
        if (k === 3) c[1] -= (s * paso) / 2;
        const e = error(c);
        if (e < mejor) {
          mejor = e;
          caja = c;
          mejora = true;
        }
      }
    }
  }
}
if (conMargen) {
  // De la parte recortada al vídeo entero (en unidades del cuadro por píxel de vídeo).
  const [x, y, w, h] = caja;
  caja = [x - (margenIzq * w) / FW, y - (margenSup * h) / FH, (VW * w) / FW, (VH * h) / FH];
}
caja = caja.map((v) => Number(v.toFixed(5)));
console.log(`✓ alineado: caja ${JSON.stringify(caja)} · error ${mejor.toFixed(2)} (0 = idéntico, 2 = sin relación)`);
if (mejor > 0.8) console.warn('  ⚠ el error es alto: puede que el primer fotograma no sea el cuadro');

// --- 2. Recodificar (misma proporción que el vídeo; alta hasta 1920 px de ancho)
await fs.mkdir(path.join(raiz, 'web/public/vivos'), { recursive: true });
const par = (n) => Math.round(n / 2) * 2;
for (const [calidad, anchoMax, bitsPorPixel] of [['alta', 1920, 2.2], ['media', 1280, 2.0]]) {
  const ancho = par(Math.min(anchoMax, VW));
  const alto = par((ancho * VH) / VW);
  const bitrate = Math.round(ancho * alto * bitsPorPixel);
  const { stdout } = await ejecutar('swift', [path.join(raiz, 'tools/recodificar_video.swift'), video,
    path.join(raiz, `web/public/vivos/${id}-${calidad}.mp4`), String(bitrate), String(ancho), String(alto)]);
  console.log(stdout.trim().split('\n').pop());
}

// --- 3. data/obras.json
const ruta = path.join(raiz, 'data/obras.json');
let texto = await fs.readFile(ruta, 'utf8');
const linea = `    "vivo": { "caja": [${caja.join(', ')}] },\n`;
const bloque = texto.indexOf(`    "id": "${id}",\n`);
if (bloque < 0) throw new Error(`No existe la obra ${id} en data/obras.json`);
const finId = bloque + `    "id": "${id}",\n`.length;
const siguiente = texto.slice(finId);
texto = siguiente.startsWith('    "vivo":')
  ? texto.slice(0, finId) + linea + siguiente.slice(siguiente.indexOf('\n') + 1)
  : texto.slice(0, finId) + linea + siguiente;
await fs.writeFile(ruta, texto);
console.log(`✓ data/obras.json: ${id} es un cuadro vivo`);
