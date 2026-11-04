"""Exporta el museo horneado a glTF binario para la web.

- Los lienzos llevan la propiedad "obra"; su material se sustituye por uno neutro
  ("obra_<id>") porque la web carga la imagen del cuadro según la calidad elegida.
- Las propiedades "lightmap" y "obra" viajan como extras de glTF (userData en Three.js).
- Escribe en build/salas/<sala>/ el edificio (sala.glb), las esculturas escaneadas aparte
  (esculturas.glb: varias tienen licencia CC BY-NC-SA y así se distinguen del resto) y
  escena.json (lo genera construir_museo.py; aquí se le añade la información de las lightmaps).

Uso: SALA=dioses Blender --background build/salas/dioses/museo.blend --python blender/exportar.py
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


def exportar_glb(ruta, objetos):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objetos:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=ruta,
        export_format='GLB',
        use_selection=True,
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
    print(f'[exportar] {ruta} ({os.path.getsize(ruta) / 1e6:.1f} MB)')


def exportar():
    materiales_neutros_para_obras()
    mallas = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    esculturas = [o for o in mallas if o.get(comun.PROP_LIGHTMAP) == 'esculturas']
    exportar_glb(comun.ruta_build('sala.glb'), [o for o in mallas if o not in esculturas])
    if esculturas:
        exportar_glb(comun.ruta_build('esculturas.glb'), esculturas)
    with open(comun.ruta_build('escena.json'), encoding='utf-8') as f:
        escena = json.load(f)
    with open(comun.ruta_build('lightmaps', 'lightmaps.json'), encoding='utf-8') as f:
        escena['lightmaps'] = json.load(f)
    with open(comun.ruta_build('escena.json'), 'w', encoding='utf-8') as f:
        json.dump(escena, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    exportar()
