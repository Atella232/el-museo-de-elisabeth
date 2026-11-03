"""Texturas procedurales del museo, generadas con numpy (sin descargas).

El ruido se crea filtrando ruido blanco en el dominio de frecuencias, así que es periódico
y las texturas se repiten sin costuras. Todas se guardan en build/texturas/ como PNG y se
cargan como imágenes de Blender (el exportador glTF las incrusta en WebP).
"""
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import comun  # noqa: E402


def ruido(n, beta=2.0, semilla=0, m=None):
    """Ruido fractal periódico de n×m, media 0 y desviación 1. beta alto = más suave."""
    m = m or n
    rng = np.random.default_rng(semilla)
    espectro = np.fft.fft2(rng.standard_normal((n, m)))
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(m)[None, :]
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    espectro *= f ** (-beta / 2)
    espectro[0, 0] = 0
    r = np.real(np.fft.ifft2(espectro))
    return (r - r.mean()) / (r.std() + 1e-9)


def srgb(hex_):
    h = hex_.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def mezclar(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return a * (1 - t) + b * t


def vetas(n, semilla, frecuencia=(2, 1), turbulencia=1.4, finura=10.0, m=None):
    """Vetas de mármol: un seno periódico deformado por ruido. Devuelve 0..1 (1 = veta)."""
    m = m or n
    v, u = np.mgrid[0:n, 0:m]
    u = u / m
    v = v / n
    t = ruido(n, 2.2, semilla, m) * 0.18 + ruido(n, 1.6, semilla + 1, m) * 0.05
    fase = 2 * np.pi * (frecuencia[0] * u + frecuencia[1] * v + turbulencia * t)
    return np.exp(-np.abs(np.sin(fase)) * finura)


def guardar(nombre, rgb, no_color=False):
    """rgb: float 0..1 en sRGB (o datos), forma (alto, ancho, 3). Devuelve la imagen de Blender."""
    ruta = comun.ruta_build('texturas', f'{nombre}.png')
    alto, ancho = rgb.shape[:2]
    if nombre in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[nombre])
    img = bpy.data.images.new(nombre, ancho, alto, alpha=False)
    img.colorspace_settings.name = 'Non-Color' if no_color else 'sRGB'
    # Blender guarda las filas de abajo arriba
    rgba = np.dstack([np.clip(rgb[::-1], 0, 1), np.ones((alto, ancho, 1))]).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = ruta
    img.file_format = 'PNG'
    img.save()
    return img


def normal_desde_altura(h, fuerza=2.0):
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * fuerza, gy * fuerza, np.ones_like(h)
    largo = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.dstack([nx / largo, ny / largo, nz / largo]) * 0.5 + 0.5


# ---------------------------------------------------------------- suelo

ATLAS_CELDAS = 4  # 4×4 baldosas: 8 blancas (celdas 0–7) y 8 negras (8–15)


def marmol_blanco(n, semilla):
    base = mezclar(srgb('#e9e6df'), srgb('#d6d3cc'), 0.5 + 0.25 * ruido(n, 2.6, semilla + 7))
    nube = 0.5 + 0.2 * ruido(n, 1.8, semilla + 3)
    base = mezclar(base, srgb('#c9c7c2'), nube * 0.35)
    gruesas = vetas(n, semilla, frecuencia=(1, 2), turbulencia=1.6, finura=7)
    finas = vetas(n, semilla + 11, frecuencia=(3, -1), turbulencia=2.2, finura=18)
    base = mezclar(base, srgb('#8d9298'), gruesas * 0.55)
    return mezclar(base, srgb('#a9acb0'), finas * 0.4)


def marmol_negro(n, semilla):
    base = mezclar(srgb('#121214'), srgb('#1d1d20'), 0.5 + 0.3 * ruido(n, 2.4, semilla + 5))
    gruesas = vetas(n, semilla, frecuencia=(2, 1), turbulencia=1.3, finura=14)
    finas = vetas(n, semilla + 13, frecuencia=(1, -3), turbulencia=2.4, finura=26)
    base = mezclar(base, srgb('#d8d6d0'), gruesas * 0.75)
    return mezclar(base, srgb('#8a8884'), finas * 0.45)


