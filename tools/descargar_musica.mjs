// Descarga la música de fondo de data/musica.json desde Wikimedia Commons y la convierte a
// AAC (.m4a, 96 kbps), que suena en todos los navegadores, también en Safari e iOS.
// Calcula además una ganancia por pieza para que todas suenen igual de fuerte.
// Escribe web/public/musica/<id>.m4a y web/public/musica/lista.json.
//
// Necesita afconvert, que viene con macOS. Las grabaciones en Ogg Vorbis se descargan en la
// versión MP3 que genera Commons, porque afconvert no lee Vorbis; las FLAC, tal cual.
//
// Uso: npm run musica            (salta las que ya están convertidas)
//      npm run musica -- --forzar
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ejecutar = promisify(execFile);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const piezas = JSON.parse(await fs.readFile(path.join(raiz, 'data/musica.json'), 'utf8'));
const cache = path.join(raiz, 'tools/cache/musica');
const destino = path.join(raiz, 'web/public/musica');
const forzar = process.argv.includes('--forzar');

const API = 'https://commons.wikimedia.org/w/api.php';
const AGENTE = 'ElMuseoDeElisabeth/0.1 (proyecto personal sin fines comerciales; github.com/Atella232)';
const OBJETIVO_DB = -20; // nivel medio (RMS de las partes que suenan) al que se igualan las piezas

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const existe = (ruta) => fs.stat(ruta).then(() => true, () => false);

async function pedir(url, intentos = 6) {
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE } });
    if (r.ok) return r;
    if (r.status === 429 || r.status >= 500) {
      const s = Number(r.headers.get('retry-after')) || 5 * (i + 1);
      console.log(`  ${r.status}, reintento en ${s} s`);
      await espera(s * 1000);
      continue;
    }
    throw new Error(`${r.status} ${r.statusText} — ${url}`);
  }
  throw new Error(`Demasiados reintentos — ${url}`);
}

// URL que se puede convertir: el original si es FLAC o MP3, si no la versión MP3 de Commons.
async function fuentes(titulos) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', prop: 'videoinfo', viprop: 'url|mime|derivatives', titles: titulos.join('|'),
  });
  const datos = await (await pedir(`${API}?${q}`)).json();
  const normal = Object.fromEntries((datos.query.normalized ?? []).map((n) => [n.to, n.from]));
  const porTitulo = {};
  for (const p of Object.values(datos.query.pages)) {
    const vi = p.videoinfo?.[0];
    if (!vi) throw new Error(`No existe en Commons: ${p.title}`);
    const directo = /flac|mpeg/.test(vi.mime);
    const mp3 = vi.derivatives?.find((d) => d.type === 'audio/mpeg');
    if (!directo && !mp3) throw new Error(`Sin versión MP3 en Commons: ${p.title}`);
    porTitulo[normal[p.title] ?? p.title] = directo
      ? { url: vi.url, ext: vi.mime.includes('flac') ? '.flac' : '.mp3' }
      : { url: mp3.src, ext: '.mp3' };
  }
  return porTitulo;
}

// Nivel en dB del RMS medio de las ventanas de 50 ms que no son silencio.
async function nivel(archivo) {
  const wav = path.join(cache, '_nivel.wav');
  await ejecutar('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', archivo, wav]);
  const buf = await fs.readFile(wav);
  await fs.rm(wav);
  const datos = buf.indexOf('data');
  const pcm = buf.subarray(datos + 8);
  const muestras = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1)));
  const ventana = 1102;
  const niveles = [];
  for (let i = 0; i + ventana <= muestras.length; i += ventana) {
    let s = 0;
    for (let j = i; j < i + ventana; j++) s += (muestras[j] / 32768) ** 2;
    const db = 10 * Math.log10(s / ventana + 1e-12);
    if (db > -50) niveles.push(db);
  }
  return niveles.reduce((a, b) => a + b, 0) / Math.max(1, niveles.length);
}

await fs.mkdir(cache, { recursive: true });
await fs.mkdir(destino, { recursive: true });

const urls = await fuentes(piezas.map((p) => p.commons));
const lista = [];
for (const pieza of piezas) {
  const m4a = path.join(destino, `${pieza.id}.m4a`);
  const { url, ext } = urls[pieza.commons];
  const original = path.join(cache, pieza.id + ext);
  if (forzar || !(await existe(original))) {
    console.log(`↓ ${pieza.compositor}: ${pieza.titulo}`);
    await fs.writeFile(original, Buffer.from(await (await pedir(url)).arrayBuffer()));
    await espera(1500);
  }
  if (forzar || !(await existe(m4a))) {
    await ejecutar('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '96000', original, m4a]);
  }
  const db = await nivel(original);
  const ganancia = Math.min(8, 10 ** ((OBJETIVO_DB - db) / 20));
  const { stdout } = await ejecutar('afinfo', [m4a]);
  const duracion = Number(stdout.match(/estimated duration: ([\d.]+)/)?.[1] ?? 0);
  console.log(`✓ ${pieza.id}.m4a · ${(await fs.stat(m4a)).size >> 10} KB · ${Math.round(duracion)} s · nivel ${db.toFixed(1)} dB → ganancia ${ganancia.toFixed(2)}`);
  lista.push({
    archivo: `${pieza.id}.m4a`,
    titulo: pieza.titulo,
    compositor: pieza.compositor,
    interprete: pieza.interprete,
    licencia: pieza.licencia,
    duracion: Math.round(duracion),
    ganancia: Number(ganancia.toFixed(3)),
  });
}
await fs.writeFile(path.join(destino, 'lista.json'), JSON.stringify(lista, null, 2) + '\n');
const total = lista.reduce((a, p) => a + p.duracion, 0);
console.log(`✓ lista.json · ${lista.length} piezas, ${Math.round(total / 60)} min`);
