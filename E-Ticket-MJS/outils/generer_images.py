#!/usr/bin/env python3
"""Génère les illustrations locales (SVG originales, aux couleurs du Mali) des sports et le fond du site.
Usage : python3 outils/generer_images.py   → public/img/sports/<id>/1.svg 2.svg 3.svg + public/img/fond-jeunesse.svg + fond-hero.svg
Pour utiliser de vraies photos : déposez .jpg/.png/.webp/.svg dans public/img/sports/<id>/ (elles remplacent ces illustrations)."""
import os, math
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'img')
V, J, R = '#0a8f3c', '#fcd116', '#ce1126'
SKIN, DARK = '#5a3825', '#14181f'
W, H, GY = 600, 750, 560

SPORTS = [
 ('football','Football','Sport moderne'),('basketball','Basketball','Sport moderne'),('athletisme','Athlétisme','Sport moderne'),
 ('arts-martiaux','Arts martiaux','Sport moderne'),('cyclisme','Cyclisme','Sport moderne'),('natation','Natation','Sport moderne'),
 ('courses-chevaux','Courses de chevaux','Sport moderne'),('lutte','Lutte traditionnelle','Sport traditionnel'),
 ('sokone','Sokone','Sport traditionnel'),('jeux-traditionnels','Jeux traditionnels','Sport traditionnel'),
 ('tir-arc','Tir à l’arc','Activité sportive'),('sports-nautiques','Sports nautiques','Activité sportive'),('culture','Culture & jeunesse','Jeunesse & culture')]

def line(a, b, w, c, cap='round'): return f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="{c}" stroke-width="{w}" stroke-linecap="{cap}"/>'
def poly(pts, w, c): return '<polyline points="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"/>' % (' '.join(f'{x},{y}' for x, y in pts), c, w)
def mid(a, b, t): return (a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)

def person(p, kit=V, shorts=DARK, skin=SKIN, hr=27, w=21, extra=''):
    s = ''
    s += poly([p['hip'], p['k2'], p['f2']], w, skin) + line(p['hip'], mid(p['hip'], p['k2'], .5), w+9, shorts)
    s += poly([p['sh'], p['e2'], p['h2']], w-3, skin)
    s += poly([p['hip'], p['k1'], p['f1']], w, skin) + line(p['hip'], mid(p['hip'], p['k1'], .5), w+9, shorts)
    s += line(p['sh'], p['hip'], 44, kit)
    s += poly([p['sh'], p['e1'], p['h1']], w-3, skin)
    s += f'<circle cx="{p["head"][0]}" cy="{p["head"][1]}" r="{hr}" fill="{skin}"/>'
    return s + extra

def mirror(p): return {k: (W-v[0], v[1]) for k, v in p.items()}
def ball(x, y, r=26, c='#fff'):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}" stroke="{DARK}" stroke-width="3"/>'
            f'<polygon points="{x},{y-r*.45} {x+r*.43},{y-r*.14} {x+r*.27},{y+r*.36} {x-r*.27},{y+r*.36} {x-r*.43},{y-r*.14}" fill="{DARK}"/>')
def shadow(x, y, rx=110): return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="14" fill="#000" opacity=".22"/>'

# ------------------------------------------------------------------ scènes (premier plan)
def football():
    net = ''.join(line((395+i*20, 340), (395+i*20, GY), 1.5, '#fff') for i in range(9)) + ''.join(line((385, 340+i*22), (580, 340+i*22), 1.5, '#fff') for i in range(1, 10))
    s = '<g opacity=".85">' + net + '</g>' + f'<rect x="385" y="336" width="195" height="{GY-336}" fill="none" stroke="#fff" stroke-width="9" rx="3"/>'
    p = dict(head=(272,255), sh=(272,298), hip=(262,408), k1=(330,462), f1=(402,516), k2=(255,490), f2=(243,560), e1=(222,352), h1=(182,382), e2=(322,338), h2=(352,300))
    return s + shadow(300, GY+8) + person(p, V, DARK) + ball(442, 538)

