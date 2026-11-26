"""Personagens desenhados à mão, pixel a pixel (24x32). Cada letra é uma cor."""
from PIL import Image
PAL = {
 'O': '#1a1220',
 's': '#e8a47c', 'S': '#b8694b', 't': '#ffd2ab',
 'd': '#8a5234', 'D': '#5c321d', 'e': '#b57650',
 'w': '#e6e9f2', 'W': '#a3abc4', 'x': '#ffffff',
 'r': '#d63a3a', 'R': '#8f1f2a',
 'n': '#3a4e98', 'N': '#222c62',
 'k': '#2e2a38', 'K': '#18151f',
 'y': '#f2c12e', 'Y': '#b07d10',
 'h': '#6e4022', 'H': '#43250f', 'j': '#96613a',
 'g': '#8a93a8', 'G': '#545c72', 'm': '#cdd5e2',
 'c': '#43d0df', 'C': '#1b7c8c',
 'v': '#3f9b4f', 'V': '#24603a',
 'p': '#8b45d8', 'P': '#552489',
 'o': '#ea6b2b', 'Q': '#9a3a12',
 'a': '#e3c27a', 'A': '#a7843f',
 'z': '#a0a0a8', 'Z': '#5f6069',
 'b': '#9a6a3d', 'B': '#5e3c1f',
 'q': '#a99b63', 'u': '#6c6240',
 'l': '#fff3b0', 'i': '#ff8fa0',
}
W, H = 24, 32

def grid(rows):
    rows = [r.ljust(W, '.')[:W] for r in rows]
    rows += ['.' * W] * (H - len(rows))
    return rows

# cada personagem: quadro base + mudanças por quadro (lista de (x, y, letra))
CH = {}

CH['SUSHIMAN'] = dict(base=grid([
"........................",
".......OOOOOOOO.........",
"......OxwwwwwwwO........",
".....OxwwwwwwwwwO.......",
".....OwwwwrrrwwwO.......",
".....OwwwwrrrwwWO.......",
".....OwwwwrrrwwWO.......",
".....OWWWWWWWWWWO....Om.",
".....OKKKKKKKKKKO...Omm.",
"....OsKssssssssKO...Omg.",
"....OsssOssssOssO..OmgO.",
"....OSssOssssOssO..OmO..",
"....OsssssssssssO.OmgO..",
".....OsKKKKKKKKSO.OmO...",
".....OSssssssssSO.OK....",
"......OOrrrrrrOO..OKO...",
"....OOwwRrrrRwwwOOsO....",
"...OwwwwwRrRwwwwwssO....",
"...OwwwwwwOwwwwwwWOO....",
"...OsswwwwwwwwwwWO......",
"...OssOrrrrrrrrrRO......",
"....OOnnnnnnnnnnNO......",
".....OnnnnnnnnnnNO......",
".....OnnnnnnnnnnNO......",
".....OnnnnnNNnnnNO......",
".....ONNNNNO.ONNNO......",
".....OnnnnO..OnnNO......",
".....OnnnnO..OnnNO......",
"....ObbbbbO..ObbbbO.....",
"....OBBBBBO..OBBBBO.....",
".....OOOOO....OOOO......",
]), blink=[(8, 10, 'S'), (13, 10, 'S'), (8, 11, 'S'), (13, 11, 'S')],
   glint=[(21, 8, 'x'), (22, 7, 'l')])

CH['BUMBLEBEE'] = dict(base=grid([
"......O.......O.........",
".......O.....O..........",
"......OyO...OyO.........",
".......OOOOOOOO.........",
"......OyyyyyyyyO........",
".....OyyyyyyyyyYO.......",
".....OKKKKKKKKKKO.......",
".....OyyyyyyyyyYO.......",
".....OccccccccccO.......",
".....OclcccccccCO.......",
".....OsssssssssSO.......",
".....OssssOOsssSO.......",
"......OSsssssSSO........",
".......OOOOOOOO.........",
".....OOyyyyyyyyOO.......",
"....OyyyyyyyyyyyYO......",
"...OkOKKKKKKKKKKOkO.....",
"...OkOyyyyyyyyyYOkO.....",
"...OssOKKKKKKKKOssO.....",
"...OssOyyyyyyyYOssO.....",
"....OOOKKKKKKKKOOO......",
"......OyyyyyyyYO..O.....",
"......OKKKKKKKKO.OyO....",
"......OKKKOOKKKO..O.....",
"......OkkKO.OkKO........",
"......OkkKO.OkKO........",
"......OkkKO.OkKO........",
".....OyyyYO.OyyYO.......",
".....OYYYYO.OYYYO.......",
"......OOOO...OOO........",
]), blink=[], glint=[(7, 9, 'x'), (8, 9, 'l')])

