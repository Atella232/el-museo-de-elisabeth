// Cartelas de pared: Blender deja las placas con sus UV apuntando a un atlas y aquí se
// dibuja el texto de cada obra (desde data/obras.json), así se edita sin volver a hornear.
import * as THREE from 'three';

const ANCHO_CELDA = 512;

export async function pintarCartelas(modelo, escena, obras, renderer) {
  const { columnas, filas, aspecto } = escena.cartelasAtlas;
  const altoCelda = Math.round(ANCHO_CELDA / aspecto);
  const lienzo = document.createElement('canvas');
  lienzo.width = ANCHO_CELDA * columnas;
  lienzo.height = altoCelda * filas;
  const ctx = lienzo.getContext('2d');
  await Promise.all([
    document.fonts.load('600 40px "Cormorant Garamond"'),
    document.fonts.load('italic 400 30px "Cormorant Garamond"'),
    document.fonts.load('600 20px "Cinzel"'),
  ]);
  ctx.fillStyle = '#ece6d9';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  for (const [id, indice] of Object.entries(escena.cartelas)) {
    const o = obras[id];
    const x = (indice % columnas) * ANCHO_CELDA;
    const y = Math.floor(indice / columnas) * altoCelda;
    const m = 34;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#2b2521';
    ctx.font = '600 22px "Cinzel"';
    ctx.fillText(o.autor.toUpperCase(), m, m + 22, ANCHO_CELDA - 2 * m);
    ctx.font = '600 40px "Cormorant Garamond"';
    lineas(ctx, o.titulo, ANCHO_CELDA - 2 * m).slice(0, 2).forEach((l, i) => ctx.fillText(l, m, m + 74 + i * 42));
    ctx.font = 'italic 400 27px "Cormorant Garamond"';
    ctx.fillStyle = '#5a4f45';
    ctx.fillText(`${o.fecha} · ${o.tecnica.split(',')[0]}`, m, altoCelda - m - 34, ANCHO_CELDA - 2 * m);
    ctx.fillText(o.museo, m, altoCelda - m, ANCHO_CELDA - 2 * m);
    ctx.restore();
  }
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.flipY = false;
  textura.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  modelo.getObjectByName('cartelas')?.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.material = obj.material.clone();
    obj.material.map = textura;
    obj.material.color.set(0xffffff);
  });
}

function lineas(ctx, texto, ancho) {
  const palabras = texto.split(' ');
  const res = [];
  let actual = '';
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (ctx.measureText(prueba).width > ancho && actual) {
      res.push(actual);
      actual = p;
    } else {
      actual = prueba;
    }
  }
  if (actual) res.push(actual);
  return res;
}