def basketball():
    s = f'<rect x="478" y="95" width="14" height="150" fill="#e8e8e8" stroke="{DARK}" stroke-width="3"/><rect x="440" y="120" width="40" height="70" fill="none" stroke="#fff" stroke-width="5"/>'
    s += f'<ellipse cx="428" cy="205" rx="48" ry="12" fill="none" stroke="{R}" stroke-width="7"/>' + ''.join(line((388+i*20, 207), (405+i*10, 262), 2, '#fff') for i in range(5))
    p = dict(head=(288,238), sh=(292,284), hip=(292,394), k1=(262,462), f1=(238,520), k2=(332,452), f2=(354,510), e1=(322,250), h1=(338,188), e2=(252,244), h2=(286,186))
    b = f'<circle cx="332" cy="150" r="31" fill="#e07b1a" stroke="{DARK}" stroke-width="3"/><path d="M301 150H363M332 119V181M311 128Q332 150 311 172M353 128Q332 150 353 172" stroke="{DARK}" stroke-width="2.5" fill="none"/>'
    return s + shadow(300, GY+8, 80) + person(p, J, DARK) + b

def athletisme():
    s = ''.join(f'<polygon points="{300+(i-2)*-30},{GY-4} {300+(i-2)*-30+22},{GY-4} {300+(i-2)*140+60},750 {300+(i-2)*140},750" fill="#fff" opacity=".7"/>' for i in range(5))
    s += f'<rect x="60" y="{GY-4}" width="480" height="8" fill="#fff"/>'
    p = dict(head=(345,262), sh=(322,298), hip=(278,392), k1=(352,424), f1=(362,502), k2=(226,452), f2=(158,494), e1=(372,336), h1=(406,292), e2=(268,344), h2=(238,300))
    return s + shadow(290, GY+8, 140) + person(p, R, DARK) + f'<rect x="248" y="270" width="80" height="22" rx="4" transform="rotate(25 300 300)" fill="#fff" opacity=".95"/>'

def arts_martiaux():
    s = f'<rect x="40" y="{GY-6}" width="520" height="40" rx="8" fill="{R}"/><rect x="40" y="{GY-6}" width="520" height="10" rx="5" fill="#fff" opacity=".4"/>'
    p = dict(head=(262,252), sh=(274,294), hip=(272,404), k1=(362,384), f1=(458,332), k2=(268,486), f2=(262,556), e1=(326,326), h1=(352,290), e2=(222,336), h2=(196,296))
    belt = f'<rect x="248" y="388" width="52" height="14" rx="3" fill="{J}"/>'
    return s + shadow(270, GY+14, 90) + person(p, '#f4f4f0', '#f4f4f0') + belt

def cyclisme():
    R_, F_, B, S, Hh = (170,500), (430,500), (290,500), (258,388), (382,402)
    s = ''.join(f'<circle cx="{c[0]}" cy="{c[1]}" r="86" fill="none" stroke="{DARK}" stroke-width="9"/><circle cx="{c[0]}" cy="{c[1]}" r="6" fill="{DARK}"/>' for c in (R_, F_))
    s += ''.join(line((c[0], c[1]), (c[0]+84*math.cos(a), c[1]+84*math.sin(a)), 1.5, DARK) for c in (R_, F_) for a in [i*math.pi/6 for i in range(12)])
    s += poly([R_, B, Hh, S, R_], 9, J) + poly([B, S], 9, J) + poly([Hh, F_], 8, DARK) + poly([Hh, (390,368), (428,374)], 8, DARK) + line((240,386), (282,386), 12, DARK)
    p = dict(head=(380,268), sh=(348,312), hip=(262,372), k1=(334,442), f1=(302,508), k2=(316,424), f2=(278,520), e1=(392,348), h1=(420,374), e2=(392,348), h2=(420,374))
    return s + shadow(300, GY+22, 190) + person(p, V, DARK) + f'<path d="M355 250Q380 228 405 250Z" fill="{R}"/>'