def atlas_suelo(celda=512):
    """Atlas de baldosas con junta oscura y un leve bisel en el borde de cada pieza."""
    lado = celda * ATLAS_CELDAS
    atlas = np.zeros((lado, lado, 3), np.float32)
    borde = np.ones((celda, celda), np.float32)
    k = max(2, celda // 170)
    borde[:k, :] = borde[-k:, :] = borde[:, :k] = borde[:, -k:] = 0.0
    bisel = np.ones((celda, celda), np.float32)
    b = k * 3
    for i in range(b):
        f = 0.82 + 0.18 * i / b
        bisel[i, :] = np.minimum(bisel[i, :], f)
        bisel[-1 - i, :] = np.minimum(bisel[-1 - i, :], f)
        bisel[:, i] = np.minimum(bisel[:, i], f)
        bisel[:, -1 - i] = np.minimum(bisel[:, -1 - i], f)
    for i in range(ATLAS_CELDAS * ATLAS_CELDAS):
        blanca = i < 8
        tex = marmol_blanco(celda, 100 + i) if blanca else marmol_negro(celda, 200 + i)
        tex = tex * bisel[..., None]
        junta = srgb('#3b3833') if blanca else srgb('#0b0b0c')
        tex = mezclar(junta[None, None, :] * np.ones_like(tex), tex, borde)
        fila, col = divmod(i, ATLAS_CELDAS)
        atlas[fila * celda:(fila + 1) * celda, col * celda:(col + 1) * celda] = tex
    return guardar('suelo_atlas', atlas)


def celda_uv(indice):
    """Rectángulo UV (u0, v0, u1, v1) de una celda del atlas (v hacia arriba, como en Blender)."""
    fila, col = divmod(indice, ATLAS_CELDAS)
    t = 1 / ATLAS_CELDAS
    return col * t, 1 - (fila + 1) * t, (col + 1) * t, 1 - fila * t


# Greca griega: un periodo de 6×6 celdas (1 = mármol blanco), dibujado de arriba abajo.
GRECA = np.array([
    [1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1, 0],
    [1, 0, 1, 1, 1, 0],
    [1, 0, 1, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1],
], np.float32)


def greca(px_celda=48):
    """Franja de greca: un periodo de 6 celdas a lo largo y 8 a lo ancho (con márgenes)."""
    filas = np.zeros((8, 6), np.float32)
    filas[1:7, :] = GRECA
    mascara = np.kron(filas, np.ones((px_celda, px_celda), np.float32))
    # suavizado para que la línea no quede dentada
    h, w = mascara.shape
    suave = (mascara + np.roll(mascara, 1, 0) + np.roll(mascara, -1, 0)
             + np.roll(mascara, 1, 1) + np.roll(mascara, -1, 1)) / 5
    fondo = marmol_negro(max(h, w), 31)[:h, :w]
    linea = marmol_blanco(max(h, w), 37)[:h, :w]
    # filete blanco fino junto a los bordes de la franja
    filete = np.zeros((h, w), np.float32)
    g = px_celda // 6
    filete[g * 2:g * 3, :] = 1
    filete[-g * 3:-g * 2, :] = 1
    return guardar('greca', mezclar(fondo, linea, np.maximum(suave, filete)))


# ---------------------------------------------------------------- muros y piedra

def yeso(n=1024):
    h = ruido(n, 2.4, 41) * 0.6 + ruido(n, 1.2, 42) * 0.25
    color = mezclar(srgb('#b99f7d'), srgb('#c9b292'), 0.5 + 0.25 * ruido(n, 2.8, 43))
    color = color * (1 + 0.025 * ruido(n, 0.8, 44))[..., None]
    guardar('yeso_normal', normal_desde_altura(h, 1.2), no_color=True)
    return guardar('yeso', color)


def piedra(n=1024):
    """Piedra clara para pilastras, entablamento y molduras (tipo travertino suave)."""
    base = mezclar(srgb('#d9cfbb'), srgb('#cbbfa7'), 0.5 + 0.3 * ruido(n, 2.5, 51))
    poros = np.clip(ruido(n, 0.6, 52) - 1.8, 0, 1)
    estratos = vetas(n, 53, frecuencia=(0, 6), turbulencia=0.6, finura=4) * 0.12
    base = mezclar(base, srgb('#b8aa8f'), estratos)
    return guardar('piedra', mezclar(base, srgb('#9f927a'), poros))


def marmol_zocalo(n=1024):
    """Verde antico oscuro para el zócalo."""
    base = mezclar(srgb('#16201b'), srgb('#24312a'), 0.5 + 0.3 * ruido(n, 2.2, 61))
    manchas = np.clip(ruido(n, 1.9, 62) * 0.6, 0, 1)
    base = mezclar(base, srgb('#3d5246'), manchas * 0.6)
    finas = vetas(n, 63, frecuencia=(2, 3), turbulencia=2.0, finura=20)
    return guardar('marmol_zocalo', mezclar(base, srgb('#b9c2b6'), finas * 0.5))


# ---------------------------------------------------------------- metales y otros

def oro(n=512):
    base = mezclar(srgb('#d9a94e'), srgb('#b88a3a'), 0.5 + 0.3 * ruido(n, 2.0, 71))
    return guardar('oro', mezclar(base, srgb('#7a5a2a'), np.clip(ruido(n, 1.4, 72) - 1.2, 0, 1)))


def bronce(n=512):
    base = mezclar(srgb('#5a4129'), srgb('#6e5236'), 0.5 + 0.3 * ruido(n, 2.0, 81))
    patina = np.clip(ruido(n, 2.4, 82) - 0.6, 0, 1) * 0.5
    return guardar('bronce', mezclar(base, srgb('#3f5a4a'), patina))


def madera(n=512):
    v, u = np.mgrid[0:n, 0:n] / n
    vetas_madera = np.sin(2 * np.pi * (u * 14 + ruido(n, 2.2, 91) * 0.25)) * 0.5 + 0.5
    base = mezclar(srgb('#3a2417'), srgb('#5a3a24'), vetas_madera * 0.7 + 0.15 * ruido(n, 1.5, 92))
    return guardar('madera', base)


def terracota(n=1024):
    """Ánforas: u alrededor, v a lo alto. Barniz negro en cuello y pie, bandas y greca."""
    v, u = np.mgrid[0:n, 0:n] / n
    v = 1 - v
    base = mezclar(srgb('#b0603a'), srgb('#c2734a'), 0.5 + 0.25 * ruido(n, 2.4, 101))
    negro = srgb('#16110e')
    barniz = ((v < 0.12) | (v > 0.72)).astype(np.float32)
    bandas = (np.abs(v - 0.22) < 0.008) | (np.abs(v - 0.6) < 0.008)
    # friso con figuras sencillas: siluetas redondeadas repetidas
    friso = (v > 0.3) & (v < 0.55)
    figuras = (np.sin(u * 2 * np.pi * 6) > 0.55) & (np.abs(np.sin((v - 0.3) / 0.25 * np.pi)) > 0.25)
    mascara = np.maximum(barniz, (bandas | (friso & figuras)).astype(np.float32))
    return guardar('terracota', mezclar(base, negro, mascara))


def todas():
    return {
        'suelo_atlas': atlas_suelo(),
        'greca': greca(),
        'yeso': yeso(),
        'piedra': piedra(),
        'marmol_zocalo': marmol_zocalo(),
        'oro': oro(),
        'bronce': bronce(),
        'madera': madera(),
        'terracota': terracota(),
    }
