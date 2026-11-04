// Cambio de sala: la pantalla se funde a negro y, mientras se carga la sala nueva, aparece el
// texto de Elisabeth «El paso a la siguiente sala» y el título y la pregunta de la sala a la que
// se entra. Se queda lo justo para leerlo (o hasta que el visitante toca o pulsa una tecla).
const escapar = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
export const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export class Transicion {
  constructor(contenedor, { movil }) {
    this.movil = movil;
    this.el = document.createElement('section');
    this.el.className = 'transicion';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
    contenedor.append(this.el);
  }

  // Funde a negro con el texto. `paso`: lo que se lee al dejar una sala hacia la siguiente;
  // `final`: la pregunta final del recorrido.
  async cubrir({ destino, paso = null, final = null }) {
    const numero = destino.numero ? `Sala ${ROMANOS[destino.numero]}` : '';
    this.el.innerHTML = `
      <div class="transicion-caja">
        ${paso ? `<p class="transicion-etiqueta">El paso a la siguiente sala</p><p class="transicion-paso">${escapar(paso)}</p>` : ''}
        ${final ? `<p class="transicion-paso">${escapar(final)}</p>` : ''}
        ${numero ? `<p class="transicion-etiqueta">${numero}</p>` : ''}
        <h2>${escapar(destino.titulo)}</h2>
        ${destino.pregunta ? `<p class="transicion-pregunta">${escapar(destino.pregunta)}</p>` : ''}
        <div class="portada-carga"><div class="portada-barra"></div></div>
        <p class="transicion-seguir" hidden>${this.movil ? 'Toca para entrar' : 'Pulsa una tecla o haz clic para entrar'}</p>
      </div>`;
    this.barra = this.el.querySelector('.portada-barra');
    const palabras = `${paso ?? ''} ${final ?? ''} ${destino.titulo} ${destino.pregunta ?? ''}`.split(/\s+/).length;
    this.lectura = Math.min(14, Math.max(3.5, palabras * 0.32)) * 1000;
    this.el.hidden = false;
    await espera(20);
    this.el.classList.add('visible');
    await espera(800);
    this.desde = performance.now();
  }

  progreso(f) {
    if (this.barra) this.barra.style.width = `${Math.round(f * 100)}%`;
  }

  // Cuando la sala ya está cargada: espera el tiempo de lectura (o un gesto) y se desvanece.
  async descubrir() {
    this.progreso(1);
    this.el.querySelector('.portada-carga')?.setAttribute('hidden', '');
    this.el.querySelector('.transicion-seguir')?.removeAttribute('hidden');
    const restante = this.lectura - (performance.now() - this.desde);
    if (restante > 0) {
      await new Promise((resolver) => {
        // En la ventana y no en el texto: con el ratón capturado, los clics no llegan a la página.
        const fin = () => {
          clearTimeout(t);
          removeEventListener('keydown', fin);
          removeEventListener('pointerdown', fin);
          resolver();
        };
        const t = setTimeout(fin, restante);
        addEventListener('keydown', fin);
        addEventListener('pointerdown', fin);
      });
    }
    this.el.classList.remove('visible');
    await espera(900);
    this.el.hidden = true;
  }
}
