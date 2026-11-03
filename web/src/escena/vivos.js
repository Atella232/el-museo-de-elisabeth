// Cuadros vivos: cuando el visitante contempla un cuadro (o se queda mirándolo desde cerca),
// la pintura se mueve unos segundos dentro de su marco y vuelve a quedarse quieta.
//
// Son vídeos que empiezan y acaban en el propio cuadro (web/public/vivos/<id>-<calidad>.mp4,
// generados con IA a partir de la pintura y recodificados con tools/recodificar_video.swift); cubren la
// parte del lienzo indicada en `vivo.caja` de data/obras.json (x, y, ancho, alto, fracciones
// desde arriba a la izquierda) porque los modelos de vídeo solo trabajan en ciertas proporciones.
// Se funden con la imagen fija al empezar y al acabar, así el cambio no se nota, y como van en
// el mismo material, reciben la luz de los focos y salen también en el reflejo del suelo.
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL;
const FUNDIDO = 0.9; // segundos de fundido al empezar y al acabar
const PAUSA = 10; // segundos quieto entre una reproducción y la siguiente

export class CuadrosVivos {
  constructor(modelo, obras, { calidad }) {
    this.calidad = calidad;
    this.porId = {};
    const vacia = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    vacia.needsUpdate = true;
    modelo.traverse((obj) => {
      const id = obj.userData.obra;
      const vivo = obras[id]?.vivo;
      if (!obj.isMesh || !vivo || this.porId[id]) return;
      const uniforms = {
        mapaVivo: { value: vacia },
        mezclaVivo: { value: 0 },
        cajaVivo: { value: new THREE.Vector4(...vivo.caja) },
      };
      obj.material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'uniform sampler2D mapaVivo;\nuniform float mezclaVivo;\nuniform vec4 cajaVivo;\nvoid main() {')
          .replace('#include <map_fragment>', `
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            vec2 uvVivo = (vMapUv - cajaVivo.xy) / cajaVivo.zw;
            float bordeVivo = min(min(uvVivo.x, 1.0 - uvVivo.x), min(uvVivo.y, 1.0 - uvVivo.y));
            float pesoVivo = mezclaVivo * smoothstep(0.0, 0.03, bordeVivo);
            if (pesoVivo > 0.0) {
              // El vídeo se sube tal cual (sRGB) y se pasa aquí a lineal, como hace Three.js con
              // sus propias texturas de vídeo; si no, se vería lavado.
              vec3 c = texture2D(mapaVivo, clamp(uvVivo, 0.0, 1.0)).rgb;
              c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, c, pesoVivo);
            }
            diffuseColor *= sampledDiffuseColor;`);
      };
      obj.material.customProgramCacheKey = () => 'cuadro-vivo';
      obj.material.needsUpdate = true;
      this.porId[id] = { archivo: `${id}-${calidad.texturas}.mp4`, uniforms, video: null, textura: null };
    });
    this.actual = null;
    this.estado = 'quieto'; // quieto · entrando · vivo · saliendo · pausa
  }

  tiene(id) {
    return !!this.porId[id];
  }

  // Empieza a animar el cuadro `id` al cabo de `espera` segundos (o ninguno con null); el vídeo
  // se va descargando mientras tanto. El anterior se funde a quieto.
  enfocar(id, espera = 0) {
    const nuevo = this.porId[id] ?? null;
    if (nuevo === this.actual) return;
    if (this.actual) this.#detener(this.actual);
    this.actual = nuevo;
    if (!nuevo) return;
    if (!nuevo.video) {
      const video = document.createElement('video');
      video.src = `${BASE}vivos/${nuevo.archivo}`;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      nuevo.video = video;
      nuevo.textura = new THREE.VideoTexture(video);
      nuevo.textura.colorSpace = THREE.NoColorSpace; // se descodifica en el shader
      nuevo.textura.flipY = false; // como las demás texturas del cuadro: v = 0 arriba
      nuevo.uniforms.mapaVivo.value = nuevo.textura;
    }
    if (espera > 0) {
      this.estado = 'pausa';
      this.esperaPausa = espera;
    } else {
      this.#reproducir(nuevo);
    }
  }

  #reproducir(v) {
    v.video.currentTime = 0;
    v.video.play().then(() => {
      if (this.actual === v) this.estado = 'vivo';
    }, () => {
      // El navegador puede negarse (pestaña oculta, ahorro de energía): se reintenta luego.
      if (this.actual !== v) return;
      this.estado = 'pausa';
      this.esperaPausa = 2;
    });
    this.estado = 'cargando';
    this.esperaPausa = 0;
  }

  #detener(v) {
    // El fundido de salida lo hace actualizar(); al acabar se pausa el vídeo.
    v.saliendo = true;
  }

  actualizar(dt) {
    for (const v of Object.values(this.porId)) {
      const m = v.uniforms.mezclaVivo;
      if (v !== this.actual) {
        if (m.value > 0) m.value = Math.max(0, m.value - dt / FUNDIDO);
        if (m.value === 0 && v.saliendo) {
          v.video?.pause();
          v.saliendo = false;
        }
        continue;
      }
      const video = v.video;
      if (this.estado === 'pausa') {
        m.value = Math.max(0, m.value - dt / FUNDIDO);
        this.esperaPausa -= dt;
        if (this.esperaPausa <= 0) this.#reproducir(v);
        continue;
      }
      if (this.estado !== 'vivo' || !video.duration) continue;
      const restante = video.duration - video.currentTime;
      // Sube al empezar a moverse y baja justo antes de acabar: el vídeo empieza y termina en
      // el cuadro, así que lo que se ve en los extremos es casi idéntico a la imagen fija.
      const objetivo = restante < FUNDIDO ? restante / FUNDIDO : Math.min(1, video.currentTime / FUNDIDO);
      m.value = THREE.MathUtils.clamp(objetivo, 0, 1);
      if (video.ended || restante < 0.05) {
        this.estado = 'pausa';
        this.esperaPausa = PAUSA;
      }
    }
  }
}