CH['BAIANO'] = dict(base=grid([
"........................",
"........OOOOOO..........",
".......OaaaaaaO.........",
"......OaaaaaaaAO........",
"......OrrrrrrrrO........",
"...OOOaaaaaaaaaAOOO.....",
"..OaaaaaaaaaaaaaaaAO....",
"...OOOOOOOOOOOOOOOO.....",
".....OKdddddddddO.......",
".....OddOddddOddO.......",
".....OddOddddOddO.......",
".....ODddddddddDO.......",
"......OdOxxxxOdO........",
".......ODddddDO.........",
"..O...OOvdddvOO.........",
"..O.OOvvvdddvvvOO.......",
"..OOvvvvvvdvvvvvvO......",
"..OOvvvvvvvvvvvvVO......",
".OxOddvvvvvvvvvddO......",
"OxxOddOvvvvvvvOddO......",
".OB.OOyyyyyyyyyOOrO.....",
".OB...OwwwwwwwWO........",
".OB...OwwwwwwwWO........",
".OBO..OwwwOOwwWO........",
"OBBBO.OwwWO.OwWO........",
"OjBBO.OwwWO.OwWO........",
"OBBBO.OwwWO.OwWO........",
".OOO.ODddDO.OddDO.......",
".....OOOOOO..OOOO.......",
]), blink=[(8, 9, 'D'), (13, 9, 'D'), (8, 10, 'D'), (13, 10, 'D')], glint=[(1, 18, 'l')])

CH['MEGALOTRON'] = dict(base=grid([
"..........OOO...........",
".........OgGGO..........",
".......OOOOOOOOO........",
"......OmgggggggGO.......",
"......OgRrrrrrRGO.......",
"......OgrlllllrGO.......",
"......OgRrrrrrRGO.......",
"......OgGOGOGOGGO.......",
".......OGGGGGGGO........",
"..OOOOOOOOOOOOOOOOOO....",
".OmggGOgggggggggOmggGO..",
".OgggGOgggOOOggGOgggGO..",
".OGGGGOggOcccOgGOGGGGO..",
"..OggOOggOclcOgGOOggO...",
"..OggO.OgOcccOGO.OggO...",
"..OggO.OggOOOgGO.OggO...",
".OGGGGOOGGGGGGGOOGGGGO..",
".OgggGO.OgGGGgO.OgggGO..",
".OOOOOO.OOOOOOO.OOOOOO..",
"........OggOgGO.........",
".......OggGOOggGO.......",
".......OgGO..OgGO.......",
".......OmgO..OmgO.......",
".......OgGO..OgGO.......",
"......OGGGGO.OGGGGO.....",
"......OggggO.OggggO.....",
".......OOOO...OOOO......",
]), blink=[(8, 5, 'r'), (9, 5, 'r'), (10, 5, 'r'), (11, 5, 'r'), (12, 5, 'r')], glint=[(11, 13, 'x')])

CH['SANSÃO'] = dict(base=grid([
"........OOOOOOO.........",
".......OhhhhhhhO........",
"......OhjhhhhhhhO.......",
".....OhjhhhhhhhhhO......",
".....OhhsssssssshO......",
".....OhOssOsssOshO......",
".....OhsssssssssshO.....",
".....OhsHHHHHHHshhO.....",
".....OhHhhxxxhhHhhO.....",
"....OhhOHhhhhhHOhhO.....",
"....OhhO.OHHHO.OhhO.....",
"...OOhOOOOOOOOOOOhOO....",
"..OsssssssssssssssssO...",
"..OstssssssssssssssSO...",
".OssOsssSsssSsssOssSO...",
".OssOsssSsssSsssOOSSO...",
".OsSOOsssssssssSO.OSO...",
"..OO.OsssSssSssSO..O....",
"..OzO.OOrrrrrrrRO.......",
".OzzzO.ORrrrrrrRO.......",
".OZzzO.ORrRRrrRRO.......",
".OzzZO..OsSO.OsSO.......",
".OZzzO..OsSO.OsSO.......",
".OzzZO..OsSO.OsSO.......",
".OZzzO.OhhhO.OhhhO......",
".OOOOO.OOOOO.OOOOO......",
]), blink=[(8, 5, 's'), (13, 5, 's')], glint=[(3, 13, 'x')])

