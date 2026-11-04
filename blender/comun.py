"""Utilidades compartidas por todos los scripts de Blender del museo.

Se ejecutan sin interfaz:
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/<script>.py -- [opciones]
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATOS = os.path.join(RAIZ, 'data')
PUBLICO = os.path.join(RAIZ, 'web', 'public')
# Cada sala se construye, se hornea y se exporta por separado (SALA=dioses sh blender/todo.sh).
# Su planta está en data/plantas/<sala>.json y todo lo que genera va a build/salas/<sala>/.
SALA = os.environ.get('SALA', 'dioses')
BUILD = os.path.join(RAIZ, 'build', 'salas', SALA)

# Grupos de lightmap: cada objeto lleva la propiedad "lightmap" con uno de estos nombres
# (o ninguna si no se hornea, como los metales y las piezas emisivas).
PROP_LIGHTMAP = 'lightmap'


def leer_json(nombre):
    with open(os.path.join(DATOS, nombre), encoding='utf-8') as f:
        return json.load(f)


def planta():
    return leer_json(os.path.join('plantas', f'{SALA}.json'))


def opciones():
    """Argumentos que van después de `--` en la línea de comandos de Blender."""
    argv = sys.argv
    return argv[argv.index('--') + 1:] if '--' in argv else []


def ruta_build(*partes):
    ruta = os.path.join(BUILD, *partes)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    return ruta


def escena_vacia():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    mundo = bpy.data.worlds.new('Noche')
    sc.world = mundo
    fondo = mundo.node_tree.nodes['Background']
    fondo.inputs['Color'].default_value = (0.0, 0.0, 0.0, 1.0)
    fondo.inputs['Strength'].default_value = 0.0
    return sc


def configurar_cycles(muestras=128):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = muestras
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    sc.cycles.glossy_bounces = 2
    sc.cycles.transmission_bounces = 2
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False


def lineal(hex_srgb):
    """'#rrggbb' en sRGB → color lineal RGBA para los nodos."""
    h = hex_srgb.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, 1.0)


def material(nombre, color='#ffffff', rugosidad=0.5, metalico=0.0, imagen=None,
             normal=None, fuerza_normal=0.4, emision=None, fuerza_emision=0.0, especular=0.5):
    """Material Principled que el exportador glTF entiende tal cual."""
    if nombre in bpy.data.materials:
        return bpy.data.materials[nombre]
    m = bpy.data.materials.new(nombre)
    nodos, enlaces = m.node_tree.nodes, m.node_tree.links
    p = nodos['Principled BSDF']
    p.inputs['Base Color'].default_value = lineal(color)
    p.inputs['Roughness'].default_value = rugosidad
    p.inputs['Metallic'].default_value = metalico
    p.inputs['Specular IOR Level'].default_value = especular
    uv = None
    if imagen or normal:
        uv = nodos.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        uv.location = (-900, 0)
    if imagen:
        t = nodos.new('ShaderNodeTexImage')
        t.image = imagen if isinstance(imagen, bpy.types.Image) else bpy.data.images.load(imagen, check_existing=True)
        t.location = (-600, 200)
        enlaces.new(uv.outputs['UV'], t.inputs['Vector'])
        enlaces.new(t.outputs['Color'], p.inputs['Base Color'])
    if normal:
        tn = nodos.new('ShaderNodeTexImage')
        tn.image = normal if isinstance(normal, bpy.types.Image) else bpy.data.images.load(normal, check_existing=True)
        tn.image.colorspace_settings.name = 'Non-Color'
        tn.location = (-600, -250)
        nm = nodos.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = fuerza_normal
        nm.location = (-300, -250)
        enlaces.new(uv.outputs['UV'], tn.inputs['Vector'])
        enlaces.new(tn.outputs['Color'], nm.inputs['Color'])
        enlaces.new(nm.outputs['Normal'], p.inputs['Normal'])
    if emision:
        p.inputs['Emission Color'].default_value = lineal(emision)
        p.inputs['Emission Strength'].default_value = fuerza_emision
    return m


def objeto_desde_bmesh(nombre, bm, materiales, lightmap=None, coleccion=None):
    malla = bpy.data.meshes.new(nombre)
    bm.normal_update()
    bm.to_mesh(malla)
    bm.free()
    for m in materiales:
        malla.materials.append(m)
    obj = bpy.data.objects.new(nombre, malla)
    (coleccion or bpy.context.scene.collection).objects.link(obj)
    if lightmap:
        obj[PROP_LIGHTMAP] = lightmap
    for pol in malla.polygons:
        pol.use_smooth = False
    return obj


def normal_newell(puntos):
    n = Vector((0, 0, 0))
    for a, b in zip(puntos, puntos[1:] + puntos[:1]):
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    return n


class Marco:
    """Sistema local sobre una pared: u a lo largo (hacia la derecha de quien mira la pared),
    d hacia el interior de la sala y z hacia arriba."""

    def __init__(self, origen, u, d):
        self.o = Vector(origen)
        self.u = Vector(u)
        self.d = Vector(d)
        self.z = Vector((0, 0, 1))

    def p(self, u, d, z):
        return self.o + self.u * u + self.d * d + self.z * z

    def vec(self, u, d, z):
        return self.u * u + self.d * d + self.z * z


class Constructor:
    """Acumula geometría en un bmesh con UV en metros de mundo.

    `rep` indica cuántos metros ocupa una repetición de la textura de cada material:
    las UV de cada cara se proyectan según su normal dominante y se dividen por ese valor.
    """

    def __init__(self, materiales, rep=None):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.materiales = list(materiales)
        self.rep = rep or {}
        self.uv_fijas = set()

    def indice(self, mat):
        if mat not in self.materiales:
            self.materiales.append(mat)
        return self.materiales.index(mat)

    def cara(self, puntos, mat, uvs=None, hacia=None):
        """Crea una cara. Si se da `hacia`, se orienta para que su normal apunte en esa dirección."""
        puntos = [Vector(p) for p in puntos]
        if hacia is not None:
            if normal_newell(puntos).dot(Vector(hacia)) < 0:
                puntos = puntos[::-1]
                uvs = uvs[::-1] if uvs else uvs
        vs = [self.bm.verts.new(p) for p in puntos]
        f = self.bm.faces.new(vs)
        f.material_index = self.indice(mat)
        if uvs:
            for loop, uv in zip(f.loops, uvs):
                loop[self.uv].uv = uv
            self.uv_fijas.add(f)
        return f

    def caja(self, a, b, mat, caras='xXyYzZ'):
        """Caja alineada a los ejes entre las esquinas a y b. `caras` elige qué lados crear:
        x/X = caras -X/+X, y/Y = -Y/+Y, z/Z = -Z/+Z (normales hacia fuera)."""
        x0, y0, z0 = a
        x1, y1, z1 = b
        if 'x' in caras:
            self.cara([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], mat)
        if 'X' in caras:
            self.cara([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], mat)
        if 'y' in caras:
            self.cara([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], mat)
        if 'Y' in caras:
            self.cara([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], mat)
        if 'z' in caras:
            self.cara([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], mat)
        if 'Z' in caras:
            self.cara([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)

    def caja_local(self, mk, u0, u1, d0, d1, z0, z1, mat, sin_fondo=True):
        """Caja en el sistema local de una pared. Sin la cara pegada a la pared (d = d0) por defecto."""
        c = mk.p((u0 + u1) / 2, (d0 + d1) / 2, (z0 + z1) / 2)
        esquinas = {
            'u0': [(u0, d0, z0), (u0, d1, z0), (u0, d1, z1), (u0, d0, z1)],
            'u1': [(u1, d0, z0), (u1, d1, z0), (u1, d1, z1), (u1, d0, z1)],
            'd0': [(u0, d0, z0), (u1, d0, z0), (u1, d0, z1), (u0, d0, z1)],
            'd1': [(u0, d1, z0), (u1, d1, z0), (u1, d1, z1), (u0, d1, z1)],
            'z0': [(u0, d0, z0), (u1, d0, z0), (u1, d1, z0), (u0, d1, z0)],
            'z1': [(u0, d0, z1), (u1, d0, z1), (u1, d1, z1), (u0, d1, z1)],
        }
        for nombre, pts in esquinas.items():
            if sin_fondo and nombre == 'd0':
                continue
            p = [mk.p(*q) for q in pts]
            centro = sum(p, Vector()) / 4
            self.cara(p, mat, hacia=centro - c)

    def caja_mundo(self, a, b, mat):
        """Caja alineada a los ejes con las normales hacia fuera."""
        self.caja_local(Marco((0, 0, 0), (1, 0, 0), (0, 1, 0)), a[0], b[0], a[1], b[1], a[2], b[2], mat, sin_fondo=False)

    def uv_mundo(self):
        for f in self.bm.faces:
            if f in self.uv_fijas:
                continue
            n = f.normal
            eje = max(range(3), key=lambda i: abs(n[i]))
            rep = self.rep.get(self.materiales[f.material_index].name, 1.0)
            for loop in f.loops:
                p = loop.vert.co
                if eje == 0:
                    u, v = p.y * (1 if n.x < 0 else -1), p.z
                elif eje == 1:
                    u, v = p.x * (1 if n.y > 0 else -1), p.z
                else:
                    u, v = p.x, p.y * (1 if n.z > 0 else -1)
                loop[self.uv].uv = (u / rep, v / rep)

    def objeto(self, nombre, lightmap=None, coleccion=None, soldar=True):
        self.bm.normal_update()
        self.uv_mundo()
        if soldar:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        return objeto_desde_bmesh(nombre, self.bm, self.materiales, lightmap, coleccion)


def a_three(v):
    """Coordenadas de Blender (Z arriba) → Three.js (Y arriba)."""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def foco(nombre, pos, objetivo, potencia, angulo_deg, mezcla=0.6, radio=0.05, color=(1.0, 0.78, 0.56)):
    luz = bpy.data.lights.new(nombre, 'SPOT')
    luz.energy = potencia
    luz.spot_size = math.radians(angulo_deg)
    luz.spot_blend = mezcla
    luz.shadow_soft_size = radio
    luz.color = color
    obj = bpy.data.objects.new(nombre, luz)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = pos
    direccion = Vector(objetivo) - Vector(pos)
    obj.rotation_euler = direccion.to_track_quat('-Z', 'Y').to_euler()
    return obj


def camara(nombre, pos, mira, lente=24):
    cam = bpy.data.cameras.new(nombre)
    cam.lens = lente
    cam.sensor_width = 36
    obj = bpy.data.objects.new(nombre, cam)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector(mira) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    return obj
