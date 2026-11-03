// Descarga las obras de data/obras.json desde Wikimedia Commons y prepara
// dos versiones WebP para la web (calidad alta y media). También escribe CREDITOS.md.
//
// Uso: npm run obras            (salta las que ya están descargadas)
//      npm run obras -- --forzar
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const obras = JSON.parse(await fs.readFile(path.join(raiz, 'data/obras.json'), 'utf8'));
const cache = path.join(raiz, 'tools/cache');
const destino = path.join(raiz, 'web/public/obras');
const forzar = process.argv.includes('--forzar');

const API = 'https://commons.wikimedia.org/w/api.php';
const AGENTE = 'ElMuseoDeElisabeth/0.1 (proyecto personal sin fines comerciales; github.com/Atella232)';
// Anchos estándar de miniatura de Wikimedia; pedir otros puede devolver 429.
const ANCHO_DESCARGA = 3840;
const VARIANTES = { alta: 3840, media: 2048 };

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

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

const sinEtiquetas = (s = '') => s.replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/\s+/g, ' ').replace(/\.+$/, '').trim();

async function infoCommons(titulos) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', prop: 'imageinfo',
    iiprop: 'url|size|extmetadata', iiurlwidth: String(ANCHO_DESCARGA),
    iiextmetadatafilter: 'Artist|LicenseShortName|DateTimeOriginal|Credit',
    titles: titulos.join('|'),
  });
  const datos = await (await pedir(`${API}?${q}`)).json();
  const porTitulo = {};
  const normal = Object.fromEntries((datos.query.normalized ?? []).map((n) => [n.to, n.from]));
  for (const p of Object.values(datos.query.pages)) {
    if (!p.imageinfo) throw new Error(`No existe en Commons: ${p.title}`);
    porTitulo[normal[p.title] ?? p.title] = p.imageinfo[0];
  }
  return porTitulo;
}

await fs.mkdir(cache, { recursive: true });
await fs.mkdir(destino, { recursive: true });

const info = await infoCommons(obras.map((o) => o.commons));
const creditos = [];

for (const obra of obras) {
  const ii = info[obra.commons];
  const ext = path.extname(new URL(ii.thumburl ?? ii.url).pathname) || '.jpg';
  const original = path.join(cache, obra.id + ext);
  const listo = await fs.stat(path.join(destino, `${obra.id}-alta.webp`)).then(() => true, () => false);

  if (forzar || !listo) {
    console.log(`↓ ${obra.titulo}`);
    const r = await pedir(ii.thumburl ?? ii.url);
    await fs.writeFile(original, Buffer.from(await r.arrayBuffer()));
    for (const [nombre, max] of Object.entries(VARIANTES)) {
      await sharp(original)
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: nombre === 'alta' ? 88 : 82 })
        .toFile(path.join(destino, `${obra.id}-${nombre}.webp`));
    }
    await espera(1500);
  } else {
    console.log(`✓ ${obra.titulo} (ya descargada)`);
  }

  const m = ii.extmetadata ?? {};
  const meta = await sharp(path.join(destino, `${obra.id}-alta.webp`)).metadata();
  console.log(`  ${meta.width}×${meta.height}`);
  creditos.push(
    `- **${obra.titulo}**, ${obra.autor} (${obra.fecha}). ${obra.museo}.  \n` +
    `  Imagen: [${obra.commons.replace(/^File:/, '')}](${ii.descriptionurl}) — ` +
    `${sinEtiquetas(m.LicenseShortName?.value) || 'dominio público'}.` +
    (m.Credit?.value ? ` Fuente: ${sinEtiquetas(m.Credit.value).slice(0, 160)}.` : ''),
  );
}

await fs.writeFile(
  path.join(raiz, 'CREDITOS.md'),
  `# Créditos\n\n## Obras\n\nTodas las obras son de dominio público. Las reproducciones proceden de Wikimedia Commons.\n\n${creditos.join('\n')}\n\n` +
  `## Tipografías\n\n- Cinzel y Cormorant Garamond, con licencia SIL Open Font License (vía Fontsource).\n`,
);
console.log('CREDITOS.md actualizado');
