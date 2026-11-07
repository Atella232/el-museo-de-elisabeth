// Ficha de una obra: datos, el mito y el cuadro, y los botones de vídeo, entrar y volver. También
// muestra entero el texto del panel de cada sala.
import { ROMANOS } from './transicion.js';

const escapar = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Ficha extends EventTarget {
  constructor(contenedor) {
    super();
    this.el = document.createElement('aside');
    this.el.className = 'ficha';
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    contenedor.append(this.el);
    this.el.addEventListener('click', (e) => {
      const accion = e.target.closest('[data-accion]')?.dataset.accion;
      if (accion) this.dispatchEvent(new CustomEvent(accion));
    });
  }

  // `pista`: una línea de ayuda bajo el título (en las esculturas exentas, cómo rodearlas).
  mostrar(obra, { pista = null } = {}) {
    const volumen = obra.tipo === 'escultura' || obra.tipo === 'relieve';
    const medidas = !obra.medidas ? null
      : obra.medidas.ancho ? `${fmt(obra.medidas.alto)} × ${fmt(obra.medidas.ancho)} cm`
        : `${fmt(obra.medidas.alto)} cm de alto`;
    const enlace = `https://commons.wikimedia.org/wiki/${encodeURIComponent(obra.commons.replace(/ /g, '_'))}`;
    const z = obra.fuente3d?.zenodo;
    const ia = obra.fuente3d?.generado;
    const credito = z
      ? `Modelo 3D: <a href="https://zenodo.org/records/${z}" target="_blank" rel="noopener">${escapar(obra.fuente3d.credito)}</a> · ${escapar(obra.fuente3d.licencia)}`
      : ia
        ? `Modelo 3D: ${escapar(obra.fuente3d.credito)} (<a href="${enlace}" target="_blank" rel="noopener">Wikimedia Commons</a>, ${escapar(obra.fuente3d.licencia)}), generado con ${escapar(ia)}`
      : obra.tipo === 'foto'
        ? `Fotografía: <a href="${enlace}" target="_blank" rel="noopener">Wikimedia Commons</a> · licencia libre (ver créditos)`
        : `${volumen ? 'Modelo 3D' : 'Imagen'}: <a href="${enlace}" target="_blank" rel="noopener">Wikimedia Commons</a> · ${escapar(obra.licencia ?? 'dominio público')}`;
    const reproduccion = obra.tipo === 'foto' ? 'Reproducción fotográfica'
      : obra.reproduccion === 'vaciado' ? 'Vaciado en yeso'
        : ia ? 'Reconstrucción 3D con IA' : null;
    this.el.innerHTML = `
      <button class="ficha-cerrar" data-accion="volver" aria-label="Volver">×</button>
      <p class="ficha-autor">${escapar(obra.autor)}</p>
      <h2>${escapar(obra.titulo)}</h2>
      ${pista ? `<p class="ficha-pista">${escapar(pista)}</p>` : ''}
      <dl class="ficha-datos">
        <div><dt>Fecha</dt><dd>${escapar(obra.fecha)}</dd></div>
        <div><dt>Técnica</dt><dd>${escapar(obra.tecnica)}</dd></div>
        ${medidas ? `<div><dt>Medidas</dt><dd>${medidas}</dd></div>` : ''}
        <div><dt>Dónde está</dt><dd>${escapar(obra.museo)}</dd></div>
        ${reproduccion ? `<div><dt>Aquí</dt><dd>${reproduccion}</dd></div>` : ''}
      </dl>
      <h3>${escapar(obra.encabezado ?? 'El mito')}</h3>
      <p>${escapar(obra.mito)}</p>
      <h3>${obra.tipo === 'escultura' ? 'La escultura' : 'La obra'}</h3>
      <p>${escapar(obra.texto)}</p>
      <div class="ficha-botones">
        ${obra.youtubeId ? '<button class="boton boton-oro" data-accion="video">▶ Ver vídeo</button>' : ''}
        ${obra.tipo && obra.tipo !== 'cuadro' ? '' : obra.diorama
    ? '<button class="boton boton-oro" data-accion="entrar">Entrar en el cuadro</button>'
    : '<button class="boton" disabled title="Muy pronto podrás entrar en el cuadro">Entrar en el cuadro <small>Próximamente</small></button>'}
        <button class="boton boton-sutil" data-accion="volver">Volver <kbd>E</kbd></button>
      </div>
      <p class="ficha-credito">${credito}</p>`;
    this.#abrir();
  }

  // El panel de la entrada de cada sala, entero; en el vestíbulo, la presentación del recorrido.
  mostrarSala(sala, datosSalas) {
    const parrafos = sala.numero ? sala.texto : datosSalas.recorrido;
    this.el.innerHTML = `
      <button class="ficha-cerrar" data-accion="volver" aria-label="Volver">×</button>
      <p class="ficha-autor">${sala.numero ? `Sala ${ROMANOS[sala.numero]}` : 'El Museo de Elisabeth'}</p>
      <h2>${escapar(sala.numero ? sala.titulo : 'El recorrido')}</h2>
      ${sala.pregunta ? `<p class="ficha-pregunta">${escapar(sala.pregunta)}</p>` : ''}
      ${parrafos.map((p) => `<p class="ficha-parrafo">${escapar(p)}</p>`).join('')}
      ${sala.numero ? '' : `<ol class="ficha-salas">${datosSalas.salas.filter((s) => s.numero).map((s) => `<li><span>${ROMANOS[s.numero]}</span> ${escapar(s.titulo)}</li>`).join('')}</ol>`}
      <div class="ficha-botones">
        <button class="boton boton-sutil" data-accion="volver">Volver <kbd>E</kbd></button>
      </div>`;
    this.#abrir();
  }

  #abrir() {
    this.el.hidden = false;
    this.el.scrollTop = 0;
    requestAnimationFrame(() => this.el.classList.add('visible'));
  }

  // Lado ('derecha' o 'abajo') y tamaño (fracción de la pantalla) del hueco que le deja el
  // encuadre del cuadro.
  colocar({ lado, hueco }) {
    this.el.classList.toggle('abajo', lado === 'abajo');
    this.el.style.height = lado === 'abajo' ? `${Math.round(hueco * innerHeight)}px` : '';
    this.el.style.width = lado === 'derecha' ? `${Math.round(hueco * innerWidth)}px` : '';
  }

  cargando(activo) {
    const b = this.el.querySelector('[data-accion="entrar"]');
    if (!b) return;
    b.disabled = activo;
    b.textContent = activo ? 'Abriendo el cuadro…' : 'Entrar en el cuadro';
  }

  ocultar() {
    this.el.classList.remove('visible');
    setTimeout(() => { if (!this.el.classList.contains('visible')) this.el.hidden = true; }, 400);
  }
}

const fmt = (n) => String(n).replace('.', ',');
