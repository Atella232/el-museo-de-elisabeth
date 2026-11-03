// Colisiones en planta (plano XZ de Three.js): el visitante es un círculo que no puede
// salir de los límites del pasillo ni entrar en los obstáculos (rectángulos [x0, z0, x1, z1]).
const limitar = (v, a, b) => Math.min(Math.max(v, a), b);

export function resolverColision(pos, radio, { limites, obstaculos = [] }) {
  pos.x = limitar(pos.x, limites.xmin + radio, limites.xmax - radio);
  pos.z = limitar(pos.z, limites.zmin + radio, limites.zmax - radio);
  for (let iter = 0; iter < 2; iter++) {
    for (const [x0, z0, x1, z1] of obstaculos) {
      const cx = limitar(pos.x, x0, x1);
      const cz = limitar(pos.z, z0, z1);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radio * radio) continue;
      if (d2 > 1e-10) {
        // Fuera del rectángulo pero demasiado cerca: se empuja desde el punto más cercano.
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radio;
        pos.z = cz + (dz / d) * radio;
      } else {
        // Dentro: se saca por el lado más cercano.
        const salidas = [[pos.x - x0, -1, 0], [x1 - pos.x, 1, 0], [pos.z - z0, 0, -1], [z1 - pos.z, 0, 1]];
        const [, sx, sz] = salidas.reduce((a, b) => (b[0] < a[0] ? b : a));
        if (sx) pos.x = sx < 0 ? x0 - radio : x1 + radio;
        if (sz) pos.z = sz < 0 ? z0 - radio : z1 + radio;
      }
    }
  }
  return pos;
}
