import * as THREE from 'three';
import '@fontsource/cinzel/600.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import './estilos.css';
import datosObras from '@datos/obras.json';
import datosSalas from '@datos/salas.json';
import { calidad, debug, parametro } from './calidad.js';
import { cargarSala, salaDisponible, precargarSala } from './escena/cargarSala.js';
import { pintarPanel } from './escena/panel.js';
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
import { resolverColision, pasoPisado } from './controles/colisiones.js';
import { Portada } from './ui/portada.js';
import { Hud } from './ui/hud.js';
import { Ficha } from './ui/ficha.js';
import { Video } from './ui/video.js';
import { Transicion, ROMANOS } from './ui/transicion.js';
import { IndiceSalas } from './ui/salas.js';
import { Ambiente } from './audio/ambiente.js';
import { Diorama } from './cuadro/diorama.js';
import { UiCuadro } from './ui/cuadro.js';
import { VisitaGuiada } from './cuadro/visita.js';
import {
  pantallaCompletaPosible, comoAplicacion, enPantallaCompleta, alternarPantallaCompleta, alCambiarPantallaCompleta,
} from './ui/pantallaCompleta.js';

const ALTURA_OJOS = 1.65;
const RADIO_VISITANTE = 0.32;
const PASO = 0.72; // metros por paso (para el sonido y el balanceo)
const ESPERA_VIVO = 3; // segundos mirando un cuadro hasta que empieza a moverse

const BASE = import.meta.env.BASE_URL;
const obras = Object.fromEntries(datosObras.map((o) => [o.id, o]));
const salas = Object.fromEntries(datosSalas.salas.map((s) => [s.id, s]));
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

// --- Salas: solo hay una cargada a la vez. `sala` guarda todo lo suyo (modelo, escena exportada
// de Blender, cuadros vivos, reflejo, haces, polvo, zonas para contemplar) para soltarlo al salir.
let sala = null;
const post = calidad.postproceso ? crearPostproceso(renderer, escena3d, camara) : null;

async function montarSala(id, { desde = null, porAscensor = false, alProgreso } = {}) {
  const s = await cargarSala(id, { renderer, calidad, alProgreso });
  escena3d.add(s.modelo);
  await pintarCartelas(s.modelo, s.escena, obras, renderer);
  await pintarPanel(s.modelo, salas[id], datosSalas, renderer);
  s.vivos = new CuadrosVivos(s.modelo, obras, { calidad });
  const medio = (s.escena.limites.zmin + s.escena.limites.zmax) / 2;
  s.entorno = capturarEntorno(renderer, escena3d, new THREE.Vector3(0, 2.2, medio), { intensidad: 1.25 });
  s.haces = crearHaces(s.escena.focos);
  escena3d.add(s.haces);
  s.polvo = calidad.particulas > 0 ? crearPolvo(s.escena.focos, { porFoco: Math.round(220 * calidad.particulas), pixelRatio: calidad.pixelRatio }) : null;
  if (s.polvo) escena3d.add(s.polvo);
  s.reflejo = calidad.reflejo > 0 && s.mallasPorGrupo.suelo
    ? new ReflejoSuelo(renderer, s.mallasPorGrupo.suelo, { resolucion: calidad.reflejo })
    : null;
  s.contemplar = new Contemplar(camara, s.escena.obras, { modelo: s.modelo, limites: s.escena.limites, obstaculos: s.escena.obstaculos });
  s.contemplar.aplicarVista(innerWidth, innerHeight);
  s.reflejo?.ajustarTamano(innerWidth, innerHeight);
  sala = s;

  // Se llega por la puerta que viene de la sala anterior, delante del ascensor si se ha subido en
  // él o, si se salta desde el índice, por la entrada de la sala.
  const fija = s.escena.camaras?.[camFija];
  if (fija) {
    camara.position.fromArray(fija.posicion);
    camara.lookAt(new THREE.Vector3().fromArray(fija.mira));
    camara.fov = fija.fov ?? camara.fov;
  } else {
    const llegada = (porAscensor && s.escena.ascensor?.llegada)
      || (desde && s.escena.pasos?.find((p) => p.destino === desde)?.llegada) || s.escena.inicio;
    camara.position.fromArray(llegada.posicion);
    camara.position.y = ALTURA_OJOS;
    camara.rotation.set(-0.04, llegada.yaw ?? 0, 0, 'YXZ');
  }
  const url = new URL(location.href);
  url.searchParams.set('sala', id);
  history.replaceState(null, '', url);

  // En el ordenador, la sala siguiente se va descargando en segundo plano (solo a la caché).
  const siguiente = s.escena.pasos?.find((p) => salas[p.destino]?.numero > salas[id].numero)?.destino;
  if (siguiente && !movil && !navigator.connection?.saveData) {
    setTimeout(() => {
      if (sala === s) salaDisponible(siguiente).then((si) => si && sala === s && precargarSala(siguiente, calidad));
    }, 15000);
  }
}

