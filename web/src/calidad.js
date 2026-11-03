// Nivel de calidad: se detecta según el dispositivo y se puede forzar con ?calidad=alta|media|baja.
const params = new URLSearchParams(location.search);

export const parametro = (nombre) => params.get(nombre);
export const debug = params.has('debug');

const movil = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const forzada = params.get('calidad');
const nivel = ['alta', 'media', 'baja'].includes(forzada) ? forzada : movil ? 'media' : 'alta';

export const calidad = {
  nivel,
  movil,
  pixelRatio: Math.min(devicePixelRatio, { alta: 2, media: 1.5, baja: 1 }[nivel]),
  // Variante de imágenes (cuadros y lightmaps): "alta" o "media"
  texturas: nivel === 'alta' ? 'alta' : 'media',
  // Fracción de la resolución de pantalla para el reflejo del suelo (0 = sin reflejo planar)
  reflejo: { alta: 0.5, media: 0.35, baja: 0 }[nivel],
  particulas: { alta: 1, media: 0.5, baja: 0.25 }[nivel],
  // Bloom, viñeta y grano (con MSAA en un búfer de media precisión): solo en calidad alta.
  postproceso: nivel === 'alta',
};
