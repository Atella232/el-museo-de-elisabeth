// Descarga las obras de data/obras.json desde Wikimedia Commons y prepara
// dos versiones WebP para la web (calidad alta y media). También escribe CREDITOS.md.
// Las esculturas y los relieves son escaneos 3D: los del SMK (STL, en Commons) y los de
// Scan the World (GLB, en Zenodo, campo `fuente3d`). Se guardan en tools/cache/esculturas/
// para que Blender los coloque en el museo. Las obras con `tipo: "foto"` son fotografías
// de esculturas o monumentos sin escaneo libre, y se tratan como un cuadro. Las que tienen
// `fuente3d.generado` son reconstrucciones 3D hechas con IA a partir de una fotografía (la de
// `commons`): el modelo ya está en fuentes/esculturas/ y aquí solo se acredita, con `fotografo`
// cuando el campo de autor de Commons nombra al escultor en vez de a quien hizo la foto.
//
// Uso: npm run obras                   (salta las que ya están descargadas)
//      npm run obras -- --forzar        (las vuelve a descargar todas)
//      npm run obras -- --recodificar   (rehace los WebP desde los originales de tools/cache, sin descargar)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const obras = JSON.parse(await fs.readFile(path.join(raiz, 'data/obras.json'), 'utf8'));
const musica = JSON.parse(await fs.readFile(path.join(raiz, 'data/musica.json'), 'utf8'));
const cache = path.join(raiz, 'tools/cache');
const destino = path.join(raiz, 'web/public/obras');
const forzar = process.argv.includes('--forzar');
const recodificar = process.argv.includes('--recodificar');

const API = 'https://commons.wikimedia.org/w/api.php';
const AGENTE = 'ElMuseoDeElisabeth/0.1 (proyecto personal sin fines comerciales; github.com/Atella232)';
// Anchos estándar de miniatura de Wikimedia; pedir otros puede devolver 429.
const ANCHO_DESCARGA = 3840;
// 3072 px bastan para que el cuadro llene una pantalla 4K al contemplarlo; con 3840 cada sala
// pesaba el doble. Calidad WebP de cada variante.
const VARIANTES = { alta: 3072, media: 2048 };
const CALIDAD = { alta: 84, media: 82 };

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

