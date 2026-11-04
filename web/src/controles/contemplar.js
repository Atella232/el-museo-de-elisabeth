// Mirar un cuadro: detectar a qué obra apunta el visitante y llevar la cámara hasta
// quedar de frente a ella, dejando sitio a la ficha (a la derecha o abajo).
import * as THREE from 'three';

const _rayo = new THREE.Raycaster();
const _centro = new THREE.Vector2();
const _arriba = new THREE.Vector3(0, 1, 0);

export class Contemplar {
  constructor(camara, obras, { alcance = 5.5 } = {}) {
    this.camara = camara;
    this.alcance = alcance;
    this.zonas = new THREE.Group();
    this.porId = {};
    for (const o of obras) {
      const plano = new THREE.Mesh(new THREE.PlaneGeometry(o.ancho, o.alto), new THREE.MeshBasicMaterial({ visible: false }));
      const centro = new THREE.Vector3().fromArray(o.centro);
      const normal = new THREE.Vector3().fromArray(o.normal);
      plano.position.copy(centro).addScaledVector(normal, 0.05);
      plano.lookAt(plano.position.clone().add(normal));
      plano.userData.obra = o;
      this.zonas.add(plano);
      this.porId[o.id] = { ...o, centroV: centro, normalV: normal };
    }
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
    return _rayo.ray.direction.dot(o.normalV) < -0.25 ? o : null;
  }

  // Pose de cámara de frente a la obra, a la distancia que la encuadra en el espacio que
  // deja libre la ficha (que ocupa la fracción `hueco` de la pantalla por `lado`).
  // `margen`: cuánto del espacio libre ocupa el cuadro por su lado más justo.
  poseFrente(obra, { lado = 'derecha', hueco = 0.36, margen = 0.78 } = {}) {
    const vfov = THREE.MathUtils.degToRad(this.fovBase);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.#aspecto());
    const libreAncho = lado === 'derecha' ? 1 - hueco : 1;
    const libreAlto = lado === 'abajo' ? 1 - hueco : 1;
    const dAlto = (obra.alto / (margen * libreAlto)) / 2 / Math.tan(vfov / 2);
    const dAncho = (obra.ancho / (margen * libreAncho)) / 2 / Math.tan(hfov / 2);
    const dist = THREE.MathUtils.clamp(Math.max(dAlto, dAncho), 0.9, 6.0);
    const pos = obra.centroV.clone().addScaledVector(obra.normalV, dist);
    pos.y = Math.max(1.2, Math.min(pos.y, 2.6));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, obra.centroV, _arriba));
    return { pos, q, hueco, lado };
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
    const pose = this.poseFrente(obra, opciones);
    this.lado = pose.lado;
    return this.ir(pose);
  }

  volver() {
    const g = this.guardada;
    this.guardada = null;
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