function desmontarSala() {
  if (!sala) return;
  sala.vivos.liberar();
  sala.reflejo?.liberar();
  sala.entorno?.dispose();
  for (const o of [sala.haces, sala.polvo]) {
    if (!o) continue;
    o.removeFromParent();
    o.traverse((x) => {
      x.geometry?.dispose();
      x.material?.dispose?.();
    });
  }
  sala.liberar();
  sala = null;
}

const salaInicial = salas[parametro('sala')] ? parametro('sala') : 'vestibulo';
const listaMusica = fetch(`${BASE}musica/lista.json`).then((r) => (r.ok ? r.json() : []), () => []);
await montarSala(salaInicial, { alProgreso: (f) => portada?.progreso(f * 0.92) });

// --- Interfaz y controles
const hud = new Hud(ui, {
  movil,
  debug,
  pantalla: pantallaCompletaPosible ? 'api' : movil && !comoAplicacion ? 'instrucciones' : null,
});
const ficha = new Ficha(ui);
const video = new Video(ui);
const transicion = new Transicion(ui, { movil });
const indice = new IndiceSalas(ui, datosSalas.salas);
const botonera = new IndiceSalas(ui, datosSalas.salas, { ascensor: true });
const ambiente = new Ambiente();
const diorama = new Diorama(renderer, { calidad });
const uiCuadro = new UiCuadro(ui, { movil });
const visita = new VisitaGuiada(diorama, ambiente);
let datosCuadro = null; // lo cargado del diorama abierto (capas y, si la tiene, su visita guiada)

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
const escritorio = movil ? null : new ControlesEscritorio(camara, document.body, lienzo);
const tactil = movil ? new ControlesTactiles(camara, lienzo, ui) : null;
tactil?.mostrar(false);
if (camFija) hud.el.hidden = true;

const PISTA_RODEAR = movil ? 'Desliza el dedo para dar la vuelta a la escultura.' : 'Arrastra con el ratón para dar la vuelta a la escultura.';
let estado = 'portada'; // portada · paseo · pausa · indice · ascensor · transicion · contemplar · cuadro
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
  // El ascensor no se contempla: se llama y se elige la sala en su botonera.
  if (obra?.tipo === 'ascensor') return abrirIndice(botonera);
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
  const opciones = colocarFicha(obra);
  if (obra.tipo === 'panel') ficha.mostrarSala(salas[sala.id], datosSalas);
  else ficha.mostrar(obras[obra.id], { pista: obra.eje ? PISTA_RODEAR : null });
  sala.vivos.enfocar(obra.id, ESPERA_VIVO);
  await sala.contemplar.acercarse(obra, opciones);
  estado = 'contemplar';
}

// El título que se ve al apuntar a una obra (o al panel de la sala).
function rotulo(o) {
  if (!o) return null;
  if (o.tipo === 'ascensor') return { titulo: 'Ascensor', accion: 'Clic o <kbd>E</kbd> para llamarlo' };
  if (o.tipo !== 'panel') return obras[o.id];
  const s = salas[sala.id];
  return { titulo: s.numero ? `Sala ${ROMANOS[s.numero]}. ${s.titulo}` : 'El recorrido de las siete salas' };
}

