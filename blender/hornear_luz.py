"""Hornea la luz de la escena en lightmaps, una textura por grupo.

Cada objeto con la propiedad "lightmap" recibe un segundo mapa UV ("Lightmap") y se hornea
con Cycles solo la luz difusa (directa + indirecta, sin el color del material). El resultado
se guarda como:
  build/lightmaps/<grupo>.exr          (float, para comparar y medir)
  build/lightmaps/<grupo>.png          (8 bits, codificado sRGB y normalizado; lo usa la web)
  build/lightmaps/lightmaps.json       (grupo → archivo y escala para deshacer la normalización)

Uso: Blender --background build/museo.blend --python blender/hornear_luz.py -- [--rapido]
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402

# Resolución y muestras por grupo. --rapido las reduce para iterar.
GRUPOS = {
    'suelo':  {'res': 2048, 'muestras': 512},
    'muros':  {'res': 4096, 'muestras': 512},
    'boveda': {'res': 2048, 'muestras': 384},
    'piezas': {'res': 2048, 'muestras': 512},
    'obras':  {'res': 1024, 'muestras': 512},
    'marcos': {'res': 1024, 'muestras': 384},
}


def objetos_del_grupo(grupo):
    return [o for o in bpy.context.scene.objects
            if o.type == 'MESH' and o.get(comun.PROP_LIGHTMAP) == grupo]


def crear_uv_lightmap(objs, margen=0.003, cara_a_cara=False):
    """Segundo mapa UV sin solapes para la lightmap. `cara_a_cara` usa Lightmap Pack (una isla
    por cara), ideal para pocos planos grandes como los lienzos."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        uvs = o.data.uv_layers
        lm = uvs.get('Lightmap') or uvs.new(name='Lightmap')
        uvs['UVMap'].active_render = True
        uvs.active = lm
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    if cara_a_cara:
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False,
                                 PREF_BOX_DIV=12, PREF_MARGIN_DIV=0.3)
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margen,
                                 area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        # Giros solo de 90°: con giros libres las islas largas quedan en diagonal y desperdician sitio.
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='AXIS_ALIGNED', scale=True,
                                margin_method='FRACTION', margin=margen, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')


def preparar_destino(objs, imagen):
    """Pone un nodo de imagen activo (sin conectar) en cada material: ahí escribe Cycles."""
    nodos_destino = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or any(n.get('destino_lm') for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image == imagen):
                continue
            n = m.node_tree.nodes.new('ShaderNodeTexImage')
            n.image = imagen
            n['destino_lm'] = True
            n.location = (-400, 600)
            m.node_tree.nodes.active = n
            nodos_destino.append((m, n))
    return nodos_destino


def quitar_destino(nodos_destino):
    for m, n in nodos_destino:
        m.node_tree.nodes.remove(n)


def quitar_ruido(imagen):
    """Elimina el ruido del horneado con OIDN a través del compositor (Blender 5)."""
    sc = bpy.context.scene
    ancho, alto = imagen.size
    arbol = bpy.data.node_groups.new('QuitarRuidoLM', 'CompositorNodeTree')
    arbol.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    n_img = arbol.nodes.new('CompositorNodeImage')
    n_img.image = imagen
    n_dn = arbol.nodes.new('CompositorNodeDenoise')
    for nombre in ('HDR',):
        if nombre in n_dn.inputs:
            n_dn.inputs[nombre].default_value = True
    salida = arbol.nodes.new('NodeGroupOutput')
    arbol.links.new(n_img.outputs['Image'], n_dn.inputs['Image'])
    arbol.links.new(n_dn.outputs['Image'], salida.inputs[0])

    anterior = (sc.compositing_node_group, sc.render.engine, sc.render.resolution_x,
                sc.render.resolution_y, sc.render.resolution_percentage, sc.camera)
    sc.compositing_node_group = arbol
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = ancho, alto
    sc.render.resolution_percentage = 100
    if sc.camera is None:
        cam = bpy.data.objects.new('CamTemporal', bpy.data.cameras.new('CamTemporal'))
        sc.collection.objects.link(cam)
        sc.camera = cam
    vista = sc.view_settings.view_transform
    sc.view_settings.view_transform = 'Standard'
    bpy.ops.render.render()
    tmp = comun.ruta_build('lightmaps', '_sin_ruido.exr')
    resultado = bpy.data.images['Render Result']
    ajustes = sc.render.image_settings
    ajustes.file_format = 'OPEN_EXR'
    ajustes.color_depth = '32'
    resultado.save_render(tmp)
    sc.view_settings.view_transform = vista
    (sc.compositing_node_group, sc.render.engine, sc.render.resolution_x,
     sc.render.resolution_y, sc.render.resolution_percentage, cam_anterior) = anterior
    if bpy.data.objects.get('CamTemporal'):
        bpy.data.objects.remove(bpy.data.objects['CamTemporal'])
    sc.camera = cam_anterior
    bpy.data.node_groups.remove(arbol)
    limpia = bpy.data.images.load(tmp)
    px = np.empty(ancho * alto * 4, dtype=np.float32)
    limpia.pixels.foreach_get(px)
    bpy.data.images.remove(limpia)
    os.remove(tmp)
    return px.reshape(alto, ancho, 4)


