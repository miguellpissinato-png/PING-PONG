"""Gera os GIFs dos personagens a partir de desenhos.py.
Uso: python3 gerar.py   (precisa de Pillow e numpy). Saída na pasta personagens/."""
import os, random, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
import desenhos as mao

DEST = os.path.join(os.path.dirname(__file__), '..')
TEMPOS = [260, 200, 260, 200, 140, 320]

def to_gif(frs, path, sc, bgfn=None):
    big = []
    for i, f in enumerate(frs):
        if bgfn:
            bg = bgfn(i); bg.alpha_composite(f, ((bg.size[0] - f.size[0]) // 2, bg.size[1] - f.size[1] - 3)); f = bg
        big.append(f.resize((f.size[0] * sc, f.size[1] * sc), Image.NEAREST))
    w, h = big[0].size
    strip = Image.new('RGB', (w, h * len(big)), (255, 0, 255))
    for i, b in enumerate(big):
        a = np.array(b); a[a[:, :, 3] < 128] = (255, 0, 255, 255)
        strip.paste(Image.fromarray(a[:, :, :3]), (0, i * h))
    q = strip.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette(); t = None
    for j in range(256):
        if pal[3 * j:3 * j + 3] == [255, 0, 255]: t = j; break
    outs = [q.crop((0, i * h, w, (i + 1) * h)) for i in range(len(big))]
    kw = dict(save_all=True, append_images=outs[1:], duration=TEMPOS, loop=0, disposal=2)
    if t is not None: kw['transparency'] = t
    outs[0].save(path, **kw)

def cenario(t):
    """sala escura com duas lanternas de papel (perfil)"""
    W, H = 40, 40; rnd = random.Random(5)
    im = Image.new('RGBA', (W, H), (12, 22, 30, 255)); d = ImageDraw.Draw(im)
    for y in range(30): d.line([(0, y), (W, y)], fill=(14 + y // 6, 28 + y // 5, 38 + y // 4, 255))
    for x0 in (3, 34): d.rectangle((x0, 0, x0 + 2, 30), fill=(18, 36, 44, 255)); d.line([(x0, 0), (x0, 30)], fill=(36, 70, 78, 255))
    d.rectangle((0, 31, W, H), fill=(16, 32, 38, 255)); d.line([(0, 31), (W, 31)], fill=(236, 170, 82, 255))
    for x in range(0, W, 5): d.line([(x, 32), (x, H)], fill=(11, 24, 30, 255))
    for cx in (8, 31):
        # brilho em pixel: anéis de cor quente, sem transparência (fica limpo no GIF)
        halo = [(62, 52, 44), (78, 62, 46)] if t % 2 == 0 else [(66, 55, 45), (84, 66, 47)]
        d.ellipse((cx - 6, 6, cx + 6, 18), fill=halo[0] + (255,))
        d.ellipse((cx - 4, 8, cx + 4, 16), fill=halo[1] + (255,))
        d.rectangle((cx - 2, 9, cx + 2, 15), fill=(120, 54, 24, 255))
        d.rectangle((cx - 1, 9, cx + 1, 14), fill=(255, 214, 130, 255)); d.point((cx, 10), fill=(255, 244, 200, 255))
        d.line([(cx, 5), (cx, 8)], fill=(40, 30, 30, 255))
    for i in range(6):
        x = rnd.randrange(6, 34); y = (rnd.randrange(4, 28) - t) % 28 + 2; d.point((x, y), fill=(255, 200, 120, 255))
    return im

def slug(n):
    return n.lower().replace(' ', '-').replace('ã', 'a')

if __name__ == '__main__':
    for n in mao.CH:
        fr = mao.frames(n)
        to_gif(fr, os.path.join(DEST, slug(n) + '.gif'), 10)
        to_gif(fr, os.path.join(DEST, slug(n) + '-perfil.gif'), 8, cenario)
        print(n)
