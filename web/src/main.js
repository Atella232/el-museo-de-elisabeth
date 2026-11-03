import * as THREE from 'three';
import '@fontsource/cinzel/600.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import './estilos.css';
import datosObras from '@datos/obras.json';
import { calidad, debug, parametro } from './calidad.js';
import { cargarMuseo } from './escena/cargarMuseo.js';
import { ReflejoSuelo } from './escena/reflejoSuelo.js';
import { capturarEntorno } from './escena/entorno.js';
import { crearHaces, CAPA_AIRE } from './escena/hacesLuz.js';
import { crearPolvo } from './escena/polvo.js';
import { crearPostproceso } from './escena/postproceso.js';
import { pintarCartelas } from './escena/cartelas.js';
import { CuadrosVivos } from './escena/vivos.js';
import { ControlesEscritorio } from './controles/escritorio.js';
import { ControlesTactiles } from './controles/tactil.js';
import { Contemplar } from './controles/contemplar.js';
import { resolverColision } from './controles/colisiones.js';
import { Portada } from './ui/portada.js';
import { Hud } from './ui/hud.js';
import { Ficha } from './ui/ficha.js';
import { Video } from './ui/video.js';
import { Ambiente } from './audio/ambiente.js';
import { Diorama } from './cuadro/diorama.js';
import { UiCuadro } from './ui/cuadro.js';

const ALTURA_OJOS = 1.65;
const RADIO_VISITANTE = 0.32;
const PASO = 0.72; // metros por paso (para el sonido y el balanceo)
const ESPERA_VIVO = 3; // segundos mirando un cuadro hasta que empieza a moverse

const BASE = import.meta.env.BASE_URL;
const obras = Object.fromEntries(datosObras.map((o) => [o.id, o]));
const ui = document.querySelector('#ui');
const lienzo = document.querySelector('#lienzo');
const camFija = parametro('cam'); // modo de captura: cámara fija, sin interfaz
const movil = calidad.movil;

const portada = camFija ? null : new Portada(ui, { movil });

// --- Render
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: !calidad.postproceso, powerPreference: 'high-performance' });
renderer.setPixelRatio(calidad.pixelRatio);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false; // con postproceso hay varias pasadas por fotograma

const escena3d = new THREE.Scene();
escena3d.background = new THREE.Color(0x000000);
const camara = new THREE.PerspectiveCamera(movil ? 70 : 62, 1, 0.05, 80);
camara.layers.enable(CAPA_AIRE);

const { modelo, escena, mallasPorGrupo, texturasObras } = await cargarMuseo({
  renderer,
  calidad,
  alProgreso: (f) => portada?.progreso(f * 0.92),
});
escena3d.add(modelo);
await pintarCartelas(modelo, escena, obras, renderer);
const vivos = new CuadrosVivos(modelo, obras, { calidad });
const listaMusica = await fetch(`${BASE}musica/lista.json`).then((r) => (r.ok ? r.json() : []), () => []);
const medio = (escena.limites.zmin + escena.limites.zmax) / 2;
capturarEntorno(renderer, escena3d, new THREE.Vector3(0, 2.2, medio), { intensidad: 1.25 });

escena3d.add(crearHaces(escena.focos));
const polvo = calidad.particulas > 0 ? crearPolvo(escena.focos, { porFoco: Math.round(220 * calidad.particulas), pixelRatio: calidad.pixelRatio }) : null;
if (polvo) escena3d.add(polvo);

const reflejo = calidad.reflejo > 0 && mallasPorGrupo.suelo
  ? new ReflejoSuelo(renderer, mallasPorGrupo.suelo, { resolucion: calidad.reflejo })
  : null;
const post = calidad.postproceso ? crearPostproceso(renderer, escena3d, camara) : null;

// --- Cámara inicial
const fija = escena.camaras?.[camFija];
if (fija) {
  camara.position.fromArray(fija.posicion);
  camara.lookAt(new THREE.Vector3().fromArray(fija.mira));
  camara.fov = fija.fov ?? camara.fov;
} else {
  camara.position.fromArray(escena.inicio.posicion);
  camara.position.y = ALTURA_OJOS;
  camara.rotation.set(-0.04, escena.inicio.yaw ?? 0, 0, 'YXZ');
}

