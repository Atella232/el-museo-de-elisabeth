// Panel de sala: Blender deja la placa junto a la entrada (malla "panel", UV de 0 a 1) y aquí
// se dibujan el número, el título, la pregunta y el texto de Elisabeth (data/salas.json). En el
// vestíbulo, la presentación del recorrido y la lista de las salas.
import * as THREE from 'three';
import { ROMANOS } from '../ui/transicion.js';

const ANCHO = 1300;
const ALTO = 1800;

export async function pintarPanel(modelo, sala, datosSalas, renderer) {
  const malla = modelo.getObjectByName('panel');
  if (!malla) return;
  await Promise.all([
    document.fonts.load('600 60px "Cormorant Garamond"'),
    document.fonts.load('italic 500 40px "Cormorant Garamond"'),
    document.fonts.load('400 30px "Cormorant Garamond"'),
    document.fonts.load('600 30px "Cinzel"'),
  ]);
  const lienzo = document.createElement('canvas');
  lienzo.width = ANCHO;
  lienzo.height = ALTO;
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#efe9dc';
  ctx.fillRect(0, 0, ANCHO, ALTO);
  const m = 110;
  const w = ANCHO - 2 * m;
  let y = 190;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#9a7a3c';
  ctx.font = '600 34px "Cinzel"';
  ctx.letterSpacing = '8px';
  ctx.fillText(sala.numero ? `SALA ${ROMANOS[sala.numero]}` : 'EL MUSEO DE ELISABETH', m, y);
  ctx.letterSpacing = '0px';
  y += 100;
  ctx.fillStyle = '#2b2521';
  ctx.font = '600 84px "Cormorant Garamond"';
  for (const l of lineas(ctx, sala.numero ? sala.titulo : 'El recorrido', w)) {
    ctx.fillText(l, m, y);
    y += 92;
  }
  y += 10;
  ctx.fillStyle = '#9a7a3c';
  ctx.fillRect(m, y, 160, 3);
  y += 80;
  if (sala.pregunta) {
    ctx.fillStyle = '#3a312a';
    ctx.font = 'italic 500 50px "Cormorant Garamond"';
    for (const l of lineas(ctx, sala.pregunta, w)) {
      ctx.fillText(l, m, y);
      y += 60;
    }
    y += 40;
  }
  ctx.fillStyle = '#3a312a';
  ctx.font = '400 37px "Cormorant Garamond"';
  const parrafos = sala.numero ? sala.texto : datosSalas.recorrido;
  for (const p of parrafos) {
    for (const l of lineas(ctx, p, w)) {
      ctx.fillText(l, m, y);
      y += 50;
    }
    y += 26;
  }
  if (!sala.numero) {
    y += 20;
    ctx.font = '600 30px "Cinzel"';
    for (const s of datosSalas.salas.filter((x) => x.numero)) {
      ctx.fillStyle = '#9a7a3c';
      ctx.fillText(ROMANOS[s.numero], m, y);
      ctx.fillStyle = '#2b2521';
      ctx.font = '600 40px "Cormorant Garamond"';
      ctx.fillText(s.titulo, m + 110, y, w - 110);
      ctx.font = '600 30px "Cinzel"';
      y += 62;
    }
  }
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.flipY = false;
  textura.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  malla.traverse((obj) => {
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
