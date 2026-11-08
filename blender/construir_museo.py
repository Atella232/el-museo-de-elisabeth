"""Construye una sala del museo a partir de su planta (data/plantas/<sala>.json) y de
data/obras.json y data/salas.json.

Cada sala es una nave con bóveda de cañón: las puertas de entrada en y = 0, el fondo en
y = largo. Genera build/salas/<sala>/museo.blend (geometría, materiales, cuadros, esculturas,
focos y luz de luna) y build/salas/<sala>/escena.json (lo que la web necesita saber: obras,
focos, colisiones, puertas a otras salas, cámaras...).

Uso: SALA=dioses Blender --background --python blender/construir_museo.py
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402
import texturas  # noqa: E402
from comun import Constructor, Marco  # noqa: E402

L = comun.planta()
OBRAS = {o['id']: o for o in comun.leer_json('obras.json')}
SALAS = {s['id']: s for s in comun.leer_json('salas.json')['salas']}
SALA = SALAS.get(comun.SALA, {})

NAVE = L['nave']
X = NAVE['ancho'] / 2
LARGO = NAVE['largo']
Z_ZOC = NAVE['zocalo']
Z_ENT = NAVE['entablamento']['base']
Z_IMP = NAVE['imposta']
R = X  # radio de la bóveda
DZ = Z_ENT - 5.6  # el entablamento se diseñó para una base a 5,6 m; en salas más altas sube entero
# Puertas: las de la calle (cerradas, solo en el vestíbulo) y los pasos a otras salas, cada uno
# con un pasillo corto en penumbra que acaba en unas puertas de bronce.
VANOS = L.get('vanos') or [{'pared': 'puertas', 'pos': 0, 'ancho': L['puertas']['ancho'],
                            'alto': L['puertas']['alto'], 'tipo': 'calle'}]
FONDO_PASILLO = 2.2
# Ascensor: unas puertas de latón cerradas en un rebaje del muro, con su marco de piedra, un dial
# con la sala en la que se está y el botón de llamada. En la web, al pulsarlo se elige la sala.
ASCENSOR = L.get('ascensor')
ASC_PA, ASC_ALTO, ASC_MARCO, ASC_FONDO = 0.55, 2.4, 0.16, 0.18  # medio ancho, alto, marco y rebaje
ASC_BOTON = 0.17  # lo que ocupa la placa del botón junto al marco, hacia el centro de la pared
RV_TERMAL = min(2.5, 0.714 * R)  # radio de la ventana termal del fondo
PIL = L['pilastras']
COLOR_FOCO = (1.0, 0.80, 0.60)
# Para dar más o menos luz a una sala entera: menos en la del inframundo, más en las de paredes
# altas, donde los carriles quedan más lejos de las obras.
INTENSIDAD_FOCOS = L.get('intensidadFocos', 1.0)
COLOR_LUNA = (0.55, 0.66, 1.0)

# Paredes: sistema local con u hacia la derecha de quien mira y d hacia la sala.
# `pos` es la y de las paredes laterales y la x de las de los extremos.
PAREDES = {
    'izquierda': lambda pos: Marco((-X, pos, 0), (0, 1, 0), (1, 0, 0)),
    'derecha': lambda pos: Marco((X, pos, 0), (0, -1, 0), (-1, 0, 0)),
    'fondo': lambda pos: Marco((pos, LARGO, 0), (1, 0, 0), (0, -1, 0)),
    'puertas': lambda pos: Marco((pos, 0, 0), (-1, 0, 0), (0, 1, 0)),
}
# Signo de u respecto a `pos` en el sistema de cada pared colocado en pos = 0.
SIGNO_U = {'izquierda': 1, 'derecha': -1, 'fondo': 1, 'puertas': -1}


def posicion(cfg):
    """Posición a lo largo de su pared de una obra, hornacina o vano de la planta."""
    if 'pos' in cfg:
        return cfg['pos']
    return cfg['x'] if cfg['pared'] in ('fondo', 'puertas') else cfg['y']

M = {}  # materiales
escena = {'sala': comun.SALA, 'obras': [], 'focos': [], 'obstaculos': [], 'cartelas': {}, 'pasos': []}


# ------------------------------------------------------------------ materiales

def materiales():
    t = texturas.todas()
    yeso_n = bpy.data.images['yeso_normal']
    M['suelo'] = comun.material('suelo', imagen=t['suelo_atlas'], rugosidad=0.1)
    M['greca'] = comun.material('greca', imagen=t['greca'], rugosidad=0.1)
    M['yeso'] = comun.material('yeso', imagen=t['yeso'], normal=yeso_n, rugosidad=0.88, especular=0.3)
    M['pompeyano'] = comun.material('pompeyano', color='#7a2c22', normal=yeso_n, rugosidad=0.85, especular=0.3)
    # Cada sala tiene su color de pared (data/salas.json); la bóveda sigue siendo de yeso.
    color = SALA.get('pared')
    if color and color.lower() != '#c9b292':
        M['pared'] = comun.material(f'pared_{comun.SALA}', color=color, normal=yeso_n, rugosidad=0.88, especular=0.3)
        REP[M['pared'].name] = 2.0
    else:
        M['pared'] = M['yeso']
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
    M['laton_mate'] = comun.material('laton_mate', color='#b48c4c', metalico=1.0, rugosidad=0.4)  # hojas del ascensor
    M['madera'] = comun.material('madera', imagen=t['madera'], rugosidad=0.45)
    M['hierro'] = comun.material('hierro', color='#1b1b1c', rugosidad=0.5, especular=0.5)
    M['terracota'] = comun.material('terracota', imagen=t['terracota'], rugosidad=0.55)
    M['vaciado'] = comun.material('vaciado', color='#e6dfd2', rugosidad=0.7, especular=0.35)
    M['marmol'] = comun.material('marmol_escultura', color='#ece6db', rugosidad=0.45, especular=0.45)
    # Un bronce claro: la luz horneada solo es difusa, sin los brillos del metal, y con un tono más
    # oscuro la loba se veía como una silueta.
    M['bronce_escultura'] = comun.material('bronce_escultura', color='#8d6c47', rugosidad=0.5, especular=0.5)
    # Bronce oscuro y en parte metálico, para las que en el original son oscuras (el Perseo): con
    # el claro, en una sala con focos fuertes, parecían de piedra. Lo metálico recibe en la web el
    # reflejo de la sala, que le da el brillo del bronce.
    M['bronce_patina'] = comun.material('bronce_patina', color='#5c4e34', metalico=0.65, rugosidad=0.36)
    # El Marco Aurelio tiene la pátina verde del bronce antiguo, con restos del dorado.
    M['bronce_verde'] = comun.material('bronce_verde', color='#4d5a48', metalico=0.6, rugosidad=0.4)
    M['panel'] = comun.material('panel', color='#efe9dc', rugosidad=0.85, especular=0.25)
    M['terciopelo'] = comun.material('terciopelo', color='#5b0f15', rugosidad=0.95, especular=0.2)
    M['cartela'] = comun.material('cartelas', color='#e9e3d6', rugosidad=0.8, especular=0.3)
    M['luna'] = comun.material('luna', color='#05070d', rugosidad=0.1, emision='#1c2b52', fuerza_emision=0.3)
    M['lente'] = comun.material('lente', color='#ffffff', emision='#ffe2b8', fuerza_emision=40.0)
    M['salida'] = comun.material('salida', color='#0c5a2a', emision='#16c25a', fuerza_emision=3.0)
    M['salida_texto'] = comun.material('salida_texto', color='#ffffff', emision='#f2fff5', fuerza_emision=4.0)
    M['boton'] = comun.material('boton_ascensor', color='#ffd9a0', emision='#ffb45a', fuerza_emision=3.0)
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


PERFIL_ENTABLAMENTO = [(d, z + DZ) for d, z in [  # (d hacia la sala, z)
    (0.0, 5.6), (0.2, 5.6), (0.2, 5.72), (0.22, 5.72), (0.22, 5.88), (0.18, 5.88), (0.18, 6.2),
    (0.24, 6.2), (0.28, 6.25), (0.28, 6.34), (0.54, 6.34), (0.54, 6.44), (0.5, 6.5), (0.0, 6.5),
]]


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
        c.caja_local(mk, u, u + w, 0.28, 0.33, 6.25 + DZ, 6.34 + DZ, M['piedra'])
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

HORNACINA = {'radio': 0.8, 'fondo': 0.72, 'imposta': 2.45}


def hornacina(c, mk, uc, h, piezas):
    """Hornacina de planta semicircular con cuarto de esfera, interior en rojo pompeyano."""
    r, zs, za, prof = HORNACINA['radio'], Z_ZOC, HORNACINA['imposta'], HORNACINA['fondo']
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
    frente = 0.05
    if h.get('escultura'):
        frente = colocar_escultura(mk, uc, h, piezas)
    else:
        pieza_hornacina(mk, uc, zs, h['pieza'], piezas)
    return {'u0': uc - r, 'u1': uc + r, 'z0': zs, 'z1': za, 'arco': True, 'frente': frente}


TRIANGULOS_ESCULTURA = 60000
TRIANGULOS_EXENTA = 120000
CARPETA_ESCANEOS = os.path.join(comun.RAIZ, 'tools', 'cache', 'esculturas')
# Modelos que no se descargan (los reconstruidos con IA a partir de fotografías): van en el repositorio.
CARPETA_PROPIOS = os.path.join(comun.RAIZ, 'fuentes', 'esculturas')


def cargar_escaneo(oid, triangulos):
    """Importa el escaneo 3D de una obra como una sola malla sin materiales, reducida a
    `triangulos`, y devuelve el objeto y sus vértices (numpy, en metros del archivo).
    Puede ser un GLB de Scan the World (<id>.glb) o uno o varios STL del SMK (<id>.stl,
    <id>-2.stl…), que se unen tal como vienen."""
    antes = set(bpy.data.objects)
    glb = next((g for g in (os.path.join(c, f'{oid}.glb') for c in (CARPETA_ESCANEOS, CARPETA_PROPIOS)) if os.path.exists(g)), None)
    if glb:
        bpy.ops.import_scene.gltf(filepath=glb)
    else:
        for f in sorted(os.listdir(CARPETA_ESCANEOS)):
            if f == f'{oid}.stl' or (f.startswith(f'{oid}-') and f.endswith('.stl')):
                bpy.ops.wm.stl_import(filepath=os.path.join(CARPETA_ESCANEOS, f))
    nuevos = [o for o in bpy.data.objects if o not in antes]
    mallas = [o for o in nuevos if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in mallas:
        o.select_set(True)
    bpy.context.view_layer.objects.active = mallas[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in nuevos:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    if len(mallas) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = f'escultura_{oid}'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Algunos GLB de Scan the World son triángulos sueltos, sin vértices compartidos: sin
    # unirlos, la reducción deja una nube de triángulos por la que se ve a través. Las
    # normales propias del archivo tampoco sobreviven a la reducción; se recalculan suaves.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    tam = max(ob.dimensions)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=tam * 1e-6)
    bm.to_mesh(ob.data)
    bm.free()
    if ob.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    caras = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'[escaneo] {oid}: {len(ob.data.vertices)} vértices, {caras} triángulos')
    if caras > triangulos:
        reducir = ob.modifiers.new('reducir', 'DECIMATE')
        reducir.ratio = triangulos / caras
        bpy.ops.object.modifier_apply(modifier=reducir.name)
    malla = ob.data
    for capa in list(malla.color_attributes):
        malla.color_attributes.remove(capa)
    v = np.empty(len(malla.vertices) * 3, np.float32)
    malla.vertices.foreach_get('co', v)
    return ob, v.reshape(-1, 3).astype(np.float64)


def material_escultura(meta):
    tecnica = meta['tecnica'].lower()
    if meta.get('reproduccion') == 'vaciado':
        return M['vaciado']
    return M['bronce_escultura'] if 'bronce' in tecnica else M['marmol']


def girar(v, grados, tumbar=0):
    """Gira los vértices alrededor de z (`grados`) y, antes, alrededor de x (`tumbar`), para
    corregir escaneos que no miran hacia -Y con z hacia arriba."""
    if tumbar:
        a = math.radians(tumbar)
        y, z = v[:, 1].copy(), v[:, 2].copy()
        v[:, 1], v[:, 2] = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
    if grados:
        a = math.radians(grados)
        x, y = v[:, 0].copy(), v[:, 1].copy()
        v[:, 0], v[:, 1] = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
    return v


def fijar_malla(ob, pos, mat):
    malla = ob.data
    malla.vertices.foreach_set('co', pos.astype(np.float32).ravel())
    ob.matrix_world = Matrix.Identity(4)
    malla.polygons.foreach_set('use_smooth', np.ones(len(malla.polygons), bool))
    malla.update()
    malla.materials.clear()
    malla.materials.append(mat)
    ob[comun.PROP_LIGHTMAP] = 'esculturas'


def colocar_exenta(cfg, piezas):
    """Escultura exenta sobre una peana de piedra en el centro de la sala, de cara a `mira`
    (vector en planta). El escaneo, una vez corregido con `giro`/`tumbar`, mira hacia -Y.
    Con `huella` [x0, y0, x1, y1] (metros desde el centro de la escultura, con ella mirando a -Y),
    la peana es ese rectángulo y la escultura se apoya en ella por lo más bajo que cae dentro:
    para las que tienen partes que cuelgan por los lados, como el cuerpo de Medusa en el Perseo."""
    oid = cfg['escultura']
    meta = OBRAS[oid]
    alto = cfg.get('alto') or meta['medidas']['alto'] / 100
    peana = cfg.get('peana', 0.6)
    ob, v = cargar_escaneo(oid, cfg.get('triangulos', TRIANGULOS_EXENTA))
    v = girar(v, cfg.get('giro', 0), cfg.get('tumbar', 0))
    mira = Vector((*cfg.get('mira', (0, -1)), 0)).normalized()
    angulo_mira = math.degrees(math.atan2(mira.y, mira.x)) + 90
    v = girar(v, angulo_mira)
    s = alto / (v[:, 2].max() - v[:, 2].min())
    v = (v - [0, 0, v[:, 2].min()]) * s
    v[:, :2] -= (v[:, :2].min(axis=0) + v[:, :2].max(axis=0)) / 2
    cx, cy = cfg['x'], cfg['y']
    huella = cfg.get('huella')
    if huella:
        esquinas = girar(np.array([[huella[0], huella[1], 0], [huella[2], huella[3], 0],
                                   [huella[0], huella[3], 0], [huella[2], huella[1], 0]], float), angulo_mira)
        (hx0, hy0), (hx1, hy1) = esquinas[:, :2].min(axis=0), esquinas[:, :2].max(axis=0)
        dentro = (v[:, 0] > hx0) & (v[:, 0] < hx1) & (v[:, 1] > hy0) & (v[:, 1] < hy1)
        v[:, 2] -= v[dentro, 2].min()
        assert v[:, 2].min() > -peana + 0.1, 'lo que cuelga de la escultura llega al suelo: hace falta una peana más alta'
    pos = v + [cx, cy, peana]
    fijar_malla(ob, pos, M[cfg['material']] if 'material' in cfg else material_escultura(meta))

    # Peana: zócalo, dado y losa, un poco mayores que la planta de la escultura (o la huella dada)
    if huella:
        (x0, y0), (x1, y1) = (hx0 + cx, hy0 + cy), (hx1 + cx, hy1 + cy)
    else:
        (x0, y0), (x1, y1) = v[:, :2].min(axis=0) + [cx, cy] - 0.12, v[:, :2].max(axis=0) + [cx, cy] + 0.12
    piezas.caja_mundo((x0 - 0.04, y0 - 0.04, 0), (x1 + 0.04, y1 + 0.04, 0.08), M['piedra'])
    piezas.caja_mundo((x0, y0, 0.08), (x1, y1, peana - 0.06), M['zocalo'])
    piezas.caja_mundo((x0 - 0.03, y0 - 0.03, peana - 0.06), (x1 + 0.03, y1 + 0.03, peana), M['piedra'])
    (ox0, oy0), (ox1, oy1) = np.minimum([x0, y0], v[:, :2].min(axis=0) + [cx, cy]), np.maximum([x1, y1], v[:, :2].max(axis=0) + [cx, cy])
    escena['obstaculos'].append([round(ox0 - 0.25, 3), round(-(oy1 + 0.25), 3), round(ox1 + 0.25, 3), round(-(oy0 - 0.25), 3)])

    # Cartela en la cara delantera de la peana
    medio = abs((y1 - y0) * mira.y) / 2 + abs((x1 - x0) * mira.x) / 2  # media profundidad según `mira`
    frente_peana = Vector(((x0 + x1) / 2, (y0 + y1) / 2, 0)) + mira * (medio + 0.001)
    derecha = Vector((-mira.y, mira.x, 0))
    indice = len(escena['cartelas'])
    escena['cartelas'][oid] = indice
    cartela(piezas, Marco(frente_peana, derecha, mira), 0, max(0.3, peana - 0.22), indice)

    prof = float(np.abs(v[:, :2] @ np.array([mira.x, mira.y])).max())
    ancho = float(np.abs(v[:, :2] @ np.array([derecha.x, derecha.y])).max()) * 2
    escena['obras'].append({
        'id': oid,
        'tipo': 'escultura',
        'centro': comun.a_three(Vector((cx, cy, peana + alto / 2)) + mira * prof),
        'normal': comun.a_three(mira),
        'ancho': round(ancho + 0.3, 3),
        'alto': round(alto + peana + 0.1, 3),
        'marco': None,
        # Con `rodear: false` (el sarcófago, junto a una pared) se contempla de frente, como un cuadro.
        **({'exenta': True} if cfg.get('rodear', True) else {}),
    })
    focos_exenta(Vector((cx, cy, peana + alto * 0.55)), mira, alto, cfg.get('intensidad', 1.0), cfg.get('frente', 2.4))


def focos_exenta(objetivo, mira, alto, intensidad=1.0, frente=2.4):
    """Luz principal desde el carril que queda delante y a un lado; relleno desde el otro y,
    como se le puede dar la vuelta, un contraluz suave desde detrás. El haz abarca la
    escultura entera, de la peana a lo más alto. `frente`: cuánto por delante de la escultura
    están los focos; a una escultura baja en una sala alta le llega la luz casi desde arriba y,
    con ellos más adelantados, se le ve la cara."""
    c = L['carriles']
    z = c['z'] - 0.14
    lado = 1 if mira.x >= 0 else -1
    for dist, s, holgura, intens in ((frente, lado, 1.0, 1.6), (frente, -lado, 1.15, 0.45), (-2.6, -lado, 1.15, 0.5)):
        y = min(max((objetivo + mira * dist).y, c['y0'] + 0.3), c['y1'] - 0.3)
        pos = Vector((s * c['x'], y, z))
        ang = min(50, math.degrees(2 * math.atan(holgura * (alto / 2 + 0.25) / (objetivo - pos).length)))
        anadir_foco(pos, objetivo, ang, intens * intensidad)


def colgar_relieve(cfg, piezas):
    """Vaciado de un relieve (escaneo) colgado en una pared, como un cuadro sin marco. El
    escaneo, corregido con `giro`/`tumbar`, debe mirar hacia -Y con la parte de arriba en +z."""
    oid = cfg['id']
    meta = OBRAS[oid]
    alto = cfg['expuesto']['alto']
    mk = PAREDES[cfg['pared']](posicion(cfg))
    ob, v = cargar_escaneo(oid, cfg.get('triangulos', TRIANGULOS_EXENTA))
    v = girar(v, cfg.get('giro', 0), cfg.get('tumbar', 0))
    s = alto / (v[:, 2].max() - v[:, 2].min())
    v = v * s
    v -= [(v[:, 0].min() + v[:, 0].max()) / 2, v[:, 1].max(), v[:, 2].min()]  # el dorso en d = 0
    ancho = float(v[:, 0].max() - v[:, 0].min())
    z_base = cfg.get('z', 1.0)
    pos = (np.outer(v[:, 0], mk.u) + np.outer(-v[:, 1] + 0.02, mk.d) + np.outer(v[:, 2] + z_base, mk.z) + np.array(mk.o))
    fijar_malla(ob, pos, material_escultura(meta))
    zc = z_base + alto / 2
    indice = len(escena['cartelas'])
    escena['cartelas'][oid] = indice
    cartela(piezas, mk, ancho / 2 + 0.42, 1.42, indice)
    escena['obras'].append({
        'id': oid,
        'tipo': 'relieve',
        'centro': comun.a_three(mk.p(0, float(-v[:, 1].min()) + 0.02, zc)),
        'normal': comun.a_three(mk.d),
        'ancho': round(ancho, 3),
        'alto': round(alto, 3),
        'marco': None,
    })
    focos_obra(mk, cfg, ancho, zc, alto)


PANEL = (1.3, 1.8)  # ancho y alto del panel con el texto de la sala


def panel_sala(cfg):
    """Panel junto a la entrada con el título, la pregunta y el texto de la sala. La web dibuja
    el texto (data/salas.json); aquí solo va la placa, que recibe la luz horneada."""
    mk = PAREDES[cfg['pared']](posicion(cfg))
    w, h = PANEL
    zc = cfg.get('z', 1.85)
    c = Constructor([M['panel']])
    c.caja_local(mk, -w / 2, w / 2, 0, 0.02, zc - h / 2, zc + h / 2, M['panel'])
    frente = Constructor([M['panel']])
    frente.cara([mk.p(-w / 2, 0.0205, zc - h / 2), mk.p(w / 2, 0.0205, zc - h / 2),
                 mk.p(w / 2, 0.0205, zc + h / 2), mk.p(-w / 2, 0.0205, zc + h / 2)],
                M['panel'], uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], hacia=mk.d)
    c.objeto('panel_canto', lightmap='piezas')
    frente.objeto('panel', lightmap='piezas')
    escena['panel'] = {'centro': comun.a_three(mk.p(0, 0.021, zc)), 'normal': comun.a_three(mk.d), 'ancho': w, 'alto': h}
    escena['obras'].append({'id': f'sala-{comun.SALA}', 'tipo': 'panel', 'centro': escena['panel']['centro'],
                            'normal': escena['panel']['normal'], 'ancho': w + 0.2, 'alto': h + 0.2, 'marco': None})
    focos_obra(mk, {'pared': cfg['pared']}, w, zc)


def colocar_escultura(mk, uc, h, piezas):
    """Escaneo 3D (STL descargado por `npm run obras`) sobre una peana dentro de la hornacina.
    Los escaneos miran hacia -Y con Z hacia arriba; se escalan a su altura real y se meten
    en la hornacina tan al fondo como permite su planta. Devuelve hasta dónde sobresalen."""
    oid = h['escultura']
    meta = OBRAS[oid]
    alto = h.get('alto') or meta['medidas']['alto'] / 100
    peana = h.get('peana', 0.1)
    r, prof, zs = HORNACINA['radio'], HORNACINA['fondo'], Z_ZOC

    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.wm.stl_import(filepath=os.path.join(comun.RAIZ, 'tools', 'cache', 'esculturas', f'{oid}.stl'))
    ob = bpy.context.selected_objects[0]
    ob.name = f'escultura_{oid}'
    bpy.context.view_layer.objects.active = ob
    reducir = ob.modifiers.new('reducir', 'DECIMATE')
    reducir.ratio = min(1.0, TRIANGULOS_ESCULTURA / len(ob.data.polygons))
    bpy.ops.object.modifier_apply(modifier=reducir.name)

    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    malla = ob.data
    v = np.empty(len(malla.vertices) * 3, np.float32)
    malla.vertices.foreach_get('co', v)
    v = v.reshape(-1, 3).astype(np.float64)
    s = alto / (v[:, 2].max() - v[:, 2].min())
    v = (v - [0, 0, v[:, 2].min()]) * s
    en_base = v[:, 2] < 0.04 * alto  # el zócalo del busto, para centrarlo en la peana
    v[:, :2] -= (v[en_base, :2].min(axis=0) + v[en_base, :2].max(axis=0)) / 2
    radio_peana = float(np.hypot(v[en_base, 0], v[en_base, 1]).max()) + 0.04

    # Profundidad: la más honda en la que todo el busto (y la peana) cabe en la planta elíptica.
    a = np.linspace(0, 2 * np.pi, 48)
    planta = np.concatenate([v[:, :2], np.stack([radio_peana * np.cos(a), radio_peana * np.sin(a)], 1)])
    holgura = 0.95
    dentro = np.abs(planta[:, 0]) < holgura * r
    d_min = np.where(dentro, -prof * np.sqrt(np.clip(holgura ** 2 - (planta[:, 0] / r) ** 2, 0, None)), 0.0)
    d_c = float((planta[:, 1] + d_min).max())  # d = d_c - y (la cara, -Y, mira a la sala)

    du, dd, dz = mk.u, mk.d, mk.z
    pos = (np.outer(uc + v[:, 0], du) + np.outer(d_c - v[:, 1], dd) + np.outer(zs + peana + v[:, 2], dz) + np.array(mk.o))
    malla.vertices.foreach_set('co', pos.astype(np.float32).ravel())
    ob.matrix_world = Matrix.Identity(4)
    malla.polygons.foreach_set('use_smooth', np.ones(len(malla.polygons), bool))
    malla.update()
    malla.materials.clear()
    malla.materials.append(M['vaciado'])
    ob[comun.PROP_LIGHTMAP] = 'esculturas'

    torno(piezas, [(0.0, 0.0), (radio_peana, 0.0), (radio_peana, peana - 0.02), (radio_peana - 0.02, peana), (0.0, peana)],
          mk.p(uc, d_c, zs), M['piedra'], segmentos=32)

    frente = float((d_c - v[:, 1]).max())
    ancho = float(v[:, 0].max() - v[:, 0].min())
    indice = len(escena['cartelas'])
    escena['cartelas'][oid] = indice
    cartela(piezas, mk, uc + r + 0.4, 1.42, indice)
    escena['obras'].append({
        'id': oid,
        'tipo': 'escultura',
        'centro': comun.a_three(mk.p(uc, max(frente, 0.0), zs + peana + alto / 2)),
        'normal': comun.a_three(mk.d),
        'ancho': round(ancho + 0.2, 3),
        'alto': round(alto + peana + 0.1, 3),
        'marco': None,
    })
    focos_escultura(mk, uc, d_c, zs + peana + alto * 0.72)
    return frente


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
    rv, marco, prof = RV_TERMAL, 0.16, 0.3
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
    rv, prof = RV_TERMAL, 0.3
    n = 32
    for k in range(n):
        a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
        c.cara([mk.p(0, -prof + 0.01, Z_IMP), mk.p(rv * math.cos(a0), -prof + 0.01, Z_IMP + rv * math.sin(a0)),
                mk.p(rv * math.cos(a1), -prof + 0.01, Z_IMP + rv * math.sin(a1))], M['luna'], hacia=mk.d)


def muros(piezas):
    global ascensor_mk
    mats = ['yeso', 'zocalo', 'piedra', 'pompeyano'] + ([] if M['pared'] is M['yeso'] else [M['pared']])
    c = constructor(*mats)
    for pared in ('izquierda', 'derecha', 'puertas', 'fondo'):
        mk = PAREDES[pared](0)
        s = SIGNO_U[pared]
        lateral = pared in ('izquierda', 'derecha')
        u0, u1 = sorted((0, s * LARGO)) if lateral else (-X, X)
        huecos, vanos = [], []
        for h in L['hornacinas']:
            if h['pared'] != pared:
                continue
            uc = s * posicion(h)
            hk = hornacina(c, mk, uc, h, piezas)
            huecos.append(hk)
            escena['obstaculos'].append(rect_plano(mk, uc - 0.4, uc + 0.4, -0.5, max(0.05, hk['frente'] + 0.05)))
        for v in VANOS:
            if v['pared'] != pared:
                continue
            uc, pa = s * posicion(v), v['ancho'] / 2
            huecos.append({'u0': uc - pa, 'u1': uc + pa, 'z0': 0, 'z1': v['alto']})
            vanos.append((uc, pa, v))
        cortes_zocalo = [(uc - pa - 0.3, uc + pa + 0.3) for uc, pa, _ in vanos]
        asc_uc = s * posicion(ASCENSOR) if ASCENSOR and ASCENSOR['pared'] == pared else None
        if asc_uc is not None:
            comprobar_ascensor(pared, s, asc_uc)
            huecos.append({'u0': asc_uc - ASC_PA, 'u1': asc_uc + ASC_PA, 'z0': 0, 'z1': ASC_ALTO})
            cortes_zocalo.append((asc_uc - ASC_PA - ASC_MARCO - 0.03, asc_uc + ASC_PA + ASC_MARCO + 0.03))
        pared_con_huecos(c, mk, u0, u1, Z_ZOC, Z_ENT, huecos, M['pared'])
        if vanos or asc_uc is not None:
            pared_con_huecos(c, mk, u0, u1, 0, Z_ZOC, [h for h in huecos if h['z0'] == 0], M['pared'])
        zocalo(c, mk, u0, u1, huecos=cortes_zocalo)
        for uc, pa, v in vanos:
            puertas(c, Marco(mk.p(uc, 0, 0), mk.u, mk.d), pa, v['alto'], v)
        if asc_uc is not None:
            ascensor_mk = Marco(mk.p(asc_uc, 0, 0), mk.u, mk.d)
            rebaje_ascensor(c, ascensor_mk)
        if lateral:
            for y in PIL['y']:
                pilastra(c, PAREDES[pared](y))
                escena['obstaculos'].append(rect_plano(PAREDES[pared](y), -0.47, 0.47, 0, 0.3))
    entablamento(c)
    lunetos(c)
    return c.objeto('muros', lightmap='muros')


def puertas(c, mk, pa, pz, vano):
    """Jambas, dintel y frontón de una puerta (piedra); las hojas de bronce van aparte.
    Las de la calle quedan en el grosor del muro. Las que llevan a otra sala abren un pasillo
    corto en penumbra, al fondo del cual están las hojas cerradas: al entrar en él se pasa
    a la otra sala."""
    prof = 0.35 if vano.get('tipo') == 'calle' else FONDO_PASILLO
    # mochetas del vano (o paredes del pasillo), techo y suelo
    c.cara([mk.p(-pa, 0, 0), mk.p(-pa, -prof, 0), mk.p(-pa, -prof, pz), mk.p(-pa, 0, pz)], M['yeso'], hacia=mk.u)
    c.cara([mk.p(pa, 0, 0), mk.p(pa, -prof, 0), mk.p(pa, -prof, pz), mk.p(pa, 0, pz)], M['yeso'], hacia=-mk.u)
    c.cara([mk.p(-pa, 0, pz), mk.p(pa, 0, pz), mk.p(pa, -prof, pz), mk.p(-pa, -prof, pz)], M['yeso'], hacia=-mk.z)
    c.cara([mk.p(-pa, 0, 0), mk.p(pa, 0, 0), mk.p(pa, -prof, 0), mk.p(-pa, -prof, 0)], M['piedra'], hacia=mk.z)
    if vano.get('tipo') != 'calle':
        c.caja_local(mk, -pa, pa, -prof, -prof + 0.002, 0, pz, M['yeso'])  # lo que queda tras las hojas
        hojas.append((mk, pa, pz, -prof + 0.004))
        destino = vano.get('destino')
        if destino:
            escena['pasos'].append({
                'destino': destino,
                # Se adentra 0,8 m en la sala para que, al restarle el radio del visitante, se toque con la nave
                'zona': rect_plano(mk, -pa + 0.1, pa - 0.1, -prof + 0.15, 0.8),
                'disparo': rect_plano(mk, -pa, pa, -prof, -0.8),
                'llegada': {'posicion': comun.a_three(mk.p(0, 1.3, 1.65)), 'yaw': yaw_hacia(mk.d)},
            })
            if vano.get('rotulo'):
                rotulo_destino(mk, pa, pz, destino)
    else:
        hojas.append((mk, pa, pz, -0.35))
    # marco (jambas + dintel) y cornisa
    w = 0.26
    c.caja_local(mk, -pa - w, -pa, 0, 0.07, 0, pz + w, M['piedra'])
    c.caja_local(mk, pa, pa + w, 0, 0.07, 0, pz + w, M['piedra'])
    c.caja_local(mk, -pa, pa, 0, 0.07, pz, pz + w, M['piedra'])
    c.caja_local(mk, -pa - w - 0.05, pa + w + 0.05, 0, 0.1, pz + w, pz + w + 0.28, M['piedra'])
    c.caja_local(mk, -pa - w - 0.15, pa + w + 0.15, 0, 0.24, pz + w + 0.28, pz + w + 0.4, M['piedra'])


hojas = []  # (marco del vano, medio ancho, alto, d de la cara trasera) de cada par de hojas


def hojas_puerta():
    c = constructor('bronce', 'laton')
    for mk, pa, pz, d0 in hojas:
        kz = pz / 4.2
        for s in (-1, 1):
            a, b = (-pa, -0.005) if s < 0 else (0.005, pa)
            c.caja_local(mk, a, b, d0, d0 + 0.06, 0, pz, M['bronce'])
            # cuarterones en relieve
            for z0, z1 in ((0.35, 1.7), (1.95, 3.85)):
                c.caja_local(mk, a + 0.16, b - 0.16, d0 + 0.06, d0 + 0.09, z0 * kz, z1 * kz, M['bronce'])
            c.caja_local(mk, (b - 0.12) if s < 0 else (a + 0.06), (b - 0.06) if s < 0 else (a + 0.12), d0 + 0.06, d0 + 0.12, 1.75, 1.95, M['laton'])
    return c.objeto('puertas')


ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII']


def yaw_hacia(d):
    """Giro de la cámara de la web (0 = mirar hacia el fondo de la sala) para mirar en la dirección d."""
    return round(math.atan2(-d.x, d.y), 4)


def rotulo_destino(mk, pa, pz, destino):
    """Nombre de la sala a la que lleva la puerta, en letras doradas sobre la cornisa."""
    s = SALAS[destino]
    cadena = (f"SALA {ROMANOS[s['numero']]} · {s['titulo']}" if s['numero'] else s['titulo']).upper()
    tamano = min(0.22, (2 * pa + 2.6) / (0.62 * len(cadena)))
    texto(cadena, mk.p(0, 0.02, pz + 0.66 + 0.22 + tamano * 0.4), mk, tamano, M['oro'], 'letras')


def rect_plano(mk, u0, u1, d0, d1):
    """Rectángulo de colisión (x0, z0, x1, z1) en coordenadas de Three.js para un área local de pared."""
    pts = [mk.p(u, d, 0) for u in (u0, u1) for d in (d0, d1)]
    xs = [p.x for p in pts]
    zs = [-p.y for p in pts]
    return [round(min(xs), 3), round(min(zs), 3), round(max(xs), 3), round(max(zs), 3)]


# ------------------------------------------------------------------ ascensor

ascensor_mk = None  # marco local del ascensor (en el centro de sus puertas), lo fija muros()


def lado_boton(uc):
    """La placa del botón va hacia el centro de la pared."""
    return -1 if uc > 0 else 1


def comprobar_ascensor(pared, s, uc):
    """Que el ascensor (marco y placa del botón) no pise ninguna puerta, panel, hornacina u obra
    de su pared ni quede pegado a una esquina: mejor fallar aquí que después de hornear."""
    lado = lado_boton(uc)
    a = uc - ASC_PA - ASC_MARCO - (ASC_BOTON if lado < 0 else 0)
    b = uc + ASC_PA + ASC_MARCO + (ASC_BOTON if lado > 0 else 0)
    u0, u1 = sorted((0, s * LARGO)) if pared in ('izquierda', 'derecha') else (-X, X)
    assert a >= u0 + 0.15 and b <= u1 - 0.15, f'el ascensor ({a:.2f}..{b:.2f}) se sale de la pared {pared} ({u0}..{u1})'
    ocupado = [(s * posicion(v), v['ancho'] / 2 + 0.41, 'una puerta') for v in VANOS if v['pared'] == pared]
    if L.get('panel', {}).get('pared') == pared:
        ocupado.append((s * posicion(L['panel']), PANEL[0] / 2 + 0.05, 'el panel'))
    ocupado += [(s * posicion(h), 0.65, 'una hornacina') for h in L['hornacinas'] if h['pared'] == pared]
    ocupado += [(s * posicion(o), OBRAS[o['id']]['medidas']['ancho'] / 200 + 0.3, o['id'])
                for o in L['obras'] if o['pared'] == pared]
    for centro, medio, que in ocupado:
        assert b <= centro - medio or a >= centro + medio, f'el ascensor pisa {que} en la pared {pared}'


def rebaje_ascensor(c, mk):
    """El hueco del muro, con las puertas al fondo, y su marco de piedra (con luz horneada)."""
    pa, pz, f, w = ASC_PA, ASC_ALTO, ASC_FONDO, ASC_MARCO
    c.cara([mk.p(-pa, 0, 0), mk.p(-pa, -f, 0), mk.p(-pa, -f, pz), mk.p(-pa, 0, pz)], M['piedra'], hacia=mk.u)
    c.cara([mk.p(pa, 0, 0), mk.p(pa, -f, 0), mk.p(pa, -f, pz), mk.p(pa, 0, pz)], M['piedra'], hacia=-mk.u)
    c.cara([mk.p(-pa, 0, pz), mk.p(pa, 0, pz), mk.p(pa, -f, pz), mk.p(-pa, -f, pz)], M['piedra'], hacia=-mk.z)
    c.caja_local(mk, -pa, pa, -f, 0, 0, 0.015, M['piedra'])  # umbral
    c.caja_local(mk, -pa, pa, -f, -f + 0.002, 0, pz, M['yeso'])  # lo que queda tras las hojas
    # jambas, dintel (con el rótulo), una cornisa fina y la placa del dial encima
    c.caja_local(mk, -pa - w, -pa, 0, 0.06, 0, pz + w, M['piedra'])
    c.caja_local(mk, pa, pa + w, 0, 0.06, 0, pz + w, M['piedra'])
    c.caja_local(mk, -pa, pa, 0, 0.06, pz, pz + w, M['piedra'])
    c.caja_local(mk, -pa - w - 0.04, pa + w + 0.04, 0, 0.09, pz + w, pz + w + 0.05, M['piedra'])
    c.caja_local(mk, -0.34, 0.34, 0, 0.04, pz + w + 0.05, pz + w + 0.39, M['piedra'])


def ascensor(piezas, laton, emisivos):
    """Las hojas de latón, el dial con la aguja en esta sala, el botón de llamada, un foco y lo
    que la web necesita: la zona a la que se apunta para llamarlo y dónde se llega."""
    mk = ascensor_mk
    pa, pz, f, w = ASC_PA, ASC_ALTO, ASC_FONDO, ASC_MARCO
    # Hojas: sin luz horneada, como las de las puertas; brillan con el reflejo del entorno.
    h = constructor('laton_mate', 'laton')
    d0 = -f + 0.004
    for s in (-1, 1):
        a, b = (-pa, -0.004) if s < 0 else (0.004, pa)
        h.caja_local(mk, a, b, d0, d0 + 0.03, 0, pz, M['laton_mate'])
        m = 0.07  # moldura de latón en relieve: arriba, a media altura y a los lados
        for ua, ub, za, zb in ((a + m, b - m, pz - m - 0.025, pz - m), (a + m, b - m, 0.9, 0.925),
                               (a + m, a + m + 0.025, 0.9, pz - m), (b - m - 0.025, b - m, 0.9, pz - m)):
            h.caja_local(mk, ua, ub, d0 + 0.03, d0 + 0.042, za, zb, M['laton'])
        h.caja_local(mk, a + 0.03, b - 0.03, d0 + 0.03, d0 + 0.04, 0.05, 0.32, M['laton'])  # zócalo
    h.objeto('ascensor_hojas')
    texto('ASCENSOR', mk.p(0, 0.061, pz + w / 2), mk, 0.07, M['oro'], 'letras', extrusion=0.003, espaciado=1.3)

    # Dial: media esfera negra con las salas (· el vestíbulo, I a VII) y la aguja en esta.
    zc = pz + w + 0.12
    r, n = 0.23, 28
    angulo = lambda k: math.pi * (0.93 - 0.86 * k / 7)  # noqa: E731
    piezas.cara([mk.p(r * math.cos(math.pi * k / n), 0.042, zc + r * math.sin(math.pi * k / n)) for k in range(n + 1)],
                M['negro'], hacia=mk.d)
    for k in range(n):
        t0, t1 = math.pi * k / n, math.pi * (k + 1) / n
        laton.cara([mk.p(r * math.cos(t0), 0.044, zc + r * math.sin(t0)), mk.p((r + 0.014) * math.cos(t0), 0.044, zc + (r + 0.014) * math.sin(t0)),
                    mk.p((r + 0.014) * math.cos(t1), 0.044, zc + (r + 0.014) * math.sin(t1)), mk.p(r * math.cos(t1), 0.044, zc + r * math.sin(t1))],
                   M['laton'], hacia=mk.d)
    laton.caja_local(mk, -r - 0.014, r + 0.014, 0.04, 0.047, zc - 0.014, zc, M['laton'])
    for k in range(8):
        t = angulo(k)
        texto(ROMANOS[k] or '·', mk.p(0.17 * math.cos(t), 0.044, zc + 0.17 * math.sin(t)), mk, 0.04, M['oro'], 'letras',
              extrusion=0.002, espaciado=1.0)
    t = angulo(SALA.get('numero', 0))
    eje, perp = mk.vec(math.cos(t), 0, math.sin(t)), mk.vec(-math.sin(t), 0, math.cos(t))
    centro = mk.p(0, 0.049, zc)
    aguja = Constructor([M['oro']])
    aguja.cara([centro + perp * 0.006, centro - perp * 0.006, centro + eje * 0.135], M['oro'], hacia=mk.d)
    aguja.cara([centro + mk.vec(0.016 * math.cos(2 * math.pi * k / 12), 0.0005, 0.016 * math.sin(2 * math.pi * k / 12)) for k in range(12)],
               M['oro'], hacia=mk.d)
    aguja.objeto('aguja')['unir_a'] = 'letras'

    # Placa del botón de llamada, hacia el centro de la pared, con el botón encendido.
    ub = lado_boton(posicion(ASCENSOR) * SIGNO_U[ASCENSOR['pared']]) * (pa + w + 0.10)
    laton.caja_local(mk, ub - 0.05, ub + 0.05, 0, 0.012, 1.02, 1.30, M['laton'])
    emisivos.cara([mk.p(ub + 0.024 * math.cos(2 * math.pi * k / 16), 0.0135, 1.2 + 0.024 * math.sin(2 * math.pi * k / 16)) for k in range(16)],
                  M['boton'], hacia=mk.d)

    # Un foco tenue desde el carril más cercano, como el de las puertas.
    cr = L['carriles']
    obj = mk.p(0, 0, 1.7)
    if abs(mk.d.y) > 0.5:
        pos = (math.copysign(cr['x'], obj.x), min(max(obj.y, cr['y0'] + 0.3), cr['y1'] - 0.3), cr['z'] - 0.14)
    else:
        pos = (-math.copysign(cr['x'], obj.x), obj.y, cr['z'] - 0.14)
    anadir_foco(pos, obj, 44, 0.5)

    escena['ascensor'] = {'llegada': {'posicion': comun.a_three(mk.p(0, 1.3, 1.65)), 'yaw': yaw_hacia(mk.d)}}
    escena['obras'].append({'id': 'ascensor', 'tipo': 'ascensor', 'centro': comun.a_three(mk.p(0, 0, 1.5)),
                            'normal': comun.a_three(mk.d), 'ancho': 2 * (pa + w), 'alto': 3.0, 'marco': None})
    # Una cámara para las capturas de control (y ?cam=ascensor en la web).
    L['camaras']['ascensor'] = {**{k: round(v, 3) for k, v in zip('xyz', mk.p(0.5, 3.0, 1.65))},
                                'mira': [round(v, 3) for v in mk.p(0, 0, 1.75)]}


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
    foto = cfg['marco'] == 'foto'  # fotografía de una escultura o un monumento: marco fino, sin paspartú
    mk = PAREDES[cfg['pared']](posicion(cfg))
    if dorado:
        g = 0.1 + 0.03 * alto
        exterior_w, exterior_h = ancho + 2 * g, alto + 2 * g
    elif foto:
        g = 0.025
        exterior_w, exterior_h = ancho + 2 * g, alto + 2 * g
    else:
        g, mat_l, mat_b = 0.03, 0.12, 0.15
        exterior_w = ancho + 2 * (mat_l + g)
        exterior_h = alto + mat_l + mat_b + 2 * g
    z_base = 1.2 if cfg.get('edicula') else 1.12
    zc_ext = max(1.58, z_base + exterior_h / 2)
    zc = zc_ext if dorado or foto else zc_ext + (mat_b - mat_l) / 2

    # Lienzo (o lámina): UV completas, normal hacia la sala
    mat_lienzo = comun.material(f'lienzo_{oid}', imagen=img, rugosidad=0.55 if dorado else 0.85, especular=0.35)
    d_lienzo = 0.035 if dorado else 0.02 if foto else 0.008
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
    elif foto:
        marco_perfil(piezas, mk, 0, zc, ancho, alto, [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)], g, 0.03, M['negro'])
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

    # Cartela a la derecha de la obra (o a la izquierda, si la planta lo pide)
    lado = -1 if cfg.get('cartela') == 'izquierda' else 1
    u_cartela = lado * (exterior_w / 2 + 0.42) if not cfg.get('edicula') else 2.75
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
    focos_obra(mk, cfg, exterior_w, zc_ext, exterior_h)
    return mk, exterior_w, exterior_h, zc_ext


CARTELA = (0.3, 0.19)
ATLAS_CARTELAS = (4, 4)


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


def focos_obra(mk, cfg, ancho_ext, zc, alto_ext=0.0):
    x_carril, z_carril = L['carriles']['x'], L['carriles']['z']
    if cfg['pared'] in ('fondo', 'puertas'):
        objetivo_c = mk.p(0, 0, zc)
        for s in (-1, 1):
            pos = Vector((s * x_carril, LARGO - 3.6 if cfg['pared'] == 'fondo' else 3.6, z_carril - 0.14))
            obj = objetivo_c + mk.u * (s * ancho_ext * 0.22)
            # Con un cuadro muy grande (Las sabinas de David) el haz se abre hasta cubrirlo de arriba abajo.
            cubrir = max(ancho_ext / 4 + 0.5, alto_ext / 2 + 0.4)
            anadir_foco(pos, obj, max(44, min(60, math.degrees(2 * math.atan(cubrir / (obj - pos).length)))), 1.25)
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


def focos_escultura(mk, uc, d_c, z_cara):
    """Luz principal desde el carril de enfrente, más frontal (unos 40°) y algo ladeada para
    modelar el volumen; un relleno suave desde el carril del mismo lado, más cenital."""
    x_carril, z_carril = L['carriles']['x'], L['carriles']['z'] - 0.14
    objetivo = mk.p(uc, d_c, z_cara)
    lado = 1 if mk.d.x > 0 else -1  # pared izquierda: la sala queda hacia +x
    anadir_foco((lado * x_carril, objetivo.y + 1.8, z_carril), objetivo, 18, 1.6)
    anadir_foco((-lado * x_carril, objetivo.y - 0.7, z_carril), objetivo, 22, 0.35)
    # Dos luces pequeñas escondidas en el alféizar levantan las sombras de la cara, que desde
    # los carriles (a 6 m) quedan bajo la frente y la corona. Sin luminaria ni haz visible.
    for s in (-1, 1):
        comun.foco(f'foco_alfeizar_{len(focos_lista)}_{s}', mk.p(uc + s * 0.5, -0.06, Z_ZOC + 0.03), objetivo,
                   2.5, 26, mezcla=0.8, radio=0.02, color=COLOR_FOCO)


focos_lista = []


def anadir_foco(pos, objetivo, angulo, intensidad=1.0):
    focos_lista.append((Vector(pos), Vector(objetivo), angulo, intensidad * INTENSIDAD_FOCOS))


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
    # Cada puerta recibe un par de focos tenues desde el carril más cercano (o desde el de
    # enfrente, si está en una pared lateral)
    c = L['carriles']
    for mk, *_ in hojas:
        for s in (-1, 1):
            obj = mk.p(s * 0.8, 0, 2.6)
            if abs(mk.d.y) > 0.5:
                pos = (math.copysign(c['x'], obj.x), min(max(obj.y, c['y0'] + 0.3), c['y1'] - 0.3), c['z'] - 0.14)
            else:
                pos = (-math.copysign(c['x'], obj.x), obj.y, c['z'] - 0.14)
            anadir_foco(pos, obj, 46, 0.3)


# ------------------------------------------------------------------ mobiliario

def banco(piezas, b):
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
    calle = next(v for v in VANOS if v.get('tipo') == 'calle')
    mk = PAREDES[calle['pared']](posicion(calle))
    z = calle['alto'] + 0.26 + 0.4 + 0.3
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
    bpy.context.scene.camera = bpy.data.objects.get('cam_entrada') or bpy.data.objects[f"cam_{next(iter(L['camaras']))}"]


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
        if OBRAS[cfg['id']].get('tipo') == 'relieve':
            colgar_relieve(cfg, piezas)
        else:
            colgar_obra(cfg, lienzos, oros, piezas, marcos)
    for cfg in L.get('exentas', []):
        colocar_exenta(cfg, piezas)
    if L.get('panel'):
        panel_sala(L['panel'])
    if ascensor_mk:
        ascensor(piezas, laton, emisivos)
    letras = constructor('oro')
    edicula_c = constructor('piedra', 'yeso')
    if any(cfg.get('edicula') for cfg in L['obras']):
        edicula(edicula_c, 'letras')
    luces_luna()
    carriles(piezas)
    crear_focos(piezas, lentes)
    for b in L.get('bancos') or ([L['banco']] if 'banco' in L else []):
        banco(piezas, b)
    if 'catenaria' in L:
        catenaria(laton)
    if any(v.get('tipo') == 'calle' for v in VANOS):
        cartel_salida(emisivos, 'salida')
    vidrio_termal(emisivos)
    for (a, b) in vidrios:
        emisivos.cara([(a[0], a[1], a[2]), (b[0], a[1], a[2]), (b[0], b[1], a[2]), (a[0], b[1], a[2])], M['luna'], hacia=(0, 0, -1))

    destinos = {
        'piezas': piezas.objeto('piezas', lightmap='piezas'),
        'letras': letras.objeto('letras'),
        'salida': emisivos.objeto('emisivos'),
    }
    if edicula_c.bm.faces:
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
    escena['inicio'] = {'posicion': comun.a_three((L['inicio']['x'], L['inicio']['y'], 1.65)), 'yaw': L['inicio'].get('yaw', 0)}
    escena['limites'] = {'xmin': -X, 'xmax': X, 'zmin': -LARGO, 'zmax': 0}
    # Zonas por las que se puede andar: la nave y el pasillo de cada puerta a otra sala
    escena['zonas'] = [[-X, -LARGO, X, 0]] + [p['zona'] for p in escena['pasos']]
    escena['cartelasAtlas'] = {'columnas': ATLAS_CARTELAS[0], 'filas': ATLAS_CARTELAS[1], 'aspecto': CARTELA[0] / CARTELA[1]}
    with open(comun.ruta_build('escena.json'), 'w', encoding='utf-8') as f:
        json.dump(escena, f, ensure_ascii=False, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=comun.ruta_build('museo.blend'))
    caras = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
    print(f'[construir] {len(bpy.context.scene.objects)} objetos, {caras} caras, {len(focos_lista)} focos')


if __name__ == '__main__':
    main()
