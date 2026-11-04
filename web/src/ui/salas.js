// Índice de salas: para ir directamente a cualquiera. Las que aún no están montadas salen
// apagadas.
import { ROMANOS } from './transicion.js';

const escapar = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class IndiceSalas extends EventTarget {
  constructor(contenedor, salas) {
    super();
    this.salas = salas;
    this.el = document.createElement('section');
    this.el.className = 'indice';
    this.el.hidden = true;
    contenedor.append(this.el);
    this.el.addEventListener('click', (e) => {
      const boton = e.target.closest('[data-sala]');
      if (boton && !boton.disabled) this.dispatchEvent(new CustomEvent('ir', { detail: boton.dataset.sala }));
      else if (e.target.closest('[data-accion="cerrar"]') || e.target === this.el) this.dispatchEvent(new CustomEvent('cerrar'));
    });
  }

  get abierto() {
    return !this.el.hidden;
  }

  mostrar(actual, disponibles) {
    this.el.innerHTML = `
      <div class="indice-caja">
        <button class="ficha-cerrar" data-accion="cerrar" aria-label="Cerrar">×</button>
        <p class="ficha-autor">El Museo de Elisabeth</p>
        <h2>Las salas</h2>
        <ol>
          ${this.salas.map((s) => `
            <li><button data-sala="${s.id}" ${disponibles.has(s.id) ? '' : 'disabled'} ${s.id === actual ? 'aria-current="true"' : ''}>
              <span class="indice-numero">${s.numero ? ROMANOS[s.numero] : '·'}</span>
              <span class="indice-titulo">${escapar(s.titulo)}${disponibles.has(s.id) ? '' : ' <small>En montaje</small>'}</span>
            </button></li>`).join('')}
        </ol>
      </div>`;
    this.el.hidden = false;
  }

  ocultar() {
    this.el.hidden = true;
  }
}
