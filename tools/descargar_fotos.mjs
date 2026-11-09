// Descarga las fotografías reales de las obras en 3D (data/fotos.json) para la sección
// «Fotografías» de su ficha: de Wikimedia Commons (`commons`) o, las de los vaciados, del
// Statens Museum for Kunst (`smk`). Deja en web/public/fotos/ una versión grande y una miniatura
// en WebP de cada una y fotos.json con su pie, autor, licencia y enlace, que lee la web y
// también tools/descargar_obras.mjs para CREDITOS.md.
//
// Uso: npm run fotos               (salta las que ya están descargadas)
//      npm run fotos -- --forzar   (las vuelve a descargar todas)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lista = JSON.parse(await fs.readFile(path.join(raiz, 'data/fotos.json'), 'utf8'));
const obras = Object.fromEntries(JSON.parse(await fs.readFile(path.join(raiz, 'data/obras.json'), 'utf8')).map((o) => [o.id, o]));
const destino = path.join(raiz, 'web/public/fotos');
const forzar = process.argv.includes('--forzar');

const API = 'https://commons.wikimedia.org/w/api.php';
const AGENTE = 'ElMuseoDeElisabeth/0.1 (proyecto personal sin fines comerciales; github.com/Atella232)';
const GRANDE = 1600; // lado mayor de la versión que se ve en el visor
const MINI = 360; // lado mayor de la miniatura de la ficha

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const existe = (ruta) => fs.stat(ruta).then(() => true, () => false);
const sinEtiquetas = (s = '') => s.replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/\s+/g, ' ').replace(/\.+$/, '').trim();

async function pedir(url, intentos = 6) {
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE } });
    if (r.ok) return r;
    if (r.status === 429 || r.status >= 500) {
      const s = Math.min(Number(r.headers.get('retry-after')) || 10 * (i + 1), 120);
      console.log(`  ${r.status}, reintento en ${s} s`);
      await espera(s * 1000);
      continue;
    }
    throw new Error(`${r.status} ${r.statusText} — ${url}`);
  }
  throw new Error(`Demasiados reintentos — ${url}`);
}

// Datos de todos los archivos de Commons, en lotes de 40 títulos.
const titulos = [...new Set(Object.values(lista).flat().filter((f) => f.commons).map((f) => f.commons))];
const info = {};
for (let i = 0; i < titulos.length; i += 40) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|user|extmetadata', iiurlwidth: String(GRANDE),
    iiextmetadatafilter: 'Artist|Attribution|LicenseShortName', titles: titulos.slice(i, i + 40).join('|'),
  });
  const datos = await (await pedir(`${API}?${q}`)).json();
  const normal = Object.fromEntries((datos.query.normalized ?? []).map((n) => [n.to, n.from]));
  for (const p of Object.values(datos.query.pages)) {
    if (!p.imageinfo) throw new Error(`No existe en Commons: ${p.title}`);
    info[normal[p.title] ?? p.title] = p.imageinfo[0];
  }
  await espera(1000);
}

// Quién hizo la foto. En muchas fotos de esculturas, el campo «Artist» de Commons nombra al
// escultor (o dice «autor desconocido»); entonces vale la atribución o, si no, quien la subió.
function fotografo(obra, ii) {
  const m = ii.extmetadata ?? {};
  const artista = sinEtiquetas(m.Artist?.value);
  const escultor = (obras[obra]?.autor ?? '').split(/[\s,]+/).filter((p) => p.length > 4);
  const noVale = !artista || /unknown|desconocid|hagesandros|athenodoros/i.test(artista)
    || escultor.some((p) => artista.toLowerCase().includes(p.toLowerCase()));
  if (!noVale) return artista;
  return sinEtiquetas(m.Attribution?.value) || `${ii.user} (Wikimedia Commons)`;
}

await fs.mkdir(destino, { recursive: true });
const salida = {};
for (const [obra, fotos] of Object.entries(lista)) {
  salida[obra] = [];
  for (const [i, f] of fotos.entries()) {
    const base = `${obra}-${i + 1}`;
    const grande = path.join(destino, `${base}.webp`);
    const mini = path.join(destino, `${base}-mini.webp`);
    let url;
    let datos;
    if (f.commons) {
      const ii = info[f.commons];
      const m = ii.extmetadata ?? {};
      url = ii.thumburl ?? ii.url;
      datos = {
        autor: fotografo(obra, ii),
        licencia: sinEtiquetas(m.LicenseShortName?.value) || 'dominio público',
        enlace: ii.descriptionurl,
      };
    } else {
      const smk = await (await pedir(`https://api.smk.dk/api/v1/art/?object_number=${f.smk}`)).json();
      url = smk.items[0].image_native;
      datos = { autor: f.autor, licencia: f.licencia, enlace: f.enlace };
    }
    if (forzar || !(await existe(grande)) || !(await existe(mini))) {
      console.log(`↓ ${base}`);
      const original = Buffer.from(await (await pedir(url)).arrayBuffer());
      const imagen = sharp(original).rotate();
      await imagen.clone().resize(GRANDE, GRANDE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(grande);
      await imagen.clone().resize(MINI, MINI, { fit: 'inside' }).webp({ quality: 74 }).toFile(mini);
      await espera(1500);
    } else {
      console.log(`✓ ${base} (ya descargada)`);
    }
    const { width, height } = await sharp(grande).metadata();
    salida[obra].push({ grande: `${base}.webp`, mini: `${base}-mini.webp`, ancho: width, alto: height, pie: f.pie, ...datos });
  }
}
await fs.writeFile(path.join(destino, 'fotos.json'), JSON.stringify(salida, null, 1));
console.log(`fotos.json: ${Object.values(salida).flat().length} fotografías de ${Object.keys(salida).length} obras`);
