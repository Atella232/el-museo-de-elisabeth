// Pantalla completa: botón en la esquina y, en el ordenador, la tecla Tab. En el móvil además
// se gira a horizontal donde el navegador lo permite (Android). El iPhone no deja poner una web
// a pantalla completa ni girarla: allí el botón explica cómo añadir el museo a la pantalla de
// inicio, que lo abre sin las barras del navegador.
const raiz = document.documentElement;

export const pantallaCompletaPosible = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

// Abierto desde la pantalla de inicio: ya se ve sin las barras del navegador.
export const comoAplicacion = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
  || navigator.standalone === true;

export const enPantallaCompleta = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

export async function alternarPantallaCompleta({ horizontal = false } = {}) {
  if (enPantallaCompleta()) {
    (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
    return;
  }
  try {
    if (raiz.requestFullscreen) await raiz.requestFullscreen({ navigationUI: 'hide' });
    else raiz.webkitRequestFullscreen?.();
    if (horizontal) await screen.orientation?.lock?.('landscape');
  } catch {
    // El navegador puede negarse (o no saber girar la pantalla): se queda como estaba.
  }
}

export function alCambiarPantallaCompleta(funcion) {
  document.addEventListener('fullscreenchange', funcion);
  document.addEventListener('webkitfullscreenchange', funcion);
}
