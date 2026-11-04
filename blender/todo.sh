#!/bin/sh
# Pipeline completa de una sala: construir → hornear la luz → exportar → optimizar para la web.
# Uso: SALA=dioses npm run blender             (calidad final)
#      SALA=dioses npm run blender -- --rapido (horneado rápido para iterar)
# La planta de la sala está en data/plantas/<sala>.json; el resultado va a build/salas/<sala>/
# y, optimizado, a web/public/salas/<sala>/.
set -e
B=/Applications/Blender.app/Contents/MacOS/Blender
cd "$(dirname "$0")/.."
export SALA="${SALA:-dioses}"
D="build/salas/$SALA"
mkdir -p "$D"
"$B" --background --factory-startup --python blender/construir_museo.py
"$B" --background --factory-startup "$D/museo.blend" --python blender/hornear_luz.py -- "$@"
"$B" --background --factory-startup "$D/museo.blend" --python blender/exportar.py
node tools/optimizar_glb.mjs
