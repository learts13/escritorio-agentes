"""Kit da marca Firmópolis: assinaturas (horizontal e empilhada, claro e escuro), ícones web e prévia social."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from gera_b import mascote, mascote16, P

G={'F':["#####","#....","#....","####.","#....","#....","#...."],
'I':["###",".#.",".#.",".#.",".#.",".#.","###"],
'R':["####.","#...#","#...#","####.","#.#..","#..#.","#...#"],
'M':["#...#","##.##","#.#.#","#.#.#","#...#","#...#","#...#"],
'O':[".###.","#...#","#...#","#...#","#...#","#...#",".###."],
'P':["####.","#...#","#...#","####.","#....","#....","#...."],
'L':["#....","#....","#....","#....","#....","#....","#####"],
'S':[".####","#....","#....",".###.","....#","....#","####."]}
AMBAR='#f5b83d'; ESCURO='#1c1c22'; INDIGO='#2c3a78'; CREME='#fff4dc'

def pix(g,ox,oy,u):
    out=[]
    for y,row in enumerate(g):
        x=0
        while x<len(row):
            c=row[x]
            if c=='.': x+=1; continue
            s=x
            while x<len(row) and row[x]==c: x+=1
            out.append(f'<rect x="{ox+s*u}" y="{oy+y*u}" width="{(x-s)*u}" height="{u}" fill="{P[c]}"/>')
    return out

def palavra(ox,oy,u,cor):
    """FIRMÓPOLIS; o acento do Ó é uma janela acesa (âmbar)."""
    out=[]; x=ox
    for i,ch in enumerate("FIRMOPOLIS"):
        gl=G[ch]
        for y,row in enumerate(gl):
            for j,c in enumerate(row):
                if c=='#': out.append(f'<rect x="{x+j*u}" y="{oy+y*u}" width="{u*3//2}" height="{u}" fill="{cor}"/>')
        if i==4:
            out.append(f'<rect x="{x+2*u}" y="{oy-2*u}" width="{2*u}" height="{u}" fill="{AMBAR}"/>')
        x+=(len(gl[0])+1)*u+u//2
    return out, x-u-ox

def salva(nome,w,h,corpo,fundo=None,rx=0):
    f=f'<rect width="{w}" height="{h}" rx="{rx}" fill="{fundo}"/>' if fundo else ''
    open(nome,'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" shape-rendering="crispEdges">{f}{"".join(corpo)}</svg>')

def horizontal(nome,cor,fundo=None):
    u=8; m=pix(mascote(),0,0,u)  # 256x256
    wu=14; p,lw=palavra(256+56,128-int(3.5*wu),wu,cor)
    salva(nome,256+56+lw+32,256,m+p,fundo)

def empilhada(nome,cor,fundo=None):
    wu=10; p,lw=palavra(0,0,wu,cor); W=max(lw,256)+64
    m=pix(mascote(),(W-256)//2,0,8)
    p,_=palavra((W-lw)//2,256+48,wu,cor)
    salva(nome,W,256+48+86,m+p,fundo)

def icone(nome,fundo,pad,rx_frac=0.22,size=512,g=None,u=None):
    g=g or mascote(); n=len(g); u=u or (size-2*pad)//n
    off=(size-n*u)//2
    salva(nome,size,size,pix(g,off,off,u),fundo,size*rx_frac)

os.chdir(os.path.join(os.path.dirname(__file__),'..','kit'))
horizontal('assinatura-horizontal.svg',INDIGO)
horizontal('assinatura-horizontal-escuro.svg',CREME,ESCURO)
empilhada('assinatura-empilhada.svg',INDIGO)
empilhada('assinatura-empilhada-escuro.svg',CREME,ESCURO)
icone('icone.svg',AMBAR,48)                    # app / PWA (cantos arredondados)
icone('icone-mascara.svg',AMBAR,104,rx_frac=0) # maskable: zona segura de 80%
icone('favicon.svg',AMBAR,32,g=mascote16(),size=256)
# prévia social 1280x640
u=10; m=pix(mascote(),120,160,u)
p,lw=palavra(500,250,11,CREME)
sub=f'<text x="500" y="380" fill="{AMBAR}" font-family="Pixeloid Sans, monospace" font-size="34">o escritório vivo dos seus agentes</text>'
salva('previa-social.svg',1280,640,m+p+[sub],ESCURO)
print('ok')
