// Mirar un cuadro: detectar a qué obra apunta el visitante y llevar la cámara hasta
// quedar de frente a ella, dejando sitio a la ficha (a la derecha o abajo).
// Las esculturas exentas se pueden apuntar desde cualquier lado y, al contemplarlas, se
// rodean arrastrando: la cámara gira alrededor de su eje.
import * as THREE from 'three';

const _rayo = new THREE.Raycaster();
const _centro = new THREE.Vector2();
const _arriba = new THREE.Vector3(0, 1, 0);
const _caja = new THREE.Box3();
const ELEVACION = [-0.12, 0.55]; // radianes: un poco desde abajo hasta bastante desde arriba
const MARGEN_PARED = 0.35;

export class Contemplar {
  // `modelo`: la sala cargada, para medir las esculturas exentas; `limites`: la nave, para que
  // al rodearlas la cámara no atraviese las paredes; `obstaculos`: las peanas, para que al
  // retroceder ante una obra de pared la cámara no se meta en la escultura que tenga delante.
  constructor(camara, obras, { alcance = 5.5, modelo = null, limites = null, obstaculos = [] } = {}) {
    this.camara = camara;
    this.alcance = alcance;
    this.limites = limites;
    this.obstaculos = obstaculos;
    this.zonas = new THREE.Group();
    this.porId = {};
    for (const o of obras) {
      const centro = new THREE.Vector3().fromArray(o.centro);
      const normal = new THREE.Vector3().fromArray(o.normal);
      const malla = o.exenta && modelo?.getObjectByName(`escultura_${o.id}`);
      if (malla) {
        // Un cilindro invisible alrededor de la escultura, de la peana hasta lo más alto.
        _caja.setFromObject(malla);
        const eje = _caja.getCenter(new THREE.Vector3());
        const radio = Math.max(_caja.max.x - _caja.min.x, _caja.max.z - _caja.min.z) / 2;
        const zona = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, _caja.max.y, 16), new THREE.MeshBasicMaterial({ visible: false }));
        zona.position.set(eje.x, _caja.max.y / 2, eje.z);
        zona.userData.obra = o;
        this.zonas.add(zona);
        this.porId[o.id] = { ...o, centroV: centro, normalV: normal, eje: new THREE.Vector3(eje.x, _caja.max.y / 2, eje.z), radio, altoTotal: _caja.max.y };
        continue;
      }
      const plano = new THREE.Mesh(new THREE.PlaneGeometry(o.ancho, o.alto), new THREE.MeshBasicMaterial({ visible: false }));
      plano.position.copy(centro).addScaledVector(normal, 0.05);
      plano.lookAt(plano.position.clone().add(normal));
      plano.userData.obra = o;
      this.zonas.add(plano);
      this.porId[o.id] = { ...o, centroV: centro, normalV: normal };
    }
    // Ángulos de la cámara alrededor de la escultura que se contempla.
    this.orbita = { azimut: 0, elevacion: 0.1 };
    // Las zonas no están en la escena: hay que calcular sus matrices a mano para el raycast.
    this.zonas.updateMatrixWorld(true);
    this.animacion = null;
    this.guardada = null;
    // Desplazamiento del encuadre para dejar sitio a la ficha sin girar la cámara:
    // fracción de pantalla ocupada (0 = sin ficha) y lado donde está la ficha.
    this.hueco = 0;
    this.lado = 'derecha';
    this.fovBase = camara.fov;
  }

  // Ajusta la proyección: con ficha abierta, el eje óptico (el centro del cuadro) cae en
  // el centro del espacio libre gracias a setViewOffset, sin girar la cámara.
  aplicarVista(w, h) {
    const cam = this.camara;
    const f = this.hueco;
    if (f < 1e-4) {
      cam.clearViewOffset();
      cam.aspect = w / h;
      cam.fov = this.fovBase;
    } else if (this.lado === 'derecha') {
      cam.fov = this.fovBase;
      cam.aspect = (w * (1 + f)) / h;
      cam.setViewOffset(w * (1 + f), h, w * f, 0, w, h);
    } else {
      const t = Math.tan(THREE.MathUtils.degToRad(this.fovBase / 2)) * (1 + f);
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t));
      cam.aspect = w / (h * (1 + f));
      cam.setViewOffset(w, h * (1 + f), 0, h * f, w, h);
    }
    cam.updateProjectionMatrix();
  }

  // Obra a la que se apunta: desde el centro de la pantalla o desde un punto (NDC) tocado.
  apuntada(ndc = _centro) {
    _rayo.setFromCamera(ndc, this.camara);
    _rayo.far = this.alcance;
    const [hit] = _rayo.intersectObjects(this.zonas.children, false);
    if (!hit) return null;
    const o = this.porId[hit.object.userData.obra.id];
    return o.eje || _rayo.ray.direction.dot(o.normalV) < -0.25 ? o : null;
  }

  // Pose de cámara de frente a la obra, a la distancia que la encuadra en el espacio que
  // deja libre la ficha (que ocupa la fracción `hueco` de la pantalla por `lado`).
  // `margen`: cuánto del espacio libre ocupa el cuadro por su lado más justo.
  poseFrente(obra, { lado = 'derecha', hueco = 0.36, margen = 0.78 } = {}) {
    const vfov = THREE.MathUtils.degToRad(this.fovBase);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.#aspecto());
    const libreAncho = lado === 'derecha' ? 1 - hueco : 1;
    const libreAlto = lado === 'abajo' ? 1 - hueco : 1;
    if (obra.eje) return this.#poseOrbita(obra, vfov, hfov, libreAncho, libreAlto, margen, hueco, lado);
    const dAlto = (obra.alto / (margen * libreAlto)) / 2 / Math.tan(vfov / 2);
    const dAncho = (obra.ancho / (margen * libreAncho)) / 2 / Math.tan(hfov / 2);
    const dist = THREE.MathUtils.clamp(Math.min(Math.max(dAlto, dAncho), this.#hastaUnObstaculo(obra.centroV, obra.normalV)), 0.9, 6.0);
    const pos = obra.centroV.clone().addScaledVector(obra.normalV, dist);
    pos.y = Math.max(1.2, Math.min(pos.y, 2.6));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, obra.centroV, _arriba));
    return { pos, q, hueco, lado };
  }

  // Escultura exenta: la cámara, a la distancia que la encuadra entera (con la peana), en la
  // dirección `azimut` desde su eje y mirando a su centro, un poco desde arriba o desde abajo
  // según `elevacion`. Si la pared queda más cerca, se acerca lo que haga falta.
  #poseOrbita(obra, vfov, hfov, libreAncho, libreAlto, margen, hueco, lado) {
    const { azimut, elevacion } = this.orbita;
    const dAlto = ((obra.altoTotal + 0.15) / (margen * libreAlto)) / 2 / Math.tan(vfov / 2);
    const dAncho = ((2 * obra.radio + 0.3) / (margen * libreAncho)) / 2 / Math.tan(hfov / 2);
    const dir = new THREE.Vector3(Math.sin(azimut) * Math.cos(elevacion), Math.sin(elevacion), Math.cos(azimut) * Math.cos(elevacion));
    // Lo más cercano de la escultura está a `radio` del eje: se retrocede algo más para que quepa.
    const dist = this.#hastaLaPared(obra.eje, dir, THREE.MathUtils.clamp(Math.max(dAlto, dAncho) + obra.radio * 0.5, obra.radio + 0.6, 7.0), MARGEN_PARED);
    const pos = obra.eje.clone().addScaledVector(dir, dist);
    pos.y = Math.max(0.9, pos.y);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, obra.eje, _arriba));
    return { pos, q, hueco, lado };
  }

  // Cuánto se puede retroceder en planta desde `desde` en la dirección `dir` antes de entrar en un
  // obstáculo (una peana y su margen). Los que ya contienen el punto de partida (la peana de la
  // propia obra) no cuentan.
  #hastaUnObstaculo(desde, dir) {
    let t = Infinity;
    for (const [x0, z0, x1, z1] of this.obstaculos) {
      if (desde.x > x0 && desde.x < x1 && desde.z > z0 && desde.z < z1) continue;
      let entra = -Infinity;
      let sale = Infinity;
      for (const [o, d, a, b] of [[desde.x, dir.x, x0, x1], [desde.z, dir.z, z0, z1]]) {
        if (Math.abs(d) < 1e-6) {
          if (o <= a || o >= b) entra = Infinity;
          continue;
        }
        const t0 = (a - o) / d;
        const t1 = (b - o) / d;
        entra = Math.max(entra, Math.min(t0, t1));
        sale = Math.min(sale, Math.max(t0, t1));
      }
      if (entra < sale && entra > 0) t = Math.min(t, entra - 0.15);
    }
    return t;
  }

  // La distancia `dist` desde `desde` en la dirección `dir`, recortada para no pasar de las paredes.
  #hastaLaPared(desde, dir, dist, margen) {
    const l = this.limites;
    if (!l) return dist;
    for (const [eje, min, max] of [['x', l.xmin, l.xmax], ['z', l.zmin, l.zmax]]) {
      if (Math.abs(dir[eje]) < 1e-4) continue;
      dist = Math.min(dist, ((dir[eje] > 0 ? max - margen : min + margen) - desde[eje]) / dir[eje]);
    }
    return dist;
  }

  // Arrastrar mientras se contempla una escultura exenta: `dx`, `dy` en fracciones de la pantalla.
  orbitar(obra, dx, dy, opciones) {
    if (!obra?.eje) return;
    this.orbita.azimut -= dx * Math.PI * 1.4;
    this.orbita.elevacion = THREE.MathUtils.clamp(this.orbita.elevacion + dy * 1.6, ...ELEVACION);
    const pose = this.poseFrente(obra, opciones);
    this.camara.position.copy(pose.pos);
    this.camara.quaternion.copy(pose.q);
  }

  // Pose con el lienzo entero a la vista (sin recortarlo, con un poco de aire alrededor) y sin
  // ficha: es el punto desde el que se entra en el cuadro. Devuelve también la distancia.
  poseLienzo(obra, ancho, alto) {
    const vfov = THREE.MathUtils.degToRad(this.fovBase);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.#aspecto());
    const dist = Math.max(alto / 2 / Math.tan(vfov / 2), ancho / 2 / Math.tan(hfov / 2)) * 1.04;
    const pos = obra.centroV.clone().addScaledVector(obra.normalV, dist);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, obra.centroV, _arriba));
    return { pos, q, hueco: 0, dist };
  }

  // Proporción de la ventana; si en un instante mide cero (al cambiar de tamaño o estar oculta),
  // la última buena, para no dividir cero entre cero.
  #aspecto() {
    if (innerWidth > 0 && innerHeight > 0) this.ultimoAspecto = innerWidth / innerHeight;
    return this.ultimoAspecto ?? 16 / 9;
  }

  ir(destino, duracion = 1.1) {
    if (destino.lado) this.lado = destino.lado;
    return new Promise((resolver) => {
      this.animacion = {
        desdePos: this.camara.position.clone(),
        desdeQ: this.camara.quaternion.clone(),
        aPos: destino.pos,
        aQ: destino.q,
        desdeHueco: this.hueco,
        aHueco: destino.hueco ?? 0,
        t: 0,
        duracion,
        resolver,
      };
    });
  }

  acercarse(obra, opciones) {
    this.guardada = { pos: this.camara.position.clone(), q: this.camara.quaternion.clone(), hueco: 0 };
    // A una escultura se la mira desde donde se está: la cámara se acerca en línea recta y luego
    // se puede rodear.
    this.exenta = obra.eje ? obra : null;
    if (obra.eje) {
      const desde = this.camara.position.clone().sub(obra.eje);
      this.orbita = { azimut: Math.atan2(desde.x, desde.z), elevacion: 0.1 };
    }
    const pose = this.poseFrente(obra, opciones);
    this.lado = pose.lado;
    return this.ir(pose);
  }

  volver() {
    const g = this.guardada;
    const o = this.exenta;
    this.guardada = null;
    this.exenta = null;
    if (g && o) {
      // Después de rodear una escultura no se vuelve en línea recta al punto de partida, que
      // podría quedar al otro lado (se la atravesaría): se retrocede desde donde se la mira,
      // a la distancia a la que se estaba, a la altura de los ojos y mirándola.
      const dir = new THREE.Vector3(Math.sin(this.orbita.azimut), 0, Math.cos(this.orbita.azimut));
      const antes = Math.hypot(g.pos.x - o.eje.x, g.pos.z - o.eje.z);
      const pos = o.eje.clone().addScaledVector(dir, this.#hastaLaPared(o.eje, dir, Math.max(antes, o.radio + 1.2), 0.5));
      pos.y = g.pos.y;
      const mira = new THREE.Vector3(o.eje.x, g.pos.y - 0.25, o.eje.z);
      g.pos = pos;
      g.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, mira, _arriba));
    }
    return g ? this.ir(g, 0.9) : Promise.resolve();
  }

  get activo() {
    return !!this.animacion;
  }

  actualizar(dt) {
    const a = this.animacion;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.duracion);
    const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
    this.camara.position.lerpVectors(a.desdePos, a.aPos, k);
    this.camara.quaternion.slerpQuaternions(a.desdeQ, a.aQ, k);
    this.hueco = a.desdeHueco + (a.aHueco - a.desdeHueco) * k;
    if (a.t >= 1) {
      this.animacion = null;
      a.resolver();
    }
  }
}
