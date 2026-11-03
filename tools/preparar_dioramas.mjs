// Prepara las capas de los dioramas («entrar en el cuadro») a partir de los proyectos de
// animación de cada cuadro, donde ya están las máscaras de las figuras (SAM) y, en la Venus,
// los planos separados con el cielo y el mar reconstruidos.
//
// Para cada cuadro escribe en web/public/dioramas/<id>/:
//   fondo-<calidad>.webp                el plano del fondo, con lo que tapan las figuras rellenado
//   <capa>-<calidad>.webp               cada plano recortado a su caja, con transparencia
//   diorama.json                        las capas de fondo a frente: caja normalizada y profundidad
//   (Venus) mar-media.webp              máscara del mar para el oleaje
//
// Los píxeles transparentes de cada capa se rellenan con el color de su borde: si no, al reducir
// la textura (mipmaps) aparecería un halo oscuro alrededor de cada figura.
//
// El fondo del Juicio, lo que tapan las figuras, se rellena aquí de forma sencilla (borroso) o,
// si existe fuentes/dioramas/juicio-fondo.webp, se toma de ahí: es el cuadro con las figuras
// borradas por un modelo de retoque (Magnific), a partir de la máscara que exporta --mascaras.
//
// Uso: npm run dioramas
//      npm run dioramas -- --mascaras     (además, guarda en tools/cache/dioramas/ el cuadro y la
//                                          máscara de lo que hay que borrar del fondo)
//      ANIMACIONES=/otra/ruta npm run dioramas
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANIMACIONES = process.env.ANIMACIONES ?? path.join(os.homedir(), 'Documents/Proyectos/Animaciones');
const DESTINO = path.join(raiz, 'web/public/dioramas');
const FUENTES = path.join(raiz, 'fuentes/dioramas');
const CACHE = path.join(raiz, 'tools/cache/dioramas');
const exportarMascaras = process.argv.includes('--mascaras');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// Profundidad de cada plano como fracción de la distancia del ojo al cuadro: 0 es el lienzo,
// 0,3 está un 30 % más cerca. En reposo, desde el punto de vista inicial, el apilado se ve
// exactamente como el cuadro; la profundidad aparece al moverse.
const CUADROS = {
  venus: {
    origen: 'nacimiento-de-venus-botticelli/web/assets/painting',
    capas: [
      { nombre: 'tierra', archivo: 'land', profundidad: 0.08 },
      { nombre: 'hora', archivo: 'hora_grupo', profundidad: 0.15 },
      { nombre: 'concha', archivo: 'concha', profundidad: 0.19 },
      { nombre: 'venus', archivo: 'venus', profundidad: 0.23 },
      { nombre: 'vientos', archivo: 'vientos', profundidad: 0.27 },
      // Las espadañas traen un halo semitransparente que, al separarse, se ve como una mancha
      // clara: van pintadas sobre el fondo, en su sitio.
      { nombre: 'espadanas', archivo: 'espadanas', alFondo: true },
    ],
  },
  juicio: {
    origen: 'juicio-de-paris-rubens',
    // Las figuras que se solapan van en el mismo plano: si no, al separarlas quedaría a la
    // vista el hueco de la que está detrás.
    capas: [
      { nombre: 'pavo', mascaras: ['pavo'], profundidad: 0.05 },
      { nombre: 'armadura', mascaras: ['armadura', 'lechuza'], profundidad: 0.12 },
      { nombre: 'putto', mascaras: ['putto'], profundidad: 0.17 },
      { nombre: 'minerva', mascaras: ['minerva'], profundidad: 0.19 },
      { nombre: 'venus', mascaras: ['venus', 'cupido'], profundidad: 0.22 },
      { nombre: 'paris', mascaras: ['paris', 'hermes', 'perro', 'manzana'], profundidad: 0.26 },
      { nombre: 'juno', mascaras: ['juno'], profundidad: 0.3 },
    ],
  },
};

