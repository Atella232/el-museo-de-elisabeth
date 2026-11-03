// Visita guiada dentro de un diorama: recorre el cuadro parada a parada con la narración del
// capítulo «Dentro del cuadro» de su vídeo. En cada parada la cámara encuadra las figuras que se
// nombran, que se iluminan con su contorno dorado, y abajo se lee lo que se oye.
const PAUSA_ENTRE_PARADAS = 1.2; // segundos de silencio entre una locución y la siguiente

export class VisitaGuiada extends EventTarget {
  constructor(diorama, ambiente) {
    super();
    this.diorama = diorama;
    this.ambiente = ambiente;
    this.datos = null;
    this.indice = -1;
    this.pausada = false;
  }

  get activa() {
    return !!this.datos;
  }

  // Debe llamarse desde el clic del botón (la voz necesita un gesto la primera vez en iOS).
  empezar(datos) {
    this.datos = datos;
    this.pausada = false;
    this.ambiente.atenuarMusica(0.12);
    this.ambiente.nivelPaisaje(0.35);
    this.#ir(0);
  }

  siguiente() {
    if (this.activa) this.#ir(this.indice + 1);
  }

  anterior() {
    if (this.activa) this.#ir(Math.max(0, this.indice - 1));
  }

  alternarPausa() {
    if (!this.activa || !this.audio) return;
    this.pausada = !this.pausada;
    clearTimeout(this.temporizador);
    if (this.pausada) {
      this.audio.pause();
    } else if (this.audio.ended) {
      this.siguiente();
    } else {
      this.audio.play().catch(() => {});
    }
    this.dispatchEvent(new CustomEvent('pausa', { detail: this.pausada }));
  }

  terminar() {
    if (!this.activa) return;
    clearTimeout(this.temporizador);
    this.audio?.removeEventListener('ended', this.alAcabar);
    this.ambiente.callarVoz();
    this.ambiente.atenuarMusica(0.6);
    this.ambiente.nivelPaisaje(1);
    this.diorama.guiar(null);
    this.datos = null;
    this.indice = -1;
    this.dispatchEvent(new Event('fin'));
  }

  #ir(i) {
    clearTimeout(this.temporizador);
    if (i >= this.datos.paradas.length) {
      this.terminar();
      return;
    }
    this.indice = i;
    this.pausada = false;
    const parada = this.datos.paradas[i];
    this.diorama.guiar(parada, this.datos);
    this.audio?.removeEventListener('ended', this.alAcabar);
    this.audio = this.ambiente.voz(this.datos.dir + parada.audio);
    // Al acabar cada locución, un respiro y a la siguiente parada.
    this.alAcabar = () => {
      if (!this.pausada) this.temporizador = setTimeout(() => this.siguiente(), PAUSA_ENTRE_PARADAS * 1000);
    };
    this.audio?.addEventListener('ended', this.alAcabar);
    this.dispatchEvent(new CustomEvent('parada', {
      detail: { indice: i, total: this.datos.paradas.length, texto: parada.texto },
    }));
  }
}
