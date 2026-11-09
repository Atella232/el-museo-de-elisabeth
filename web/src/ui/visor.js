// Visor de las fotografías reales de una obra (la sección «Fotografías» de su ficha): la foto en
// grande con su pie y su crédito, y flechas, teclado o deslizar el dedo para pasar de una a otra.
const BASE = import.meta.env.BASE_URL;
const escapar = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class VisorFotos {
  constructor(contenedor) {
    this.fotos = [];
    this.i = 0;
    this.el = document.createElement('section');
    this.el.className = 'visor';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Fotografías de la obra');
    this.el.innerHTML = `
      <button class="visor-cerrar" data-accion="cerrar" aria-label="Cerrar">×</button>
      <button class="visor-flecha visor-anterior" data-accion="anterior" aria-label="Foto anterior">‹</button>
      <figure>
        <img alt="">
        <figcaption>
          <p class="visor-pie"></p>
          <p class="visor-credito"></p>
        </figcaption>
      </figure>
      <button class="visor-flecha visor-siguiente" data-accion="siguiente" aria-label="Foto siguiente">›</button>`;
    contenedor.append(this.el);
    this.img = this.el.querySelector('img');
    this.el.addEventListener('click', (e) => {
      const accion = e.target.closest('[data-accion]')?.dataset.accion;
      if (accion === 'cerrar') this.cerrar();
      else if (accion === 'anterior') this.mostrar(this.i - 1);
      else if (accion === 'siguiente') this.mostrar(this.i + 1);
      else if (e.target === this.el) this.cerrar(); // un clic fuera de la foto
    });
    // Deslizar el dedo sobre la foto para pasar a la siguiente o a la anterior.
    let inicio = null;
    this.img.addEventListener('pointerdown', (e) => { inicio = e.clientX; });
    this.img.addEventListener('pointerup', (e) => {
      if (inicio === null) return;
      const dx = e.clientX - inicio;
      inicio = null;
      if (Math.abs(dx) > 50) this.mostrar(this.i + (dx < 0 ? 1 : -1));
    });
    // En la fase de captura, antes que los atajos del museo: con el visor abierto, Esc lo cierra a
    // él (no a la ficha) y E no devuelve al paseo.
    addEventListener('keydown', (e) => {
      if (!this.abierto) return;
      const accion = { Escape: 'cerrar', ArrowLeft: -1, ArrowRight: 1 }[e.code];
      if (e.code !== 'Tab') e.stopImmediatePropagation();
      if (accion === 'cerrar') this.cerrar();
      else if (accion) this.mostrar(this.i + accion);
    }, true);
  }

  get abierto() {
    return !this.el.hidden;
  }

  abrir(fotos, i = 0) {
    this.fotos = fotos;
    this.el.classList.toggle('una', fotos.length < 2);
    this.el.hidden = false;
    this.mostrar(i);
    requestAnimationFrame(() => this.el.classList.add('visible'));
  }

  mostrar(i) {
    const n = this.fotos.length;
    this.i = (i + n) % n;
    const f = this.fotos[this.i];
    this.img.src = `${BASE}fotos/${f.grande}`;
    this.img.alt = f.pie;
    this.img.width = f.ancho;
    this.img.height = f.alto;
    this.el.querySelector('.visor-pie').textContent = f.pie;
    this.el.querySelector('.visor-credito').innerHTML = `${n > 1 ? `<span>${this.i + 1} / ${n}</span> · ` : ''}`
      + `Foto: ${escapar(f.autor)} · ${escapar(f.licencia)} · <a href="${escapar(f.enlace)}" target="_blank" rel="noopener">ver el original</a>`;
    // La siguiente, ya pedida, para que al pasar aparezca enseguida.
    if (n > 1) new Image().src = `${BASE}fotos/${this.fotos[(this.i + 1) % n].grande}`;
  }

  cerrar() {
    this.el.classList.remove('visible');
    setTimeout(() => { if (!this.el.classList.contains('visible')) this.el.hidden = true; }, 250);
  }
}
