// Paseo en primera persona con ratón y teclado: W A S D o ↑ ↓ para caminar, ← → para girar,
// Mayúsculas para ir más rápido.
//
// Si el navegador deja bloquear el ratón, se mira moviéndolo (PointerLockControls). Si no
// (algunos navegadores integrados no lo permiten) se mira arrastrando con el botón pulsado,
// y un clic sin arrastrar elige el cuadro que hay bajo el cursor.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const TECLAS = {
  KeyW: 'adelante', ArrowUp: 'adelante',
  KeyS: 'atras', ArrowDown: 'atras',
  KeyA: 'izquierda', KeyD: 'derecha',
  ArrowLeft: 'girarIzquierda', ArrowRight: 'girarDerecha',
  ShiftLeft: 'rapido', ShiftRight: 'rapido',
};

const _adelante = new THREE.Vector3();
const _derecha = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export class ControlesEscritorio extends EventTarget {
  constructor(camara, elementoBloqueo, lienzo) {
    super();
    this.camara = camara;
    this.lienzo = lienzo;
    this.puntero = new PointerLockControls(camara, elementoBloqueo);
    this.puntero.pointerSpeed = 0.8;
    this.pulsadas = new Set();
    this.activo = true;
    this.arrastre = null;
    this.puntero.addEventListener('lock', () => {
      lienzo.classList.remove('arrastrable');
      this.dispatchEvent(new Event('bloqueo'));
    });
    this.puntero.addEventListener('unlock', () => {
      lienzo.classList.add('arrastrable');
      this.dispatchEvent(new Event('desbloqueo'));
    });
    lienzo.classList.add('arrastrable');

    addEventListener('keydown', (e) => {
      if (TECLAS[e.code]) {
        this.pulsadas.add(TECLAS[e.code]);
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.pulsadas.delete(TECLAS[e.code]));
    addEventListener('blur', () => this.pulsadas.clear());

    lienzo.addEventListener('pointerdown', (e) => {
      if (this.bloqueado || e.button !== 0 || e.pointerType === 'touch') return;
      this.arrastre = { x: e.clientX, y: e.clientY, movido: 0 };
      lienzo.setPointerCapture(e.pointerId);
    });
    lienzo.addEventListener('pointermove', (e) => {
      const a = this.arrastre;
      if (!a) return;
      const dx = e.clientX - a.x;
      const dy = e.clientY - a.y;
      a.x = e.clientX;
      a.y = e.clientY;
      a.movido += Math.abs(dx) + Math.abs(dy);
      if (this.activo) this.#girar(dx * 0.0042, dy * 0.0042);
    });
    lienzo.addEventListener('pointerup', (e) => {
      const a = this.arrastre;
      this.arrastre = null;
      if (a && a.movido < 6) {
        this.dispatchEvent(new CustomEvent('clic', {
          detail: new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
        }));
      }
    });
  }

  get bloqueado() {
    return this.puntero.isLocked;
  }

  bloquear() {
    // El navegador puede rechazarlo (sin gesto, justo después de Esc o porque no lo
    // admite); entonces se sigue paseando con arrastre.
    try {
      const p = this.puntero.domElement.requestPointerLock?.();
      p?.catch?.(() => {});
    } catch {
      // sin bloqueo de ratón
    }
  }

  desbloquear() {
    if (this.bloqueado) this.puntero.unlock();
  }

  #girar(dYaw, dPitch) {
    _euler.setFromQuaternion(this.camara.quaternion);
    _euler.y -= dYaw;
    _euler.x = THREE.MathUtils.clamp(_euler.x - dPitch, -1.3, 1.3);
    this.camara.quaternion.setFromEuler(_euler);
  }

  // Devuelve el desplazamiento deseado en el plano XZ para este fotograma (y aplica los giros).
  desplazamiento(dt, salida) {
    salida.set(0, 0, 0);
    if (!this.activo) return salida;
    const p = this.pulsadas;
    const giro = (p.has('girarIzquierda') ? 1 : 0) - (p.has('girarDerecha') ? 1 : 0);
    if (giro) this.#girar(-giro * 1.7 * dt, 0);
    const avance = (p.has('adelante') ? 1 : 0) - (p.has('atras') ? 1 : 0);
    const lateral = (p.has('derecha') ? 1 : 0) - (p.has('izquierda') ? 1 : 0);
    if (!avance && !lateral) return salida;
    this.camara.getWorldDirection(_adelante);
    _adelante.y = 0;
    _adelante.normalize();
    _derecha.crossVectors(_adelante, this.camara.up).normalize();
    salida.addScaledVector(_adelante, avance).addScaledVector(_derecha, lateral).normalize();
    return salida.multiplyScalar((p.has('rapido') ? 2.6 : 1.4) * dt);
  }
}