def natation():
    s = f'<rect x="0" y="430" width="{W}" height="{H-430}" fill="#1a8fc4"/><rect x="0" y="430" width="{W}" height="26" fill="#2fb0e2"/>'
    s += ''.join(f'<path d="M0 {y}Q75 {y-18} 150 {y}T300 {y}T450 {y}T600 {y}" fill="none" stroke="#fff" stroke-width="4" opacity=".5"/>' for y in (500, 560, 620, 680))
    s += ''.join(line((0, y), (W, y), 6, c) for y, c in ((460, R), (468, J)))
    s += f'<path d="M205 470Q320 440 450 480" stroke="{V}" stroke-width="46" fill="none" stroke-linecap="round"/><path d="M450 480L545 462" stroke="{SKIN}" stroke-width="20" stroke-linecap="round"/>'
    s += f'<circle cx="196" cy="458" r="25" fill="{SKIN}"/><path d="M172 452Q196 424 222 452Z" fill="{J}"/>'
    s += f'<path d="M262 455Q290 340 200 388" stroke="{SKIN}" stroke-width="20" fill="none" stroke-linecap="round"/>'
    s += f'<path d="M0 492Q75 470 150 492T300 492T450 492T600 492V750H0Z" fill="#1a8fc4" opacity=".92"/><path d="M0 492Q75 470 150 492T300 492T450 492T600 492" fill="none" stroke="#fff" stroke-width="6" opacity=".8"/>'
    s += ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fff" opacity=".85"/>' for x, y, r in ((560,440,9),(578,420,6),(535,425,7),(180,365,8),(150,380,5),(210,350,5)))
    return s

def courses_chevaux():
    BR = '#7a4a22'
    s = shadow(300, GY+14, 220) + ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#c9a66b" opacity=".5"/>' for x, y, r in ((110,545,26),(70,555,18),(145,550,16),(40,540,12)))
    s += poly([(235,440),(165,482),(112,470)], 20, BR) + poly([(245,445),(205,505),(150,520)], 20, '#5e3818')
    s += poly([(372,440),(440,474),(500,452)], 20, BR) + poly([(362,446),(412,504),(452,522)], 20, '#5e3818')
    s += f'<ellipse cx="302" cy="400" rx="128" ry="58" fill="{BR}"/><path d="M380 370Q420 300 440 262L492 282Q450 320 424 410Z" fill="{BR}"/>'
    s += f'<ellipse cx="482" cy="268" rx="46" ry="22" transform="rotate(28 482 268)" fill="{BR}"/><path d="M428 268Q420 330 392 372" stroke="{DARK}" stroke-width="14" fill="none" stroke-linecap="round"/>'
    s += f'<path d="M184 372Q130 380 96 440" stroke="{DARK}" stroke-width="18" fill="none" stroke-linecap="round"/><circle cx="494" cy="262" r="4" fill="#fff"/>'
    s += f'<rect x="276" y="338" width="70" height="26" rx="12" fill="{R}"/>'
    p = dict(head=(338,226), sh=(324,276), hip=(298,346), k1=(350,390), f1=(340,438), k2=(350,390), f2=(340,438), e1=(372,300), h1=(412,300), e2=(372,300), h2=(412,300))
    return s + person(p, J, '#fff', hr=25, w=19) + f'<path d="M313 218Q338 190 363 218Z" fill="{R}"/>' + line((412,300), (468,276), 3, DARK)

def lutte():
    s = f'<ellipse cx="300" cy="{GY+12}" rx="270" ry="40" fill="#d9b779" stroke="#fff" stroke-width="5"/>'
    crowd = ''.join(f'<circle cx="{40+i*52}" cy="{GY-30-(i%2)*10}" r="17" fill="#2b1a10" opacity=".55"/><rect x="{24+i*52}" y="{GY-16-(i%2)*10}" width="32" height="30" rx="14" fill="#2b1a10" opacity=".55"/>' for i in range(12))
    a = dict(head=(242,306), sh=(262,346), hip=(214,438), k1=(262,494), f1=(284,560), k2=(168,492), f2=(148,560), e1=(308,404), h1=(346,392), e2=(296,356), h2=(338,342))
    b = mirror(dict(head=(240,326), sh=(260,364), hip=(206,446), k1=(256,498), f1=(280,560), k2=(160,496), f2=(138,560), e1=(306,420), h1=(342,400), e2=(300,376), h2=(344,360)))
    return crowd + shadow(300, GY+16, 220) + person(a, V, J) + person(b, R, J)

