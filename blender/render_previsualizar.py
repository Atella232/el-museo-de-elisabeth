"""Renders rápidos de control desde las cámaras de data/layout.json.

Uso: Blender --background build/museo.blend --python blender/render_previsualizar.py -- [muestras] [prefijo]
Deja las imágenes en build/renders/<prefijo>_<cámara>.png
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402

args = comun.opciones()
muestras = int(args[0]) if args else 64
prefijo = args[1] if len(args) > 1 else 'previa'

sc = bpy.context.scene
comun.configurar_cycles(muestras)
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_depth = '8'
for cam in [o for o in sc.objects if o.type == 'CAMERA' and o.name.startswith('cam_')]:
    sc.camera = cam
    sc.render.filepath = comun.ruta_build('renders', f'{prefijo}_{cam.name[4:]}.png')
    bpy.ops.render.render(write_still=True)
    print(f'[render] {sc.render.filepath}')
