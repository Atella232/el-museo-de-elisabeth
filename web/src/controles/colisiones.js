// Colisiones en planta (plano XZ de Three.js): el visitante es un círculo que no puede salir de
// las zonas por las que se anda (la nave y el pasillo de cada puerta, rectángulos [x0, z0, x1, z1]
// que se tocan) ni entrar en los obstáculos (rectángulos con el mismo formato).
const limitar = (v, a, b) => Math.min(Math.max(v, a), b);

export function resolverColision(pos, radio, { limites, zonas, obstaculos = [] }) {
  // Si el centro no cabe en ninguna zona (encogida por el radio), se lleva al punto más cercano.
  const areas = zonas ?? [[limites.xmin, limites.zmin, limites.xmax, limites.zmax]];
  let mejorX = pos.x;
  let mejorZ = pos.z;
  let mejor = Infinity;
  for (const [x0, z0, x1, z1] of areas) {
    const cx = limitar(pos.x, x0 + radio, x1 - radio);
    const cz = limitar(pos.z, z0 + radio, z1 - radio);
    const d2 = (pos.x - cx) ** 2 + (pos.z - cz) ** 2;
    if (d2 < mejor) {
      mejor = d2;
      mejorX = cx;
      mejorZ = cz;
      if (d2 === 0) break;
    }
  }
  pos.x = mejorX;
  pos.z = mejorZ;
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

// El paso a otra sala cuyo rectángulo de disparo pisa el visitante, si lo hay.
export function pasoPisado(pos, pasos = []) {
  return pasos.find(({ disparo: [x0, z0, x1, z1] }) => pos.x > x0 && pos.x < x1 && pos.z > z0 && pos.z < z1) ?? null;
}