def sokone():
    s = ''.join(f'<rect x="{x}" y="{y}" width="18" height="{GY-y}" fill="#5a4630"/><ellipse cx="{x+9}" cy="{y}" rx="{r}" ry="{r*.55}" fill="#3e6b2a"/>' for x, y, r in ((40,360,60),(530,380,48)))
    for x in (150, 450):
        s += f'<rect x="{x-38}" y="{GY-62}" width="76" height="62" fill="#c98b4e"/><polygon points="{x-52},{GY-60} {x},{GY-120} {x+52},{GY-60}" fill="#8a5a22"/>'
    p1 = dict(head=(232,262), sh=(236,304), hip=(228,412), k1=(290,462), f1=(352,516), k2=(220,490), f2=(212,560), e1=(190,356), h1=(154,386), e2=(284,342), h2=(310,306))
    p2 = mirror(dict(head=(228,282), sh=(240,322), hip=(212,420), k1=(268,468), f1=(256,544), k2=(160,470), f2=(122,520), e1=(290,366), h1=(326,340), e2=(190,360), h2=(160,336)))
    return s + shadow(300, GY+8, 240) + person(p1, V, DARK) + person(p2, J, R) + ball(380, 540, 24, '#e9d7a8')

def jeux_traditionnels():
    n, x0, y0, c = 6, 110, 250, 63
    s = f'<rect x="{x0-16}" y="{y0-16}" width="{n*c+32}" height="{n*c+32}" rx="10" fill="#4a2c14"/>'
    for i in range(n):
        for j in range(n):
            s += f'<rect x="{x0+i*c}" y="{y0+j*c}" width="{c}" height="{c}" fill="{"#e6c98a" if (i+j)%2==0 else "#a8733a"}"/>'
    s += ''.join(f'<circle cx="{x0+i*c+c/2}" cy="{y0+j*c+c/2}" r="21" fill="{col}" stroke="{DARK}" stroke-width="3"/>' for i, j, col in ((0,0,'#f4f4f0'),(2,0,'#f4f4f0'),(4,1,'#f4f4f0'),(1,1,'#f4f4f0'),(3,2,'#f4f4f0'),(1,4,DARK),(3,4,DARK),(5,4,DARK),(2,3,DARK),(4,5,DARK)))
    s += f'<ellipse cx="300" cy="670" rx="230" ry="40" fill="#d9b779"/>' + f'<path d="M120 640Q175 700 230 640Z" fill="#8a5a22"/>' + ''.join(f'<circle cx="{x}" cy="{y}" r="9" fill="#f4f4f0" stroke="{DARK}" stroke-width="2"/>' for x, y in ((330,650),(360,666),(400,652),(440,668),(470,650)))
    return s

def tir_arc():
    s = line((520,440), (520,GY), 12, '#5a4630') + ''.join(f'<circle cx="520" cy="360" r="{r}" fill="{c}" stroke="{DARK}" stroke-width="3"/>' for r, c in ((78,'#f4f4f0'),(60,DARK),(44,'#2b7bd0'),(28,R),(12,J)))
    p = dict(head=(214,254), sh=(222,298), hip=(214,404), k1=(250,482), f1=(268,556), k2=(186,482), f2=(160,556), e1=(290,300), h1=(368,300), e2=(176,300), h2=(238,306))
    bow = f'<path d="M372 190Q452 300 372 410" stroke="#6b3d12" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M372 190L238 304L372 410" stroke="#f4f4f0" stroke-width="2.5" fill="none"/>'
    arrow = f'<line x1="238" y1="304" x2="470" y2="304" stroke="#8a5a22" stroke-width="5"/><polygon points="470,296 494,304 470,312" fill="{DARK}"/><polygon points="238,298 258,304 238,310" fill="{R}"/>'
    return s + shadow(230, GY+8, 110) + person(p, J, DARK) + bow + arrow