// --- Cambio de sala
// Al pisar el fondo del pasillo de una puerta: fundido a negro con el texto de paso, se suelta
// la sala, se carga la otra y se entra por la puerta que viene de la anterior.
async function cruzarPuerta(paso) {
  estado = 'transicion';
  if (!(await salaDisponible(paso.destino))) {
    const s = salas[paso.destino];
    hud.nota(`La <b>${s.numero ? `Sala ${ROMANOS[s.numero]}` : s.titulo}</b> todavía se está montando. Vuelve pronto.`, 6);
    const p = sala.escena.pasos.find((x) => x === paso);
    camara.position.fromArray(p.llegada.posicion);
    camara.position.y = ALTURA_OJOS;
    estado = 'paseo';
    return;
  }
  await cambiarDeSala(paso.destino, { porPuerta: true });
}

async function cambiarDeSala(destino, { porPuerta = false, porAscensor = false } = {}) {
  const origen = salas[sala.id];
  const nueva = salas[destino];
  estado = 'transicion';
  hud.paseo(false);
  tactil?.mostrar(false);
  if (tactil) tactil.activo = false;
  if (escritorio) escritorio.activo = false;
  const adelante = porPuerta && nueva.numero > origen.numero;
  const final = porPuerta && nueva.id === 'vestibulo' && origen.final ? origen.final : null;
  await transicion.cubrir({ destino: nueva, paso: adelante ? origen.paso : null, final });
  desmontarSala();
  await montarSala(destino, { desde: porPuerta ? origen.id : null, porAscensor, alProgreso: (f) => transicion.progreso(f) });
  apuntada = null;
  await transicion.descubrir();
  if (porAscensor) ambiente.timbre();
  entrarEnPaseo();
}

// El índice de salas (botón ☰) y la botonera del ascensor son la misma lista: `panel` dice cuál.
function abrirIndice(panel = indice) {
  if (estado !== 'paseo' && estado !== 'pausa') return;
  estado = panel === botonera ? 'ascensor' : 'indice';
  hud.paseo(false);
  hud.mostrarPausa(false);
  tactil?.mostrar(false);
  if (tactil) tactil.activo = false;
  if (escritorio) {
    escritorio.activo = false;
    escritorio.desbloquear();
  }
  Promise.all(datosSalas.salas.map(async (s) => [s.id, await salaDisponible(s.id)]))
    .then((r) => panel.mostrar(sala.id, new Set(r.filter(([, si]) => si).map(([id]) => id))));
}

function cerrarIndice(panel = indice) {
  if (estado !== (panel === botonera ? 'ascensor' : 'indice')) return;
  panel.ocultar();
  if (escritorio?.capturaPosible) {
    estado = 'pausa';
    hud.mostrarPausa(true);
  } else {
    entrarEnPaseo();
  }
}

for (const panel of [indice, botonera]) {
  panel.addEventListener('cerrar', () => cerrarIndice(panel));
  panel.addEventListener('ir', (e) => {
    if (e.detail === sala.id) {
      cerrarIndice(panel);
      return;
    }
    panel.ocultar();
    estado = 'paseo';
    cambiarDeSala(e.detail, { porAscensor: panel === botonera });
  });
}
hud.addEventListener('salas', () => abrirIndice());

// Dónde va la ficha y qué fracción de la pantalla ocupa; el cuadro se encuadra en el resto. En
// una pantalla ancha, a la derecha. En el móvil y en ventanas estrechas, debajo del cuadro: en
// vertical el cuadro ocupa lo justo para verse de lado a lado (con aire arriba para los botones)
// y la ficha el resto; en horizontal la ficha se queda con el 40 % de abajo.
function colocarFicha(obra) {
  const w = innerWidth;
  const h = innerHeight;
  let opciones;
  if (!movil && w > 800) {
    opciones = { lado: 'derecha', hueco: Math.min(440, w * 0.36) / w, margen: 0.78 };
  } else if (w > h) {
    opciones = { lado: 'abajo', hueco: 0.4, margen: 0.86 };
  } else {
    const o = sala.contemplar.porId[obra.id];
    const libre = THREE.MathUtils.clamp((w * (o.alto / o.ancho) + 90) / h, 0.3, 0.55);
    opciones = { lado: 'abajo', hueco: 1 - libre, margen: 0.9 };
  }
  ficha.colocar(opciones);
  return opciones;
}