// --- Interfaz y controles
const hud = new Hud(ui, { movil, debug });
const ficha = new Ficha(ui);
const video = new Video(ui);
const ambiente = new Ambiente();
const diorama = new Diorama(renderer, { calidad });
const uiCuadro = new UiCuadro(ui, { movil });

// Fundido entre el museo y el diorama: se congela el último fotograma de uno en un lienzo 2D
// encima y se desvanece sobre el otro. Así la luz de los focos, el bloom y la viñeta del museo
// no cambian de golpe al pasar a la pintura (que dentro se ve sin la luz de la sala).
const fundido = document.createElement('canvas');
fundido.className = 'fundido';
lienzo.after(fundido);
let capturaPendiente = null;
const congelar = () => new Promise((resolver) => { capturaPendiente = resolver; });
function desvanecer() {
  requestAnimationFrame(() => requestAnimationFrame(() => fundido.classList.remove('visible')));
}
const contemplar = new Contemplar(camara, escena.obras);
const escritorio = movil ? null : new ControlesEscritorio(camara, document.body, lienzo);
const tactil = movil ? new ControlesTactiles(camara, lienzo, ui) : null;
tactil?.mostrar(false);
if (camFija) hud.el.hidden = true;

let estado = 'portada'; // portada · paseo · pausa · transicion · contemplar · cuadro
let obraActual = null;
let apuntada = null;

function entrarEnPaseo() {
  estado = 'paseo';
  hud.mostrarPausa(false);
  hud.paseo(true);
  tactil?.mostrar(true);
  if (tactil) tactil.activo = true;
  if (escritorio) {
    escritorio.puntero.enabled = true;
    escritorio.activo = true;
  }
}

async function abrirObra(obra) {
  if (!obra || estado !== 'paseo') return;
  estado = 'transicion';
  obraActual = obra;
  hud.paseo(false);
  tactil?.mostrar(false);
  if (tactil) tactil.activo = false;
  if (escritorio) {
    escritorio.puntero.enabled = false;
    escritorio.activo = false; // arrastrar ya no gira la cámara
    escritorio.desbloquear();
  }
  ficha.mostrar(obras[obra.id]);
  vivos.enfocar(obra.id, ESPERA_VIVO);
  await contemplar.acercarse(obra, opcionesFicha());
  estado = 'contemplar';
}

function opcionesFicha() {
  const lado = innerWidth > 800 ? 'derecha' : 'abajo';
  return { lado, hueco: lado === 'derecha' ? Math.min(440, innerWidth * 0.36) / innerWidth : 0.56 };
}

// Entrar en el cuadro: la cámara del museo se acerca hasta que el lienzo llena la pantalla y,
// desde ese mismo punto, se pasa al diorama.
async function entrarEnCuadro() {
  const o = obras[obraActual?.id];
  if (estado !== 'contemplar' || !o?.diorama) return;
  estado = 'transicion';
  ficha.cargando(true);
  const textura = texturasObras[o.id];
  const alto = o.medidas.alto / 100;
  const ancho = alto * (textura.image.width / textura.image.height);
  const pose = contemplar.poseLienzo(obraActual, ancho, alto);
  try {
    await diorama.cargar(o.id);
  } catch (e) {
    console.error(e);
    ficha.cargando(false);
    estado = 'contemplar';
    return;
  }
  ficha.ocultar();
  vivos.enfocar(null);
  await contemplar.ir(pose, 1.4);
  await congelar();
  await diorama.preparar(o.id, { ancho, alto, distancia: pose.dist, fov: camara.fov, aspecto: camara.aspect, cuadroPlano: textura });
  desvanecer();
  estado = 'cuadro';
  uiCuadro.mostrar(o);
  ambiente.paisaje(o.id === 'venus' ? 'mar' : 'viento');
  ambiente.atenuarMusica(0.6);
  await diorama.entrar();
}