def sports_nautiques():
    s = f'<rect x="0" y="430" width="{W}" height="{H-430}" fill="#2a8fb8"/><rect x="0" y="430" width="{W}" height="20" fill="#5fc0df"/>'
    s += ''.join(f'<path d="M0 {y}Q75 {y-14} 150 {y}T300 {y}T450 {y}T600 {y}" fill="none" stroke="#fff" stroke-width="4" opacity=".45"/>' for y in (520, 580, 640, 700))
    s += f'<path d="M80 468Q300 538 520 468L492 506Q300 566 108 506Z" fill="#7a4a22"/><path d="M80 468Q300 538 520 468" stroke="{J}" stroke-width="7" fill="none"/><path d="M150 500Q300 548 450 500" stroke="{R}" stroke-width="6" fill="none"/>'
    s += f'<rect x="250" y="420" width="90" height="62" rx="20" fill="{V}"/><circle cx="300" cy="388" r="26" fill="{SKIN}"/><path d="M276 380Q300 346 326 380Z" fill="{J}"/>'
    s += poly([(330,440),(390,470),(430,540)], 15, SKIN) + line((420,380), (455,640), 8, '#6b3d12') + f'<path d="M435 590Q470 610 450 650L420 640Z" fill="#6b3d12"/>'
    s += f'<path d="M0 520Q75 500 150 520T300 520T450 520T600 520" fill="none" stroke="#fff" stroke-width="5" opacity=".6"/>'
    s += f'<path d="M430 420L500 380L520 420Z" fill="#f4f4f0" opacity=".0"/>'
    return s

def culture():
    s = f'<polygon points="140,0 300,560 20,560" fill="#fff" opacity=".12"/><polygon points="460,0 580,560 300,560" fill="#fff" opacity=".1"/>'
    d = f'<path d="M205 330Q205 300 300 300T395 330Q360 410 342 440L360 520Q362 550 300 556T240 520L258 440Q240 410 205 330Z" fill="#9a5a24" stroke="{DARK}" stroke-width="4"/>'
    d += f'<ellipse cx="300" cy="326" rx="96" ry="22" fill="#f1dcb0" stroke="{DARK}" stroke-width="4"/>'
    d += ''.join(f'<path d="M{222+i*8} {352+i*0}L{250+i*4} {450} L{238+i*6} {540}" stroke="{J}" stroke-width="3" fill="none" opacity=".0"/>' for i in range(0))
    d += poly([(250,360),(262,452),(246,536),(270,500)], 0.01, 'none')
    d += ''.join(poly([(228+k*5, 366+i*46) , (300, 392+i*46), (372-k*5, 366+i*46)], 5, J) for i in range(3) for k in (0,))
    hands = ''.join(f'<ellipse cx="{x}" cy="{y}" rx="26" ry="18" fill="{SKIN}" transform="rotate({a} {x} {y})"/>' + line((x+(-1 if x<300 else 1)*20, y-8), (x+(-1 if x<300 else 1)*100, y-80), 20, SKIN) for x, y, a in ((262,276,-12),(338,276,12)))
    notes = ''.join(f'<g fill="{c}"><circle cx="{x}" cy="{y}" r="11"/><rect x="{x+8}" y="{y-44}" width="5" height="44"/><path d="M{x+13} {y-44}q24 8 18 28" stroke="{c}" stroke-width="5" fill="none"/></g>' for x, y, c in ((88,190,J),(520,210,'#fff'),(130,110,'#fff'),(480,120,J)))
    p = dict(head=(468,300), sh=(470,346), hip=(466,440), k1=(496,500), f1=(510,556), k2=(436,500), f2=(424,556), e1=(520,310), h1=(540,250), e2=(420,310), h2=(400,246))
    return s + shadow(300, GY+8, 240) + d + hands + notes + person(p, R, DARK, hr=25, w=19)