CH['KAMIKAZE'] = dict(base=grid([
"........................",
"........OOOOOO..........",
".......OjhhhhhO.........",
"......OjhhhhhhhO........",
".....OhOOOOOOOOhO.......",
".....OOcclOcclOOO.......",
".....OhOccOOccOhO.......",
".....OhOOOOOOOOhO.......",
".....OhssssssssShO......",
".....OhsOssssOssO.......",
".....OhssssssssSO.......",
".....OhSssOOOssSO.......",
"......OOSsssssSOrrO.....",
".....OOrrrrrrrrrRRrrO...",
"....OjhhhRrrRhhhOOOrrO..",
"...OjhhhhhhOhhhhhO..OO..",
"...OhhhhhhhOhhhhhssO....",
"...OsshhhhhOhhhhHssO....",
"...OssOhhhhOhhhhHOO.....",
"....OOqqqqqqqqqquO......",
".....OqqqqqqqqqquO......",
".....OqqqqOOqqqquO......",
".....OqqquO.Oqqqu.......",
".....OqqquO.OqqquO......",
".....OhhhhO.OhhhhO......",
"....OhhhhHO.OhhhhHO.....",
".....OOOOO...OOOOO......",
]), blink=[(8, 9, 'S'), (13, 9, 'S')], glint=[(8, 5, 'x')])

CH['BAILA VINI'] = dict(base=grid([
"...................OOO..",
"......OOOOOO......OssO..",
".....OKkkkkkOO...OssO...",
"....OKkkkkkkkkO.OppO....",
"....OkkkkkkkkkKOOppO....",
".....OKKKKKKKKOOppO.....",
".....OssssssssOppPO.....",
".....OKKKKKKKKOppO......",
".....OKpKKKKpKOpPO......",
".....OssssssssOppO......",
".....OsOxxxxOsOpPO......",
"......OSssssSOppO.......",
".......OOOOOOOppO.......",
".....OOpppwxwpppO.......",
"....OpppppwxwppppO......",
"...OppppppwwpppppO......",
"...OpppppppppplpO.......",
"..OssOpppppppppO........",
"..OssOpppppppppO........",
"...OOKKKKKKKKKKO........",
".....OKKKKKKKKKO........",
".....OKKKKOOKKKO........",
".....OKKKKO.OKKKO.......",
"....OKKKKKO.OKKKKO......",
"...OKKKKKKO.OKKKKKO.....",
"...OxxxxxxO.OxxxxxO.....",
"....OOOOOO...OOOOO......",
]), blink=[], glint=[(23, 0, 'l'), (2, 3, 'l'), (17, 0, 'l')])

CH['REVERSO'] = dict(base=grid([
"..................O.....",
".......OOOOOO....OxO....",
"......OnnnnnnO....O.....",
".....OnnnnnnnnO.........",
"..OOOnnnnnnnnnO...OOO...",
".OnnnnnnnnnnnnO..OrrrO..",
"..OOOOOOOOOOOOO.OrrrrrO.",
".....OhssssssssO.OrrrrrO",
".....OhsOssssOsO.OrrrrrO",
".....OhsOssssOsO..OrrrO.",
".....OssssssssSO...ObO..",
"......OSssOOssSO..ObO...",
".......OOOOOOOO..ObO....",
".....OOoooooooooOsO.....",
"....OooooooooooooO......",
"...OoooooxxoooooQO......",
"...OssOoooxxoooQO.......",
"...OssOoooooooooO.......",
"....OOnnnnnnnnnnO.......",
".....OnnnnnnnnnNO.......",
".....OnnnnOOnnnNO.......",
".....OssSO..OssSO.......",
".....OssSO..OssSO.......",
"....OxxxWO..OxxxWO......",
"....OOOOOO..OOOOOO......",
]), blink=[(8, 8, 's'), (13, 8, 's'), (8, 9, 'S'), (13, 9, 'S')], glint=[])