// La API admite como mucho 50 títulos por consulta.
async function infoCommons(titulos) {
  const porTitulo = {};
  for (let i = 0; i < titulos.length; i += 40) {
    const q = new URLSearchParams({
      action: 'query', format: 'json', prop: 'imageinfo',
      iiprop: 'url|size|extmetadata', iiurlwidth: String(ANCHO_DESCARGA),
      iiextmetadatafilter: 'Artist|LicenseShortName|DateTimeOriginal|Credit',
      titles: titulos.slice(i, i + 40).join('|'),
    });
    const datos = await (await pedir(`${API}?${q}`)).json();
    const normal = Object.fromEntries((datos.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of Object.values(datos.query.pages)) {
      if (!p.imageinfo) throw new Error(`No existe en Commons: ${p.title}`);
      porTitulo[normal[p.title] ?? p.title] = p.imageinfo[0];
    }
    await espera(1000);
  }
  return porTitulo;
}

async function bajar(url, ruta, rotulo) {
  if (!forzar && (await existe(ruta))) {
    console.log(`✓ ${rotulo} (ya descargado)`);
    return;
  }
  console.log(`↓ ${rotulo}`);
  await fs.writeFile(ruta, Buffer.from(await (await pedir(url)).arrayBuffer()));
  await espera(1500);
}

await fs.mkdir(path.join(cache, 'esculturas'), { recursive: true });
await fs.mkdir(destino, { recursive: true });

const info = await infoCommons(obras.flatMap((o) => [o.commons, ...(o.piezas3d ?? [])]));
const creditos = [];
const creditosFotos = [];
const creditosEsculturas = [];
const creditosEscaneos = [];
const creditosIA = [];
const creditosSketchfab = [];
const existe = (ruta) => fs.stat(ruta).then(() => true, () => false);
const enlace = (titulo, ii) => `[${titulo.replace(/^File:/, '')}](${ii.descriptionurl})`;

for (const obra of obras) {
  const ii = info[obra.commons];
  const m = ii.extmetadata ?? {};
  const licencia = sinEtiquetas(m.LicenseShortName?.value) || 'dominio público';
  if (obra.fuente3d?.sketchfab) {
    creditosSketchfab.push(
      `- **${obra.titulo}**, ${obra.autor}. ${obra.museo}.  \n` +
      `  Modelo 3D: [${obra.fuente3d.credito}](${obra.fuente3d.sketchfab}) — ${obra.fuente3d.licencia}.`,
    );
    continue;
  }
  if (obra.fuente3d?.generado) {
    creditosIA.push(
      `- **${obra.titulo}**, ${obra.autor} (${obra.fecha}). ${obra.museo}.  \n` +
      `  Modelo 3D: reconstrucción generada con ${obra.fuente3d.generado} a partir de la fotografía ${enlace(obra.commons, ii)}, ` +
      `de ${obra.fuente3d.fotografo ?? (sinEtiquetas(m.Artist?.value) || 'autor desconocido')} — ${licencia}.`,
    );
    continue;
  }
  const z = obra.fuente3d?.zenodo;
  if (z) {
    const registro = `https://zenodo.org/records/${z}`;
    await bajar(`${registro}/files/${encodeURIComponent(obra.fuente3d.archivo)}?download=1`,
      path.join(cache, 'esculturas', `${obra.id}.glb`), `${obra.titulo} (modelo 3D de Zenodo)`);
    creditosEscaneos.push(
      `- **${obra.titulo}**, ${obra.autor}. ${obra.museo}.  \n` +
      `  Modelo 3D: [${obra.fuente3d.credito}, Zenodo ${z}](${registro}) — ${obra.fuente3d.licencia}.`,
    );
    continue;
  }
  if (obra.tipo === 'escultura') {
    const piezas = [obra.commons, ...(obra.piezas3d ?? [])];
    for (const [i, titulo] of piezas.entries()) {
      const p = info[titulo];
      await bajar(p.url, path.join(cache, 'esculturas', `${obra.id}${i ? `-${i + 1}` : ''}.stl`),
        `${obra.titulo} (modelo 3D, ${(p.size / 1e6).toFixed(0)} MB)`);
    }
    creditosEsculturas.push(
      `- **${obra.titulo}**. ${obra.tecnica}, ${obra.museo}.  \n` +
      `  Modelo 3D: ${piezas.map((t) => enlace(t, info[t])).join(' y ')} — ${licencia}.`,
    );
    continue;
  }
  const ext = path.extname(new URL(ii.thumburl ?? ii.url).pathname) || '.jpg';
  const original = path.join(cache, obra.id + ext);
  const listo = await existe(path.join(destino, `${obra.id}-alta.webp`));

  const local = recodificar && (await existe(original));
  if (forzar || !listo || local) {
    console.log(`${local ? '⟳' : '↓'} ${obra.titulo}`);
    if (!local) {
      const r = await pedir(ii.thumburl ?? ii.url);
      await fs.writeFile(original, Buffer.from(await r.arrayBuffer()));
    }
    // `recorte` [x0, y0, x1, y1], en fracciones: para fotos de un cuadro que incluyen el marco.
    let fuente = sharp(original);
    if (obra.recorte) {
      const { width: w, height: h } = await fuente.metadata();
      const [x0, y0, x1, y1] = obra.recorte;
      fuente = sharp(await fuente.extract({
        left: Math.round(x0 * w), top: Math.round(y0 * h),
        width: Math.round((x1 - x0) * w), height: Math.round((y1 - y0) * h),
      }).toBuffer());
    }
    for (const [nombre, max] of Object.entries(VARIANTES)) {
      await fuente.clone()
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: CALIDAD[nombre] })
        .toFile(path.join(destino, `${obra.id}-${nombre}.webp`));
    }
    if (!local) await espera(1500);
  } else {
    console.log(`✓ ${obra.titulo} (ya descargada)`);
  }

  const meta = await sharp(path.join(destino, `${obra.id}-alta.webp`)).metadata();
  console.log(`  ${meta.width}×${meta.height}`);
  if (obra.tipo === 'foto') {
    creditosFotos.push(
      `- **${obra.titulo}**, ${obra.autor} (${obra.fecha}). ${obra.museo}.  \n` +
      `  Fotografía: ${enlace(obra.commons, ii)}, de ${sinEtiquetas(m.Artist?.value) || 'autor desconocido'} — ${licencia}.`,
    );
    continue;
  }
  creditos.push(
    `- **${obra.titulo}**, ${obra.autor} (${obra.fecha}). ${obra.museo}.  \n` +
    `  Imagen: ${enlace(obra.commons, ii)} — ${licencia}.` +
    (m.Credit?.value ? ` Fuente: ${sinEtiquetas(m.Credit.value).slice(0, 160)}.` : ''),
  );
}

