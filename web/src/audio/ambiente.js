// Sonido generado con Web Audio, sin archivos: rumor de sala vacía y pasos sobre mármol
// con la reverberación larga de una galería de piedra.
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
    env.gain.linearRampToValueAtTime(0.22 * fuerte, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    fuente.connect(banda).connect(env);
    // golpe grave del talón
    const golpe = ctx.createOscillator();
    golpe.frequency.setValueAtTime(140, t);
    golpe.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const envG = ctx.createGain();
    envG.gain.setValueAtTime(0.18 * fuerte, t);
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
