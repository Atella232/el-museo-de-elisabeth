// Pantalla de entrada: título, barra de carga y botón para entrar (ese clic también
// activa el sonido y, en ordenador, el control del ratón).
export class Portada {
  constructor(contenedor, { movil }) {
    this.el = document.createElement('section');
    this.el.className = 'portada';
    this.el.innerHTML = `
      <div class="portada-caja">
        <p class="portada-ante">Después del cierre</p>
        <h1>El Museo<br><span>de Elisabeth</span></h1>
        <div class="portada-carga" role="progressbar" aria-label="Cargando el museo" aria-valuemin="0" aria-valuemax="100">
          <div class="portada-barra"></div>
        </div>
        <button class="portada-entrar" disabled>Cargando…</button>
        <p class="portada-ayuda">${movil
    ? 'Joystick abajo a la izquierda para caminar · arrastra para mirar · toca un cuadro para contemplarlo'
    : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o flechas para caminar · ratón (o arrastrar) para mirar · <kbd>clic</kbd> o <kbd>E</kbd> sobre un cuadro para contemplarlo'}</p>
      </div>`;
    contenedor.append(this.el);
    this.barra = this.el.querySelector('.portada-barra');
    this.carga = this.el.querySelector('.portada-carga');
    this.boton = this.el.querySelector('.portada-entrar');
  }

  progreso(f) {
    const p = Math.round(f * 100);
    this.barra.style.width = `${p}%`;
    this.carga.setAttribute('aria-valuenow', String(p));
  }

  lista() {
    this.progreso(1);
    this.boton.disabled = false;
    this.boton.textContent = 'Entrar';
    this.boton.focus();
    return new Promise((resolver) => {
      this.boton.addEventListener('click', () => resolver(), { once: true });
    });
  }

  ocultar() {
    this.el.classList.add('oculta');
    setTimeout(() => this.el.remove(), 1200);
  }
}
