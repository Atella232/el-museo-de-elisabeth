// Entrar en el cuadro: la pintura se convierte en un diorama, un teatro de papel con cada
// figura en un plano a su profundidad (capas preparadas por tools/preparar_dioramas.mjs).
//
// El ojo empieza exactamente donde acaba el acercamiento del museo, con el lienzo entero a la
// vista. Cada plano se escala según su distancia, así que desde ese punto el apilado se ve
// igual que el cuadro; la profundidad aparece al moverse. Encima hay una copia plana del cuadro
// que se desvanece al entrar y vuelve al salir, para que el paso del museo al diorama no se note.
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL;
const ENTRADA = 3.2; // segundos que dura la entrada
const SALIDA = 1.6;
const AVANCE_ENTRADA = 0.07; // cuánto se adentra el ojo al entrar (fracción de la distancia)
const suave = (t) => t * t * (3 - 2 * t);
const ZOOM_MAX = 2; // la visita guiada no acerca más del doble: las capas no tienen más detalle
const _frente = new THREE.Vector3();
const _color = new THREE.Color();

export class Diorama {
  constructor(renderer, { calidad }) {
    this.renderer = renderer;
    this.calidad = calidad;
    this.cache = new Map();
    this.escena = new THREE.Scene();
    this.escena.background = new THREE.Color(0x000000);
    this.camara = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
    this.activo = false;
    this.puntero = new THREE.Vector2(); // -1..1, hacia donde se asoma el visitante
    this.desplazamiento = new THREE.Vector2(); // asomarse, ya suavizado
    this.avance = 0; // cuánto se ha adentrado el ojo, en fracción de la distancia al lienzo
    this.avanceObjetivo = 0;
    this.ultimoMovimiento = 0;
    this.#escuchar();
  }

  // Descarga (una sola vez) el manifiesto y las texturas de las capas.
  cargar(id) {
    if (!this.cache.has(id)) {
      this.cache.set(id, (async () => {
        const dir = `${BASE}dioramas/${id}/`;
        const datos = await (await fetch(`${dir}diorama.json`)).json();
        const cargador = new THREE.TextureLoader();
        const textura = async (archivo, srgb = true) => {
          const t = await cargador.loadAsync(dir + archivo);
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          return t;
        };
        const capas = await Promise.all(datos.capas.map(async (c) => ({ ...c, textura: await textura(c.archivos[this.calidad.texturas]) })));
        const mar = datos.mar ? await textura(datos.mar, false) : null;
        const visita = datos.visita ? { ...(await (await fetch(dir + datos.visita)).json()), dir } : null;
        return { id, datos, capas, mar, visita };
      })());
    }
    return this.cache.get(id);
  }