SCENES = dict(zip([s[0] for s in SPORTS], [football, basketball, athletisme, arts_martiaux, cyclisme, natation, courses_chevaux, lutte, sokone, jeux_traditionnels, tir_arc, sports_nautiques, culture]))

# ------------------------------------------------------------------ fonds
def bogolan(y, h, op=1, c1='#3a2414', c2='#f1e2c0', w=600):
    return (f'<defs><pattern id="bg{y}" width="60" height="{h}" patternUnits="userSpaceOnUse"><rect width="60" height="{h}" fill="{c2}"/>'
            f'<path d="M0 {h*.2}L15 {h*.5}L30 {h*.2}L45 {h*.5}L60 {h*.2}" stroke="{c1}" stroke-width="3" fill="none"/><path d="M0 {h*.8}L15 {h*.5}L30 {h*.8}L45 {h*.5}L60 {h*.8}" stroke="{c1}" stroke-width="3" fill="none"/>'
            f'<circle cx="30" cy="{h*.5}" r="4" fill="{c1}"/><rect x="6" y="{h*.45}" width="8" height="8" fill="{c1}"/><rect x="46" y="{h*.45}" width="8" height="8" fill="{c1}"/></pattern></defs>'
            f'<rect x="0" y="{y}" width="{w}" height="{h}" fill="url(#bg{y})" opacity="{op}"/>')

def mosque(x, base, s=1, c='#8a5a32'):
    t = lambda a, b: f'{x+a*s},{base+b*s}'
    pts = ' '.join(t(a, b) for a, b in ((0,0),(0,-150),(14,-170),(30,-150),(30,-200),(44,-226),(58,-200),(58,-150),(76,-176),(94,-150),(94,-210),(108,-236),(122,-210),(122,-150),(140,-170),(156,-150),(156,0)))
    sp = ''.join(line((x+a*s, base-150*s), (x+a*s, base-250*s+ (0 if a in (44,108) else 20)*s), 3, c) for a in (44, 108))
    return f'<polygon points="{pts}" fill="{c}"/>' + sp + ''.join(f'<rect x="{x+a*s}" y="{base-(100+i*10)*s}" width="{8*s}" height="{18*s}" fill="#5e3a1c"/>' for i, a in enumerate((16, 68, 130)))

def baobab(x, base, s=1, c='#4b3a24', leaf='#2f5a22'):
    return (f'<path d="M{x-26*s} {base}Q{x-12*s} {base-120*s} {x-38*s} {base-170*s}L{x+38*s} {base-170*s}Q{x+12*s} {base-120*s} {x+26*s} {base}Z" fill="{c}"/>'
            f'<path d="M{x-30*s} {base-168*s}l-50 -50 M{x} {base-170*s}l0 -70 M{x+30*s} {base-168*s}l50 -50" stroke="{c}" stroke-width="{9*s}" stroke-linecap="round"/>'
            f'<ellipse cx="{x-80*s}" cy="{base-225*s}" rx="{34*s}" ry="{18*s}" fill="{leaf}"/><ellipse cx="{x}" cy="{base-250*s}" rx="{38*s}" ry="{20*s}" fill="{leaf}"/><ellipse cx="{x+80*s}" cy="{base-225*s}" rx="{34*s}" ry="{18*s}" fill="{leaf}"/>')