CH['BOMBEIRA'] = dict(base=grid([
"........OOOOOO..........",
".......OrryyrrO.........",
"......OrrryYrrrO........",
".....OrrrrrrrrrrO.......",
"...OOrrrrrrrrrrrrOO.....",
"..ORRRRRRRRRRRRRRRRO....",
"...OOOhOOOOOOOOOOO......",
"....OhOssssssssO........",
"....OhOsOssssOsO........",
"....OhOsOssssOsO........",
"....OhOssssssssSO.......",
"....OhOSiOiiOisO........",
"....OhOOSsssSSOO........",
"....OhOkkkkkkkkO........",
"....OOkkkkkkkkkkkO..OO..",
"...OkkkkkkkkkkkkkkOOmmO.",
"...OkkyyyykkyyyykkOOmO..",
"...OkkkkkkkkkkkkksssOc..",
"...OkkKkkkkkkkkkkOOO.c..",
"...OKKOkkkkkkkkkkO...c..",
"....OOyyyykkyyyykO..c...",
".....OkkkkkkkkkkkO..c...",
".....OkkkkOOkkkkkO.c....",
".....OkkkKO.OkkkKOc.....",
".....OyyyyO.OyyyyOc.....",
".....OkkkKO.OkkkKc......",
"....OKKKKKO.OKKKKKO.....",
"....OOOOOOO.OOOOOOO.....",
]), blink=[(8, 8, 's'), (13, 8, 's'), (8, 9, 'S'), (13, 9, 'S')], glint=[(22, 13, 'c'), (23, 12, 'x')])

CH['ENCAPUZADO'] = dict(base=grid([
"........................",
"........OOOOOO..........",
".......OzzzzzzOO........",
"......OzzzzzzzzZO.......",
".....OzzzzzzzzzzZO......",
".....OzzZOOOOOOZZO......",
"....OzzZOKKKKKKOZZO.....",
"....OzzOKKKKKKKKOZO.....",
"....OzZOKxKKKKxKOZO.....",
"....OzZOKxKKKKxKOZO.....",
"....OzZOKKKKKKKKOZO.....",
"....OZZOOKKKKKKOOZO.....",
".....OOrrrrrrrrrROO.....",
"....OrrRrrrrrrRrrrO.....",
"...OzzOrRrrrrRrRzzZO....",
"...OzzzORRRRRRROzzZO....",
"...OzzZhhhhhhhhhZzZO....",
"..OzzZOhhhhhhhhhOZzZO...",
"..OKKOhhhhhhhhhhhOKKO...",
"..OKKOhhhHhhhHhhhOOmO...",
"...OOhhhhHhhhHhhhOOmO...",
"....OhhhhHhhhHhhhhOmO...",
"....OhhhhHhhhHhhhhOmO...",
"....OhhhHhhhhhHhhhOmO...",
"....OhhhHhhhhhHhhHOgO...",
".....OOKKO...OKKOO.OO...",
".....OKKKO...OKKKO......",
"....OKKKKO...OKKKKO.....",
"....OOOOOO...OOOOOO.....",
]), blink=[(9, 8, 'K'), (14, 8, 'K'), (9, 9, 'K'), (14, 9, 'K')], glint=[(19, 19, 'x')])

def frame(name, i):
    c = CH[name]
    rows = [list(r) for r in c['base']]
    bob = i in (1, 2)               # respiração: tronco e cabeça sobem 1px nos quadros 1 e 2
    legs = 21                        # linhas a partir daqui não se mexem
    if bob:
        top = rows[:legs]; rest = rows[legs:]
        top = top[1:] + [list('.' * W)]
        # mantém a linha de junção para não abrir buraco
        top[legs - 1] = rows[legs - 1][:]
        rows = top + rest
    if i == 4:
        for x, y, ch in c['blink']: rows[y - (1 if bob else 0)][x] = ch
    if i == 2:
        for x, y, ch in c['glint']: rows[y][x] = ch
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in '.': continue
            col = PAL[ch]
            im.putpixel((x, y), tuple(int(col[k:k + 2], 16) for k in (1, 3, 5)) + (255,))
    return im

def frames(name):
    return [frame(name, i) for i in range(6)]

if __name__ == '__main__':
    sc = 8
    names = list(CH)
    im = Image.new('RGBA', (len(names) * (W + 4) * sc, H * sc), (24, 30, 44, 255))
    for i, n in enumerate(names):
        f = frame(n, 0).resize((W * sc, H * sc), Image.NEAREST)
        im.alpha_composite(f, (i * (W + 4) * sc, 0))
    im.save('/tmp/mao.png')
    print('ok')
