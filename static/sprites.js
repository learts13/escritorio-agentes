/* Firmópolis — sprites do site: as três espécies de morador e os veículos da rua.
 * Cada sprite é uma grade de letras (paleta por letra), desenhada com contorno escuro automático.
 * Os bichinhos de feltro vêm do avatar.js do próprio escritório; aqui ficam os terminaizinhos, a gente e os carros.
 * Gente e terminais andam num passo de 4 tempos (contato, passagem, contato, passagem) e têm ações:
 * 'andar', 'parar' (olha em volta / digita no celular), 'acenar' e, nos terminais, a telinha muda de cara. */
(function () {
  'use strict';
  var CONTORNO = '#14131f';

  // Desenha a grade em (x, y) = canto superior esquerdo; espelha para a esquerda; contorno de 1 px em volta.
  // Cada combinação de grade, paleta e lado é pintada uma vez num canvas guardado; depois é só um drawImage.
  var prontos = new Map(), idPaleta = new WeakMap(), proximaPaleta = 1, paletas = new Map();
  function paleta(chave, fazer) {   // a mesma paleta (mesmo objeto) para a mesma chave, para o cache acertar
    var p = paletas.get(chave);
    if (!p) { p = fazer(); paletas.set(chave, p); }
    return p;
  }
  function sprite(c, linhas, cores, x, y, esquerda) {
    var id = idPaleta.get(cores);
    if (!id) { id = proximaPaleta++; idPaleta.set(cores, id); }
    var chave = id + (esquerda ? '<' : '>') + linhas.join('|'), pronto = prontos.get(chave);
    if (!pronto) {
      if (prontos.size > 900) prontos.clear();
      pronto = pintarSprite(linhas, cores, esquerda);
      prontos.set(chave, pronto);
    }
    c.drawImage(pronto, x - 1, y - 1);
  }
  function pintarSprite(linhas, cores, esquerda) {
    var h = linhas.length, w = 0, i, j, ch;
    for (i = 0; i < h; i++) w = Math.max(w, linhas[i].length);
    var cv = document.createElement('canvas'); cv.width = w + 2; cv.height = h + 2;
    var c = cv.getContext('2d');
    var cel = function (i, j) { return linhas[i] && linhas[i][esquerda ? w - 1 - j : j]; };
    c.fillStyle = CONTORNO;
    for (i = 0; i < h; i++) for (j = 0; j < w; j++) {
      ch = cel(i, j); if (!ch || ch === '.') continue;
      c.fillRect(j, i + 1, 3, 1); c.fillRect(j + 1, i, 1, 3);
    }
    for (i = 0; i < h; i++) for (j = 0; j < w; j++) {
      ch = cel(i, j); if (!ch || ch === '.') continue;
      c.fillStyle = cores[ch] || CONTORNO; c.fillRect(j + 1, i + 1, 1, 1);
    }
    return cv;
  }
  function sombra(c, x, pes, w) { c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x, pes, w, 1); c.fillRect(x + 1, pes + 1, w - 2, 1); }
  function trocar(linha, j, ch) { return linha.slice(0, j) + ch + linha.slice(j + 1); }

  /* ---------- Gente (você e as visitas): chibi de cabeção, no traço dos bichinhos ----------
   * 12 px de largura e 18 de altura: cabeça de 11 linhas (cabelo, franja, olhos grandes com brilho, bochecha e boca)
   * e corpo de 7 (blusa, braços, calça e sapato). Olha para o lado em que anda; o espelho cuida da esquerda. */
  var CABECAS = [
    [ // curto, com topete
      '...hhhhhh...',
      '..hhHHHhhh..',
      '.hhHHhhhhhh.',
      '.hhhhhhhhhhh',
      '.hhhsshhsshh',
      '.hhssssssssh',
      '.hsssowsssow',
      '.hsssoosssoo',
      '.hsskssssssk',
      '..hssssmsss.',
      '...ssssss...'],
    [ // comprido, até o ombro
      '...hhhhhh...',
      '..hhHHHhhh..',
      '.hhHHhhhhhh.',
      'hhhhhhhhhhhh',
      'hhhhsshhsshh',
      'hhhssssssssh',
      'hhsssowsssow',
      'hhsssoosssoo',
      'hhsskssssssk',
      'hhhssssmsss.',
      'hh.ssssss...'],
    [ // cacheado, volumoso
      '..hHhhHhh...',
      '.hHHhhHHhhh.',
      'hhHhhhhhHhhh',
      'hhhhhhhhhhhh',
      'hhhhshhhshhh',
      'hhhssssssssh',
      '.hsssowsssow',
      '.hsssoosssoo',
      '.hsskssssssk',
      '..hssssmsss.',
      '...ssssss...']];
  // corpo: 7 linhas. c blusa, C dobra clara, a manga, s mão, P perna de perto, p perna de longe, z sapato, g celular
  var CORPO = {
    parado:   ['...cCCccc...', '..acCcccca..', '..acccccca..', '..sPPPPPPs..', '...PP..pp...', '...PP..pp...', '..zzz..zzz..'],
    contato1: ['...cCCccc...', '..acCcccca..', '..acccccca..', '..sPPPPPPs..', '...PP..pp...', '..PP....pp..', '.zzz....zzz.'],
    passa1:   ['...cCCccc...', '..acCcccca..', '..acccccca..', '..sPPPPPPs..', '....PPpp....', '....PPpp....', '....zzzz....'],
    contato2: ['...cCCccc...', '..acCcccca..', '..acccccca..', '..sppppPPs..', '...pp..PP...', '..pp....PP..', '.zzz....zzz.'],
    passa2:   ['...cCCccc...', '..acCcccca..', '..acccccca..', '..sppppPPs..', '....ppPP....', '....ppPP....', '....zzzz....'],
    celular:  ['...cCCccc...', '..acCcssga..', '..acccsscc..', '...PPPPPP...', '...PP..pp...', '...PP..pp...', '..zzz..zzz..'],
    acenar:   ['...cCCcccas.', '..acCccca...', '..acccccc...', '..sPPPPPP...', '...PP..pp...', '...PP..pp...', '..zzz..zzz..']};
  var CICLO = ['contato1', 'passa1', 'contato2', 'passa2'];
  var CABELOS = ['#3b2a20', '#1b1a2b', '#c98a1e', '#8a3b2a', '#e8d9b0', '#6b3fa0', '#2f6db5'];
  var PELES = ['#f6d2ae', '#e0ad84', '#b07a52', '#7a4b2e'];
  var ROUPAS = ['#e8574a', '#3fb35c', '#3a92e6', '#f5b83d', '#9566e6', '#ff7a8a', '#33b3a0'];
  var CALCAS = ['#2c3a78', '#3b3b47', '#5a4632', '#1f2650'];

  // f: tempo do passo (0..3); acao: 'andar' | 'parar' | 'acenar' | 'celular'; agora: ms (piscar e aceno);
  // blusa: a cor que a pessoa escolheu no perfil (#rrggbb), no lugar da sorteada pela variação v
  // visual (opcional): { blusa: '#hex', cabelo: 0-6, pele: 0-3 }, o que a pessoa escolheu; o que faltar vem da semente v
  function gente(c, x, pes, f, esquerda, v, acao, agora, visual) {
    acao = acao || 'andar'; agora = agora || 0; visual = visual || {};
    var cab = CABELOS[visual.cabelo >= 0 ? visual.cabelo % 7 : v % 7], pele = PELES[visual.pele >= 0 ? visual.pele % 4 : (v >> 2) % 4];
    var roupa = visual.blusa || ROUPAS[(v >> 1) % 7], calca = CALCAS[(v >> 3) % 4];
    var cores = paleta('g' + v + roupa + cab + pele, function () { return { h: cab, H: clarear(cab), s: pele, o: '#1b1a2b', w: '#ffffff', k: '#ff8a98',
      m: '#a0463f', c: roupa, C: clarear(roupa), a: escurecer(roupa), P: calca, p: escurecer(calca), z: '#1b1a2b', g: '#9fd3ff' }; });
    var t = agora + v * 1311, cabeca = CABECAS[(v >> 2) % 3].slice(), corpo, sobe = 0;
    var piscou = (t % 4200) < 140;
    if (acao === 'andar') { corpo = CORPO[CICLO[f % 4]]; sobe = f % 2; }       // sobe 1 px na passagem
    else if (acao === 'celular') {
      corpo = CORPO.celular;
      cabeca[6] = trocar(trocar(trocar(trocar(cabeca[6], 5, 's'), 6, 's'), 10, 's'), 11, 's');   // olhos para baixo, no celular
      cabeca[8] = trocar(trocar(cabeca[8], 5, 'o'), 10, 'o');
    } else if (acao === 'acenar') {
      corpo = CORPO.acenar;
      var lado = Math.floor(agora / 180) % 2;                                  // a mão balança ao lado da cabeça
      cabeca = cabeca.map(function (l) { return l + '..'; });
      cabeca[9] = trocar(cabeca[9], 12, 'a'); cabeca[10] = trocar(cabeca[10], 11, 'a');
      cabeca[8] = trocar(cabeca[8], 12 + lado, 's'); cabeca[7] = trocar(cabeca[7], 12 + lado, 's');
      cabeca[9] = trocar(cabeca[9], 7, 'o');                                   // boca aberta: "oi!"
      corpo = corpo.map(function (l) { return l + '..'; });
    } else {
      corpo = CORPO.parado;
      if ((t % 5200) > 3600) {                                                 // olha para trás
        [[6, 4, 'w'], [6, 5, 'o'], [6, 6, 's'], [6, 9, 'w'], [6, 10, 'o'], [6, 11, 's'], [7, 4, 'o'], [7, 6, 's'], [7, 9, 'o'], [7, 11, 's']]
          .forEach(function (m) { cabeca[m[0]] = trocar(cabeca[m[0]], m[1], m[2]); });
      }
    }
    if (piscou && acao !== 'celular') cabeca[6] = cabeca[6].slice(0, 2) + cabeca[6].slice(2).replace(/[ow]/g, 's');   // piscou: sobra a linha de baixo
    var linhas = cabeca.concat(corpo);
    sombra(c, x + 2, pes, 9);
    sprite(c, linhas, cores, x, pes - linhas.length - sobe, esquerda);
  }

  /* ---------- Terminaizinhos (terminais locais): monitor CRT de cabeça, telinha com cara, crachá e o cabo de força ---------- */
  var MONITOR = [
    '.GGGGGGGGGG.',
    'Gg@@@@@@@@gd',
    'Gg@@@@@@@@gd',
    'Gg@@@@@@@@gd',
    'Gg@@@@@@@@gd',
    'Gg@@@@@@@@gd',
    'Gg@@@@@@@@gd',
    '.dddddddddd.',
    '....kKKk....',
    '..bBBbbbbb..',
    '.bBBbbbyybb.'];
  // telinha 8x6 (linhas 1 a 6, colunas 2 a 9). # fundo, e verde, x linha de varredura, r/S brilho, w âmbar, u cursor
  var TELAS = {
    olhos:  ['rS######', '#EE##EE#', '#ee##ee#', 'xxxxxxxx', '###uu###', '########'],
    feliz:  ['rS######', '##e##e##', '#e#ee#e#', 'xxxxxxxx', '#e####e#', '##eeee##'],
    espera: ['rS##w###', '####w###', '####w###', 'xxxxxxxx', '########', '####w###'],
    olhaLado: ['rS######', '#EE##EE#', '##ee##ee', 'xxxxxxxx', '####uu##', '########'],
    apagada: ['########', '########', '########', 'xxxxxxxx', '########', '########']};   // cochilando: a tela apaga
  var CORPO_T = {
    contato1: ['abBbbbbyyb..', 'k.bbbbbbbb..', '..bbbbbbbbak', '..ppPP..PP..', '.pp.....PP..', 'zzz......zzz'],
    passa1:   ['.abbbbbyyb..', '.kbbbbbbbba.', '..bbbbbbbbk.', '...ppPPPP...', '...pp..PP...', '..zzz..zzz..'],
    contato2: ['..bbbbbyyba.', '..bbbbbbbb.k', 'kabbbbbbbb..', '..PP..ppPP..', '..PP.....pp.', 'zzz......zzz'],
    passa2:   ['.abbbbbyyb..', '.abbbbbbbbk.', '.kbbbbbbbb..', '...PPPPpp...', '...PP..pp...', '..zzz..zzz..'],
    parado:   ['.abbbbbyyba.', '.abbbbbbbba.', '.kbbbbbbbbk.', '...PPPPPP...', '...PP..PP...', '..zzz..zzz..'],
    acenar:   ['.abbbbbyybak', '.abbbbbbbb..', '.kbbbbbbbb..', '...PPPPPP...', '...PP..PP...', '..zzz..zzz..']};
  var MOLDURAS = ['#e8794a', '#5fa8ff', '#9be15d', '#c38bff', '#ffd166'];
  // linhas de código que sobem na telinha quando o terminal está "digitando" (parado pensando)
  function telaDigitando(t) {
    var r = ['rS######'], base = Math.floor(t / 260);
    for (var i = 0; i < 5; i++) {
      var n = (base + i) * 2654435761 >>> 0, larg = 2 + n % 6, rec = 1 + (n >> 5) % 2, s = '#';
      for (var j = 1; j < 8; j++) s += j > rec && j <= rec + larg ? 'e' : '#';
      r.push(i === 4 ? s.slice(0, 7) + (Math.floor(t / 300) % 2 ? 'u' : '#') : s);
    }
    return r;
  }
  // acao: 'andar' | 'parar' (digitando) | 'acenar' (carinha feliz) | 'esperar' (! âmbar) | 'dormir' (tela apagada, parado)
  function terminal(c, x, pes, f, esquerda, v, agora, acao) {
    acao = acao || 'andar'; agora = agora || 0;
    var g = MOLDURAS[v % 5], t = agora + v * 997;
    var piscando = (t % 3600) < 140, cursor = Math.floor(t / 420) % 2;
    var tela = '#0b1a12', verde = '#4ade80';
    var cores = paleta('t' + (v % 5) + piscando + cursor, function () { return { G: clarear(g), g: g, d: escurecer(g), '#': tela, x: '#10261a', r: '#c8ffd9', S: '#5f8f70',
      E: piscando ? tela : verde, e: verde, u: cursor ? verde : tela, w: '#f5b83d', k: '#7a8196', K: '#b5bccc',
      b: escurecer(g), B: g, y: '#fff4dc', a: escurecer(escurecer(g)), P: '#3b3b47', p: '#2b2b35', z: '#14131f' }; });
    var cara = acao === 'acenar' ? TELAS.feliz : acao === 'esperar' ? TELAS.espera : acao === 'dormir' ? TELAS.apagada : acao === 'parar' ? telaDigitando(t)
      : (t % 6000) > 5200 ? TELAS.olhaLado : TELAS.olhos;
    var monitor = MONITOR.map(function (l, i) { return i >= 1 && i <= 6 ? l.slice(0, 2) + cara[i - 1] + l.slice(10) : l; });
    var corpo, sobe = 0;
    if (acao === 'andar') { corpo = CORPO_T[CICLO[f % 4]]; sobe = f % 2; }
    else if (acao === 'acenar') {
      corpo = CORPO_T.acenar;
      var alto = Math.floor(agora / 180) % 2;   // o braço sobe ao lado da tela e a mão balança
      monitor = monitor.map(function (l) { return (l + '..').slice(0, 14); });
      monitor[8] = trocar(monitor[8], 11, 'B'); monitor[7] = trocar(monitor[7], 12, 'B'); monitor[6] = trocar(monitor[6], 12, 'B');
      monitor[5] = trocar(monitor[5], 12, 'B'); monitor[4] = trocar(monitor[4], 12 + alto, 'K'); monitor[3] = trocar(monitor[3], 12 + alto, 'K');
    } else corpo = CORPO_T.parado;
    var linhas = monitor.concat(corpo), topo = pes - linhas.length - sobe;
    sombra(c, x + 1, pes, 11);
    cabo(c, x, pes, esquerda, agora, acao === 'andar');
    sprite(c, linhas, cores, x, topo, esquerda);
  }
  // o cabo de força arrastando atrás, ondulando no passo
  function cabo(c, x, pes, esquerda, agora, andando) {
    var y0 = pes - 4, dir = esquerda ? 1 : -1, x0 = esquerda ? x + 11 : x;
    c.fillStyle = '#5b6275';
    for (var i = 1; i <= 7; i++) {
      var onda = andando ? Math.round(Math.sin(agora / 120 - i * 0.9) * (i / 7) * 1.4) : 0;
      c.fillRect(x0 + dir * i, Math.min(pes - 1, y0 + Math.min(3, i >> 1) + onda), 1, 1);
    }
    c.fillStyle = '#c8ccd8'; c.fillRect(x0 + dir * 8, pes - 1, 1, 1);   // a tomada na ponta
  }
  function escurecer(cor) {
    var rgb = cor[0] === '#' ? [1, 3, 5].map(function (i) { return parseInt(cor.slice(i, i + 2), 16); }) : cor.match(/\d+/g).map(Number);
    return 'rgb(' + rgb.map(function (v) { return Math.round(v * 0.62); }).join(',') + ')';
  }

  /* ---------- Bichinhos de feltro (agentes.chat), pelo avatar.js do escritório ---------- */
  var APARENCIAS = [];
  var POSE_BICHO = { andar: 'andando', parar: 'cafe', acenar: 'acenando', celular: 'parado', esperar: 'parado' };
  function bichinho(c, x, pes, f, esquerda, v, agora, acao) {
    var Av = window.Avatar;
    if (!Av) return;
    if (!APARENCIAS.length) APARENCIAS = ['ana', 'bento', 'cacau', 'dara', 'enzo', 'flora', 'gael', 'hana', 'icaro', 'jade'].map(Av.padrao);
    Av.boneco(c, { x: x + 11, y: pes, ap: APARENCIAS[v % APARENCIAS.length], pose: POSE_BICHO[acao || 'andar'], olha: esquerda ? 'esq' : 'dir', semente: v }, agora || 0, 1);
  }

  /* ---------- Balõezinhos sobre a cabeça (encontros na calçada) ---------- */
  var ICONES = {
    oi:     ['wwwwwwwww', 'wnwnwwnww', 'wnnnwwnww', 'wnwnwwwww', 'wnwnwwnww', 'wwwwwwwww', '.ww......', '.w.......'],
    coracao:['wwwwwwwww', 'wwrrwrrww', 'wwrrrrrww', 'wwwrrrwww', 'wwwwrwwww', 'wwwwwwwww', '.ww......', '.w.......'],
    nota:   ['wwwwwwwww', 'wwwwwnnww', 'wwwwwnwnw', 'wwnnnwwww', 'wwnnnwwww', 'wwwwwwwww', '.ww......', '.w.......'],
    cafe:   ['wwwwwwwww', 'wwwswswww', 'wwmmmmmww', 'wwmmmmwmw', 'wwwmmmwww', 'wwwwwwwww', '.ww......', '.w.......'],
    comida: ['wwwwwwwww', 'wwwwgmwww', 'wwrrgrrww', 'wwrrrrrww', 'wwwrrrwww', 'wwwwwwwww', '.ww......', '.w.......'],   // a maçã
    zz:     ['wwwwwwwww', 'wnnnnwwww', 'wwwnwwwww', 'wwnwwnnnw', 'wnnnnwnww', 'wwwwwnnnw', '.ww......', '.w.......'],   // um Z grande e um z
    alerta: ['wwwwwwwww', 'wwwwrwwww', 'wwwwrwwww', 'wwwwrwwww', 'wwwwwwwww', 'wwwwrwwww', '.ww......', '.w.......'],
    wc:     ['wwwwwwwww', 'wnwwwnwnn', 'wnwnwnwnw', 'wnwnwnwnw', 'wwnwnwwnn', 'wwwwwwwww', '.ww......', '.w.......'],   // "WC" em azul
    eca:    ['wwwwwwwww', 'wwgwwgwgw', 'wgwwgwgww', 'wwgwwgwgw', 'wgwwgwgww', 'wwwwwwwww', '.ww......', '.w.......'],   // o fedor (zeladoria.js)
    quebrada: ['wwwwwwwww', 'wwrwwwrww', 'wwwrwrwww', 'wwwwrwwww', 'wwwrwrwww', 'wwrwwwrww', 'wwwwwwwww', '.ww......', '.w.......']};   // o X vermelho
  var CORES_BALAO = { w: '#fff4dc', r: '#e8574a', n: '#3d4f9e', m: '#8a5a3a', s: '#b5bccc', g: '#4f9a4a' };
  function balao(c, tipo, x, y) {
    var g = ICONES[tipo]; if (!g) return;
    sprite(c, g, CORES_BALAO, x, y, false);
  }

  /* ---------- Veículos ---------- */
  var CARRO = [
    '.......CCCCCCCCCC...........',
    '......CwwwwCwwwwwC..........',
    '.....CwwwwwCwwwwwwC.........',
    '..CCCCCCCCCCCCCCCCCCCCCCC...',
    '.CLLLLLLLLLLLLLLLLLLLLLLLCY.',
    'RCCCCCCCCCCCCCCCCCCCCCCCCCY.',
    '.DDDDDDDDDDDDDDDDDDDDDDDDDD.',
    '...WWW..............WWW.....',
    '..WhhW..............WhhW....',
    '...WWW..............WWW.....'];
  var VAN = [
    '....CCCCCCCCCCCCCCCCCCCCC.....',
    '...CCCCCCCCCCCCCCCCCCCwwwC....',
    '...CCCCCCCCCCCCCCCCCCCwwwwC...',
    '...CCCCCCCCCCCCCCCCCCCwwwwwC..',
    '...AAAAAAAAAAAAAAAAAAACCCCCCC.',
    '...CCCCCCCCCCCCCCCCCCCCCCCCCY.',
    '..RCCCCCCCCCCCCCCCCCCCCCCCCCY.',
    '...DDDDDDDDDDDDDDDDDDDDDDDDDD.',
    '.....WWW............WWW.......',
    '....WhhW............WhhW......',
    '.....WWW............WWW.......'];
  var MOTO = ['....AAA.....', '....AAA.....', '..sss.......', '..CCCCw.....', '.CCCCCCCCC..', 'WW.....WW...', 'WhW...WhW...', 'WW.....WW...'];
  var PINTURAS = ['#e8574a', '#f5b83d', '#4ade80', '#5fa8ff', '#fff4dc', '#ff7a8a', '#c38bff'];
  function veiculo(c, tipo, x, rodas, esquerda, v, noite, agora) {
    var cor = PINTURAS[v % PINTURAS.length];
    var linhas = tipo === 'van' ? VAN : tipo === 'moto' ? MOTO : CARRO;
    // as rodas giram: o miolo da calota alterna
    var gira = Math.floor((agora || 0) / 90) % 2;
    var cores = paleta('v' + tipo + (v % PINTURAS.length) + gira + !!noite, function () { return { C: tipo === 'moto' ? '#e8574a' : cor, L: clarear(tipo === 'moto' ? '#e8574a' : cor), D: escurecer(cor), w: '#9fd3ff', W: '#1b1a2b',
      h: gira ? '#9aa3b8' : '#5b6275', R: '#ff4f4f', Y: noite ? '#fff1a8' : '#ffe9a0', A: '#f5b83d', s: '#f2c9a0' }; });
    var sobe = tipo === 'moto' ? 0 : (Math.floor((agora || 0) / 260 + v) % 7 === 0 ? 1 : 0);   // um solavanco de vez em quando
    c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x + 2, rodas, linhas[0].length - 4, 1);
    sprite(c, linhas, cores, x, rodas - linhas.length - sobe, esquerda);
    if (noite && tipo !== 'moto') {  // farol na rua
      c.fillStyle = 'rgba(255,236,150,.32)';
      var fx = esquerda ? x - 18 : x + linhas[0].length - 1;
      c.fillRect(fx, rodas - 6, 18, 4);
    }
  }
  function clarear(hex) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { return Math.round(v + (255 - v) * 0.3); }).join(',') + ')';
  }

  window.Sprites = { gente: gente, terminal: terminal, bichinho: bichinho, veiculo: veiculo, balao: balao, larguras: { carro: 28, van: 30, moto: 12 } };
})();
