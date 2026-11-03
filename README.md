# El Museo de Elisabeth

Un pasillo de museo neoclásico, de noche y después del cierre, para recorrer en el navegador.
Las obras son cuadros reales de dominio público; cada una tiene su ficha y, más adelante,
se podrá «entrar» en ella.

## Cómo se usa

```bash
npm install
npm run dev          # abre http://localhost:5173
```

- **Ordenador:** `W A S D` o flechas para caminar, ratón para mirar, `Mayús` para ir más rápido,
  clic o `E` sobre un cuadro para contemplarlo, `Esc` para volver o pausar.
- **Móvil:** joystick abajo a la izquierda, arrastrar para mirar y tocar un cuadro.
- Parámetros de la URL: `?calidad=alta|media|baja`, `?debug` (FPS y datos) y
  `?cam=entrada|mitad|juicio|fondo` (cámara fija, para comparar con los renders de Blender).

## Cómo está hecho

```
data/layout.json + data/obras.json     ← planta del museo y fichas de las obras
        │
        ├─► blender/*.py (Blender sin interfaz) ─► build/museo.glb + lightmaps + escena.json
        │                                                    │
        └─► web/ (Vite + Three.js) ◄──── tools/optimizar_glb.mjs (→ web/public/)
```

- **Blender** (5.2, `/Applications/Blender.app`) construye todo el museo por código
  (`blender/construir_museo.py`), hornea la luz de los focos con Cycles en lightmaps
  (`hornear_luz.py`) y lo exporta a glTF (`exportar.py`).
- **La web** carga el modelo, aplica las lightmaps (canal UV 1) y añade lo que no se hornea:
  el reflejo del suelo pulido, los haces de luz, el polvo, el reflejo de los marcos dorados,
  las cartelas y las fichas.

### Regenerar el museo

```bash
npm run obras                  # descarga las obras de Wikimedia Commons (solo la primera vez)
npm run blender -- --rapido    # construir + hornear rápido + exportar (unos 4 minutos)
npm run blender                # calidad final (unos 40 minutos en un M5)
```

Para revisar el aspecto sin hornear:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background build/museo.blend \
  --python blender/render_previsualizar.py -- 48 previa      # → build/renders/
```

### Cambiar cosas

- **Textos de las fichas, vídeos:** `data/obras.json`. Para añadir un vídeo de YouTube basta con
  poner su identificador en `youtubeId` (lo que va después de `v=` en el enlace). No hace falta
  volver a hornear.
- **Colocación de obras, medidas, cámaras:** `data/layout.json` y después `npm run blender`.

## Créditos

Ver [CREDITOS.md](CREDITOS.md).
