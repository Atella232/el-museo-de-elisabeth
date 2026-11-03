#!/bin/sh
# Pipeline completa: construir → hornear la luz → exportar → optimizar para la web.
# Uso: npm run blender            (calidad final)
#      npm run blender -- --rapido (horneado rápido para iterar)
set -e
B=/Applications/Blender.app/Contents/MacOS/Blender
cd "$(dirname "$0")/.."
mkdir -p build
"$B" --background --factory-startup --python blender/construir_museo.py
"$B" --background --factory-startup build/museo.blend --python blender/hornear_luz.py -- "$@"
"$B" --background --factory-startup build/museo.blend --python blender/exportar.py
node tools/optimizar_glb.mjs
