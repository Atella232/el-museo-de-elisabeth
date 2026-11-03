// Controles táctiles: joystick virtual abajo a la izquierda para caminar, arrastrar en el
// resto de la pantalla para mirar y un toque corto para elegir un cuadro.
import * as THREE from 'three';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _adelante = new THREE.Vector3();
const _derecha = new THREE.Vector3();

export class ControlesTactiles extends EventTarget {
  constructor(camara, elemento, contenedor) {
    super();
    this.camara = camara;
    this.activo = true;
    this.joy = { id: null, x: 0, y: 0, cx: 0, cy: 0 };
    this.mirar = { id: null, x: 0, y: 0, t: 0, movido: 0 };

    this.base = document.createElement('div');
    this.base.className = 'joystick';
    this.base.innerHTML = '<div class="joystick-mando"></div>';
    contenedor.append(this.base);
    this.mando = this.base.firstElementChild;

    elemento.addEventListener('touchstart', (e) => this.#inicio(e), { passive: false });
    elemento.addEventListener('touchmove', (e) => this.#mover(e), { passive: false });
    elemento.addEventListener('touchend', (e) => this.#fin(e));
    elemento.addEventListener('touchcancel', (e) => this.#fin(e));
  }

  mostrar(visible) {
    this.base.hidden = !visible;
  }

  #inicio(e) {
    if (!this.activo) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const zonaJoy = t.clientX < innerWidth * 0.4 && t.clientY > innerHeight * 0.45;
      if (zonaJoy && this.joy.id === null) {
        Object.assign(this.joy, { id: t.identifier, cx: t.clientX, cy: t.clientY, x: 0, y: 0 });
        this.base.style.left = `${t.clientX - 60}px`;
        this.base.style.top = `${t.clientY - 60}px`;
        this.base.classList.add('activo');
      } else if (this.mirar.id === null) {
        Object.assign(this.mirar, { id: t.identifier, x: t.clientX, y: t.clientY, t: performance.now(), movido: 0 });
      }
    }
  }

  #mover(e) {
    if (!this.activo) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joy.id) {
        const dx = t.clientX - this.joy.cx;
        const dy = t.clientY - this.joy.cy;
        const largo = Math.min(50, Math.hypot(dx, dy));
        const ang = Math.atan2(dy, dx);
        this.joy.x = (Math.cos(ang) * largo) / 50;
        this.joy.y = (Math.sin(ang) * largo) / 50;
        this.mando.style.transform = `translate(${this.joy.x * 50}px, ${this.joy.y * 50}px)`;
      } else if (t.identifier === this.mirar.id) {
        const dx = t.clientX - this.mirar.x;
        const dy = t.clientY - this.mirar.y;
        this.mirar.x = t.clientX;
        this.mirar.y = t.clientY;
        this.mirar.movido += Math.abs(dx) + Math.abs(dy);
        _euler.setFromQuaternion(this.camara.quaternion);
        _euler.y += dx * 0.0045;
        _euler.x = THREE.MathUtils.clamp(_euler.x + dy * 0.0045, -1.3, 1.3);
        this.camara.quaternion.setFromEuler(_euler);
      }
    }
  }

  #fin(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.joy.id) {
        Object.assign(this.joy, { id: null, x: 0, y: 0 });
        this.mando.style.transform = '';
        this.base.classList.remove('activo');
        this.base.style.left = this.base.style.top = '';
      } else if (t.identifier === this.mirar.id) {
        const toque = this.mirar.movido < 12 && performance.now() - this.mirar.t < 350;
        this.mirar.id = null;
        if (toque && this.activo) {
          this.dispatchEvent(new CustomEvent('toque', {
            detail: new THREE.Vector2((t.clientX / innerWidth) * 2 - 1, -(t.clientY / innerHeight) * 2 + 1),
          }));
        }
      }
    }
  }

  desplazamiento(dt, salida) {
    salida.set(0, 0, 0);
    if (!this.activo || (!this.joy.x && !this.joy.y)) return salida;
    this.camara.getWorldDirection(_adelante);
    _adelante.y = 0;
    _adelante.normalize();
    _derecha.crossVectors(_adelante, this.camara.up).normalize();
    salida.addScaledVector(_adelante, -this.joy.y).addScaledVector(_derecha, this.joy.x);
    return salida.multiplyScalar(1.6 * dt);
  }
}