// --- Relleno «push-pull»: promedia hacia una pirámide de resoluciones lo que se conoce
// (peso 1) y vuelve a subir rellenando lo desconocido con el nivel más grueso, interpolado.
function rellenar(rgb, peso, w, h) {
  const niveles = [];
  let R = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) R[i * 3 + c] = rgb[i * 3 + c] * peso[i];
  let P = Float32Array.from(peso);
  let lw = w;
  let lh = h;
  niveles.push({ R, P, w: lw, h: lh });
  while (lw > 1 || lh > 1) {
    const nw = Math.ceil(lw / 2);
    const nh = Math.ceil(lh / 2);
    const R2 = new Float32Array(nw * nh * 3);
    const P2 = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let n = 0;
        const o = y * nw + x;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(lw - 1, x * 2 + dx);
            const sy = Math.min(lh - 1, y * 2 + dy);
            const s = sy * lw + sx;
            P2[o] += P[s];
            for (let c = 0; c < 3; c++) R2[o * 3 + c] += R[s * 3 + c];
            n++;
          }
        }
        P2[o] /= n;
        for (let c = 0; c < 3; c++) R2[o * 3 + c] /= n;
      }
    }
    R = R2;
    P = P2;
    lw = nw;
    lh = nh;
    niveles.push({ R, P, w: lw, h: lh });
  }
  // Subida: color = conocido + (1 - peso) × color del nivel superior (bilineal).
  let arriba = null;
  for (let k = niveles.length - 1; k >= 0; k--) {
    const { R: Rk, P: Pk, w: kw, h: kh } = niveles[k];
    const C = new Float32Array(kw * kh * 3);
    for (let y = 0; y < kh; y++) {
      for (let x = 0; x < kw; x++) {
        const o = y * kw + x;
        const p = Math.min(1, Pk[o]);
        let sup = [0, 0, 0];
        if (arriba) {
          const fx = Math.min(arriba.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
          const fy = Math.min(arriba.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const x1 = Math.min(arriba.w - 1, x0 + 1);
          const y1 = Math.min(arriba.h - 1, y0 + 1);
          const tx = fx - x0;
          const ty = fy - y0;
          sup = [0, 1, 2].map((c) => {
            const a = arriba.C[(y0 * arriba.w + x0) * 3 + c] * (1 - tx) + arriba.C[(y0 * arriba.w + x1) * 3 + c] * tx;
            const b = arriba.C[(y1 * arriba.w + x0) * 3 + c] * (1 - tx) + arriba.C[(y1 * arriba.w + x1) * 3 + c] * tx;
            return a * (1 - ty) + b * ty;
          });
        }
        for (let c = 0; c < 3; c++) {
          const conocido = Pk[o] > 1e-6 ? Rk[o * 3 + c] / Pk[o] : 0;
          C[o * 3 + c] = p * conocido + (1 - p) * sup[c];
        }
      }
    }
    arriba = { C, w: kw, h: kh };
  }
  return arriba.C;
}

// Máximo en una ventana cuadrada (dilatación) separable.
function dilatar(m, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = Math.max(0, x - r); d <= Math.min(w - 1, x + r) && !v; d++) v = m[y * w + d];
      tmp[y * w + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0;
      for (let d = Math.max(0, y - r); d <= Math.min(h - 1, y + r) && !v; d++) v = tmp[d * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

// Rellena los agujeros interiores de una máscara (lo transparente que no toca el borde): las
// máscaras SAM a veces dejan huecos dentro de una figura y por ellos se vería el fondo.
function taparAgujeros(alfa, w, h) {
  const fuera = new Uint8Array(w * h);
  const pila = new Int32Array(w * h);
  let n = 0;
  const empujar = (i) => {
    if (!fuera[i] && alfa[i] < 128) {
      fuera[i] = 1;
      pila[n++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    empujar(x);
    empujar((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    empujar(y * w);
    empujar(y * w + w - 1);
  }
  while (n) {
    const i = pila[--n];
    const x = i % w;
    if (x > 0) empujar(i - 1);
    if (x < w - 1) empujar(i + 1);
    if (i >= w) empujar(i - w);
    if (i < w * (h - 1)) empujar(i + w);
  }
  for (let i = 0; i < w * h; i++) if (alfa[i] < 128 && !fuera[i]) alfa[i] = 255;
}

async function leerRGB(archivo, w, h) {
  const { data } = await sharp(archivo).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from(data);
}

async function leerMascara(archivo, w, h, suavizado = 0) {
  let img = sharp(archivo).resize(w, h, { fit: 'fill' }).greyscale();
  if (suavizado) img = img.blur(suavizado);
  return (await img.raw().toBuffer({ resolveWithObject: true })).data;
}

// Guarda una imagen RGB (+ alfa opcional) en dos calidades. Devuelve los nombres de archivo.
async function guardar(dir, nombre, rgb, alfa, w, h) {
  const canales = alfa ? 4 : 3;
  const buf = Buffer.alloc(w * h * canales);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) buf[i * canales + c] = Math.max(0, Math.min(255, Math.round(rgb[i * 3 + c])));
    if (alfa) buf[i * canales + 3] = alfa[i];
  }
  const archivos = {};
  const tamaños = [];
  for (const [calidad, escala] of [['alta', 1], ['media', 0.5]]) {
    const archivo = `${nombre}-${calidad}.webp`;
    await sharp(buf, { raw: { width: w, height: h, channels: canales } })
      .resize(Math.max(1, Math.round(w * escala)))
      .webp({ quality: 86, alphaQuality: 100, effort: 5 })
      .toFile(path.join(dir, archivo));
    archivos[calidad] = archivo;
    tamaños.push(kb((await fs.stat(path.join(dir, archivo))).size));
  }
  console.log(`  ${nombre} ${w}×${h} · ${tamaños.join(' · ')}`);
  return archivos;
}

// Recorta a la caja del alfa (con margen), rellena bajo la transparencia y guarda.
async function guardarCapa(dir, nombre, rgbTotal, alfaTotal, W, H) {
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alfaTotal[y * W + x] > 8) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  const m = 12;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(W - 1, x1 + m);
  y1 = Math.min(H - 1, y1 + m);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const rgb = new Float32Array(w * h * 3);
  const alfa = new Uint8Array(w * h);
  const peso = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y + y0) * W + (x + x0);
      const o = y * w + x;
      alfa[o] = alfaTotal[s];
      peso[o] = alfaTotal[s] > 200 ? 1 : 0;
      for (let c = 0; c < 3; c++) rgb[o * 3 + c] = rgbTotal[s * 3 + c];
    }
  }
  const sangrado = rellenar(rgb, peso, w, h);
  for (let o = 0; o < w * h; o++) if (!peso[o]) for (let c = 0; c < 3; c++) rgb[o * 3 + c] = sangrado[o * 3 + c];
  const archivos = await guardar(dir, nombre, rgb, alfa, w, h);
  return { archivos, caja: [x0 / W, y0 / H, w / W, h / H].map((v) => Number(v.toFixed(5))) };
}

async function venus(dir, cfg) {
  const O = path.join(ANIMACIONES, cfg.origen);
  const cajas = JSON.parse(await fs.readFile(path.join(O, 'layers.json'), 'utf8')).layers;
  const { width: W, height: H } = await sharp(path.join(O, 'real/plate.jpg')).metadata();
  const manifiesto = { ancho: W, alto: H, capas: [] };
  const fondo = await leerRGB(path.join(O, 'real/plate.jpg'), W, H);
  const capas = [];
  for (const capa of cfg.capas) {
    const [cx, cy, cw, ch] = cajas[capa.archivo];
    const w = Math.round(cw * W);
    const h = Math.round(ch * H);
    const { data } = await sharp(path.join(O, `real/${capa.archivo}.png`)).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Se pega en un lienzo completo para reutilizar el recorte común.
    const rgbTotal = new Float32Array(W * H * 3);
    const alfaTotal = new Uint8Array(W * H);
    const ox = Math.round(cx * W);
    const oy = Math.round(cy * H);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * w + x;
        const o = (y + oy) * W + (x + ox);
        if (o >= W * H) continue;
        alfaTotal[o] = data[s * 4 + 3];
        for (let c = 0; c < 3; c++) rgbTotal[o * 3 + c] = data[s * 4 + c];
      }
    }
    if (capa.alFondo) {
      for (let i = 0; i < W * H; i++) {
        const a = alfaTotal[i] / 255;
        if (a > 0) for (let c = 0; c < 3; c++) fondo[i * 3 + c] = fondo[i * 3 + c] * (1 - a) + rgbTotal[i * 3 + c] * a;
      }
      continue;
    }
    capas.push({ capa, rgbTotal, alfaTotal });
  }
  manifiesto.capas.push({ nombre: 'fondo', archivos: await guardar(dir, 'fondo', fondo, null, W, H), caja: [0, 0, 1, 1], profundidad: 0 });
  for (const { capa, rgbTotal, alfaTotal } of capas) {
    const { archivos, caja } = await guardarCapa(dir, capa.nombre, rgbTotal, alfaTotal, W, H);
    manifiesto.capas.push({ nombre: capa.nombre, archivos, caja, profundidad: capa.profundidad });
  }
  // Máscara del mar (para el oleaje), a resolución modesta.
  await sharp(path.join(O, 'masks/mar.png')).ensureAlpha().extractChannel(3).resize(1024).webp({ quality: 80 }).toFile(path.join(dir, 'mar-media.webp'));
  manifiesto.mar = 'mar-media.webp';
  return manifiesto;
}

