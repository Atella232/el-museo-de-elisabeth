// Lo que se ve dentro del cuadro: el título, cómo moverse y el botón para salir.
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
      if (e.target.closest('[data-accion="salir"]')) this.dispatchEvent(new Event('salir'));
    });
  }

  mostrar(obra) {
    const ayuda = this.movil
      ? 'Arrastra para asomarte'
      : 'Mueve el ratón para asomarte · rueda o <kbd>W</kbd> <kbd>S</kbd> para adentrarte';
    this.el.innerHTML = `
      <p class="cuadro-titulo"><span>Dentro de</span>${escapar(obra.titulo)}</p>
      <button class="boton cuadro-salir" data-accion="salir">Salir del cuadro${this.movil ? '' : ' <kbd>Esc</kbd>'}</button>
      <p class="cuadro-ayuda">${ayuda}</p>`;
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('visible'));
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.el.querySelector('.cuadro-ayuda')?.classList.add('oculta'), 7000);
  }

  ocultar() {
    this.el.classList.remove('visible');
    setTimeout(() => { if (!this.el.classList.contains('visible')) this.el.hidden = true; }, 600);
  }
}
