// Ficha de una obra: datos, el mito y el cuadro, y los botones de vídeo, entrar y volver.
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

  mostrar(obra) {
    const escultura = obra.tipo === 'escultura';
    const medidas = !obra.medidas ? null
      : obra.medidas.ancho ? `${fmt(obra.medidas.alto)} × ${fmt(obra.medidas.ancho)} cm`
        : `${fmt(obra.medidas.alto)} cm de alto`;
    const enlace = `https://commons.wikimedia.org/wiki/${encodeURIComponent(obra.commons.replace(/ /g, '_'))}`;
    this.el.innerHTML = `
      <button class="ficha-cerrar" data-accion="volver" aria-label="Volver al pasillo">×</button>
      <p class="ficha-autor">${escapar(obra.autor)}</p>
      <h2>${escapar(obra.titulo)}</h2>
      <dl class="ficha-datos">
        <div><dt>Fecha</dt><dd>${escapar(obra.fecha)}</dd></div>
        <div><dt>Técnica</dt><dd>${escapar(obra.tecnica)}</dd></div>
        ${medidas ? `<div><dt>Medidas</dt><dd>${medidas}</dd></div>` : ''}
        <div><dt>Dónde está</dt><dd>${escapar(obra.museo)}</dd></div>
      </dl>
      <h3>El mito</h3>
      <p>${escapar(obra.mito)}</p>
      <h3>${escultura ? 'La escultura' : 'La obra'}</h3>
      <p>${escapar(obra.texto)}</p>
      <div class="ficha-botones">
        ${obra.youtubeId ? '<button class="boton boton-oro" data-accion="video">▶ Ver vídeo</button>' : ''}
        ${escultura ? '' : obra.diorama
    ? '<button class="boton boton-oro" data-accion="entrar">Entrar en el cuadro</button>'
    : '<button class="boton" disabled title="Muy pronto podrás entrar en el cuadro">Entrar en el cuadro <small>Próximamente</small></button>'}
        <button class="boton boton-sutil" data-accion="volver">Volver <kbd>E</kbd></button>
      </div>
      <p class="ficha-credito">${escultura ? 'Modelo 3D' : 'Imagen'}: <a href="${enlace}" target="_blank" rel="noopener">Wikimedia Commons</a> · dominio público</p>`;
    this.el.hidden = false;
    this.el.scrollTop = 0;
    requestAnimationFrame(() => this.el.classList.add('visible'));
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