async function juicio(dir, cfg) {
  const O = path.join(ANIMACIONES, cfg.origen);
  const pintura = path.join(O, 'web/assets/painting/real.jpg');
  const { width: W, height: H } = await sharp(pintura).metadata();
  const rgb = await leerRGB(pintura, W, H);
  const manifiesto = { ancho: W, alto: H, capas: [] };
  const union = new Uint8Array(W * H);
  const capas = [];
  for (const capa of cfg.capas) {
    const alfa = new Uint8Array(W * H);
    for (const m of capa.mascaras) {
      const d = await leerMascara(path.join(O, `assets/painting/masks/${m}.png`), W, H, 1.2);
      for (let i = 0; i < W * H; i++) {
        alfa[i] = Math.max(alfa[i], d[i]);
        if (d[i] > 127) union[i] = 1;
      }
    }
    taparAgujeros(alfa, W, H);
    capas.push({ capa, alfa });
  }
  // Fondo: se rellena todo lo que tapan las figuras (y un margen, para que el relleno llegue
  // por debajo de los bordes suavizados).
  const tapado = dilatar(union, W, H, 15);
  if (exportarMascaras) {
    await fs.mkdir(CACHE, { recursive: true });
    await sharp(pintura).png().toFile(path.join(CACHE, 'juicio-cuadro.png'));
    await sharp(Buffer.from(tapado.map((v) => (v ? 255 : 0))), { raw: { width: W, height: H, channels: 1 } })
      .png().toFile(path.join(CACHE, 'juicio-mascara.png'));
    console.log(`  máscara del fondo en ${path.relative(raiz, CACHE)}/`);
  }
  let relleno;
  const reconstruido = path.join(FUENTES, 'juicio-fondo.webp');
  if (await fs.stat(reconstruido).then(() => true, () => false)) {
    relleno = await leerRGB(reconstruido, W, H);
    console.log('  fondo reconstruido: fuentes/dioramas/juicio-fondo.webp');
  } else {
    const peso = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) peso[i] = tapado[i] ? 0 : 1;
    relleno = rellenar(rgb, peso, W, H);
  }
  // Fuera de lo tapado se queda el cuadro original; el borde se funde unos píxeles.
  const mezcla = await sharp(Buffer.from(tapado.map((v) => (v ? 255 : 0))), { raw: { width: W, height: H, channels: 1 } })
    .blur(3).extractChannel(0).raw().toBuffer();
  const fondo = Float32Array.from(rgb);
  for (let i = 0; i < W * H; i++) {
    const k = mezcla[i] / 255;
    if (k > 0) for (let c = 0; c < 3; c++) fondo[i * 3 + c] = rgb[i * 3 + c] * (1 - k) + relleno[i * 3 + c] * k;
  }
  manifiesto.capas.push({ nombre: 'fondo', archivos: await guardar(dir, 'fondo', fondo, null, W, H), caja: [0, 0, 1, 1], profundidad: 0 });
  for (const { capa, alfa } of capas) {
    const { archivos, caja } = await guardarCapa(dir, capa.nombre, rgb, alfa, W, H);
    manifiesto.capas.push({ nombre: capa.nombre, archivos, caja, profundidad: capa.profundidad });
  }
  return manifiesto;
}

const PREPARAR = { venus, juicio };
for (const [id, cfg] of Object.entries(CUADROS)) {
  const t0 = Date.now();
  console.log(`▸ ${id}`);
  const dir = path.join(DESTINO, id);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const manifiesto = await PREPARAR[id](dir, cfg);
  await fs.writeFile(path.join(dir, 'diorama.json'), JSON.stringify(manifiesto, null, 1) + '\n');
  console.log(`✓ ${id}: ${manifiesto.capas.length} planos en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
