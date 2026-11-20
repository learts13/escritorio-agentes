"""Gera o mascote da Firmópolis (prédio vivo) em pixel art, grade 32x32, e o corte de 16 px."""
import sys
P = {  # paleta
 'o':'#1b1a2b', # contorno
 'b':'#3d4f9e', # fachada
 'l':'#5468bf', # luz (lado esquerdo)
 's':'#2c3a78', # sombra (lado direito)
 'r':'#262f5e', # telhado
 'w':'#fff4dc', # olho
 'p':'#1b1a2b', # pupila
 'h':'#ffffff', # brilho do olho
 'a':'#f5b83d', # janela acesa / âmbar
 'A':'#c98a1e', # âmbar sombra
 'd':'#1f2650', # janela apagada
 'k':'#ff7a8a', # bochecha
 'm':'#9aa3b8', # antena
 't':'#ff4f4f', # luz da antena
 'g':'#5b6275', # calçada
 'c':'#e8574a', # toldo
}
def grade(w,h): return [['.']*w for _ in range(h)]
def rect(g,x,y,w,h,c):
    for j in range(y,y+h):
        for i in range(x,x+w): g[j][i]=c
def svg(g,u,nome,fundo=None,pad=0):
    W=len(g[0]);H=len(g)
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W*u+2*pad} {H*u+2*pad}" shape-rendering="crispEdges">']
    if fundo: out.append(f'<rect width="100%" height="100%" rx="{(W*u+2*pad)*0.22}" fill="{fundo}"/>')
    for y,row in enumerate(g):
        x=0
        while x<W:
            c=row[x]
            if c=='.': x+=1; continue
            s=x
            while x<W and row[x]==c: x+=1
            out.append(f'<rect x="{pad+s*u}" y="{pad+y*u}" width="{(x-s)*u}" height="{u}" fill="{P[c]}"/>')
    out.append('</svg>'); open(nome,'w').write(''.join(out))

def mascote(olhar=1, piscar=False):
    g=grade(32,32)
    # antena
    rect(g,15,3,2,5,'m'); rect(g,14,1,4,3,'o'); rect(g,15,1,2,2,'t'); rect(g,15,1,1,1,'h')
    # telhado em degrau
    rect(g,10,7,12,3,'o'); rect(g,11,8,10,1,'r')
    # corpo
    rect(g,5,9,22,22,'o'); rect(g,6,10,20,20,'b')
    rect(g,6,10,2,20,'l'); rect(g,24,10,2,20,'s'); rect(g,6,10,20,1,'l')
    # olhos (janelas grandes)
    for ex in (9,18):
        rect(g,ex-1,12,7,7,'o')
        if piscar:
            rect(g,ex,15,5,1,'p')
            rect(g,ex,12,5,3,'b'); rect(g,ex,16,5,2,'b')
        else:
            rect(g,ex,13,5,5,'w')
            px=ex+1+olhar
            rect(g,px,15,2,2,'p'); g[15][px]='h'
    # bochechas
    rect(g,8,20,2,1,'k'); rect(g,22,20,2,1,'k')
    # janelas pequenas (umas acesas)
    acesa={(9,22):'a',(12,22):'d',(18,22):'a',(21,22):'a',(9,25):'d',(21,25):'a'}
    for (x,y),c in acesa.items():
        rect(g,x,y,2,2,c)
        if c=='a': g[y+1][x+1]='A'
    # toldo e porta
    rect(g,11,23,10,2,'o'); rect(g,12,23,1,1,'c'); rect(g,19,23,1,1,'c'); rect(g,12,24,8,1,'c'); rect(g,11,22,1,1,'o'); rect(g,20,22,1,1,'o')
    rect(g,13,25,6,6,'o'); rect(g,14,26,4,4,'a'); rect(g,16,26,1,4,'A'); rect(g,17,28,0,0,'o')
    # calçada
    rect(g,2,30,28,2,'g'); rect(g,2,30,28,1,'o'); rect(g,13,30,6,1,'g')
    return g

def mascote16():
    g=grade(16,16)
    rect(g,7,0,2,1,'t'); rect(g,7,1,2,1,'m')
    rect(g,5,2,6,1,'o')
    rect(g,2,3,12,12,'o'); rect(g,3,4,10,10,'b'); rect(g,3,4,1,10,'l'); rect(g,12,4,1,10,'s')
    for ex in (4,9):
        rect(g,ex,5,3,3,'w'); rect(g,ex+1,6,2,2,'p'); g[6][ex+1]='h'
    rect(g,4,9,1,1,'k'); rect(g,11,9,1,1,'k')
    rect(g,5,10,6,1,'c'); rect(g,4,9,0,0,'c')
    rect(g,4,12,1,1,'a'); rect(g,11,12,1,1,'a')
    rect(g,7,11,2,3,'a')
    rect(g,1,14,14,1,'g')
    return g

if __name__=='__main__':
    svg(mascote(),16,'b-simbolo.svg')
    svg(mascote(),14,'b-icone-app.svg',fundo='#f5b83d',pad=32)
    svg(mascote(),14,'b-icone-escuro.svg',fundo='#1c1c22',pad=32)
    svg(mascote16(),16,'b-simbolo-16.svg')
    svg(mascote16(),14,'b-favicon.svg',fundo='#f5b83d',pad=8)