// Entrar en el cuadro: la cámara del museo se acerca hasta que el lienzo llena la pantalla y,
// desde ese mismo punto, se pasa al diorama.
async function entrarEnCuadro() {
  const o = obras[obraActual?.id];
  if (estado !== 'contemplar' || !o?.diorama) return;
  estado = 'transicion';
  ficha.cargando(true);
  const textura = sala.texturasObras[o.id];
  const alto = o.medidas.alto / 100;
  const ancho = alto * (textura.image.width / textura.image.height);
  const pose = sala.contemplar.poseLienzo(obraActual, ancho, alto);
  try {
    await diorama.cargar(o.id);
  } catch (e) {
    console.error(e);
    ficha.cargando(false);
    estado = 'contemplar';
    return;
  }
  ficha.ocultar();
  sala.vivos.enfocar(null);
  await sala.contemplar.ir(pose, 1.4);
  await congelar();
  await diorama.preparar(o.id, { ancho, alto, distancia: pose.dist, fov: camara.fov, aspecto: camara.aspect, cuadroPlano: textura });
  datosCuadro = await diorama.cargar(o.id);
  desvanecer();
  estado = 'cuadro';
  uiCuadro.mostrar(o, { visita: !!datosCuadro.visita });
  ambiente.paisaje(o.id === 'venus' ? 'mar' : 'viento');
  ambiente.atenuarMusica(0.6);
  await diorama.entrar();
}

async function salirDelCuadro() {
  if (estado !== 'cuadro') return;
  estado = 'transicion';
  visita.terminar();
  uiCuadro.ocultar();
  ambiente.paisaje(null);
  ambiente.atenuarMusica(1);
  await diorama.salir();
  await congelar();
  diorama.cerrar();
  desvanecer();
  const opciones = colocarFicha(obraActual);
  ficha.mostrar(obras[obraActual.id]);
  await sala.contemplar.ir(sala.contemplar.poseFrente(obraActual, opciones), 1.2);
  estado = 'contemplar';
}

async function volverAlPaseo({ gesto = false } = {}) {
  if (estado !== 'contemplar') return;
  estado = 'transicion';
  ficha.ocultar();
  sala.vivos.enfocar(null);
  if (video.abierto) video.cerrar();
  if (escritorio && gesto) escritorio.bloquear();
  await sala.contemplar.volver();
  obraActual = null;
  apuntada = null; // para que el cuadro al que se vuelve a mirar se anime otra vez
  // Si se volvió con Esc, el navegador no deja recuperar la captura del ratón (Esc no cuenta
  // como gesto del visitante): se muestra la pausa y un clic la recupera.
  if (escritorio?.capturaPosible && !escritorio.bloqueado) {
    estado = 'pausa';
    hud.mostrarPausa(true);
  } else {
    entrarEnPaseo();
  }
}

// Rodear una escultura exenta: arrastrar con el ratón o con el dedo mientras se contempla.
let arrastre = null;
lienzo.addEventListener('pointerdown', (e) => {
  if (estado !== 'contemplar' || !obraActual?.eje) return;
  arrastre = { id: e.pointerId, x: e.clientX, y: e.clientY };
  lienzo.setPointerCapture(e.pointerId);
});
lienzo.addEventListener('pointermove', (e) => {
  if (arrastre?.id !== e.pointerId || estado !== 'contemplar') return;
  const opciones = colocarFicha(obraActual);
  sala.contemplar.orbitar(obraActual, (e.clientX - arrastre.x) / innerWidth, (e.clientY - arrastre.y) / innerHeight, opciones);
  arrastre.x = e.clientX;
  arrastre.y = e.clientY;
});
for (const tipo of ['pointerup', 'pointercancel']) {
  lienzo.addEventListener(tipo, (e) => {
    if (arrastre?.id === e.pointerId) arrastre = null;
  });
}

