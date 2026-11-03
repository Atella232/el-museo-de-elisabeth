// Lo que se ve dentro del cuadro: el título, cómo moverse, el botón para salir y, si el cuadro
// la tiene, la visita guiada (botón para empezarla, subtítulos y mandos).
const escapar = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class UiCuadro extends EventTarget {
  constructor(contenedor, { movil }) {
    super();
    this.movil = movil;
    this.el = document.createElement('div');
    this.el.className = 'cuadro-ui';
    this.el.hidden = true;
    contenedor.append(this.el);
    this.el.addEventListener('click', (e) => {
      const accion = e.target.closest('[data-accion]')?.dataset.accion;
      if (accion) this.dispatchEvent(new Event(accion));
    });
  }

  mostrar(obra, { visita = false } = {}) {
    const ayuda = this.movil
      ? 'Arrastra para asomarte'
      : 'Mueve el ratón para asomarte · rueda o <kbd>W</kbd> <kbd>S</kbd> para adentrarte';
    const teclas = (t) => (this.movil ? '' : ` <kbd>${t}</kbd>`);
    this.el.innerHTML = `
      <p class="cuadro-titulo"><span>Dentro de</span>${escapar(obra.titulo)}</p>
      <div class="cuadro-botones">
        ${visita ? '<button class="boton boton-oro" data-accion="visita">▶ Visita guiada</button>' : ''}
        <button class="boton cuadro-salir" data-accion="salir">Salir del cuadro${teclas('Esc')}</button>
      </div>
      <p class="cuadro-ayuda">${ayuda}</p>
      <div class="cuadro-visita" hidden>
        <p class="cuadro-subtitulo" aria-live="polite"></p>
        <div class="cuadro-mandos">
          <button class="boton-icono" data-accion="anterior" aria-label="Parada anterior">‹</button>
          <button class="boton-icono" data-accion="pausa" aria-label="Pausa">❚❚</button>
          <button class="boton-icono" data-accion="siguiente" aria-label="Parada siguiente">›</button>
          <span class="cuadro-contador"></span>
          <button class="boton boton-sutil" data-accion="terminar">Terminar visita</button>
        </div>
        ${this.movil ? '' : '<p class="cuadro-teclas"><kbd>←</kbd> <kbd>→</kbd> para cambiar de parada · <kbd>espacio</kbd> para pausar</p>'}
      </div>`;
    this.visitaEl = this.el.querySelector('.cuadro-visita');
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('visible'));
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.el.querySelector('.cuadro-ayuda')?.classList.add('oculta'), 7000);
  }

  // Durante la visita se esconden la ayuda y el botón de empezarla, y aparecen los subtítulos.
  visita(activa) {
    this.el.classList.toggle('en-visita', activa);
    this.visitaEl.hidden = !activa;
  }

  parada({ indice, total, texto }) {
    this.el.querySelector('.cuadro-subtitulo').textContent = texto;
    this.el.querySelector('.cuadro-contador').textContent = `${indice + 1} / ${total}`;
    this.pausa(false);
  }

  pausa(pausada) {
    const b = this.el.querySelector('[data-accion="pausa"]');
    b.textContent = pausada ? '▶' : '❚❚';
    b.setAttribute('aria-label', pausada ? 'Seguir' : 'Pausa');
  }

  ocultar() {
    this.el.classList.remove('visible');
    setTimeout(() => { if (!this.el.classList.contains('visible')) this.el.hidden = true; }, 600);
  }
}