async function salirDelCuadro() {
  if (estado !== 'cuadro') return;
  estado = 'transicion';
  uiCuadro.ocultar();
  ambiente.paisaje(null);
  ambiente.atenuarMusica(1);
  await diorama.salir();
  await congelar();
  diorama.cerrar();
  desvanecer();
  ficha.mostrar(obras[obraActual.id]);
  await contemplar.ir(contemplar.poseFrente(obraActual, opcionesFicha()), 1.2);
  estado = 'contemplar';
}

async function volverAlPaseo({ gesto = false } = {}) {
  if (estado !== 'contemplar') return;
  estado = 'transicion';
  ficha.ocultar();
  vivos.enfocar(null);
  if (video.abierto) video.cerrar();
  if (escritorio && gesto) escritorio.bloquear();
  await contemplar.volver();
  obraActual = null;
  // Si se volvió con Esc, el navegador no deja recuperar la captura del ratón (Esc no cuenta
  // como gesto del visitante): se muestra la pausa y un clic la recupera.
  if (escritorio?.capturaPosible && !escritorio.bloqueado) {
    estado = 'pausa';
    hud.mostrarPausa(true);
  } else {
    entrarEnPaseo();
  }
}

ficha.addEventListener('volver', () => volverAlPaseo({ gesto: true }));
ficha.addEventListener('entrar', () => entrarEnCuadro());
uiCuadro.addEventListener('salir', () => salirDelCuadro());
ficha.addEventListener('video', () => {
  const o = obras[obraActual?.id];
  if (!o?.youtubeId) return;
  ambiente.atenuarMusica(0);
  video.abrir(o.youtubeId, o.titulo);
});
video.addEventListener('cerrado', () => ambiente.atenuarMusica(1));
hud.addEventListener('sonido', () => hud.sonido(ambiente.alternarSilencio()));
hud.addEventListener('continuar', () => {
  escritorio?.bloquear();
  entrarEnPaseo();
});

escritorio?.addEventListener('desbloqueo', () => {
  if (estado === 'paseo') {
    estado = 'pausa';
    hud.paseo(false);
    hud.mostrarPausa(true);
  }
});
escritorio?.addEventListener('bloqueo', () => {
  if (estado === 'pausa') entrarEnPaseo();
});
escritorio?.addEventListener('clic', (e) => {
  if (estado === 'paseo') abrirObra(contemplar.apuntada(e.detail));
});
document.addEventListener('mousedown', (e) => {
  if (estado === 'paseo' && escritorio?.bloqueado && e.button === 0) abrirObra(contemplar.apuntada());
});
addEventListener('keydown', (e) => {
  // E abre el cuadro al que se mira y, con la ficha abierta, vuelve al pasillo recuperando la
  // captura del ratón (una tecla normal sí cuenta como gesto del visitante, Esc no).
  if (e.code === 'KeyE' && !e.repeat) {
    if (estado === 'paseo') abrirObra(contemplar.apuntada());
    else if (estado === 'contemplar') volverAlPaseo({ gesto: true });
  }
  if (e.code === 'Escape') {
    if (video.abierto) video.cerrar();
    else if (estado === 'cuadro') salirDelCuadro();
    else if (estado === 'contemplar') volverAlPaseo();
  }
});
tactil?.addEventListener('toque', (e) => {
  if (estado === 'paseo') abrirObra(contemplar.apuntada(e.detail));
});

// --- Tamaño
function ajustar() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h, false);
  lienzo.style.width = `${w}px`;
  lienzo.style.height = `${h}px`;
  contemplar.aplicarVista(w, h);
  diorama.ajustarTamano(w, h);
  reflejo?.ajustarTamano(w, h);
  post?.ajustarTamano(w, h);
}
addEventListener('resize', ajustar);
ajustar();

// --- Bucle
const reloj = new THREE.Timer();
const paso = new THREE.Vector3();
const antes = new THREE.Vector3();
let fasePaso = 0;
let fpsMarcos = 0;
let fpsTiempo = 0;