def bg_a():   # lever de soleil sur la savane
    return (f'<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7b733"/><stop offset=".55" stop-color="#fce38a"/><stop offset="1" stop-color="#fff3c4"/></linearGradient></defs>'
            f'<rect width="{W}" height="{GY}" fill="url(#a)"/><circle cx="440" cy="250" r="90" fill="#fff" opacity=".35"/><circle cx="440" cy="250" r="62" fill="{R}" opacity=".9"/>'
            f'<path d="M0 {GY-60}Q150 {GY-140} 300 {GY-70}T600 {GY-90}V{GY}H0Z" fill="#c6a15a" opacity=".6"/>' + baobab(90, GY-30, .9) + baobab(520, GY-20, .6)
            + f'<rect y="{GY}" width="{W}" height="{H-GY}" fill="#b98a4a"/><rect y="{GY}" width="{W}" height="14" fill="#a07339"/>')

def bg_b():   # stade de nuit
    return (f'<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05301a"/><stop offset="1" stop-color="#0a8f3c"/></linearGradient></defs>'
            f'<rect width="{W}" height="{GY}" fill="url(#b)"/>' + ''.join(f'<polygon points="{x},60 {x-70},{GY} {x+70},{GY}" fill="#fff" opacity=".07"/><circle cx="{x}" cy="60" r="18" fill="#fffbd0"/>' for x in (110, 300, 490))
            + ''.join(f'<circle cx="{40+i*28}" cy="{GY-40-(i*7)%26}" r="10" fill="#0b1f12" opacity=".7"/>' for i in range(21))
            + f'<rect y="{GY}" width="{W}" height="{H-GY}" fill="#2f9a47"/>' + ''.join(f'<rect y="{GY+i*50}" width="{W}" height="25" fill="#35a74e"/>' for i in range(4)) + line((0,GY), (W,GY), 6, '#fff'))

def bg_c():   # fleuve Niger et mosquée de style soudanais
    return (f'<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fb4e6"/><stop offset="1" stop-color="#f5ecd2"/></linearGradient></defs>'
            f'<rect width="{W}" height="{GY}" fill="url(#c)"/><circle cx="120" cy="140" r="52" fill="#fff6c2"/>' + mosque(300, GY-20, 1.45) +
            f'<rect y="{GY-20}" width="{W}" height="30" fill="#2a8fb8" opacity=".85"/><rect y="{GY+8}" width="{W}" height="{H-GY-8}" fill="#d9b779"/><rect y="{GY+8}" width="{W}" height="12" fill="#c29d5e"/>')

def stripe(): return f'<rect y="{H-14}" width="{W}" height="14" fill="{V}"/><rect x="200" y="{H-14}" width="200" height="14" fill="{J}"/><rect x="400" y="{H-14}" width="200" height="14" fill="{R}"/>'