def guardar(grupo, px):
    """Guarda el EXR lineal y el PNG normalizado en sRGB de 8 bits."""
    alto, ancho = px.shape[:2]
    rgb = np.clip(px[..., :3], 0.0, None)
    # Escala robusta: percentil de los texeles usados, para que unos pocos puntos muy
    # calientes (junto a las luminarias) no aplasten el resto en los valores más bajos.
    brillo = rgb.max(axis=2)
    usados = brillo[brillo > 1e-5]
    escala = float(np.percentile(usados, 99.7)) if usados.size else 1.0
    escala = escala or 1.0
    n = np.clip(rgb / escala, 0.0, 1.0)
    srgb = np.where(n <= 0.0031308, 12.92 * n, 1.055 * np.power(n, 1 / 2.4) - 0.055)

    ruta_exr = comun.ruta_build('lightmaps', f'{grupo}.exr')
    ruta_png = comun.ruta_build('lightmaps', f'{grupo}.png')

    img = bpy.data.images.new(f'LMf_{grupo}', ancho, alto, float_buffer=True, alpha=False)
    img.pixels.foreach_set(np.dstack([rgb, np.ones((alto, ancho, 1), np.float32)]).ravel())
    img.filepath_raw = ruta_exr
    img.file_format = 'OPEN_EXR'
    sc = bpy.context.scene
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '16'
    sc.render.image_settings.exr_codec = 'ZIP'
    img.save_render(ruta_exr, scene=sc)
    bpy.data.images.remove(img)

    img8 = bpy.data.images.new(f'LM8_{grupo}', ancho, alto, float_buffer=False, alpha=False)
    img8.colorspace_settings.name = 'Non-Color'
    q = np.round(srgb * 255) / 255
    img8.pixels.foreach_set(np.dstack([q, np.ones((alto, ancho, 1), np.float32)]).astype(np.float32).ravel())
    img8.filepath_raw = ruta_png
    img8.file_format = 'PNG'
    img8.save()
    bpy.data.images.remove(img8)
    return escala


def hornear(grupos=None, rapido=False):
    grupos = grupos or GRUPOS
    sc = bpy.context.scene
    comun.configurar_cycles()
    sc.render.bake.margin = 8
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    indice = {}
    for grupo, cfg in grupos.items():
        objs = objetos_del_grupo(grupo)
        if not objs:
            continue
        res = cfg['res'] // (4 if rapido else 1)
        muestras = max(16, cfg['muestras'] // (8 if rapido else 1))
        t0 = time.time()
        print(f'[hornear] {grupo}: {len(objs)} objetos, {res}px, {muestras} muestras')
        crear_uv_lightmap(objs, cara_a_cara=grupo == 'obras')
        imagen = bpy.data.images.new(f'LM_{grupo}', res, res, float_buffer=True, alpha=False)
        destino = preparar_destino(objs, imagen)
        sc.cycles.samples = muestras
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'},
                            margin=8, use_clear=True, target='IMAGE_TEXTURES')
        quitar_destino(destino)
        try:
            px = quitar_ruido(imagen)
        except Exception as e:  # si el compositor cambia de API, seguimos sin quitar ruido
            print(f'[hornear] aviso: sin eliminación de ruido ({e})')
            px = np.empty(res * res * 4, dtype=np.float32)
            imagen.pixels.foreach_get(px)
            px = px.reshape(res, res, 4)
        escala = guardar(grupo, px)
        bpy.data.images.remove(imagen)
        indice[grupo] = {'archivo': f'{grupo}.png', 'escala': round(escala, 5), 'resolucion': res}
        print(f'[hornear] {grupo} listo en {time.time() - t0:.0f} s (escala {escala:.3f})')
    with open(comun.ruta_build('lightmaps', 'lightmaps.json'), 'w') as f:
        json.dump(indice, f, indent=2)
    return indice


if __name__ == '__main__':
    args = comun.opciones()
    hornear(rapido='--rapido' in args)
    bpy.ops.wm.save_mainfile()