ficha.addEventListener('volver', () => volverAlPaseo({ gesto: true }));
ficha.addEventListener('entrar', () => entrarEnCuadro());
uiCuadro.addEventListener('salir', () => salirDelCuadro());
uiCuadro.addEventListener('visita', () => {
  if (estado !== 'cuadro' || !datosCuadro?.visita) return;
  uiCuadro.visita(true, datosCuadro.visita.paradas.map((p) => p.texto));
  diorama.reservar(uiCuadro.reserva()); // el cuadro, encima de los subtítulos
  visita.empezar(datosCuadro.visita); // dentro del clic: la voz necesita el gesto en iOS
});
uiCuadro.addEventListener('anterior', () => visita.anterior());
uiCuadro.addEventListener('siguiente', () => visita.siguiente());
uiCuadro.addEventListener('pausa', () => visita.alternarPausa());
uiCuadro.addEventListener('terminar', () => visita.terminar());
visita.addEventListener('parada', (e) => uiCuadro.parada(e.detail));
visita.addEventListener('pausa', (e) => uiCuadro.pausa(e.detail));
visita.addEventListener('fin', () => {
  uiCuadro.visita(false);
  diorama.reservar(0);
});
ficha.addEventListener('video', () => {
  const o = obras[obraActual?.id];
  if (!o?.youtubeId) return;
  ambiente.atenuarMusica(0);
  video.abrir(o.youtubeId, o.titulo);
});
video.addEventListener('cerrado', () => ambiente.atenuarMusica(1));
hud.addEventListener('sonido', () => hud.sonido(ambiente.alternarSilencio()));
hud.addEventListener('pantalla', () => {
  if (pantallaCompletaPosible) {
    alternarPantallaCompleta({ horizontal: movil });
  } else {
    hud.nota('Para verlo a pantalla completa en el iPhone, toca <b>Compartir</b> y luego '
      + '<b>Añadir a pantalla de inicio</b>, y abre el museo desde allí. Gira el teléfono para verlo en horizontal.', 14);
  }
});
alCambiarPantallaCompleta(() => hud.pantallaCompleta(enPantallaCompleta()));
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
  if (estado === 'paseo') abrirObra(sala.contemplar.apuntada(e.detail));
});
document.addEventListener('mousedown', (e) => {
  if (estado === 'paseo' && escritorio?.bloqueado && e.button === 0) abrirObra(sala.contemplar.apuntada());
});
addEventListener('keydown', (e) => {
  // Tab pone y quita la pantalla completa (en vez de saltar entre botones).
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!e.repeat && pantallaCompletaPosible) alternarPantallaCompleta();
  }
  // E abre el cuadro al que se mira y, con la ficha abierta, vuelve al pasillo recuperando la
  // captura del ratón (una tecla normal sí cuenta como gesto del visitante, Esc no).
  if (e.code === 'KeyE' && !e.repeat) {
    if (estado === 'paseo') abrirObra(sala.contemplar.apuntada());
    else if (estado === 'contemplar') volverAlPaseo({ gesto: true });
  }
  if (estado === 'cuadro' && visita.activa) {
    const accion = { ArrowRight: 'siguiente', ArrowLeft: 'anterior', Space: 'alternarPausa' }[e.code];
    if (accion && !e.repeat) {
      e.preventDefault();
      visita[accion]();
    }
  }
  if (e.code === 'Escape') {
    if (indice.abierto) cerrarIndice();
    else if (botonera.abierto) cerrarIndice(botonera);
    else if (video.abierto) video.cerrar();
    else if (estado === 'cuadro') salirDelCuadro();
    else if (estado === 'contemplar') volverAlPaseo();
  }
});
tactil?.addEventListener('toque', (e) => {
  if (estado === 'paseo') abrirObra(sala.contemplar.apuntada(e.detail));
});
// Cada toque sirve de gesto para que el móvil deje moverse al cuadro vivo (después del de los
// mandos táctiles, que es el que abre el cuadro tocado).
addEventListener('touchend', () => sala?.vivos.desbloquear(), { passive: true });
addEventListener('click', () => sala?.vivos.desbloquear());

