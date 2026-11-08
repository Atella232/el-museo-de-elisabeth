"""Convierte un mapa de profundidad de un relieve (PNG en gris, lo cercano en claro) en una malla:
una losa cuyo frente sigue la profundidad, mirando hacia -Y con la parte de arriba en +z y el
dorso en y = 0, que es como colgar_relieve() espera los escaneos. Con --caja, además, la caja de
un sarcófago detrás del relieve (costados, fondo y el hueco de arriba).

Las medidas van en metros; el museo vuelve a escalar el relieve a su `expuesto.alto` o, en las
exentas, a `medidas.alto` de la obra. Escribe un GLB comprimido en fuentes/esculturas/.

Uso: Blender --background --python blender/relieve_profundidad.py -- <profundidad.png> <salida.glb>
         <ancho> <alto> <profundidad del relieve> [--caja <fondo de la caja>] [--columnas N]
"""
import sys

import bmesh
import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
png, salida = args[0], args[1]
ancho, alto, hondo = (float(a) for a in args[2:5])
fondo_caja = float(args[args.index('--caja') + 1]) if '--caja' in args else None
columnas = int(args[args.index('--columnas') + 1]) if '--columnas' in args else 520
LOSA = 0.02  # grosor bajo lo más hundido del relieve
PARED = 0.07  # grosor de las paredes de la caja

bpy.ops.wm.read_factory_settings(use_empty=True)
img = bpy.data.images.load(png)
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)[::-1, :, 0]  # fila 0 arriba
filas = max(2, round(columnas * alto / ancho))


def muestrear(a, nf, nc):
    """Reduce la imagen a nf × nc promediando bloques: suaviza el ruido del mapa."""
    ys = np.linspace(0, a.shape[0], nf + 1).astype(int)
    xs = np.linspace(0, a.shape[1], nc + 1).astype(int)
    return np.array([[a[ys[i]:max(ys[i + 1], ys[i] + 1), xs[j]:max(xs[j + 1], xs[j] + 1)].mean() for j in range(nc)] for i in range(nf)])


d = muestrear(px, filas, columnas)
d = (d - np.percentile(d, 1)) / max(1e-6, np.percentile(d, 99.5) - np.percentile(d, 1))
d = np.clip(d, 0, 1)

bm = bmesh.new()
xs = np.linspace(-ancho / 2, ancho / 2, columnas)
zs = np.linspace(alto, 0, filas)
vs = [[bm.verts.new((xs[j], -(LOSA + hondo * d[i, j]), zs[i])) for j in range(columnas)] for i in range(filas)]
for i in range(filas - 1):
    for j in range(columnas - 1):
        bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))


def faldon(borde):
    """Une un borde del frente con el plano del dorso (y = 0): el canto de la losa."""
    atras = [bm.verts.new((v.co.x, 0.0, v.co.z)) for v in borde]
    for a, b, c, e in zip(borde, borde[1:], atras[1:], atras):
        bm.faces.new((a, b, c, e))
    return atras


arriba = faldon(vs[0])
abajo = faldon(vs[-1][::-1])
izq = faldon([vs[i][0] for i in range(filas)][::-1])
der = faldon([vs[i][-1] for i in range(filas)])

if fondo_caja:
    # Caja del sarcófago detrás del relieve: de y = 0 a y = fondo_caja, abierta por arriba.
    x0, x1, p, e = -ancho / 2, ancho / 2, fondo_caja, PARED

    def cara(hacia, *pts):
        """Una cara con la normal hacia `hacia` (se da la vuelta a los vértices si hace falta)."""
        pts = [np.array(q, float) for q in pts]
        n = sum(np.cross(a, b) for a, b in zip(pts, pts[1:] + pts[:1]))
        if np.dot(n, hacia) < 0:
            pts = pts[::-1]
        bm.faces.new([bm.verts.new(tuple(q)) for q in pts])

    cara((-1, 0, 0), (x0, 0, 0), (x0, p, 0), (x0, p, alto), (x0, 0, alto))      # costado izquierdo
    cara((1, 0, 0), (x1, 0, 0), (x1, 0, alto), (x1, p, alto), (x1, p, 0))       # costado derecho
    cara((0, 1, 0), (x0, p, 0), (x1, p, 0), (x1, p, alto), (x0, p, alto))       # fondo
    # borde de arriba alrededor del hueco
    cara((0, 0, 1), (x0, 0, alto), (x0, p, alto), (x0 + e, p - e, alto), (x0 + e, e, alto))
    cara((0, 0, 1), (x1, 0, alto), (x1 - e, e, alto), (x1 - e, p - e, alto), (x1, p, alto))
    cara((0, 0, 1), (x0, 0, alto), (x0 + e, e, alto), (x1 - e, e, alto), (x1, 0, alto))
    cara((0, 0, 1), (x0, p, alto), (x1, p, alto), (x1 - e, p - e, alto), (x0 + e, p - e, alto))
    # paredes y suelo del hueco, mirando hacia dentro
    s = 0.12
    cara((1, 0, 0), (x0 + e, e, s), (x0 + e, e, alto), (x0 + e, p - e, alto), (x0 + e, p - e, s))
    cara((-1, 0, 0), (x1 - e, e, s), (x1 - e, p - e, s), (x1 - e, p - e, alto), (x1 - e, e, alto))
    cara((0, 1, 0), (x0 + e, e, s), (x1 - e, e, s), (x1 - e, e, alto), (x0 + e, e, alto))
    cara((0, -1, 0), (x0 + e, p - e, s), (x0 + e, p - e, alto), (x1 - e, p - e, alto), (x1 - e, p - e, s))
    cara((0, 0, 1), (x0 + e, e, s), (x0 + e, p - e, s), (x1 - e, p - e, s), (x1 - e, e, s))

bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
bm.normal_update()
malla = bpy.data.meshes.new('relieve')
bm.to_mesh(malla)
bm.free()
ob = bpy.data.objects.new('relieve', malla)
bpy.context.scene.collection.objects.link(ob)
for p in malla.polygons:
    p.use_smooth = True
print(f'[relieve] {len(malla.polygons)} caras, {columnas} × {filas}')
ob.select_set(True)
bpy.context.view_layer.objects.active = ob
bpy.ops.export_scene.gltf(filepath=salida, export_format='GLB', use_selection=True, export_materials='NONE',
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
