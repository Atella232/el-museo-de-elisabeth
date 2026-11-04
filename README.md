# El Museo de Elisabeth

Un museo neoclásico, de noche y después del cierre, para recorrer en el navegador: un vestíbulo y
siete salas que van de los dioses griegos a la Roma imperial, con el recorrido y los textos de sala
de Elisabeth. Las obras son cuadros reales de dominio público, esculturas escaneadas en 3D y, donde
no hay escaneo libre, fotografías; cada una tiene su ficha, y en *El nacimiento de Venus* y
*El juicio de Paris* se puede «entrar» en el cuadro. De fondo suena, muy baja, música clásica de
grabaciones libres.

**Visítalo en <https://atella232.github.io/el-museo-de-elisabeth/>**

## Cómo se usa

```bash
npm install
npm run dev          # abre http://localhost:5173
```

- **Ordenador:** `W A S D` o flechas para caminar, ratón para mirar, `Mayús` para ir más rápido,
  clic o `E` sobre un cuadro para contemplarlo, `Esc` para volver o pausar.
- **Móvil:** joystick abajo a la izquierda, arrastrar para mirar y tocar un cuadro.
- **Salas:** se pasa de una a otra cruzando sus puertas (la pantalla se funde a negro con el texto
  de paso de Elisabeth mientras se carga la siguiente) o con el botón ☰ de arriba a la derecha.
- Parámetros de la URL: `?sala=vestibulo|dioses|deseo|…`, `?calidad=alta|media|baja`, `?debug`
  (FPS y datos) y `?cam=<cámara>` (cámara fija de la planta de la sala, para comparar con los
  renders de Blender).

## Cómo está hecho

```
data/plantas/<sala>.json + data/obras.json + data/salas.json   ← planta de cada sala, fichas y textos de sala
        │
        ├─► blender/*.py (Blender sin interfaz) ─► build/salas/<sala>/ (sala.glb, esculturas.glb, lightmaps, escena.json)
        │                                                    │
        └─► web/ (Vite + Three.js) ◄──── tools/optimizar_glb.mjs (→ web/public/salas/<sala>/)
```

- **Blender** (5.2, `/Applications/Blender.app`) construye cada sala por código
  (`blender/construir_museo.py`), hornea la luz de los focos con Cycles en lightmaps
  (`hornear_luz.py`) y la exporta a glTF (`exportar.py`). Cada sala es una nave con bóveda; su
  planta dice medidas, color de pared, qué cuelga en cada pared, las esculturas exentas y las
  puertas a otras salas.
- **La web carga una sala cada vez** (`web/src/escena/cargarSala.js`) y suelta la anterior al
  salir. Las puertas a otras salas tienen un pasillo corto en penumbra; al llegar a su fondo se
  pasa a la otra sala (`web/src/ui/transicion.js`).
- **Las esculturas** son escaneos 3D: vaciados en yeso del Statens Museum for Kunst (STL, dominio
  público) y escaneos de Scan the World (GLB en Zenodo, licencia CC BY-NC-SA 4.0). Blender las
  reduce, las coloca en hornacinas o sobre peanas y hornea su luz en los vértices (no en una
  lightmap: el mapa UV de un escaneo sale en miles de trozos con costuras). Van en un archivo
  aparte de cada sala (`esculturas.glb`).
- **Entrar en el cuadro** (`web/src/cuadro/diorama.js`): la pintura se convierte en un diorama de
  planos a distintas profundidades, como un teatro de papel. Las capas salen de los proyectos de
  animación de cada cuadro (`~/Documents/Proyectos/Animaciones`) con `npm run dioramas`, que
  recorta las figuras con sus máscaras y rellena lo que tapaban en el fondo.
- **Cuadros vivos** (`web/src/escena/vivos.js`): al contemplar un cuadro, o al quedarse mirándolo,
  la pintura se mueve unos segundos dentro de su marco. Son vídeos generados con IA (Kling 2.5 y
  MiniMax en Magnific) que empiezan y acaban en la propia pintura. Para añadir uno:
  `npm run vivo -- <id> <vídeo.mp4>` lo alinea con el cuadro, lo recodifica y lo activa en
  `data/obras.json` (necesita macOS).
- **La web** carga el modelo, aplica las lightmaps (canal UV 1) y añade lo que no se hornea:
  el reflejo del suelo pulido, los haces de luz, el polvo, el reflejo de los marcos dorados,
  las cartelas y las fichas.

### Regenerar el museo

```bash
npm run obras                  # descarga las obras y esculturas de Wikimedia Commons (solo la primera vez)
npm run musica                 # descarga la música y la convierte a AAC (usa afconvert, de macOS)
npm run dioramas               # capas para entrar en los cuadros (ANIMACIONES=/ruta si no están en ~/Documents/Proyectos/Animaciones)
SALA=dioses npm run blender -- --rapido    # una sala: construir + hornear rápido + exportar (unos 3 minutos)
SALA=dioses npm run blender                # calidad final (unos 5 minutos por sala en un M5)
```

Para revisar el aspecto sin hornear:

```bash
SALA=dioses /Applications/Blender.app/Contents/MacOS/Blender --background build/salas/dioses/museo.blend \
  --python blender/render_previsualizar.py -- 48 previa      # → build/salas/dioses/renders/
```

### Cambiar cosas

- **Textos de sala (pregunta, presentación, paso):** `data/salas.json`. No hace falta volver a hornear.
- **Textos de las fichas, vídeos:** `data/obras.json`. Para añadir un vídeo de YouTube basta con
  poner su identificador en `youtubeId` (lo que va después de `v=` en el enlace). No hace falta
  volver a hornear.
- **Colocación de obras, esculturas, medidas, puertas, cámaras:** `data/plantas/<sala>.json` y después
  `SALA=<sala> npm run blender`.
- **Música:** `data/musica.json` y después `npm run musica` y `npm run obras` (para los créditos).
  El volumen general está en `VOLUMEN_MUSICA`, en `web/src/audio/ambiente.js`.

## Publicación

Cada vez que se sube algo a `main`, GitHub Actions compila la web
(`.github/workflows/pages.yml`) y la publica en GitHub Pages. Solo hace falta Vite: todo lo que
sale de Blender, las obras, la música y los vídeos ya está en `web/public`.

Para probar en local la versión publicada:

```bash
BASE=/el-museo-de-elisabeth/ npm run build && BASE=/el-museo-de-elisabeth/ npm run preview
```

## Créditos

Ver [CREDITOS.md](CREDITOS.md).
