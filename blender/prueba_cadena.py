"""F0.5 · Prueba de la cadena completa con un tramo tosco.

Construye una sala de 7×10 m con suelo de damero, paredes de yeso, un cuadro con marco
dorado y dos focos; la hornea, la exporta y hace un render de referencia en Cycles desde
la misma cámara que usará la web (?cam=prueba).

Uso: Blender --background --python blender/prueba_cadena.py
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402
import exportar  # noqa: E402
import hornear_luz  # noqa: E402
import texturas  # noqa: E402

ANCHO, LARGO, ALTO = 7.0, 10.0, 6.5
X = ANCHO / 2


def sala(tex):
    yeso = comun.material('yeso', imagen=tex['yeso'], normal=bpy.data.images['yeso_normal'], rugosidad=0.85)
    c = comun.Constructor([yeso], rep={'yeso': 2.0})
    c.caja((-X, 0, 0), (X, LARGO, ALTO), yeso, caras='xXyYZ')
    bmesh.ops.reverse_faces(c.bm, faces=c.bm.faces)
    return c.objeto('muros', lightmap='muros')


def suelo(tex):
    m = comun.material('suelo', imagen=tex['suelo_atlas'], rugosidad=0.12)
    c = comun.Constructor([m])
    lado = 0.7
    random.seed(1)
    nx, ny = int(ANCHO / lado + 0.5), int(LARGO / lado + 1)
    for i in range(nx):
        for j in range(ny):
            x0, y0 = -X + i * lado, j * lado
            y1 = min(y0 + lado, LARGO)
            if y0 >= LARGO:
                continue
            blanca = (i + j) % 2 == 0
            u0, v0, u1, v1 = texturas.celda_uv(random.randrange(8) + (0 if blanca else 8))
            fv = (y1 - y0) / lado
            vtop = v0 + (v1 - v0) * fv
            c.cara([(x0, y0, 0), (x0 + lado, y0, 0), (x0 + lado, y1, 0), (x0, y1, 0)], m,
                   uvs=[(u0, v0), (u1, v0), (u1, vtop), (u0, vtop)])
    return c.objeto('suelo', lightmap='suelo', soldar=False)


def cuadro(tex, obra, y, alto_m):
    img = bpy.data.images.load(os.path.join(comun.PUBLICO, 'obras', f"{obra}-media.webp"))
    ancho_m = alto_m * img.size[0] / img.size[1]
    zc = 1.1 + 0.12 + alto_m / 2
    lienzo = comun.material(f'lienzo_{obra}', imagen=img, rugosidad=0.55, especular=0.35)
    c = comun.Constructor([lienzo])
    xw = -X + 0.06
    c.cara([(xw, y - ancho_m / 2, zc - alto_m / 2), (xw, y + ancho_m / 2, zc - alto_m / 2),
            (xw, y + ancho_m / 2, zc + alto_m / 2), (xw, y - ancho_m / 2, zc + alto_m / 2)],
           lienzo, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    o = c.objeto(f'lienzo_{obra}', lightmap='obras')
    o['obra'] = obra
    oro = comun.material('oro', imagen=tex['oro'], metalico=1.0, rugosidad=0.32)
    m = comun.Constructor([oro], rep={'oro': 0.5})
    g, p = 0.12, 0.10
    y0, y1 = y - ancho_m / 2, y + ancho_m / 2
    z0, z1 = zc - alto_m / 2, zc + alto_m / 2
    m.caja((-X, y0 - g, z0 - g), (-X + p, y1 + g, z0), oro)
    m.caja((-X, y0 - g, z1), (-X + p, y1 + g, z1 + g), oro)
    m.caja((-X, y0 - g, z0), (-X + p, y0, z1), oro)
    m.caja((-X, y1, z0), (-X + p, y1 + g, z1), oro)
    m.objeto(f'marco_{obra}')
    return {'id': obra, 'centro': comun.a_three((xw, y, zc)), 'normal': [1, 0, 0],
            'ancho': round(ancho_m, 3), 'alto': round(alto_m, 3)}


def main():
    comun.escena_vacia()
    tex = {'yeso': texturas.yeso(), 'suelo_atlas': texturas.atlas_suelo(), 'oro': texturas.oro()}
    sala(tex)
    suelo(tex)
    obra = cuadro(tex, 'ulises', 5.0, 1.006)
    focos = [
        ((-1.3, 4.3, 6.2), (-3.5, 4.6, 1.9), 900, 38),
        ((-1.3, 5.7, 6.2), (-3.5, 5.4, 1.9), 900, 38),
        ((1.3, 3.0, 6.2), (3.5, 3.0, 2.0), 700, 34),
        ((1.3, 7.5, 6.2), (3.5, 7.5, 2.0), 700, 34),
    ]
    for i, (pos, obj, pot, ang) in enumerate(focos):
        comun.foco(f'foco_{i}', pos, obj, pot, ang)
    cam_pos, cam_mira = (2.2, 0.8, 1.65), (-3.5, 6.0, 1.9)
    comun.camara('Prueba', cam_pos, cam_mira, lente=22)
    bpy.context.scene.camera = bpy.data.objects['Prueba']

    escena = {
        'inicio': {'posicion': comun.a_three((0, 1.5, 1.65)), 'yaw': 0},
        'camaras': {'prueba': {'posicion': comun.a_three(cam_pos), 'mira': comun.a_three(cam_mira),
                               'fov': round(math.degrees(2 * math.atan(18 / 22 * 720 / 1280)), 2)}},
        'obras': [obra],
        'focos': [{'posicion': comun.a_three(p), 'objetivo': comun.a_three(o), 'angulo': a} for p, o, _, a in focos],
        'obstaculos': [],
        'limites': {'xmin': -X, 'xmax': X, 'zmin': -LARGO, 'zmax': 0},
    }
    with open(comun.ruta_build('escena.json'), 'w', encoding='utf-8') as f:
        json.dump(escena, f, ensure_ascii=False, indent=1)

    bpy.ops.wm.save_as_mainfile(filepath=comun.ruta_build('prueba.blend'))
    hornear_luz.hornear({
        'suelo': {'res': 1024, 'muestras': 256},
        'muros': {'res': 2048, 'muestras': 256},
        'obras': {'res': 512, 'muestras': 256},
    })
    bpy.ops.wm.save_mainfile()

    # Render de referencia con el material real del cuadro (antes de exportar)
    sc = bpy.context.scene
    comun.configurar_cycles(256)
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_depth = '8'
    sc.render.filepath = comun.ruta_build('prueba', 'referencia.png')
    bpy.ops.render.render(write_still=True)

    exportar.exportar()


if __name__ == '__main__':
    main()
