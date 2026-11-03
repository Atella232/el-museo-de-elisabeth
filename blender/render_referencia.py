"""Render de referencia en Cycles con volumétrica real: haces de luz y aire con polvo.
Es el aspecto que la web intenta imitar con sus conos de luz falsos.

Uso: Blender --background build/museo.blend --python blender/render_referencia.py -- [cámara] [muestras]
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402

args = comun.opciones()
nombre = args[0] if args else 'entrada'
muestras = int(args[1]) if len(args) > 1 else 256

sc = bpy.context.scene
comun.configurar_cycles(muestras)
sc.cycles.volume_bounces = 1
arbol = sc.world.node_tree
volumen = arbol.nodes.new('ShaderNodeVolumePrincipled')
volumen.inputs['Density'].default_value = 0.012
volumen.inputs['Anisotropy'].default_value = 0.55
volumen.inputs['Color'].default_value = (1, 1, 1, 1)
arbol.links.new(volumen.outputs['Volume'], arbol.nodes['World Output'].inputs['Volume'])

sc.camera = bpy.data.objects[f'cam_{nombre}']
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = comun.ruta_build('renders', f'referencia_{nombre}.png')
bpy.ops.render.render(write_still=True)
print(f'[referencia] {sc.render.filepath}')
