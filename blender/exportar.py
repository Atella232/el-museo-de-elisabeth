"""Exporta el museo horneado a glTF binario para la web.

- Los lienzos llevan la propiedad "obra"; su material se sustituye por uno neutro
  ("obra_<id>") porque la web carga la imagen del cuadro según la calidad elegida.
- Las propiedades "lightmap" y "obra" viajan como extras de glTF (userData en Three.js).
- Escribe build/museo.glb y build/escena.json (escena.json lo genera construir_museo.py;
  aquí se le añade la información de las lightmaps).

Uso: Blender --background build/museo.blend --python blender/exportar.py
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402


def materiales_neutros_para_obras():
    for o in bpy.context.scene.objects:
        obra = o.get('obra')
        if not obra or o.type != 'MESH':
            continue
        neutro = comun.material(f'obra_{obra}', color='#ffffff', rugosidad=0.62, especular=0.35)
        for slot in o.material_slots:
            if slot.material and slot.material.name.startswith('lienzo_'):
                slot.material = neutro


def exportar():
    materiales_neutros_para_obras()
    ruta = comun.ruta_build('museo.glb')
    bpy.ops.export_scene.gltf(
        filepath=ruta,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE',  # la luz horneada en los vértices de las esculturas
        export_image_format='WEBP',
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
    )
    with open(comun.ruta_build('escena.json'), encoding='utf-8') as f:
        escena = json.load(f)
    with open(comun.ruta_build('lightmaps', 'lightmaps.json'), encoding='utf-8') as f:
        escena['lightmaps'] = json.load(f)
    with open(comun.ruta_build('escena.json'), 'w', encoding='utf-8') as f:
        json.dump(escena, f, ensure_ascii=False, indent=1)
    print(f'[exportar] {ruta} ({os.path.getsize(ruta) / 1e6:.1f} MB)')


if __name__ == '__main__':
    exportar()
