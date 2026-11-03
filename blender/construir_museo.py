"""Construye el pasillo del museo a partir de data/layout.json y data/obras.json.

Genera build/museo.blend (geometría, materiales, cuadros, focos y luz de luna) y
build/escena.json (lo que la web necesita saber: obras, focos, colisiones, cámaras...).

Uso: Blender --background --python blender/construir_museo.py
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402
import texturas  # noqa: E402
from comun import Constructor, Marco  # noqa: E402

L = comun.leer_json('layout.json')
OBRAS = {o['id']: o for o in comun.leer_json('obras.json')}

NAVE = L['nave']
X = NAVE['ancho'] / 2
LARGO = NAVE['largo']
Z_ZOC = NAVE['zocalo']
Z_ENT = NAVE['entablamento']['base']
Z_IMP = NAVE['imposta']
R = X  # radio de la bóveda
PIL = L['pilastras']
COLOR_FOCO = (1.0, 0.80, 0.60)
COLOR_LUNA = (0.55, 0.66, 1.0)

# Paredes: sistema local con u hacia la derecha de quien mira y d hacia la sala.
PAREDES = {
    'izquierda': lambda pos: Marco((-X, pos, 0), (0, 1, 0), (1, 0, 0)),
    'derecha': lambda pos: Marco((X, pos, 0), (0, -1, 0), (-1, 0, 0)),
    'fondo': lambda pos: Marco((pos, LARGO, 0), (1, 0, 0), (0, -1, 0)),
    'puertas': lambda pos: Marco((pos, 0, 0), (-1, 0, 0), (0, 1, 0)),
}

M = {}  # materiales
escena = {'obras': [], 'focos': [], 'obstaculos': [], 'cartelas': {}}


# ------------------------------------------------------------------ materiales

def materiales():
    t = texturas.todas()
    yeso_n = bpy.data.images['yeso_normal']
    M['suelo'] = comun.material('suelo', imagen=t['suelo_atlas'], rugosidad=0.1)
    M['greca'] = comun.material('greca', imagen=t['greca'], rugosidad=0.1)
    M['yeso'] = comun.material('yeso', imagen=t['yeso'], normal=yeso_n, rugosidad=0.88, especular=0.3)
    M['pompeyano'] = comun.material('pompeyano', color='#7a2c22', normal=yeso_n, rugosidad=0.85, especular=0.3)
    M['piedra'] = comun.material('piedra', imagen=t['piedra'], rugosidad=0.6, especular=0.4)
    M['zocalo'] = comun.material('zocalo', imagen=t['marmol_zocalo'], rugosidad=0.18)
    M['oro'] = comun.material('oro', imagen=t['oro'], metalico=1.0, rugosidad=0.3)
    # Los marcos son solo en parte metálicos: así reciben la luz horneada de los focos
    # (la parte difusa) y el reflejo del entorno en la web (la parte especular).
    M['oro_marco'] = comun.material('oro_marco', imagen=t['oro'], metalico=0.55, rugosidad=0.32)
    M['dorado'] = comun.material('dorado', color='#b8913f', rugosidad=0.4, especular=0.7)
    M['negro'] = comun.material('marco_negro', color='#121212', rugosidad=0.45)
    M['paspartu'] = comun.material('paspartu', color='#efeade', rugosidad=0.92, especular=0.2)
    M['bronce'] = comun.material('bronce', imagen=t['bronce'], metalico=1.0, rugosidad=0.42)
    M['laton'] = comun.material('laton', color='#c9a35a', metalico=1.0, rugosidad=0.25)
    M['madera'] = comun.material('madera', imagen=t['madera'], rugosidad=0.45)
    M['hierro'] = comun.material('hierro', color='#1b1b1c', rugosidad=0.5, especular=0.5)
    M['terracota'] = comun.material('terracota', imagen=t['terracota'], rugosidad=0.55)
    M['terciopelo'] = comun.material('terciopelo', color='#5b0f15', rugosidad=0.95, especular=0.2)
    M['cartela'] = comun.material('cartelas', color='#e9e3d6', rugosidad=0.8, especular=0.3)
    M['luna'] = comun.material('luna', color='#05070d', rugosidad=0.1, emision='#1c2b52', fuerza_emision=0.3)
    M['lente'] = comun.material('lente', color='#ffffff', emision='#ffe2b8', fuerza_emision=40.0)
    M['salida'] = comun.material('salida', color='#0c5a2a', emision='#16c25a', fuerza_emision=3.0)
    M['salida_texto'] = comun.material('salida_texto', color='#ffffff', emision='#f2fff5', fuerza_emision=4.0)
    return t


REP = {'yeso': 2.0, 'pompeyano': 2.0, 'piedra': 1.5, 'zocalo': 1.2, 'oro': 0.4, 'bronce': 1.0,
       'madera': 1.0, 'dorado': 1.0, 'hierro': 1.0}


def constructor(*mats):
    return Constructor([M[m] if isinstance(m, str) else m for m in mats], rep=REP)


# ------------------------------------------------------------------ suelo

def suelo():
    c = constructor('suelo', 'greca')
    lado = L['suelo']['baldosa']
    borde = L['suelo']['cenefa']
    random.seed(7)
    x0, x1 = -X + borde, X - borde
    y0, y1 = borde, LARGO - borde
    nx = round((x1 - x0) / lado)
    j = 0
    y = y0
    while y < y1 - 1e-6:
        yb = min(y + lado, y1)
        for i in range(nx):
            xa = x0 + i * lado
            blanca = (i + j) % 2 == 0
            u0, v0, u1, v1 = texturas.celda_uv(random.randrange(8) + (0 if blanca else 8))
            vt = v0 + (v1 - v0) * (yb - y) / lado
            c.cara([(xa, y, 0), (xa + lado, y, 0), (xa + lado, yb, 0), (xa, yb, 0)], M['suelo'],
                   uvs=[(u0, v0), (u1, v0), (u1, vt), (u0, vt)], hacia=(0, 0, 1))
        y = yb
        j += 1
    # Cenefa de greca junto a las cuatro paredes (u avanza a lo largo de la franja)
    periodo = borde * 6 / 8

    def franja(a, b, ancho_dir):
        a, b = Vector(a), Vector(b)
        largo = (b - a).length
        w = Vector(ancho_dir) * borde
        c.cara([a, b, b + w, a + w], M['greca'],
               uvs=[(0, 0), (largo / periodo, 0), (largo / periodo, 1), (0, 1)], hacia=(0, 0, 1))

    franja((-X, 0, 0), (-X, LARGO, 0), (1, 0, 0))
    franja((X, LARGO, 0), (X, 0, 0), (-1, 0, 0))
    franja((-X + borde, 0, 0), (X - borde, 0, 0), (0, 1, 0))
    franja((X - borde, LARGO, 0), (-X + borde, LARGO, 0), (0, -1, 0))
    # Soldar no cambia las UV del atlas (van por esquina de cara) y deja el suelo como una
    # sola isla para la lightmap.
    return c.objeto('suelo', lightmap='suelo')


# ------------------------------------------------------------------ elementos de pared

def pared_con_huecos(c, mk, u0, u1, z0, z1, huecos, mat):
    """Paño de pared entre u0..u1 y z0..z1 con huecos (rectángulos o arcos de medio punto).
    Cada hueco: dict(u0, u1, z0, z1, arco=bool); con arco, z1 es el arranque y el radio es la mitad del ancho."""
    hacia = mk.d
    cortes = sorted({u0, u1} | {h['u0'] for h in huecos} | {h['u1'] for h in huecos})
    for a, b in zip(cortes, cortes[1:]):
        h = next((h for h in huecos if h['u0'] <= a + 1e-6 and h['u1'] >= b - 1e-6), None)
        if not h:
            c.cara([mk.p(a, 0, z0), mk.p(b, 0, z0), mk.p(b, 0, z1), mk.p(a, 0, z1)], mat, hacia=hacia)
            continue
        if h['z0'] > z0:
            c.cara([mk.p(a, 0, z0), mk.p(b, 0, z0), mk.p(b, 0, h['z0']), mk.p(a, 0, h['z0'])], mat, hacia=hacia)
        if not h.get('arco'):
            if h['z1'] < z1:
                c.cara([mk.p(a, 0, h['z1']), mk.p(b, 0, h['z1']), mk.p(b, 0, z1), mk.p(a, 0, z1)], mat, hacia=hacia)
            continue
        r = (h['u1'] - h['u0']) / 2
        uc = h['u0'] + r
        n = 16
        pts = [(uc - r * math.cos(math.pi * k / n), h['z1'] + r * math.sin(math.pi * k / n)) for k in range(n + 1)]
        for (ua, za), (ub, zb) in zip(pts, pts[1:]):
            c.cara([mk.p(ua, 0, za), mk.p(ub, 0, zb), mk.p(ub, 0, z1), mk.p(ua, 0, z1)], mat, hacia=hacia)


def zocalo(c, mk, u0, u1, huecos=()):
    """Chapado de mármol de 0 a Z_ZOC con un remate de piedra."""
    cortes = sorted({u0, u1} | {h[0] for h in huecos} | {h[1] for h in huecos})
    for a, b in zip(cortes, cortes[1:]):
        if any(h[0] <= a + 1e-6 and h[1] >= b - 1e-6 for h in huecos):
            continue
        c.caja_local(mk, a, b, 0, 0.03, 0, Z_ZOC, M['zocalo'])
        c.caja_local(mk, a, b, 0, 0.055, Z_ZOC, Z_ZOC + 0.05, M['piedra'])


def voluta(c, mk, uc, zc, radio, d0, d1, sentido):
    mat = M['piedra']
    n = 24
    circ = [(uc + radio * math.cos(2 * math.pi * k / n), zc + radio * math.sin(2 * math.pi * k / n)) for k in range(n)]
    centro = mk.p(uc, (d0 + d1) / 2, zc)
    for (ua, za), (ub, zb) in zip(circ, circ[1:] + circ[:1]):
        pts = [mk.p(ua, d0, za), mk.p(ub, d0, zb), mk.p(ub, d1, zb), mk.p(ua, d1, za)]
        c.cara(pts, mat, hacia=sum(pts, Vector()) / 4 - centro)
    c.cara([mk.p(u, d1, z) for u, z in circ], mat, hacia=mk.d)
    # Espiral en relieve sobre la cara frontal
    dr = d1 + 0.012
    pasos = 60
    ext, inte = [], []
    for k in range(pasos + 1):
        th = 3.2 * math.pi * k / pasos
        r = radio * 0.92 * math.exp(-0.16 * th)
        w = radio * 0.2 * math.exp(-0.12 * th)
        ang = th * sentido
        ext.append((uc + r * math.cos(ang), zc + r * math.sin(ang)))
        inte.append((uc + (r - w) * math.cos(ang), zc + (r - w) * math.sin(ang)))
    for k in range(pasos):
        frente = [mk.p(*_uz(ext[k], dr)), mk.p(*_uz(ext[k + 1], dr)), mk.p(*_uz(inte[k + 1], dr)), mk.p(*_uz(inte[k], dr))]
        c.cara(frente, mat, hacia=mk.d)
        for borde in (ext, inte):
            lado = [mk.p(*_uz(borde[k], d1)), mk.p(*_uz(borde[k + 1], d1)), mk.p(*_uz(borde[k + 1], dr)), mk.p(*_uz(borde[k], dr))]
            centro_l = sum(lado, Vector()) / 4
            c.cara(lado, mat, hacia=centro_l - mk.p(uc, dr, zc) if borde is ext else mk.p(uc, dr, zc) - centro_l)


def _uz(uz, d):
    return uz[0], d, uz[1]


def pilastra(c, mk, alto=Z_ENT, ancho=PIL['ancho'], saliente=PIL['saliente']):
    """Pilastra jónica estriada. Las medidas de referencia son las de 0,8 m de ancho y 5,6 m de alto."""
    kw, kz, kd = ancho / 0.8, alto / 5.6, saliente / 0.22
    p = M['piedra']

    def caja(hu, dd, z0, z1):
        c.caja_local(mk, -hu * kw, hu * kw, 0, dd * kd, z0 * kz, z1 * kz, p)

    caja(0.46, 0.29, 0.0, 0.12)
    caja(0.44, 0.27, 0.12, 0.2)
    caja(0.42, 0.25, 0.2, 0.3)
    # Fuste con 5 estrías
    hu, df = 0.4 * kw, 0.22 * kd
    zf0, zf1, zs0, zs1 = 0.62 * kz, 4.9 * kz, 0.3 * kz, 5.18 * kz
    c.cara([mk.p(-hu, 0, zs0), mk.p(-hu, df, zs0), mk.p(-hu, df, zs1), mk.p(-hu, 0, zs1)], p, hacia=-mk.u)
    c.cara([mk.p(hu, 0, zs0), mk.p(hu, df, zs0), mk.p(hu, df, zs1), mk.p(hu, 0, zs1)], p, hacia=mk.u)
    c.cara([mk.p(-hu, df, zs0), mk.p(hu, df, zs0), mk.p(hu, df, zf0), mk.p(-hu, df, zf0)], p, hacia=mk.d)
    c.cara([mk.p(-hu, df, zf1), mk.p(hu, df, zf1), mk.p(hu, df, zs1), mk.p(-hu, df, zs1)], p, hacia=mk.d)
    margen, fw, prof = 0.07 * kw, 0.09 * kw, 0.016 * kd
    filete = (2 * hu - 2 * margen - 5 * fw) / 4
    u = -hu
    tramos = [(u, -hu + margen, False)]
    u = -hu + margen
    for i in range(5):
        tramos.append((u, u + fw, True))
        u += fw
        if i < 4:
            tramos.append((u, u + filete, False))
            u += filete
    tramos.append((u, hu, False))
    for a, b, estria in tramos:
        d = df - prof if estria else df
        c.cara([mk.p(a, d, zf0), mk.p(b, d, zf0), mk.p(b, d, zf1), mk.p(a, d, zf1)], p, hacia=mk.d)
        if estria:
            c.cara([mk.p(a, d, zf0), mk.p(a, df, zf0), mk.p(a, df, zf1), mk.p(a, d, zf1)], p, hacia=mk.u)
            c.cara([mk.p(b, d, zf0), mk.p(b, df, zf0), mk.p(b, df, zf1), mk.p(b, d, zf1)], p, hacia=-mk.u)
            c.cara([mk.p(a, d, zf0), mk.p(b, d, zf0), mk.p(b, df, zf0), mk.p(a, df, zf0)], p, hacia=mk.z)
            c.cara([mk.p(a, d, zf1), mk.p(b, d, zf1), mk.p(b, df, zf1), mk.p(a, df, zf1)], p, hacia=-mk.z)
    # Capitel jónico
    caja(0.42, 0.24, 5.18, 5.23)
    caja(0.43, 0.25, 5.23, 5.36)
    caja(0.5, 0.26, 5.3, 5.48)
    caja(0.5, 0.29, 5.48, 5.6)
    for s in (-1, 1):
        voluta(c, mk, s * 0.4 * kw, 5.33 * kz, 0.11 * kw, 0, 0.27 * kd, s)


PERFIL_ENTABLAMENTO = [  # (d hacia la sala, z)
    (0.0, 5.6), (0.2, 5.6), (0.2, 5.72), (0.22, 5.72), (0.22, 5.88), (0.18, 5.88), (0.18, 6.2),
    (0.24, 6.2), (0.28, 6.25), (0.28, 6.34), (0.54, 6.34), (0.54, 6.44), (0.5, 6.5), (0.0, 6.5),
]


def perfil_extruido(c, mk, largo, perfil, mat, inglete=(True, True)):
    """Extruye un perfil (d, z) a lo largo de u = 0..largo con ingletes de esquina interior."""
    for (da, za), (db, zb) in zip(perfil, perfil[1:]):
        if abs(da - db) < 1e-9 and abs(za - zb) < 1e-9:
            continue
        ua0, ub0 = (da if inglete[0] else 0), (db if inglete[0] else 0)
        ua1, ub1 = largo - (da if inglete[1] else 0), largo - (db if inglete[1] else 0)
        pts = [mk.p(ua0, da, za), mk.p(ua1, da, za), mk.p(ub1, db, zb), mk.p(ub0, db, zb)]
        hacia = mk.d * (zb - za) + mk.z * -(db - da)
        c.cara(pts, mat, hacia=hacia)


def denticulos(c, mk, largo):
    paso, w = 0.11, 0.06
    n = int((largo - 0.6) / paso)
    u = (largo - n * paso) / 2
    for _ in range(n):
        c.caja_local(mk, u, u + w, 0.28, 0.33, 6.25, 6.34, M['piedra'])
        u += paso


def entablamento(c):
    tramos = [
        (Marco((-X, 0, 0), (0, 1, 0), (1, 0, 0)), LARGO),
        (Marco((X, LARGO, 0), (0, -1, 0), (-1, 0, 0)), LARGO),
        (Marco((X, 0, 0), (-1, 0, 0), (0, 1, 0)), 2 * X),
        (Marco((-X, LARGO, 0), (1, 0, 0), (0, -1, 0)), 2 * X),
    ]
    for mk, largo in tramos:
        perfil_extruido(c, mk, largo, PERFIL_ENTABLAMENTO, M['piedra'])
        denticulos(c, mk, largo)


# ------------------------------------------------------------------ muros

def hornacina(c, mk, uc, pieza, piezas):
    """Hornacina de planta semicircular con cuarto de esfera, interior en rojo pompeyano."""
    r, zs, za, prof = 0.72, Z_ZOC, 2.45, 0.5
    n = 16
    centro_eje = mk.p(uc, 0, za)
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
        p0 = (uc - r * math.cos(a0), -prof * math.sin(a0))
        p1 = (uc - r * math.cos(a1), -prof * math.sin(a1))
        lado = [mk.p(p0[0], p0[1], zs), mk.p(p1[0], p1[1], zs), mk.p(p1[0], p1[1], za), mk.p(p0[0], p0[1], za)]
        c.cara(lado, M['pompeyano'], hacia=mk.p(uc, 0, zs) - sum(lado, Vector()) / 4)
        c.cara([mk.p(uc, 0, zs), mk.p(p0[0], p0[1], zs), mk.p(p1[0], p1[1], zs)], M['piedra'], hacia=mk.z)
        # cuarto de esfera
        for j in range(8):
            e0, e1 = math.pi / 2 * j / 8, math.pi / 2 * (j + 1) / 8
            q = []
            for a, e in ((a0, e0), (a1, e0), (a1, e1), (a0, e1)):
                q.append(mk.p(uc - r * math.cos(a) * math.cos(e), -prof * math.sin(a) * math.cos(e), za + r * math.sin(e)))
            c.cara(q, M['pompeyano'], hacia=centro_eje - sum(q, Vector()) / 4)
    # Arquivolta de piedra
    w = 0.09
    for k in range(16):
        a0, a1 = math.pi * k / 16, math.pi * (k + 1) / 16
        q = [mk.p(uc - (r + s) * math.cos(a), 0.035, za + (r + s) * math.sin(a)) for s, a in ((0, a0), (0, a1), (w, a1), (w, a0))]
        c.cara(q, M['piedra'], hacia=mk.d)
        for s in (0, w):
            lado = [mk.p(uc - (r + s) * math.cos(a), dd, za + (r + s) * math.sin(a)) for a, dd in ((a0, 0), (a1, 0), (a1, 0.035), (a0, 0.035))]
            cl = sum(lado, Vector()) / 4
            c.cara(lado, M['piedra'], hacia=(cl - centro_eje) if s else (centro_eje - cl))
    for s in (-1, 1):
        c.caja_local(mk, uc + s * r - (w if s < 0 else 0), uc + s * r + (0 if s < 0 else w), 0, 0.035, Z_ZOC + 0.05, za, M['piedra'])
    pieza_hornacina(mk, uc, zs, pieza, piezas)
    return {'u0': uc - r, 'u1': uc + r, 'z0': zs, 'z1': za, 'arco': True}


def torno(c, perfil, base, mat, segmentos=40):
    """Sólido de revolución alrededor del eje z que pasa por `base`. perfil: [(radio, z)]."""
    alto = perfil[-1][1] - perfil[0][1]
    for k in range(segmentos):
        a0, a1 = 2 * math.pi * k / segmentos, 2 * math.pi * (k + 1) / segmentos
        for (ra, za), (rb, zb) in zip(perfil, perfil[1:]):
            pts = [base + Vector((ra * math.cos(a0), ra * math.sin(a0), za)), base + Vector((ra * math.cos(a1), ra * math.sin(a1), za)),
                   base + Vector((rb * math.cos(a1), rb * math.sin(a1), zb)), base + Vector((rb * math.cos(a0), rb * math.sin(a0), zb))]
            uvs = [(k / segmentos, (za - perfil[0][1]) / alto), ((k + 1) / segmentos, (za - perfil[0][1]) / alto),
                   ((k + 1) / segmentos, (zb - perfil[0][1]) / alto), (k / segmentos, (zb - perfil[0][1]) / alto)]
            am = (a0 + a1) / 2
            radial = Vector((math.cos(am), math.sin(am), 0))
            normal2d = Vector((zb - za, 0, -(rb - ra)))  # (radial, z) hacia fuera del perfil
            hacia = radial * normal2d.x + Vector((0, 0, normal2d.z))
            if ra < 1e-6 and rb < 1e-6:
                continue
            if ra < 1e-6:
                pts, uvs = [pts[0], pts[2], pts[3]], [uvs[0], uvs[2], uvs[3]]
            elif rb < 1e-6:
                pts, uvs = pts[:3], uvs[:3]
            c.cara(pts, mat, uvs=uvs, hacia=hacia)


ANFORA = [(0.0, 0.0), (0.09, 0.0), (0.1, 0.03), (0.06, 0.07), (0.05, 0.12), (0.14, 0.25), (0.24, 0.42),
          (0.26, 0.52), (0.24, 0.66), (0.17, 0.76), (0.085, 0.82), (0.075, 0.9), (0.105, 0.95), (0.11, 0.98), (0.08, 0.99), (0.0, 0.99)]
CRATERA = [(0.0, 0.0), (0.13, 0.0), (0.13, 0.03), (0.08, 0.06), (0.06, 0.12), (0.12, 0.17), (0.2, 0.22),
           (0.22, 0.3), (0.24, 0.42), (0.3, 0.58), (0.34, 0.66), (0.35, 0.69), (0.3, 0.69), (0.0, 0.69)]


def pieza_hornacina(mk, uc, zs, pieza, piezas):
    base = mk.p(uc, -0.22, zs)
    # pedestal cilíndrico de piedra
    torno(piezas, [(0.0, 0.0), (0.26, 0.0), (0.26, 0.06), (0.22, 0.08), (0.22, 0.22), (0.26, 0.24), (0.26, 0.28), (0.0, 0.28)],
          base, M['piedra'], segmentos=32)
    cuerpo = base + Vector((0, 0, 0.28))
    torno(piezas, ANFORA if pieza == 'anfora' else CRATERA, cuerpo, M['terracota'])
    asas(mk, cuerpo, pieza)


def asas(mk, cuerpo, pieza):
    """Asas como tubos (curva con bisel) que luego se unen al objeto de piezas."""
    if pieza == 'anfora':
        tramos = [[(0.16, 0.74), (0.24, 0.8), (0.24, 0.9), (0.1, 0.9)]]
    else:
        tramos = [[(0.22, 0.32), (0.34, 0.33), (0.4, 0.42), (0.33, 0.47)]]
    for s in (-1, 1):
        for tramo in tramos:
            cu = bpy.data.curves.new('asa', 'CURVE')
            cu.dimensions = '3D'
            cu.bevel_depth = 0.018
            cu.bevel_resolution = 2
            sp = cu.splines.new('POLY')
            sp.points.add(len(tramo) - 1)
            for p, (r, z) in zip(sp.points, tramo):
                v = cuerpo + mk.u * (s * r) + Vector((0, 0, z))
                p.co = (*v, 1)
            ob = bpy.data.objects.new('asa', cu)
            bpy.context.scene.collection.objects.link(ob)
            ob.data.materials.append(M['terracota'])
            ob['unir_a'] = 'piezas'


def lunetos(c):
    """Cierres semicirculares de la bóveda en ambos extremos; ventana termal en el fondo."""
    n = 32
    # Lado de las puertas: lunetto liso
    mk = PAREDES['puertas'](0)
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
        tri = [mk.p(0, 0, Z_IMP), mk.p(R * math.cos(a0), 0, Z_IMP + R * math.sin(a0)), mk.p(R * math.cos(a1), 0, Z_IMP + R * math.sin(a1))]
        c.cara(tri, M['yeso'], hacia=mk.d)
    # Fondo: ventana termal con dos parteluces
    mk = PAREDES['fondo'](0)
    rv, marco, prof = 2.5, 0.16, 0.3
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n

        def arco(r, a, d=0.0):
            return mk.p(r * math.cos(a), d, Z_IMP + r * math.sin(a))

        c.cara([arco(rv + marco, a0), arco(R, a0), arco(R, a1), arco(rv + marco, a1)], M['yeso'], hacia=mk.d)
        c.cara([arco(rv, a0, 0.03), arco(rv + marco, a0, 0.03), arco(rv + marco, a1, 0.03), arco(rv, a1, 0.03)], M['piedra'], hacia=mk.d)
        borde = [arco(rv + marco, a0, 0), arco(rv + marco, a1, 0), arco(rv + marco, a1, 0.03), arco(rv + marco, a0, 0.03)]
        c.cara(borde, M['piedra'], hacia=sum(borde, Vector()) / 4 - mk.p(0, 0, Z_IMP))
        intrados = [arco(rv, a0, 0.03), arco(rv, a1, 0.03), arco(rv, a1, -prof), arco(rv, a0, -prof)]
        c.cara(intrados, M['yeso'], hacia=mk.p(0, 0, Z_IMP) - sum(intrados, Vector()) / 4)
    c.cara([mk.p(-rv, 0.03, Z_IMP), mk.p(rv, 0.03, Z_IMP), mk.p(rv, -prof, Z_IMP), mk.p(-rv, -prof, Z_IMP)], M['piedra'], hacia=mk.z)
    for u in (-rv / 3, rv / 3):
        alto = math.sqrt(rv ** 2 - u ** 2)
        c.caja_local(mk, u - 0.07, u + 0.07, -prof, -0.02, Z_IMP, Z_IMP + alto, M['piedra'], sin_fondo=False)


def vidrio_termal(c):
    mk = PAREDES['fondo'](0)
    rv, prof = 2.5, 0.3
    n = 32
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
        c.cara([mk.p(0, -prof + 0.01, Z_IMP), mk.p(rv * math.cos(a0), -prof + 0.01, Z_IMP + rv * math.sin(a0)),
                mk.p(rv * math.cos(a1), -prof + 0.01, Z_IMP + rv * math.sin(a1))], M['luna'], hacia=mk.d)


def muros(piezas):
    c = constructor('yeso', 'zocalo', 'piedra', 'pompeyano')
    hornacinas = {}
    for h in L['hornacinas']:
        hornacinas.setdefault(h['pared'], []).append(h)

    for lado in ('izquierda', 'derecha'):
        mk = PAREDES[lado](0)
        signo = 1 if lado == 'izquierda' else -1  # u = y en la izquierda, u = -y en la derecha
        huecos = []
        for h in hornacinas.get(lado, []):
            hk = hornacina(c, mk, signo * h['y'], h['pieza'], piezas)
            huecos.append(hk)
            escena['obstaculos'].append(rect_plano(mk, signo * h['y'] - 0.3, signo * h['y'] + 0.3, -0.5, 0.05))
        u0, u1 = sorted((0, signo * LARGO))
        pared_con_huecos(c, mk, u0, u1, Z_ZOC, Z_ENT, huecos, M['yeso'])
        zocalo(c, mk, u0, u1)
        for y in PIL['y']:
            pilastra(c, PAREDES[lado](y))
            escena['obstaculos'].append(rect_plano(PAREDES[lado](y), -0.47, 0.47, 0, 0.3))

    # Pared de las puertas
    mk = PAREDES['puertas'](0)
    pa, pz = L['puertas']['ancho'] / 2, L['puertas']['alto']
    pared_con_huecos(c, mk, -X, X, Z_ZOC, Z_ENT, [{'u0': -pa, 'u1': pa, 'z0': 0, 'z1': pz}], M['yeso'])
    pared_con_huecos(c, mk, -X, X, 0, Z_ZOC, [{'u0': -pa, 'u1': pa, 'z0': 0, 'z1': pz}], M['yeso'])
    zocalo(c, mk, -X, X, huecos=[(-pa - 0.3, pa + 0.3)])
    puertas(c, mk, pa, pz)

    # Pared del fondo
    mk = PAREDES['fondo'](0)
    pared_con_huecos(c, mk, -X, X, Z_ZOC, Z_ENT, [], M['yeso'])
    zocalo(c, mk, -X, X)
    entablamento(c)
    lunetos(c)
    return c.objeto('muros', lightmap='muros')


def puertas(c, mk, pa, pz):
    """Jambas, dintel y frontón de las puertas (piedra); las hojas de bronce van aparte."""
    prof = 0.35
    # mochetas del vano
    c.cara([mk.p(-pa, 0, 0), mk.p(-pa, -prof, 0), mk.p(-pa, -prof, pz), mk.p(-pa, 0, pz)], M['yeso'], hacia=mk.u)
    c.cara([mk.p(pa, 0, 0), mk.p(pa, -prof, 0), mk.p(pa, -prof, pz), mk.p(pa, 0, pz)], M['yeso'], hacia=-mk.u)
    c.cara([mk.p(-pa, 0, pz), mk.p(pa, 0, pz), mk.p(pa, -prof, pz), mk.p(-pa, -prof, pz)], M['yeso'], hacia=-mk.z)
    c.cara([mk.p(-pa, 0, 0), mk.p(pa, 0, 0), mk.p(pa, -prof, 0), mk.p(-pa, -prof, 0)], M['piedra'], hacia=mk.z)
    # marco (jambas + dintel) y cornisa
    w = 0.26
    c.caja_local(mk, -pa - w, -pa, 0, 0.07, 0, pz + w, M['piedra'])
    c.caja_local(mk, pa, pa + w, 0, 0.07, 0, pz + w, M['piedra'])
    c.caja_local(mk, -pa, pa, 0, 0.07, pz, pz + w, M['piedra'])
    c.caja_local(mk, -pa - w - 0.05, pa + w + 0.05, 0, 0.1, pz + w, pz + w + 0.28, M['piedra'])
    c.caja_local(mk, -pa - w - 0.15, pa + w + 0.15, 0, 0.24, pz + w + 0.28, pz + w + 0.4, M['piedra'])


def hojas_puerta():
    mk = PAREDES['puertas'](0)
    pa, pz = L['puertas']['ancho'] / 2, L['puertas']['alto']
    c = constructor('bronce', 'laton')
    d0 = -0.35
    for s in (-1, 1):
        a, b = (-pa, -0.005) if s < 0 else (0.005, pa)
        c.caja_local(mk, a, b, d0, d0 + 0.06, 0, pz, M['bronce'])
        # cuarterones en relieve
        for z0, z1 in ((0.35, 1.7), (1.95, 3.85)):
            c.caja_local(mk, a + 0.16, b - 0.16, d0 + 0.06, d0 + 0.09, z0, z1, M['bronce'])
        c.caja_local(mk, (b - 0.12) if s < 0 else (a + 0.06), (b - 0.06) if s < 0 else (a + 0.12), d0 + 0.06, d0 + 0.12, 1.75, 1.95, M['laton'])
    return c.objeto('puertas')


def rect_plano(mk, u0, u1, d0, d1):
    """Rectángulo de colisión (x0, z0, x1, z1) en coordenadas de Three.js para un área local de pared."""
    pts = [mk.p(u, d, 0) for u in (u0, u1) for d in (d0, d1)]
    xs = [p.x for p in pts]
    zs = [-p.y for p in pts]
    return [round(min(xs), 3), round(min(zs), 3), round(max(xs), 3), round(max(zs), 3)]


# ------------------------------------------------------------------ bóveda

def punto_boveda(th, y, r):
    return Vector((r * math.sin(th), y, Z_IMP + r * math.cos(th)))


def boveda():
    c = constructor('yeso', 'piedra', 'dorado')
    cfg = L['boveda']
    s0 = cfg['lucernario']['ancho'] / 2
    s1 = math.pi * R / 2
    filas = cfg['filasCasetones']
    wr = 0.18
    cs = (s1 - s0 - (filas + 1) * wr) / filas
    medio_fajon = PIL['ancho'] / 2
    lim = [0.0] + [v for y in PIL['y'] for v in (y - medio_fajon, y + medio_fajon)] + [LARGO]
    segmentos = list(zip(lim[0::2], lim[1::2]))
    luz_largo = cfg['lucernario']['largo']
    tramos_con_lucernario = [(a + b) / 2 for a, b in segmentos[1:-1]]

    cortes_s = [s0]
    for _ in range(filas):
        cortes_s += [cortes_s[-1] + wr, cortes_s[-1] + wr + cs]
    cortes_s.append(s1)

    for ya, yb in segmentos:
        largo = yb - ya
        ny = max(1, round((largo - wr) / (cs + wr)))
        cy = (largo - (ny + 1) * wr) / ny
        cortes_y = [ya]
        for _ in range(ny):
            cortes_y += [cortes_y[-1] + wr, cortes_y[-1] + wr + cy]
        cortes_y.append(yb)
        for lado in (-1, 1):
            for i, (sa, sb) in enumerate(zip(cortes_s, cortes_s[1:])):
                for j, (y0, y1) in enumerate(zip(cortes_y, cortes_y[1:])):
                    th0, th1 = lado * sa / R, lado * sb / R
                    if i % 2 == 1 and j % 2 == 1:
                        caseton(c, th0, th1, y0, y1)
                    else:
                        panel_boveda(c, th0, th1, y0, y1)
        # franja de la clave: lucernario en los tramos centrales
        yc = (ya + yb) / 2
        th = s0 / R
        if any(abs(yc - t) < 1e-6 for t in tramos_con_lucernario):
            la, lb = yc - luz_largo / 2, yc + luz_largo / 2
            panel_boveda(c, -th, th, ya, la)
            panel_boveda(c, -th, th, lb, yb)
            lucernario(c, th, la, lb)
        else:
            panel_boveda(c, -th, th, ya, yb)
    for y in PIL['y']:
        fajon(c, y - medio_fajon, y + medio_fajon)
    return c.objeto('boveda', lightmap='boveda')


def panel_boveda(c, th0, th1, y0, y1, r=R, n=None):
    th0, th1 = min(th0, th1), max(th0, th1)
    n = n or max(1, int(abs(th1 - th0) / 0.08))
    for k in range(n):
        a = th0 + (th1 - th0) * k / n
        b = th0 + (th1 - th0) * (k + 1) / n
        pts = [punto_boveda(a, y0, r), punto_boveda(b, y0, r), punto_boveda(b, y1, r), punto_boveda(a, y1, r)]
        eje = Vector((0, (y0 + y1) / 2, Z_IMP))
        c.cara(pts, M['yeso'], hacia=eje - sum(pts, Vector()) / 4)


def caseton(c, th0, th1, y0, y1):
    th0, th1 = min(th0, th1), max(th0, th1)
    anillos = [(R, 0.0), (R + 0.05, 0.035), (R + 0.05, 0.06), (R + 0.13, 0.085)]
    tm = (th0 + th1) / 2
    centro_boca = punto_boveda(tm, (y0 + y1) / 2, R)

    def anillo(r, ins):
        a, b = th0 + ins / r, th1 - ins / r
        m = (a + b) / 2
        ya, yb = y0 + ins, y1 - ins
        return [punto_boveda(a, ya, r), punto_boveda(m, ya, r), punto_boveda(b, ya, r),
                punto_boveda(b, yb, r), punto_boveda(m, yb, r), punto_boveda(a, yb, r)]

    previo = anillo(*anillos[0])
    for r, ins in anillos[1:]:
        actual = anillo(r, ins)
        for k in range(6):
            q = [previo[k], previo[(k + 1) % 6], actual[(k + 1) % 6], actual[k]]
            c.cara(q, M['yeso'], hacia=centro_boca - sum(q, Vector()) / 4)
        previo = actual
    fondo = previo
    for q in ([fondo[0], fondo[1], fondo[4], fondo[5]], [fondo[1], fondo[2], fondo[3], fondo[4]]):
        c.cara(q, M['yeso'], hacia=centro_boca - sum(q, Vector()) / 4)
    # rosetón dorado
    r_fondo = anillos[-1][0]
    centro = punto_boveda(tm, (y0 + y1) / 2, r_fondo)
    radial = (centro - Vector((0, centro.y, Z_IMP))).normalized()
    rot = radial.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    pet = 8
    estrella = []
    for k in range(pet * 2):
        a = math.pi * k / pet
        ra = 0.13 if k % 2 == 0 else 0.07
        estrella.append(centro + rot @ Vector((ra * math.cos(a), ra * math.sin(a), -0.01)))
    cima = centro + rot @ Vector((0, 0, -0.05))
    for k in range(len(estrella)):
        c.cara([cima, estrella[k], estrella[(k + 1) % len(estrella)]], M['dorado'], hacia=-radial)


def lucernario(c, th, y0, y1):
    """Pozo del lucernario sobre la clave, cerrado arriba por un vidrio de luna."""
    z_top = Z_IMP + R + 0.7
    xr = R * math.sin(th)
    zr = Z_IMP + R * math.cos(th)
    for s in (-1, 1):
        q = [Vector((s * xr, y0, zr)), Vector((s * xr, y1, zr)), Vector((s * xr, y1, z_top)), Vector((s * xr, y0, z_top))]
        c.cara(q, M['yeso'], hacia=(-s, 0, 0))
    n = 6
    for yy, hacia in ((y0, (0, 1, 0)), (y1, (0, -1, 0))):
        for k in range(n):
            a = -th + 2 * th * k / n
            b = -th + 2 * th * (k + 1) / n
            pa, pb = punto_boveda(a, yy, R), punto_boveda(b, yy, R)
            c.cara([pa, pb, Vector((pb.x, yy, z_top)), Vector((pa.x, yy, z_top))], M['yeso'], hacia=hacia)
    vidrios.append(((-xr, y0, z_top - 0.02), (xr, y1, z_top - 0.02)))


vidrios = []


def fajon(c, y0, y1):
    """Arco fajón: banda de piedra que cruza la bóveda sobre cada pareja de pilastras."""
    n = 40
    rin = R - 0.12
    for k in range(n):
        a = -math.pi / 2 + math.pi * k / n
        b = -math.pi / 2 + math.pi * (k + 1) / n
        sof = [punto_boveda(a, y0, rin), punto_boveda(b, y0, rin), punto_boveda(b, y1, rin), punto_boveda(a, y1, rin)]
        eje = Vector((0, (y0 + y1) / 2, Z_IMP))
        c.cara(sof, M['piedra'], hacia=eje - sum(sof, Vector()) / 4)
        for yy, hacia in ((y0, (0, -1, 0)), (y1, (0, 1, 0))):
            c.cara([punto_boveda(a, yy, rin), punto_boveda(b, yy, rin), punto_boveda(b, yy, R), punto_boveda(a, yy, R)], M['piedra'], hacia=hacia)


# ------------------------------------------------------------------ obras

def imagen_obra(oid):
    return bpy.data.images.load(os.path.join(comun.PUBLICO, 'obras', f'{oid}-media.webp'), check_existing=True)


PERFIL_ORO = [  # (w hacia fuera desde el borde visible, h hacia la sala), en fracción del ancho de marco
    (-0.06, 0.38), (0.0, 0.62), (0.08, 0.78), (0.16, 0.8), (0.26, 0.92), (0.42, 1.0), (0.58, 0.9),
    (0.74, 0.74), (0.84, 0.8), (0.94, 0.78), (1.0, 0.55), (1.0, 0.0),
]


def marco_perfil(c, mk, uc, zc, ancho, alto, perfil, g, h, mat):
    """Barre un perfil alrededor del rectángulo visible del cuadro (ingletes en las esquinas)."""
    def anillo(w, d):
        a, b = ancho / 2 + w, alto / 2 + w
        return [mk.p(uc - a, d, zc - b), mk.p(uc + a, d, zc - b), mk.p(uc + a, d, zc + b), mk.p(uc - a, d, zc + b)]
    fuera = [-mk.z, mk.u, mk.z, -mk.u]  # abajo, derecha, arriba, izquierda
    puntos = [(w * g, d * h) for w, d in perfil]
    for (wa, da), (wb, db) in zip(puntos, puntos[1:]):
        A, B = anillo(wa, da), anillo(wb, db)
        for k in range(4):
            q = [A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k]]
            hacia = fuera[k] * -(db - da) + mk.d * (wb - wa)
            c.cara(q, mat, hacia=hacia)


def cuentas(c, mk, uc, zc, ancho, alto, w, d, radio, mat):
    """Moldura de cuentas: pequeñas esferas a lo largo de un anillo del marco."""
    a, b = ancho / 2 + w, alto / 2 + w
    perimetro = 4 * (a + b)
    n = int(perimetro / (radio * 2.7))
    ico = bmesh.new()
    bmesh.ops.create_icosphere(ico, subdivisions=1, radius=radio)
    for k in range(n):
        t = k / n * perimetro
        if t < 2 * a:
            u, z = -a + t, -b
        elif t < 2 * a + 2 * b:
            u, z = a, -b + (t - 2 * a)
        elif t < 4 * a + 2 * b:
            u, z = a - (t - 2 * a - 2 * b), b
        else:
            u, z = -a, b - (t - 4 * a - 2 * b)
        centro = mk.p(uc + u, d, zc + z)
        for f in ico.faces:
            pts = [centro + v.co for v in f.verts]
            c.cara(pts, mat, hacia=sum(pts, Vector()) / len(pts) - centro)
    ico.free()


def colgar_obra(cfg, lienzos, oros, piezas, marcos):
    oid = cfg['id']
    meta = OBRAS[oid]
    img = imagen_obra(oid)
    aspecto = img.size[0] / img.size[1]
    alto = cfg.get('expuesto', {}).get('alto') or meta['medidas']['alto'] / 100
    ancho = alto * aspecto
    dorado = cfg['marco'] == 'dorado'
    mk = PAREDES[cfg['pared']](cfg['x'] if cfg['pared'] == 'fondo' else cfg['y'])
    if dorado:
        g = 0.1 + 0.03 * alto
        exterior_w, exterior_h = ancho + 2 * g, alto + 2 * g
    else:
        g, mat_l, mat_b = 0.03, 0.12, 0.15
        exterior_w = ancho + 2 * (mat_l + g)
        exterior_h = alto + mat_l + mat_b + 2 * g
    z_base = 1.2 if cfg.get('edicula') else 1.12
    zc_ext = max(1.58, z_base + exterior_h / 2)
    zc = zc_ext if dorado else zc_ext + (mat_b - mat_l) / 2

    # Lienzo (o lámina): UV completas, normal hacia la sala
    mat_lienzo = comun.material(f'lienzo_{oid}', imagen=img, rugosidad=0.55 if dorado else 0.85, especular=0.35)
    d_lienzo = 0.035 if dorado else 0.008
    extra = 0.006 if dorado else 0.0
    q = [mk.p(-ancho / 2 - extra, d_lienzo, zc - alto / 2 - extra), mk.p(ancho / 2 + extra, d_lienzo, zc - alto / 2 - extra),
         mk.p(ancho / 2 + extra, d_lienzo, zc + alto / 2 + extra), mk.p(-ancho / 2 - extra, d_lienzo, zc + alto / 2 + extra)]
    cl = Constructor([mat_lienzo])
    cl.cara(q, mat_lienzo, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], hacia=mk.d)
    obj = cl.objeto(f'lienzo_{oid}', lightmap='obras')
    obj['obra'] = oid
    lienzos.append(obj)

    if dorado:
        h = 0.07 + 0.012 * alto
        marco_perfil(marcos, mk, 0, zc, ancho, alto, PERFIL_ORO, g, h, M['oro_marco'])
        cuentas(oros, mk, 0, zc, ancho, alto, 0.12 * g, 0.8 * h + 0.004, 0.0075, M['oro'])
    else:
        # paspartú con bisel blanco y marco negro fino
        wl, wb = mat_l, mat_b
        dm = 0.016
        ventana = [mk.p(-ancho / 2, dm - 0.006, zc - alto / 2), mk.p(ancho / 2, dm - 0.006, zc - alto / 2),
                   mk.p(ancho / 2, dm - 0.006, zc + alto / 2), mk.p(-ancho / 2, dm - 0.006, zc + alto / 2)]
        exterior = [mk.p(-ancho / 2 - wl, dm, zc - alto / 2 - wb), mk.p(ancho / 2 + wl, dm, zc - alto / 2 - wb),
                    mk.p(ancho / 2 + wl, dm, zc + alto / 2 + wl), mk.p(-ancho / 2 - wl, dm, zc + alto / 2 + wl)]
        bisel = [mk.p(-ancho / 2 - 0.006, dm, zc - alto / 2 - 0.006), mk.p(ancho / 2 + 0.006, dm, zc - alto / 2 - 0.006),
                 mk.p(ancho / 2 + 0.006, dm, zc + alto / 2 + 0.006), mk.p(-ancho / 2 - 0.006, dm, zc + alto / 2 + 0.006)]
        for k in range(4):
            piezas.cara([exterior[k], exterior[(k + 1) % 4], bisel[(k + 1) % 4], bisel[k]], M['paspartu'], hacia=mk.d)
            piezas.cara([bisel[k], bisel[(k + 1) % 4], ventana[(k + 1) % 4], ventana[k]], M['paspartu'], hacia=mk.d)
        perfil_negro = [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)]
        hm = 0.035
        uc0 = 0
        zc_m = zc_ext
        marco_perfil(piezas, mk, uc0, zc_m, exterior_w - 2 * g, exterior_h - 2 * g, perfil_negro, g, hm, M['negro'])

    # Cartela a la derecha de la obra
    u_cartela = exterior_w / 2 + 0.42 if not cfg.get('edicula') else 2.75
    indice = len(escena['cartelas'])
    escena['cartelas'][oid] = indice
    cartela(piezas, mk, u_cartela, 1.42, indice)

    centro = mk.p(0, d_lienzo, zc)
    escena['obras'].append({
        'id': oid,
        'centro': comun.a_three(centro),
        'normal': comun.a_three(mk.d),
        'ancho': round(exterior_w, 3),
        'alto': round(exterior_h, 3),
        'marco': cfg['marco'],
    })
    focos_obra(mk, cfg, exterior_w, zc_ext)
    return mk, exterior_w, exterior_h, zc_ext


CARTELA = (0.3, 0.19)
ATLAS_CARTELAS = (4, 2)


def cartela(c, mk, uc, zc, indice):
    w, h = CARTELA
    c.caja_local(mk, uc - w / 2, uc + w / 2, 0, 0.012, zc - h / 2, zc + h / 2, M['cartela'])
    cols, filas = ATLAS_CARTELAS
    col, fila = indice % cols, indice // cols
    u0, u1 = col / cols, (col + 1) / cols
    v1 = 1 - fila / filas
    v0 = 1 - (fila + 1) / filas
    frente = [mk.p(uc - w / 2, 0.0125, zc - h / 2), mk.p(uc + w / 2, 0.0125, zc - h / 2),
              mk.p(uc + w / 2, 0.0125, zc + h / 2), mk.p(uc - w / 2, 0.0125, zc + h / 2)]
    cartelas_frente.cara(frente, M['cartela'], uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)], hacia=mk.d)


cartelas_frente = None


# ------------------------------------------------------------------ edícula de la Venus

def edicula(c, letras_obj):
    mk = PAREDES['fondo'](0)
    xp = 1.98
    alto_pil = 3.55
    for s in (-1, 1):
        pilastra(c, Marco(mk.p(s * xp, 0, 0), mk.u, mk.d), alto=alto_pil, ancho=0.38, saliente=0.13)
    # entablamento propio
    perfil = [(0.0, 3.55), (0.15, 3.55), (0.15, 3.7), (0.12, 3.7), (0.12, 4.0), (0.17, 4.0), (0.2, 4.05),
              (0.3, 4.08), (0.3, 4.17), (0.26, 4.2), (0.0, 4.2)]
    largo = 4.8
    perfil_extruido(c, Marco(mk.p(-largo / 2, 0, 0), mk.u, mk.d), largo, perfil, M['piedra'], inglete=(False, False))
    for u in (-largo / 2, largo / 2):
        cara = [mk.p(u, d, z) for d, z in perfil]
        c.cara(cara, M['piedra'], hacia=mk.u * (1 if u > 0 else -1))
    # frontón: tímpano y cornisas inclinadas
    zb, zt = 4.2, 4.2 + 2.4 * math.tan(math.radians(15))
    c.cara([mk.p(-2.3, 0.1, zb), mk.p(2.3, 0.1, zb), mk.p(0, 0.1, zt - 0.08)], M['yeso'], hacia=mk.d)
    for s in (-1, 1):
        a0, a1 = mk.p(s * 2.45, 0, zb), mk.p(0, 0, zt)
        dir_ = (a1 - a0).normalized()
        normal_arriba = dir_.cross(mk.d).normalized()
        if normal_arriba.z < 0:
            normal_arriba = -normal_arriba
        hgt = 0.17
        q0 = [a0, a1, a1 + normal_arriba * hgt, a0 + normal_arriba * hgt]
        frente = [p + mk.d * 0.28 for p in q0]
        c.cara(frente, M['piedra'], hacia=mk.d)
        c.cara([q0[0], q0[1], frente[1], frente[0]], M['piedra'], hacia=-normal_arriba)
        c.cara([q0[3], q0[2], frente[2], frente[3]], M['piedra'], hacia=normal_arriba)
        c.cara([q0[0], q0[3], frente[3], frente[0]], M['piedra'], hacia=-dir_)
    c.cara([mk.p(-0.12, 0, zt), mk.p(0.12, 0, zt), mk.p(0.12, 0.28, zt), mk.p(-0.12, 0.28, zt)], M['piedra'], hacia=mk.z)
    # inscripción en el friso, con letras doradas en relieve
    texto(L['inscripcion'], mk.p(0, 0.125, 3.85), mk, 0.19, M['oro'], letras_obj)
    escena['obstaculos'].append(rect_plano(mk, -2.6, 2.6, 0, 0.35))


def fuente_romana():
    ruta = os.path.join(comun.RAIZ, 'node_modules', '@fontsource', 'cinzel', 'files', 'cinzel-latin-600-normal.woff')
    try:
        return bpy.data.fonts.load(ruta, check_existing=True)
    except Exception as e:
        print(f'[construir] aviso: no se pudo cargar Cinzel ({e}); uso la fuente por defecto')
        return None


def texto(cadena, centro, mk, tamano, mat, destino, extrusion=0.006, espaciado=1.15):
    cu = bpy.data.curves.new('texto', 'FONT')
    cu.body = cadena
    fuente = fuente_romana()
    if fuente:
        cu.font = fuente
    cu.size = tamano
    cu.extrude = extrusion
    cu.space_character = espaciado
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('texto', cu)
    bpy.context.scene.collection.objects.link(ob)
    # El texto se escribe en XY y mira a +Z: se gira para que mire hacia la sala (mk.d)
    rot = Matrix((mk.u, mk.z, mk.d)).transposed().to_4x4()
    ob.matrix_world = Matrix.Translation(centro) @ rot
    ob.data.materials.append(mat)
    ob['unir_a'] = destino
    return ob


# ------------------------------------------------------------------ luces

def potencia_para(angulo):
    return 1100 * (angulo / 38) ** 2


def focos_obra(mk, cfg, ancho_ext, zc):
    x_carril, z_carril = L['carriles']['x'], L['carriles']['z']
    if cfg['pared'] == 'fondo':
        objetivo_c = mk.p(0, 0, zc)
        for s in (-1, 1):
            pos = Vector((s * x_carril, LARGO - 3.6, z_carril - 0.14))
            obj = objetivo_c + mk.u * (s * ancho_ext * 0.22)
            anadir_foco(pos, obj, 44, 1.25)
        return
    n = 1 if ancho_ext < 1.2 else 2 if ancho_ext < 3.2 else 3
    desplaz = {1: [0], 2: [-ancho_ext / 4, ancho_ext / 4], 3: [-ancho_ext / 3, 0, ancho_ext / 3]}[n]
    signo_x = -1 if cfg['pared'] == 'izquierda' else 1
    for du in desplaz:
        objetivo = mk.p(du, 0, zc)
        pos = Vector((signo_x * x_carril, objetivo.y, z_carril - 0.14))
        dist = (objetivo - pos).length
        cubrir = (ancho_ext / n) / 2 + 0.45
        ang = max(24, min(56, math.degrees(2 * math.atan(cubrir / dist))))
        anadir_foco(pos, objetivo, ang, 0.55 if ancho_ext < 1.2 else 1.0)


focos_lista = []


def anadir_foco(pos, objetivo, angulo, intensidad=1.0):
    focos_lista.append((Vector(pos), Vector(objetivo), angulo, intensidad))


def crear_focos(piezas, lentes):
    """Luminarias en los carriles + luces de Cycles. Las luces se adelantan un poco a la lente."""
    for i, (pos, objetivo, ang, intens) in enumerate(focos_lista):
        direccion = (objetivo - pos).normalized()
        rot = direccion.to_track_quat('-Z', 'Y').to_matrix().to_4x4()
        base = Matrix.Translation(pos)
        # adaptador en el carril y horquilla
        piezas.caja_mundo(pos + Vector((-0.03, -0.03, 0.08)), pos + Vector((0.03, 0.03, 0.14)), M['hierro'])
        piezas.caja_mundo(pos + Vector((-0.008, -0.008, 0.0)), pos + Vector((0.008, 0.008, 0.08)), M['hierro'])
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.055, radius2=0.05, depth=0.2,
                              matrix=base @ rot @ Matrix.Translation((0, 0, 0.02)))
        bm.normal_update()
        for f in bm.faces:
            pts = [v.co.copy() for v in f.verts]
            piezas.cara(pts, M['hierro'], hacia=f.normal)
        bm.free()
        lente_c = pos + direccion * 0.12
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=0.042,
                                matrix=Matrix.Translation(lente_c) @ rot)
        for f in bm.faces:
            lentes.cara([v.co.copy() for v in f.verts], M['lente'], hacia=direccion)
        bm.free()
        comun.foco(f'foco_{i:02d}', lente_c + direccion * 0.03, objetivo,
                   potencia_para(ang) * intens, ang, mezcla=0.62, radio=0.04, color=COLOR_FOCO)
        escena['focos'].append({
            'posicion': comun.a_three(lente_c), 'objetivo': comun.a_three(objetivo),
            'angulo': round(ang, 1), 'intensidad': intens,
        })


def carriles(piezas):
    c = L['carriles']
    for s in (-1, 1):
        x = s * c['x']
        piezas.caja_mundo((x - 0.025, c['y0'], c['z'] - 0.02), (x + 0.025, c['y1'], c['z'] + 0.02), M['hierro'])
        # cables hasta la bóveda
        z_b = Z_IMP + math.sqrt(R ** 2 - x ** 2)
        y = c['y0'] + 0.4
        while y < c['y1']:
            if all(abs(y - p) > 0.6 for p in PIL['y']):
                piezas.caja_mundo((x - 0.004, y - 0.004, c['z'] + 0.02), (x + 0.004, y + 0.004, z_b), M['hierro'])
            y += 3.5


def luces_luna():
    for (a, b) in vidrios:
        luz = bpy.data.lights.new('luna', 'AREA')
        luz.shape = 'RECTANGLE'
        luz.size = abs(b[0] - a[0])
        luz.size_y = abs(b[1] - a[1])
        luz.energy = 7
        luz.color = COLOR_LUNA
        ob = bpy.data.objects.new('luna', luz)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2] - 0.05)
    luz = bpy.data.lights.new('luna_termal', 'AREA')
    luz.shape = 'DISK'
    luz.size = 4.0
    luz.energy = 20
    luz.color = COLOR_LUNA
    ob = bpy.data.objects.new('luna_termal', luz)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (0, LARGO + 0.2, Z_IMP + 1.0)
    ob.rotation_euler = (math.radians(-90), 0, 0)  # mira hacia -Y (al interior)
    # Las puertas reciben un par de focos tenues
    for s in (-1, 1):
        anadir_foco((s * L['carriles']['x'], L['carriles']['y0'] + 0.3, L['carriles']['z'] - 0.14), (s * 0.8, 0, 2.6), 46, 0.3)


# ------------------------------------------------------------------ mobiliario

def banco(piezas):
    b = L['banco']
    x, y, lx, ly, h = b['x'], b['y'], b['fondo'] / 2, b['largo'] / 2, b['alto']
    piezas.caja_mundo((x - lx, y - ly, h - 0.06), (x + lx, y + ly, h), M['madera'])
    for s in (-1, 1):
        yy = y + s * (ly - 0.12)
        piezas.caja_mundo((x - lx + 0.04, yy - 0.02, 0), (x - lx + 0.08, yy + 0.02, h - 0.06), M['hierro'])
        piezas.caja_mundo((x + lx - 0.08, yy - 0.02, 0), (x + lx - 0.04, yy + 0.02, h - 0.06), M['hierro'])
        piezas.caja_mundo((x - lx + 0.04, yy - 0.02, h - 0.1), (x + lx - 0.04, yy + 0.02, h - 0.06), M['hierro'])
    escena['obstaculos'].append([round(x - lx, 3), round(-(y + ly), 3), round(x + lx, 3), round(-(y - ly), 3)])


def catenaria(laton):
    cfg = L['catenaria']
    y = cfg['y']
    for x in cfg['x']:
        base = Vector((x, y, 0))
        torno(laton, [(0.0, 0.0), (0.16, 0.0), (0.16, 0.025), (0.06, 0.05), (0.025, 0.08), (0.025, 0.9),
                      (0.04, 0.93), (0.045, 0.96), (0.03, 0.99), (0.0, 1.0)], base, M['laton'], segmentos=24)
    for a, b in zip(cfg['x'], cfg['x'][1:]):
        cu = bpy.data.curves.new('cordon', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.022
        cu.bevel_resolution = 3
        sp = cu.splines.new('POLY')
        n = 16
        sp.points.add(n)
        for k in range(n + 1):
            t = k / n
            xx = a + (b - a) * t
            z = 0.9 - 0.2 * (1 - (2 * t - 1) ** 2)
            sp.points[k].co = (xx, y, z, 1)
        ob = bpy.data.objects.new('cordon', cu)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(M['terciopelo'])
        ob['unir_a'] = 'piezas'
    escena['obstaculos'].append([-X, -(y + 0.2), X, 0.0])


def cartel_salida(emisivos, letras_obj):
    mk = PAREDES['puertas'](0)
    z = L['puertas']['alto'] + 0.26 + 0.4 + 0.3
    emisivos.caja_local(mk, -0.24, 0.24, 0, 0.04, z, z + 0.16, M['salida'])
    texto('SALIDA', mk.p(0, 0.041, z + 0.08), mk, 0.075, M['salida_texto'], letras_obj, extrusion=0.002, espaciado=1.05)


# ------------------------------------------------------------------ unión, cámaras y escena

def convertir_y_unir(destinos):
    """Convierte textos y curvas en mallas y las une a su objeto destino."""
    for ob in [o for o in bpy.context.scene.objects if o.get('unir_a')]:
        destino = destinos[ob['unir_a']]
        dg = bpy.context.evaluated_depsgraph_get()
        malla = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        malla.transform(ob.matrix_world)
        nuevo = bpy.data.objects.new(ob.name + '_m', malla)
        bpy.context.scene.collection.objects.link(nuevo)
        bpy.data.objects.remove(ob)
        if not nuevo.data.uv_layers:
            nuevo.data.uv_layers.new(name='UVMap')
        else:
            nuevo.data.uv_layers[0].name = 'UVMap'
        bpy.ops.object.select_all(action='DESELECT')
        destino.select_set(True)
        nuevo.select_set(True)
        bpy.context.view_layer.objects.active = destino
        bpy.ops.object.join()


def camaras():
    escena['camaras'] = {}
    for nombre, cfg in L['camaras'].items():
        pos = (cfg['x'], cfg['y'], cfg['z'])
        ob = comun.camara(f'cam_{nombre}', pos, cfg['mira'])
        ob.data.sensor_fit = 'VERTICAL'
        ob.data.sensor_height = 24
        ob.data.lens = 12 / math.tan(math.radians(30))
        escena['camaras'][nombre] = {'posicion': comun.a_three(pos), 'mira': comun.a_three(cfg['mira']), 'fov': 60}
    bpy.context.scene.camera = bpy.data.objects['cam_entrada']


def main():
    global cartelas_frente
    comun.escena_vacia()
    materiales()

    piezas = constructor('hierro', 'piedra', 'terracota', 'madera', 'cartela', 'paspartu', 'negro')
    oros = constructor('oro')
    laton = constructor('laton')
    lentes = constructor('lente')
    emisivos = constructor('salida', 'luna')
    cartelas_frente = Constructor([M['cartela']])
    lienzos = []
    marcos = constructor('oro_marco')

    suelo()
    muros_obj = muros(piezas)
    boveda()
    for cfg in L['obras']:
        colgar_obra(cfg, lienzos, oros, piezas, marcos)
    letras = constructor('oro')
    edicula_c = constructor('piedra', 'yeso')
    edicula(edicula_c, 'letras')
    luces_luna()
    carriles(piezas)
    crear_focos(piezas, lentes)
    banco(piezas)
    catenaria(laton)
    cartel_salida(emisivos, 'salida')
    vidrio_termal(emisivos)
    for (a, b) in vidrios:
        emisivos.cara([(a[0], a[1], a[2]), (b[0], a[1], a[2]), (b[0], b[1], a[2]), (a[0], b[1], a[2])], M['luna'], hacia=(0, 0, -1))

    destinos = {
        'piezas': piezas.objeto('piezas', lightmap='piezas'),
        'letras': letras.objeto('letras'),
        'salida': emisivos.objeto('emisivos'),
    }
    edicula_c.objeto('edicula', lightmap='muros')
    oros.objeto('cuentas_doradas')
    marcos.objeto('marcos_dorados', lightmap='marcos')
    laton.objeto('laton')
    lentes.objeto('lentes')
    hojas_puerta()
    cartelas_frente.objeto('cartelas', lightmap='piezas')
    convertir_y_unir(destinos)

    # Las luminarias no deben tapar su propia luz
    for nombre in ('lentes',):
        bpy.data.objects[nombre].visible_shadow = False

    camaras()
    escena['inicio'] = {'posicion': comun.a_three((L['inicio']['x'], L['inicio']['y'], 1.65)), 'yaw': 0}
    escena['limites'] = {'xmin': -X, 'xmax': X, 'zmin': -LARGO, 'zmax': 0}
    escena['cartelasAtlas'] = {'columnas': ATLAS_CARTELAS[0], 'filas': ATLAS_CARTELAS[1], 'aspecto': CARTELA[0] / CARTELA[1]}
    with open(comun.ruta_build('escena.json'), 'w', encoding='utf-8') as f:
        json.dump(escena, f, ensure_ascii=False, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=comun.ruta_build('museo.blend'))
    caras = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
    print(f'[construir] {len(bpy.context.scene.objects)} objetos, {caras} caras, {len(focos_lista)} focos')


if __name__ == '__main__':
    main()
