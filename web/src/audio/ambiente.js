// Sonido generado con Web Audio, sin archivos: rumor de sala vacía y pasos sobre mármol
// con la reverberación larga de una galería de piedra. Y, muy baja, música de fondo
// (web/public/musica/, la prepara tools/descargar_musica.mjs).

const VOLUMEN_MUSICA = 0.3;
const PAUSA_ENTRE_PIEZAS = 7; // segundos de silencio entre una pieza y la siguiente
const VOLUMEN_PASOS = 0.35;

export class Ambiente {
  constructor() {
    this.ctx = null;
    this.silencio = false;
  }

  // Debe llamarse desde un gesto del usuario (el clic de "Entrar").
  iniciar() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.maestro = ctx.createGain();
    this.maestro.gain.value = this.silencio ? 0 : 1;
    this.maestro.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.#respuestaSala(2.8);
    const humedo = ctx.createGain();
    humedo.gain.value = 0.55;
    this.reverb.connect(humedo).connect(this.maestro);

    // Rumor: ruido marrón muy filtrado
    const ruido = ctx.createBufferSource();
    ruido.buffer = this.#ruidoMarron(4);
    ruido.loop = true;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 260;
    const nivel = ctx.createGain();
    nivel.gain.value = 0.05;
    ruido.connect(filtro).connect(nivel).connect(this.maestro);
    ruido.start();
    this.blanco = this.#ruidoBlanco(0.25);
  }

  // Debe llamarse justo después de iniciar(), en el mismo gesto (iOS solo deja sonar un
  // <audio> que empezó en un gesto; luego se reutiliza el mismo elemento para cada pieza).
  // Las piezas suenan en orden aleatorio y la lista se vuelve a barajar al acabar.
  iniciarMusica(lista, base) {
    if (!this.ctx || this.audio || !lista.length) return;
    const ctx = this.ctx;
    this.lista = lista;
    this.base = base;
    this.cola = [];
    this.fallos = 0;
    const audio = (this.audio = new Audio());
    audio.preload = 'auto';
    this.ganancia = ctx.createGain(); // iguala el volumen de cada pieza
    this.musica = ctx.createGain(); // volumen general; baja a 0 mientras hay un vídeo
    this.musica.gain.setValueAtTime(0, ctx.currentTime);
    this.musica.gain.linearRampToValueAtTime(VOLUMEN_MUSICA, ctx.currentTime + 6);
    // Sin brillo y con la reverberación de la sala: como si sonara lejos, en otra galería.
    const tono = ctx.createBiquadFilter();
    tono.type = 'lowpass';
    tono.frequency.value = 3800;
    const directo = ctx.createGain();
    directo.gain.value = 0.6;
    const envio = ctx.createGain();
    envio.gain.value = 0.5;
    ctx.createMediaElementSource(audio).connect(this.ganancia).connect(tono).connect(this.musica);
    this.musica.connect(directo).connect(this.maestro);
    this.musica.connect(envio).connect(this.reverb);
    audio.addEventListener('ended', () => {
      this.fallos = 0;
      setTimeout(() => this.#siguientePieza(), PAUSA_ENTRE_PIEZAS * 1000);
    });
    audio.addEventListener('error', () => {
      if (++this.fallos < this.lista.length) setTimeout(() => this.#siguientePieza(), 1000);
    });
    this.#siguientePieza();
  }

  // nivel: 1 normal, 0 en silencio (con un vídeo), algo menos dentro de un cuadro.
  atenuarMusica(nivel) {
    if (this.musica) this.musica.gain.setTargetAtTime(VOLUMEN_MUSICA * nivel, this.ctx.currentTime, 0.5);
  }

  // Sonido de dentro de un cuadro: 'mar' (olas que rompen despacio) o 'viento' (brisa entre
  // los árboles). null lo apaga. Todo es ruido filtrado y modulado, sin archivos.
  paisaje(tipo) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.paisajeActual) {
      const { nivel, fuentes } = this.paisajeActual;
      nivel.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => fuentes.forEach((f) => f.stop()), 3000);
      this.paisajeActual = null;
    }
    if (!tipo) return;
    const nivel = ctx.createGain();
    nivel.gain.setValueAtTime(0, t);
    nivel.gain.setTargetAtTime(1, t + 0.8, 1.2);
    nivel.connect(this.maestro);
    const fuentes = [];
    const ruido = (seg) => {
      const f = ctx.createBufferSource();
      f.buffer = this.#ruidoMarron(seg);
      f.loop = true;
      fuentes.push(f);
      return f;
    };
    const lfo = (frecuencia, profundidad, destino, base) => {
      const o = ctx.createOscillator();
      o.frequency.value = frecuencia;
      const g = ctx.createGain();
      g.gain.value = profundidad;
      destino.value = base;
      o.connect(g).connect(destino);
      fuentes.push(o);
    };
    if (tipo === 'mar') {
      // Grave y lento: el oleaje. El volumen sube y baja con cada ola (unos 9 s).
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const g = ctx.createGain();
      lfo(0.11, 0.09, g.gain, 0.12);
      ruido(6).connect(f).connect(g).connect(nivel);
      // Espuma: un siseo agudo que acompaña la rompiente.
      const e = ctx.createBiquadFilter();
      e.type = 'bandpass';
      e.frequency.value = 2600;
      e.Q.value = 0.6;
      const ge = ctx.createGain();
      lfo(0.11, 0.025, ge.gain, 0.025);
      ruido(4).connect(e).connect(ge).connect(nivel);
      ge.connect(this.reverb);
    } else {
      // Brisa: banda media que se mueve despacio, con rachas.
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.8;
      lfo(0.07, 260, f.frequency, 620);
      const g = ctx.createGain();
      lfo(0.045, 0.05, g.gain, 0.08);
      ruido(5).connect(f).connect(g).connect(nivel);
      g.connect(this.reverb);
    }
    fuentes.forEach((f) => f.start());
    this.paisajeActual = { nivel, fuentes };
  }

  #siguientePieza() {
    if (!this.cola.length) {
      const anterior = this.pieza;
      this.cola = [...this.lista];
      for (let i = this.cola.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.cola[i], this.cola[j]] = [this.cola[j], this.cola[i]];
      }
      if (this.cola.length > 1 && this.cola[0] === anterior) this.cola.push(this.cola.shift());
    }
    this.pieza = this.cola.shift();
    this.ganancia.gain.value = this.pieza.ganancia;
    this.audio.src = `${this.base}musica/${this.pieza.archivo}`;
    this.audio.play().catch(() => {});
  }

  alternarSilencio() {
    this.silencio = !this.silencio;
    if (this.ctx) this.maestro.gain.setTargetAtTime(this.silencio ? 0 : 1, this.ctx.currentTime, 0.08);
    return this.silencio;
  }

  paso(fuerte = 1) {
    if (!this.ctx || this.silencio) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const fuente = ctx.createBufferSource();
    fuente.buffer = this.blanco;
    fuente.playbackRate.value = 0.85 + Math.random() * 0.3;
    const banda = ctx.createBiquadFilter();
    banda.type = 'bandpass';
    banda.frequency.value = 1700 + Math.random() * 600;
    banda.Q.value = 1.1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.22 * VOLUMEN_PASOS * fuerte, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    fuente.connect(banda).connect(env);
    // golpe grave del talón
    const golpe = ctx.createOscillator();
    golpe.frequency.setValueAtTime(140, t);
    golpe.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const envG = ctx.createGain();
    envG.gain.setValueAtTime(0.18 * VOLUMEN_PASOS * fuerte, t);
    envG.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    golpe.connect(envG);
    for (const n of [env, envG]) {
      n.connect(this.maestro);
      n.connect(this.reverb);
    }
    fuente.start(t);
    fuente.stop(t + 0.12);
    golpe.start(t);
    golpe.stop(t + 0.1);
  }

  #ruidoBlanco(seg) {
    const b = this.ctx.createBuffer(1, Math.round(this.ctx.sampleRate * seg), this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  #ruidoMarron(seg) {
    const b = this.ctx.createBuffer(2, Math.round(this.ctx.sampleRate * seg), this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let ultimo = 0;
      for (let i = 0; i < d.length; i++) {
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = ultimo * 3.5;
      }
    }
    return b;
  }

  #respuestaSala(seg) {
    const sr = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(2, Math.round(sr * seg), sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.4) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    return b;
  }
}