def wrap(body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="system-ui,Segoe UI,Arial,sans-serif">{body}</svg>'

def slides(sid, nom, fam):
    sc = SCENES[sid]()
    s1 = wrap(bg_a() + sc + stripe())
    s2 = wrap(bg_c() + f'<g transform="translate({W} 0) scale(-1 1)">' + sc + '</g>' + stripe())
    emb = (f'<rect width="{W}" height="{H}" fill="#0a5a28"/>' + bogolan(0, 90, .9) + bogolan(H-170, 90, .9) +
           f'<defs><clipPath id="cc"><circle cx="300" cy="375" r="215"/></clipPath></defs><circle cx="300" cy="375" r="232" fill="{J}"/><circle cx="300" cy="375" r="222" fill="#fff"/>'
           f'<g clip-path="url(#cc)"><g transform="translate(300 375) scale(.72) translate(-300 -375)">' + (bg_b()) + sc + '</g></g>'
           + stripe())
    return s1, s2, wrap(emb)

# ------------------------------------------------------------------ fond du site
def fond(dark):
    Wd, Hd = 1920, 1080
    base = '#073d1b' if dark else '#f5f6f2'
    sil = '#ffffff' if dark else '#0a8f3c'
    op = .16 if dark else .09
    out = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wd} {Hd}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{"#052c14" if dark else "#fbfcf7"}"/><stop offset="1" stop-color="{"#0a8f3c" if dark else "#eef2e4"}"/></linearGradient></defs><rect width="{Wd}" height="{Hd}" fill="url(#g)"/>'
    out += f'<circle cx="1560" cy="300" r="260" fill="{J}" opacity="{.18 if dark else .22}"/><circle cx="1560" cy="300" r="170" fill="{R}" opacity="{.12 if dark else .08}"/>'
    # collines + mosquée
    out += f'<path d="M0 760Q320 640 640 730T1280 700T1920 740V1080H0Z" fill="{sil}" opacity="{op*.8}"/>'
    out += f'<g opacity="{op*1.4}">' + mosque(1380, 760, 1.7, sil) + '</g>' + f'<g opacity="{op}">' + baobab(300, 760, 1.5, sil, sil) + baobab(1780, 770, 1.1, sil, sil) + '</g>'
    # silhouettes de jeunes sportifs (réutilise les poses)
    def sil_fig(p, dx, dy, k):
        q = {kk: (dx+(v[0]-300)*k, dy+(v[1]-GY)*k) for kk, v in p.items()}
        return person(q, sil, sil, sil, hr=27*k, w=21*k)
    poses = [
        dict(head=(272,255), sh=(272,298), hip=(262,408), k1=(330,462), f1=(402,516), k2=(255,490), f2=(243,560), e1=(222,352), h1=(182,382), e2=(322,338), h2=(352,300)),
        dict(head=(288,238), sh=(292,284), hip=(292,394), k1=(262,462), f1=(238,520), k2=(332,452), f2=(354,510), e1=(322,250), h1=(338,188), e2=(252,244), h2=(286,186)),
        dict(head=(345,262), sh=(322,298), hip=(278,392), k1=(352,424), f1=(362,502), k2=(226,452), f2=(158,494), e1=(372,336), h1=(406,292), e2=(268,344), h2=(238,300)),
        dict(head=(262,252), sh=(274,294), hip=(272,404), k1=(362,384), f1=(458,332), k2=(268,486), f2=(262,556), e1=(326,326), h1=(352,290), e2=(222,336), h2=(196,296)),
        dict(head=(214,254), sh=(222,298), hip=(214,404), k1=(250,482), f1=(268,556), k2=(186,482), f2=(160,556), e1=(290,300), h1=(368,300), e2=(176,300), h2=(238,306))]
    out += f'<g opacity="{op*2.2}">' + ''.join(sil_fig(p, 260+i*330, 1010, 1.02+ (i%2)*.14) for i, p in enumerate(poses)) + '</g>'
    out += f'<g opacity="{op*1.6}">' + ball(1010, 900, 34, sil).replace(DARK, base) + '</g>'
    # bande bogolan + drapeau
    out += bogolan(1030, 44, .5 if not dark else .35, w=1920) + f'<rect y="1074" width="640" height="6" fill="{V}"/><rect x="640" y="1074" width="640" height="6" fill="{J}"/><rect x="1280" y="1074" width="640" height="6" fill="{R}"/></svg>'
    return out

def main():
    for sid, nom, fam in SPORTS:
        d = os.path.join(ROOT, 'sports', sid); os.makedirs(d, exist_ok=True)
        for i, svg in enumerate(slides(sid, nom, fam), 1):
            open(os.path.join(d, f'{i}.svg'), 'w', encoding='utf-8').write(svg)
    open(os.path.join(ROOT, 'fond-jeunesse.svg'), 'w', encoding='utf-8').write(fond(False))
    open(os.path.join(ROOT, 'fond-hero.svg'), 'w', encoding='utf-8').write(fond(True))
    js = os.path.join(ROOT, '..', 'js', 'sport-images.js')
    open(js, 'w', encoding='utf-8').write('/* Généré par outils/generer_images.py — liste de secours des images (mode démo / fichier ouvert directement). */\nwindow.SPORT_IMAGES = ' + __import__('json').dumps({sid: [f'img/sports/{sid}/{i}.svg' for i in (1, 2, 3)] for sid, _, _ in SPORTS}, indent=1) + ';\n')
    print('images générées :', len(SPORTS) * 3, 'illustrations + 2 fonds')
if __name__ == '__main__': main()