  // Monta la escena para un lienzo de `ancho` × `alto` metros visto desde `distancia`,
  // con la misma cámara (fov y proporción) que el museo.
  async preparar(id, { ancho, alto, distancia, fov, aspecto, cuadroPlano }) {
    const { capas, mar } = await this.cargar(id);
    this.id = id;
    this.L = distancia;
    this.lienzo = { ancho, alto };
    this.escena.clear();
    this.mar = null;
    this.camara.fov = fov;
    this.camara.aspect = aspecto;
    this.camara.position.set(0, 0, 0);
    this.camara.quaternion.identity();
    this.camara.zoom = 1;
    this.camara.updateProjectionMatrix();
    this.mira = new THREE.Vector3(0, 0, -distancia);
    this.guia = null;
    this.contornos = {};
    this.capas = capas;
    this.tiempo = 0;

    this.planos = capas.map((c, i) => {
      const material = new THREE.MeshBasicMaterial({
        map: c.textura, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      });
      if (c.nombre === 'fondo' && mar) this.#oleaje(material, mar);
      const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      plano.renderOrder = i;
      const [x, y, w, h] = c.caja;
      const s = 1 - c.profundidad; // distancia relativa al ojo: así se ve igual que en el cuadro
      plano.position.set((x + w / 2 - 0.5) * ancho * s, (0.5 - (y + h / 2)) * alto * s, -distancia * s);
      plano.scale.set(w * ancho * s, h * alto * s, 1);
      plano.userData.brillo = 1; // la visita guiada atenúa las capas que no nombra
      this.escena.add(plano);
      return plano;
    });

    // La textura del cuadro es la del museo, preparada para las UV de glTF (sin voltear): se le da
    // la vuelta a las UV del plano para que no salga boca abajo.
    const geoPlano = new THREE.PlaneGeometry(ancho, alto);
    const uv = geoPlano.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.plano = new THREE.Mesh(
      geoPlano,
      new THREE.MeshBasicMaterial({ map: cuadroPlano, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.plano.position.z = -distancia;
    this.plano.renderOrder = 100;
    this.escena.add(this.plano);

    this.motas = this.#motas(id, capas.map((c) => c.profundidad));
    for (const m of this.motas) this.escena.add(m);
    this.rayos = id === 'juicio' ? this.#rayos() : [];
    this.#limites();
    this.opacidadPlano = 1;
    this.avance = 0;
    this.avanceObjetivo = AVANCE_ENTRADA;
    this.desplazamiento.set(0, 0);
    this.puntero.set(0, 0);
    this.activo = true;
  }

  entrar() {
    return this.#animar({ desde: 1, hasta: 0, avanceFinal: AVANCE_ENTRADA, duracion: ENTRADA });
  }

  // Vuelve al punto de partida; el diorama sigue dibujándose hasta que se llama a cerrar().
  salir() {
    return this.#animar({ desde: 0, hasta: 1, avanceFinal: 0, duracion: SALIDA });
  }

  cerrar() {
    this.activo = false;
  }

  // Animación de entrada o salida: la copia plana del cuadro aparece o se desvanece y el ojo
  // avanza hacia dentro o vuelve al punto de partida.
  #animar({ desde, hasta, avanceFinal, duracion }) {
    return new Promise((resolver) => {
      this.transicion = { t: 0, desde, hasta, avanceInicial: this.avance, avanceFinal, duracion, resolver };
    });
  }

  ajustarTamano(w, h) {
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    if (this.activo) this.#limites();
  }

  // Hasta dónde puede adentrarse el ojo: desde el punto de partida (el cuadro entero a la vista)
  // hasta poco más de lo justo para que el fondo llene la pantalla.
  #limites() {
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2));
    const th = tv * this.camara.aspect;
    const cubre = Math.min(this.lienzo.alto / 2 / tv, this.lienzo.ancho / 2 / th);
    this.avanceMin = 0;
    this.avanceMax = THREE.MathUtils.clamp(1 - (cubre / this.L) * 0.9, 0.12, 0.35);
  }

  actualizar(dt) {
    if (!this.activo) return;
    this.tiempo += dt;
    const tr = this.transicion;
    if (tr) {
      tr.t = Math.min(1, tr.t + dt / tr.duracion);
      const entrando = tr.hasta === 0;
      // Al entrar, el cuadro plano se desvanece en el primer cuarto, antes de que el ojo se
      // mueva; al salir, vuelve en la segunda mitad, cuando el ojo ya ha regresado.
      const kp = entrando ? suave(Math.min(1, tr.t * 4)) : suave(Math.max(0, tr.t * 2 - 1));
      this.opacidadPlano = tr.desde + (tr.hasta - tr.desde) * kp;
      const ka = entrando ? suave(Math.max(0, (tr.t - 0.25) / 0.75)) : suave(Math.min(1, tr.t * 2));
      this.avance = tr.avanceInicial + (tr.avanceFinal - tr.avanceInicial) * ka;
      if (!entrando) this.desplazamiento.multiplyScalar(1 - ka);
      if (tr.t >= 1) {
        this.transicion = null;
        this.avanceObjetivo = this.avance;
        tr.resolver();
      }
    } else if (this.guia) {
      // En la visita, el ojo se queda en su sitio y solo respira un poco; encuadra el zoom.
      this.avance += (AVANCE_ENTRADA - this.avance) * Math.min(1, dt * 2);
      const respira = new THREE.Vector2(Math.sin(this.tiempo * 0.23) * 0.25, Math.sin(this.tiempo * 0.17 + 1) * 0.15);
      this.desplazamiento.lerp(respira, Math.min(1, dt * 0.8));
    } else {
      this.avance += (THREE.MathUtils.clamp(this.avanceObjetivo, this.avanceMin, this.avanceMax) - this.avance) * Math.min(1, dt * 3);
      // Si el visitante no mueve nada, el ojo deriva despacio, como si respirara.
      const quieto = this.tiempo - this.ultimoMovimiento > 4;
      const objetivo = quieto
        ? new THREE.Vector2(Math.sin(this.tiempo * 0.23) * 0.6, Math.sin(this.tiempo * 0.17 + 1) * 0.35)
        : this.puntero;
      this.desplazamiento.lerp(objetivo, Math.min(1, dt * (quieto ? 0.6 : 2.5)));
    }
    this.plano.material.opacity = this.opacidadPlano;
    this.plano.visible = this.opacidadPlano > 0.001;

    // Posición del ojo: avanza hacia el lienzo y se asoma un poco a los lados. Con tope: asomarse
    // mucho deja ver los rellenos detrás de las figuras.
    const margenX = this.L * 0.07;
    const margenY = this.L * 0.04;
    this.camara.position.set(this.desplazamiento.x * margenX, this.desplazamiento.y * margenY, -this.L * this.avance);

    // Qué se encuadra y con cuánto zoom: todo el cuadro de frente, salvo en la visita guiada, que
    // encuadra cada figura. La cámara nunca gira (el cuadro se vería en escorzo): desplaza la
    // imagen como el descentrable de una cámara de fotos. Siempre se llega poco a poco.
    const g = this.guia;
    const k = Math.min(1, dt * 1.4);
    this.mira.lerp(g?.mira ?? _frente.set(this.camara.position.x, this.camara.position.y, -this.L), k);
    this.camara.zoom += ((g?.zoom ?? 1) - this.camara.zoom) * k;
    this.camara.updateProjectionMatrix();
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2)) / this.camara.zoom;
    const prof = Math.max(1e-3, this.camara.position.z - this.mira.z);
    const e = this.camara.projectionMatrix.elements;
    e[8] = (this.mira.x - this.camara.position.x) / prof / (tanV * this.camara.aspect);
    e[9] = (this.mira.y - this.camara.position.y) / prof / tanV;
    this.camara.projectionMatrixInverse.copy(this.camara.projectionMatrix).invert();
    for (const plano of this.planos) plano.material.color.lerp(_color.setScalar(plano.userData.brillo), Math.min(1, dt * 2));
    for (const c of Object.values(this.contornos)) {
      c.material.opacity += ((c.userData.visible ? 1 : 0) - c.material.opacity) * Math.min(1, dt * 2.5);
      c.visible = c.material.opacity > 0.01;
    }

    for (const m of this.motas) m.material.uniforms.tiempo.value = this.tiempo;
    for (const [i, r] of this.rayos.entries()) {
      r.material.opacity = r.userData.base * (0.65 + 0.35 * Math.sin(this.tiempo * 0.35 + i * 2.1));
      r.rotation.z = r.userData.giro + Math.sin(this.tiempo * 0.12 + i) * 0.03;
    }
    if (this.mar) this.mar.uniforms.tiempo.value = this.tiempo;
  }

  render() {
    this.renderer.render(this.escena, this.camara);
  }

  // Visita guiada: encuadra y resalta las figuras de una parada (null la termina y devuelve la
  // vista libre). Encuadra con el zoom de la cámara y no moviendo el ojo: así no se descubren
  // los rellenos de detrás de las figuras, y nunca acerca más de ZOOM_MAX.
  guiar(parada, visita) {
    for (const c of Object.values(this.contornos)) c.userData.visible = false;
    for (const plano of this.planos) plano.userData.brillo = 1;
    if (!parada) {
      this.guia = null;
      return;
    }
    const nombres = parada.figuras ?? [];
    for (const n of nombres) this.#contorno(n, visita.figuras[n]).userData.visible = true;
    if (nombres.length && !parada.general) {
      const capasNombradas = new Set(nombres.map((n) => visita.figuras[n].capa));
      for (const [i, plano] of this.planos.entries()) plano.userData.brillo = capasNombradas.has(this.capas[i].nombre) ? 1 : 0.62;
    }
    let caja = parada.encuadre ?? null;
    if (!caja && nombres.length && !parada.general) {
      const cajas = nombres.map((n) => visita.figuras[n].caja);
      caja = [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...cajas.map((c) => c[k])));
    }
    if (!caja) {
      this.guia = { mira: null, zoom: 1 };
      return;
    }
    const s = 1 - (nombres.length ? this.#capa(visita.figuras[nombres[0]].capa).profundidad : 0);
    const { ancho: W, alto: H } = this.lienzo;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2));
    const tanH = tanV * this.camara.aspect;
    const D = this.L * s - this.L * AVANCE_ENTRADA; // del ojo al plano de la figura
    const [x0, y0, x1, y1] = caja;
    const zoom = THREE.MathUtils.clamp(Math.min(
      (0.68 * 2 * D * tanV) / ((y1 - y0) * H * s),
      (0.68 * 2 * D * tanH) / ((x1 - x0) * W * s),
    ), 1, ZOOM_MAX);
    // Que lo encuadrado no se salga del cuadro.
    const limX = Math.max(0, (W * s) / 2 - (D * tanH) / zoom * 0.95);
    const limY = Math.max(0, (H * s) / 2 - (D * tanV) / zoom * 0.95);
    const mira = new THREE.Vector3(
      THREE.MathUtils.clamp(((x0 + x1) / 2 - 0.5) * W * s, -limX, limX),
      THREE.MathUtils.clamp((0.5 - (y0 + y1) / 2) * H * s, -limY, limY),
      -this.L * s,
    );
    this.guia = { mira, zoom };
  }

  #capa(nombre) {
    const i = Math.max(0, this.capas.findIndex((c) => c.nombre === nombre));
    return { ...this.capas[i], indice: i };
  }

  // Contorno dorado de una figura, dibujado desde los mismos trazos que el vídeo, en un plano a
  // la profundidad de su capa (y con su misma escala, para que encaje con ella).
  #contorno(nombre, fig) {
    if (this.contornos[nombre]) return this.contornos[nombre];
    const capa = this.#capa(fig.capa);
    const { ancho: W, alto: H } = this.lienzo;
    const m = 0.015;
    const [x0, y0, x1, y1] = [fig.caja[0] - m, fig.caja[1] - m, fig.caja[2] + m, fig.caja[3] + m];
    const bw = x1 - x0;
    const bh = y1 - y0;
    const lado = 1024 / Math.max(bw * W, bh * H);
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(8, Math.round(bw * W * lado));
    lienzo.height = Math.max(8, Math.round(bh * H * lado));
    const ctx = lienzo.getContext('2d');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const trazar = () => {
      ctx.beginPath();
      for (const anillo of fig.anillos) {
        anillo.forEach(([x, y], i) => {
          const px = ((x - x0) / bw) * lienzo.width;
          const py = ((y - y0) / bh) * lienzo.height;
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.closePath();
      }
    };
    const grosor = Math.max(lienzo.width, lienzo.height) / 340;
    ctx.shadowColor = 'rgba(240, 190, 90, 0.95)';
    ctx.shadowBlur = grosor * 5;
    ctx.strokeStyle = 'rgba(255, 210, 130, 0.9)';
    ctx.lineWidth = grosor;
    trazar();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 236, 190, 1)';
    ctx.lineWidth = grosor * 0.45;
    ctx.stroke();
    const textura = new THREE.CanvasTexture(lienzo);
    textura.colorSpace = THREE.SRGBColorSpace;
    const s = 1 - capa.profundidad;
    const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: textura, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    plano.position.set((x0 + bw / 2 - 0.5) * W * s, (0.5 - (y0 + bh / 2)) * H * s, -this.L * s);
    plano.scale.set(bw * W * s, bh * H * s, 1);
    plano.renderOrder = capa.indice + 0.7;
    plano.visible = false;
    plano.userData.visible = false;
    this.escena.add(plano);
    this.contornos[nombre] = plano;
    return plano;
  }

  #escuchar() {
    const lienzo = this.renderer.domElement;
    let arrastre = null;
    addEventListener('pointermove', (e) => {
      if (!this.activo || this.transicion || this.guia) return;
      this.ultimoMovimiento = this.tiempo;
      if (e.pointerType === 'mouse') {
        this.puntero.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
      } else if (arrastre) {
        this.puntero.x = THREE.MathUtils.clamp(arrastre.px - (e.clientX - arrastre.x) / (innerWidth * 0.4), -1, 1);
        this.puntero.y = THREE.MathUtils.clamp(arrastre.py + (e.clientY - arrastre.y) / (innerHeight * 0.4), -1, 1);
      }
    });
    lienzo.addEventListener('pointerdown', (e) => {
      if (this.activo && e.pointerType !== 'mouse') arrastre = { x: e.clientX, y: e.clientY, px: this.puntero.x, py: this.puntero.y };
    });
    addEventListener('pointerup', () => { arrastre = null; });
    lienzo.addEventListener('wheel', (e) => {
      if (!this.activo || this.transicion || this.guia) return;
      e.preventDefault();
      this.ultimoMovimiento = this.tiempo;
      this.avanceObjetivo = THREE.MathUtils.clamp(this.avanceObjetivo - e.deltaY * 0.0006, this.avanceMin, this.avanceMax);
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (!this.activo || this.transicion || this.guia) return;
      const paso = { KeyW: 1, ArrowUp: 1, KeyS: -1, ArrowDown: -1 }[e.code];
      if (!paso) return;
      e.preventDefault();
      this.ultimoMovimiento = this.tiempo;
      this.avanceObjetivo = THREE.MathUtils.clamp(this.avanceObjetivo + paso * 0.05, this.avanceMin, this.avanceMax);
    });
  }

  // El mar de la Venus: la imagen del fondo se ondula donde está el mar, con olas más finas
  // hacia el horizonte, y salen algunos destellos.
  #oleaje(material, mascara) {
    const uniforms = { tiempo: { value: 0 }, mascaraMar: { value: mascara } };
    this.mar = { uniforms };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float tiempo;\nuniform sampler2D mascaraMar;\nvoid main() {')
        .replace('#include <map_fragment>', `
          vec2 uvMar = vMapUv;
          float mar = texture2D(mascaraMar, uvMar).r;
          // horizonte a un 39 % desde arriba; f = 0 en el horizonte, 1 abajo del todo
          float f = clamp((0.606 - uvMar.y) / 0.606, 0.0, 1.0);
          float k = mix(260.0, 60.0, f);
          vec2 ola = vec2(sin(uvMar.y * k * 1.7 + tiempo * 1.1 + sin(uvMar.x * 23.0)),
                          sin(uvMar.x * k * 0.6 - tiempo * 0.8 + uvMar.y * 40.0));
          uvMar += mar * ola * mix(0.0005, 0.0026, f) * vec2(1.0, 0.45);
          vec4 sampledDiffuseColor = texture2D(map, uvMar);
          float destello = pow(max(0.0, sin(uvMar.x * 900.0 + tiempo * 2.3) * sin(uvMar.y * 520.0 - tiempo * 1.7)), 24.0);
          sampledDiffuseColor.rgb += mar * destello * (0.15 + 0.25 * f) * vec3(1.0, 0.97, 0.9);
          diffuseColor *= sampledDiffuseColor;`);
    };
  }

  // Rayos de sol del Juicio: salen del claro del cielo, entre Mercurio y Minerva, justo por
  // delante del paisaje y por detrás de todas las figuras, y respiran despacio.
  #rayos() {
    const lienzo = document.createElement('canvas');
    lienzo.width = 64;
    lienzo.height = 256;
    const ctx = lienzo.getContext('2d');
    const img = ctx.createImageData(64, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 64; x++) {
        const d = (x - 31.5) / 32;
        const v = Math.exp(-d * d * 6) * (1 - y / 255) ** 1.4 * Math.min(1, y / 20);
        img.data.set([255, 255, 255, Math.round(v * 255)], (y * 64 + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    const textura = new THREE.CanvasTexture(lienzo);
    const s = 1 - 0.03; // entre el fondo y el primer plano
    const origen = new THREE.Vector2((0.37 - 0.5) * this.lienzo.ancho * s, (0.5 - 0.22) * this.lienzo.alto * s);
    return [[0.5, 0.42, 0.22], [0.32, 0.3, 0.17], [0.68, 0.36, 0.14], [0.15, 0.22, 0.11]].map(([giro, ancho, base]) => {
      const largo = this.lienzo.alto * 0.9 * s;
      const geo = new THREE.PlaneGeometry(ancho * s, largo).translate(0, -largo / 2, 0);
      const rayo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: textura, color: 0xffe2a8, transparent: true, opacity: base, blending: THREE.AdditiveBlending,
        depthTest: false, depthWrite: false, toneMapped: false,
      }));
      rayo.position.set(origen.x, origen.y, -this.L * s);
      rayo.rotation.z = giro;
      rayo.userData = { giro, base };
      rayo.renderOrder = 0.4;
      this.escena.add(rayo);
      return rayo;
    });
  }

  // Motas de luz suspendidas entre los planos: polen dorado en el Juicio, pétalos rosados
  // que el viento empuja hacia la derecha en la Venus. Ayudan a sentir la profundidad.
  // Como los planos se dibujan por orden (sin prueba de profundidad), las motas se reparten en
  // franjas entre plano y plano y cada franja se dibuja en su turno.
  #motas(id, profundidades) {
    const venus = id === 'venus';
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tiempo: { value: 0 },
        color: { value: new THREE.Color(venus ? 0xffd6d0 : 0xffdf9a) },
        viento: { value: new THREE.Vector2(venus ? 0.06 : 0.012, venus ? -0.004 : 0.008) },
        ancho: { value: this.lienzo.ancho },
        tamano: { value: (venus ? 30 : 22) * Math.min(2, this.renderer.getPixelRatio()) },
      },
      vertexShader: `
        uniform float tiempo, ancho, tamano;
        uniform vec2 viento;
        attribute float semilla;
        varying float vBrillo;
        void main() {
          vec3 p = position;
          // deriva con el viento, envuelta para que las motas no se acaben nunca
          p.x = mod(p.x + viento.x * tiempo * (0.6 + semilla) + ancho, 2.0 * ancho) - ancho;
          p.y += viento.y * tiempo + sin(tiempo * (0.3 + semilla * 0.5) + semilla * 40.0) * 0.03;
          p.x += sin(tiempo * 0.5 + semilla * 17.0) * 0.02;
          vBrillo = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(tiempo * (0.7 + semilla) + semilla * 30.0), 3.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = tamano * (0.4 + semilla * 0.6) / -mv.z;
        }`,
      fragmentShader: `
        uniform vec3 color;
        varying float vBrillo;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(color * a * vBrillo * 0.55, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const n = Math.round(260 * Math.max(0.3, this.calidad.particulas));
    const franjas = profundidades.map(() => ({ pos: [], semilla: [] }));
    for (let i = 0; i < n; i++) {
      const k = 0.02 + Math.random() * 0.36; // profundidad como fracción, igual que los planos
      const s = 1 - k;
      let f = 0;
      while (f + 1 < profundidades.length && profundidades[f + 1] <= k) f++;
      franjas[f].pos.push((Math.random() - 0.5) * this.lienzo.ancho * s, (Math.random() - 0.5) * this.lienzo.alto * s, -this.L * s);
      franjas[f].semilla.push(Math.random());
    }
    return franjas.filter((f) => f.semilla.length).map((f) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(f.pos, 3));
      geo.setAttribute('semilla', new THREE.Float32BufferAttribute(f.semilla, 1));
      const puntos = new THREE.Points(geo, material);
      puntos.renderOrder = franjas.indexOf(f) + 0.5;
      puntos.frustumCulled = false;
      return puntos;
    });
  }
}