// La música la descarga tools/descargar_musica.mjs; aquí solo se acredita.
const creditosMusica = musica.map((p) =>
  `- **${p.compositor}: ${p.titulo}**. ${p.interprete}.  \n` +
  `  Grabación: [${p.commons.replace(/^File:/, '')}](https://commons.wikimedia.org/wiki/${encodeURIComponent(p.commons.replace(/ /g, '_'))}) — ${p.licencia}.`);

await fs.writeFile(
  path.join(raiz, 'CREDITOS.md'),
  `# Créditos\n\n## Pinturas\n\nTodas las pinturas son de dominio público. Las reproducciones proceden de Wikimedia Commons.\n\n${creditos.join('\n')}\n\n` +
  `## Fotografías\n\nEsculturas y monumentos de los que no hay un escaneo 3D libre. Las obras son de dominio público; cada fotografía tiene la licencia de su autor.\n\n${creditosFotos.join('\n')}\n\n` +
  `## Esculturas: vaciados del SMK\n\nEscaneos 3D de vaciados en yeso de la Colección Real de Vaciados del Statens Museum for Kunst (SMK), publicados en Wikimedia Commons.\n\n${creditosEsculturas.join('\n')}\n\n` +
  `## Esculturas y relieves: Scan the World\n\nEscaneos 3D del proyecto Scan the World (MyMiniFactory), archivados en Zenodo con licencia Creative Commons Reconocimiento-NoComercial-CompartirIgual 4.0. Los modelos que se publican aquí, reducidos y con la luz horneada, se comparten con esa misma licencia.\n\n${creditosEscaneos.join('\n')}\n\n` +
  `## Esculturas: escaneos de Sketchfab\n\nEscaneos 3D publicados en Sketchfab por sus autores; se descargaron a mano (Sketchfab pide una cuenta) y están, reducidos, en fuentes/esculturas/.\n\n${creditosSketchfab.join('\n')}\n\n` +
  `## Esculturas reconstruidas con IA\n\nDe estas no hay un escaneo 3D libre: el modelo se generó con inteligencia artificial a partir de una fotografía del original, así que es una aproximación y no una copia exacta.\n\n${creditosIA.join('\n')}\n\n` +
  `## Música\n\nGrabaciones de Wikimedia Commons, convertidas a AAC. Las obras son de dominio público; cada grabación tiene la licencia indicada.\n\n${creditosMusica.join('\n')}\n\n` +
  `## Dioramas («entrar en el cuadro»)\n\nLas capas salen de las máscaras de figuras (SAM) de los proyectos de animación de cada cuadro. El fondo del *Juicio de Paris*, lo que tapan las figuras, se reconstruyó con el retoque de Magnific (Nano Banana Pro) y está en fuentes/dioramas/.\n\n` +
  `## Cuadros vivos\n\nLos vídeos de web/public/vivos/ se generaron con Kling 2.5 (Ulises y Héctor) y MiniMax Hailuo 3 (el resto), vía Magnific, a partir de las pinturas, con la propia pintura como primer y último fotograma.\n\n` +
  `## Tipografías\n\n- Cinzel y Cormorant Garamond, con licencia SIL Open Font License (vía Fontsource).\n`,
);
console.log('CREDITOS.md actualizado');