// --- Tamaño
function ajustar() {
  const { innerWidth: w, innerHeight: h } = window;
  if (!w || !h) return; // ventana oculta o a medio cambiar de tamaño
  renderer.setSize(w, h, false);
  lienzo.style.width = `${w}px`;
  lienzo.style.height = `${h}px`;
  sala?.contemplar.aplicarVista(w, h);
  diorama.ajustarTamano(w, h);
  sala?.reflejo?.ajustarTamano(w, h);
  post?.ajustarTamano(w, h);
  // Al girar el móvil o entrar y salir de la pantalla completa, se recoloca lo que hay abierto.
  if (estado === 'contemplar' && obraActual) {
    sala.contemplar.ir(sala.contemplar.poseFrente(obraActual, colocarFicha(obraActual)), 0.35);
  }
  if (estado === 'cuadro' && visita.activa) {
    diorama.reservar(uiCuadro.reserva());
    visita.reencuadrar();
  }
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
  if (!sala) return; // entre una sala y la siguiente
  const { contemplar, vivos, reflejo, polvo } = sala;
  if (contemplar.activo) {
    contemplar.actualizar(dt);
    contemplar.aplicarVista(innerWidth, innerHeight);
  }

  if (estado === 'paseo') {
    (escritorio ?? tactil).desplazamiento(dt, paso);
    antes.copy(camara.position);
    if (paso.lengthSq() > 0) {
      camara.position.add(paso);
      resolverColision(camara.position, RADIO_VISITANTE, sala.escena);
      const recorrido = Math.hypot(camara.position.x - antes.x, camara.position.z - antes.z);
      const anterior = Math.floor(fasePaso / Math.PI);
      fasePaso += (recorrido / PASO) * Math.PI;
      if (Math.floor(fasePaso / Math.PI) !== anterior) ambiente.paso(paso.length() / dt > 2 ? 1.2 : 0.9);
      camara.position.y = ALTURA_OJOS + Math.abs(Math.sin(fasePaso)) * 0.022 - 0.011;
    } else {
      camara.position.y += (ALTURA_OJOS - camara.position.y) * Math.min(1, dt * 6);
    }
    // El cuadro del centro de la pantalla. Si se queda mirando un cuadro vivo, al rato empieza a
    // moverse; si deja de mirarlo, se para. En el móvil no hay mira ni aviso: basta con tocarlo.
    const o = contemplar.apuntada();
    if (o?.id !== apuntada?.id) {
      if (!movil) hud.apuntando(rotulo(o));
      vivos.enfocar(o?.id ?? null, ESPERA_VIVO);
    }
    apuntada = o;
    const puerta = pasoPisado(camara.position, sala.escena.pasos);
    if (puerta) cruzarPuerta(puerta);
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
        `${sala.id} · calidad ${calidad.nivel} · pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} · ${estado} · ${vivos.diagnostico}`);
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
  ambiente.iniciarMusica(await listaMusica, BASE);
  escritorio?.bloquear();
  portada.ocultar();
  entrarEnPaseo();
}

if (debug) {
  window.__museo = {
    THREE, renderer, escena3d, camara, video, obras, salas, ambiente, diorama,
    sala: () => sala,
    estado: () => estado,
    irASala: (id) => cambiarDeSala(id),
    cruzarPuerta: (destino) => cruzarPuerta(sala.escena.pasos.find((p) => p.destino === destino)),
    llamarAscensor: () => abrirObra(sala.contemplar.porId.ascensor),
    ascensor: (destino) => cambiarDeSala(destino, { porAscensor: true }),
    contemplarObra: (id) => {
      estado = 'paseo';
      return abrirObra(sala.contemplar.porId[id]);
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