renderer.setAnimationLoop((ahora) => {
  reloj.update(ahora);
  const dt = Math.min(reloj.getDelta(), 0.1);
  const t = reloj.getElapsed();
  renderer.info.reset();
  if (contemplar.activo) {
    contemplar.actualizar(dt);
    contemplar.aplicarVista(innerWidth, innerHeight);
  }

  if (estado === 'paseo') {
    (escritorio ?? tactil).desplazamiento(dt, paso);
    antes.copy(camara.position);
    if (paso.lengthSq() > 0) {
      camara.position.add(paso);
      resolverColision(camara.position, RADIO_VISITANTE, escena);
      const recorrido = Math.hypot(camara.position.x - antes.x, camara.position.z - antes.z);
      const anterior = Math.floor(fasePaso / Math.PI);
      fasePaso += (recorrido / PASO) * Math.PI;
      if (Math.floor(fasePaso / Math.PI) !== anterior) ambiente.paso(paso.length() / dt > 2 ? 1.2 : 0.9);
      camara.position.y = ALTURA_OJOS + Math.abs(Math.sin(fasePaso)) * 0.022 - 0.011;
    } else {
      camara.position.y += (ALTURA_OJOS - camara.position.y) * Math.min(1, dt * 6);
    }
    if (!movil) {
      const o = contemplar.apuntada();
      if (o?.id !== apuntada?.id) {
        hud.apuntando(o ? obras[o.id] : null);
        // Si se queda mirando un cuadro vivo, al rato empieza a moverse; si deja de mirarlo, se para.
        vivos.enfocar(o?.id ?? null, ESPERA_VIVO);
      }
      apuntada = o;
    }
  }

  vivos.actualizar(dt);
  if (diorama.activo) {
    diorama.actualizar(dt);
    diorama.render();
  } else {
    polvo?.actualizar(t);
    reflejo?.actualizar(escena3d, camara);
    if (post) post.render(t);
    else renderer.render(escena3d, camara);
  }
  if (capturaPendiente) {
    // En el mismo fotograma en que se ha dibujado: después el navegador vacía el lienzo WebGL.
    fundido.width = renderer.domElement.width;
    fundido.height = renderer.domElement.height;
    fundido.getContext('2d').drawImage(renderer.domElement, 0, 0);
    fundido.classList.add('visible');
    capturaPendiente();
    capturaPendiente = null;
  }

  if (debug) {
    fpsMarcos++;
    fpsTiempo += dt;
    if (fpsTiempo > 0.5) {
      const i = renderer.info.render;
      const p = camara.position;
      hud.datos(`${Math.round(fpsMarcos / fpsTiempo)} fps · ${i.calls} llamadas · ${(i.triangles / 1000).toFixed(0)}k triángulos\n` +
        `calidad ${calidad.nivel} · pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} · ${estado}`);
      fpsMarcos = 0;
      fpsTiempo = 0;
    }
  }
});

// --- Entrada
if (portada) {
  await portada.lista();
  ambiente.iniciar();
  ambiente.alEmpezarPieza = (pieza) => hud.musica(pieza);
  ambiente.iniciarMusica(listaMusica, BASE);
  escritorio?.bloquear();
  portada.ocultar();
  entrarEnPaseo();
}

if (debug) {
  window.__museo = {
    THREE, renderer, escena3d, camara, escena, contemplar, video, obras, ambiente, diorama, vivos,
    estado: () => estado,
    contemplarObra: (id) => {
      estado = 'paseo';
      return abrirObra(contemplar.porId[id]);
    },
    volver: () => volverAlPaseo(),
    entrarEnCuadro: () => entrarEnCuadro(),
    salirDelCuadro: () => salirDelCuadro(),
    ir: (x, z, yaw = 0) => {
      camara.position.set(x, ALTURA_OJOS, z);
      camara.rotation.set(0, yaw, 0, 'YXZ');
    },
  };
}
