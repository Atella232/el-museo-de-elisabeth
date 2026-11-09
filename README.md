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
  clic o `E` sobre un cuadro para contemplarlo, `Esc` para volver o pausar. A las esculturas
  del centro de las salas se les da la vuelta arrastrando mientras se contemplan.
- **Móvil:** joystick abajo a la izquierda, arrastrar para mirar y tocar un cuadro (o deslizar
  el dedo sobre una escultura para rodearla).
- **Salas:** se pasa de una a otra cruzando sus puertas (la pantalla se funde a negro con el texto
  de paso de Elisabeth mientras se carga la siguiente), con el ascensor que hay junto a la entrada
  de cada sala (en el vestíbulo, junto a la puerta de la Sala I: se le apunta, se pulsa y se elige
  la sala en su botonera) o con el botón ☰ de arriba a la derecha.
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
  pasa a la otra sala (`web/src/ui/transicion.js`). El ascensor de cada sala (`"ascensor"` en la
  planta: pared y posición) tiene las puertas cerradas y un dial con la aguja en esa sala; al
  llamarlo se abre su botonera (`web/src/ui/salas.js`) y se llega delante del ascensor de la otra.
- **Las esculturas** son escaneos 3D: vaciados en yeso del Statens Museum for Kunst (STL, dominio
  público) y escaneos de Scan the World (GLB en Zenodo, licencia CC BY-NC-SA 4.0). Blender las
  reduce, las coloca en hornacinas o sobre peanas y hornea su luz en los vértices (no en una
  lightmap: el mapa UV de un escaneo sale en miles de trozos con costuras). Van en un archivo
  aparte de cada sala (`esculturas.glb`). Las exentas, como *Apolo y Dafne* en la Sala II, se
  pueden apuntar desde cualquier lado y rodear al contemplarlas (`web/src/controles/contemplar.js`).
  El *Marco Aurelio* ecuestre es un escaneo publicado en Sketchfab (descargado a mano, porque
  Sketchfab pide una cuenta). De otras cinco no hay escaneo libre (el *Perseo* de Cellini, el *Teseo*
  de Canova, los dos Bernini de la Borghese y el *Augusto de Prima Porta*): son reconstrucciones
  hechas con IA (Hi3D 3.0, vía Magnific) a partir de una fotografía de Commons. Los modelos de todas
  están, reducidos, en `fuentes/esculturas/`. En el móvil se cargan las esculturas con menos
  triángulos (`esculturas-media.glb`, lo hace `tools/optimizar_glb.mjs`). El relieve del sarcófago de Proserpina y el del arco de Tito
  salen de un mapa de profundidad de una fotografía (Hi3D Relief, vía Magnific), que
  `blender/relieve_profundidad.py` convierte en una losa en relieve (y, para el sarcófago, en la caja).
- **Fotografías de los originales:** la ficha de cada obra en 3D tiene una sección «Fotografías» con
  fotos reales de la escultura o el monumento, que se abren en grande en un visor
  (`web/src/ui/visor.js`). Se eligen en `data/fotos.json` y las descarga `npm run fotos`
  (`tools/descargar_fotos.mjs`) a `web/public/fotos/`, con su autor y su licencia.
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
