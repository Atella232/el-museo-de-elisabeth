// Elementos del paseo: mira, aviso de "contemplar", pausa, botones de sonido y ayuda,
// y el contador de depuración.
export class Hud extends EventTarget {
  constructor(contenedor, { movil, debug }) {
    super();
    this.movil = movil;
    const el = (this.el = document.createElement('div'));
    el.className = 'hud';
    el.innerHTML = `
      <div class="mira" hidden></div>
      <div class="aviso" hidden></div>
      <div class="pausa" data-accion="continuar" hidden>
        <div class="pausa-caja">
          <p class="pausa-titulo">El museo te espera</p>
          <button class="boton boton-oro" data-accion="continuar">Seguir paseando</button>
          <p class="portada-ayuda"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o flechas para caminar · <kbd>Mayús</kbd> más rápido · ratón para mirar · <kbd>clic</kbd> o <kbd>E</kbd> para contemplar</p>
        </div>
      </div>
      <div class="esquina">
        <button class="boton-icono" data-accion="sonido" aria-label="Silenciar">${ICONO_SONIDO}</button>
      </div>
      ${debug ? '<pre class="depuracion"></pre>' : ''}`;
    contenedor.append(el);
    this.mira = el.querySelector('.mira');
    this.aviso = el.querySelector('.aviso');
    this.pausa = el.querySelector('.pausa');
    this.botonSonido = el.querySelector('[data-accion="sonido"]');
    this.depuracion = el.querySelector('.depuracion');
    el.addEventListener('click', (e) => {
      const accion = e.target.closest('[data-accion]')?.dataset.accion;
      if (accion) this.dispatchEvent(new CustomEvent(accion));
    });
  }

  paseo(activo) {
    this.mira.hidden = !activo || this.movil;
    if (!activo) this.apuntando(null);
  }

  apuntando(obra) {
    if (!obra) {
      this.aviso.hidden = true;
      this.mira.classList.remove('sobre');
      return;
    }
    this.mira.classList.add('sobre');
    this.aviso.innerHTML = `<strong>${obra.titulo.replace(/</g, '&lt;')}</strong><span>${this.movil ? 'Toca para contemplar' : 'Clic o <kbd>E</kbd> para contemplar'}</span>`;
    this.aviso.hidden = false;
  }

  mostrarPausa(visible) {
    this.pausa.hidden = !visible;
  }

  sonido(silencio) {
    this.botonSonido.innerHTML = silencio ? ICONO_MUDO : ICONO_SONIDO;
    this.botonSonido.setAttribute('aria-label', silencio ? 'Activar el sonido' : 'Silenciar');
  }

  datos(texto) {
    if (this.depuracion) this.depuracion.textContent = texto;
  }
}

const ICONO_SONIDO = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
const ICONO_MUDO = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
