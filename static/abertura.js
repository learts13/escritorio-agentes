/* Abertura da Firmópolis: o prédio-mascote sobe, acende as janelas, abre os olhos e o nome aparece.
 * Uso: Abertura.tocar() -> Promise que resolve quando a abertura some.
 * Pula com clique, toque ou tecla. Com "reduzir movimento", mostra o quadro final parado por um instante.
 * Toca uma vez por sessão do navegador (Abertura.tocar({ sempre: true }) ignora isso). */
(function () {
  'use strict';

  var MASCOTE = [
    '................................', '..............ohto..............', '..............otto..............',
    '..............oooo..............', '...............mm...............', '...............mm...............',
    '...............mm...............', '..........oooooooooooo..........', '..........orrrrrrrrrro..........',
    '.....oooooooooooooooooooooo.....', '.....ollllllllllllllllllllo.....', '.....ollbbbbbbbbbbbbbbbbsso.....',
    '.....ollooooooobbooooooosso.....', '.....ollowwwwwobbowwwwwosso.....', '.....ollowwwwwobbowwwwwosso.....',
    '.....ollowwhpwobbowwhpwosso.....', '.....ollowwppwobbowwppwosso.....', '.....ollowwwwwobbowwwwwosso.....',
    '.....ollooooooobbooooooosso.....', '.....ollbbbbbbbbbbbbbbbbsso.....', '.....ollkkbbbbbbbbbbbbkksso.....',
    '.....ollbbbbbbbbbbbbbbbbsso.....', '.....ollbaaoddbbbbaaoaabsso.....', '.....ollbaAocoooooocoaAbsso.....',
    '.....ollbbboccccccccobbbsso.....', '.....ollbddbboooooobbaabsso.....', '.....ollbddbboaaAaobbaAbsso.....',
    '.....ollbbbbboaaAaobbbbbsso.....', '.....ollbbbbboaaAaobbbbbsso.....', '.....ollbbbbboaaAaobbbbbsso.....',
    '..oooooooooooggggggooooooooooo..', '..gggggggggggggggggggggggggggg..'
  ];
  var COR = {
    o: '#1b1a2b', b: '#3d4f9e', l: '#5468bf', s: '#2c3a78', r: '#262f5e', w: '#fff4dc', p: '#1b1a2b',
    h: '#ffffff', a: '#f5b83d', A: '#c98a1e', d: '#1f2650', k: '#ff7a8a', m: '#9aa3b8', t: '#ff4f4f',
    g: '#5b6275', c: '#e8574a'
  };
  var LETRAS = {
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.']
  };
  var NOME = 'FIRMOPOLIS';
  var FUNDO = '#1c1c22', CREME = '#fff4dc', AMBAR = '#f5b83d';
  var DURACAO = 2700, SAIDA = 350;
  var OLHOS = [9, 18];  // primeira coluna de dentro de cada olho

  // Janelas e porta acesas, na ordem em que acendem (de baixo para cima, alternando os lados).
  var JANELAS = [[21, 25, 2, 2], [9, 22, 2, 2], [18, 22, 2, 2], [21, 22, 2, 2], [14, 26, 4, 4]];

  function suave(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  function quadro(t) {
    var g = MASCOTE.map(function (l) { return l.split(''); });
    // Janelas apagadas até a vez de cada uma.
    JANELAS.forEach(function (j, i) {
      if (t >= 1250 + i * 120) return;
      for (var y = j[1]; y < j[1] + j[3]; y++) for (var x = j[0]; x < j[0] + j[2]; x++) {
        if (g[y][x] === 'a' || g[y][x] === 'A') g[y][x] = 'd';
      }
    });
    // Olhos: fechados até 1700 ms, uma piscada em 2250 ms.
    var fechado = t < 1700 || (t > 2250 && t < 2350);
    // Pupilas olham para o lado e voltam ao centro.
    var desvio = t < 1950 ? 1 : (t < 2150 ? -1 : 0);
    OLHOS.forEach(function (ex) {
      for (var y = 13; y <= 17; y++) for (var x = ex; x < ex + 5; x++) g[y][x] = fechado ? 'b' : 'w';
      if (fechado) { for (var x2 = ex; x2 < ex + 5; x2++) g[16][x2] = 'p'; return; }
      var px = ex + 2 + desvio;
      g[15][px] = 'h'; g[15][px + 1] = 'p'; g[16][px] = 'p'; g[16][px + 1] = 'p';
    });
    // Luz da antena pisca depois de pronta.
    if (t < 1100 || (t > 1500 && Math.floor(t / 220) % 2)) { g[1][15] = 'o'; g[1][16] = 'o'; g[2][15] = 'o'; g[2][16] = 'o'; }
    return g;
  }

  function desenhar(ctx, W, H, t) {
    ctx.fillStyle = FUNDO; ctx.fillRect(0, 0, W, H);
    var u = Math.max(2, Math.floor(Math.min(W, H) * 0.42 / 32));
    var wu = Math.max(2, Math.floor(u * 0.62));
    var largNome = 0;
    NOME.split('').forEach(function (c) { largNome += (LETRAS[c][0].length + 1.5) * wu; });
    largNome -= 1.5 * wu;
    var altTotal = 32 * u + wu * 4 + 7 * wu;
    var ox = Math.floor((W - 32 * u) / 2), oy = Math.floor((H - altTotal) / 2);

    // Calçada nasce do meio para as bordas.
    var chao = suave(t / 250);
    // O prédio sobe linha a linha (de baixo para cima), com um pulinho no fim.
    var sobe = suave((t - 150) / 850);
    var linhaCorte = 30 - Math.round(sobe * 30);
    var pulo = t > 1000 && t < 1200 ? Math.round(Math.sin((t - 1000) / 200 * Math.PI) * u * 0.6) : 0;
    var g = quadro(t);
    for (var y = 0; y < 32; y++) {
      var noChao = y >= 30;
      if (!noChao && y < linhaCorte) continue;
      if (!noChao && y < 7 && t < 1000) continue;  // antena surge depois do corpo
      for (var x = 0; x < 32; x++) {
        var c = g[y][x];
        if (c === '.') continue;
        if (noChao && Math.abs(x - 15.5) > chao * 16) continue;
        ctx.fillStyle = COR[c];
        ctx.fillRect(ox + x * u, oy + y * u - (noChao ? 0 : pulo), u, u);
      }
    }

    // Nome, letra a letra; o acento do Ó é uma janela que acende por último.
    var nx = Math.floor((W - largNome) / 2), ny = oy + 32 * u + wu * 4;
    NOME.split('').forEach(function (c, i) {
      var vez = 1750 + i * 55;
      if (t < vez) { nx += (LETRAS[c][0].length + 1.5) * wu; return; }
      var a = suave((t - vez) / 120);
      ctx.globalAlpha = a;
      ctx.fillStyle = CREME;
      LETRAS[c].forEach(function (linha, ly) {
        linha.split('').forEach(function (p, lx) {
          if (p === '#') ctx.fillRect(Math.round(nx + lx * wu), ny + ly * wu + Math.round((1 - a) * wu * 2), Math.ceil(wu * 1.5), wu);
        });
      });
      if (i === 4 && t > 2400) { ctx.fillStyle = AMBAR; ctx.fillRect(Math.round(nx + 2 * wu), ny - 2 * wu, wu * 2, wu); }
      ctx.globalAlpha = 1;
      nx += (LETRAS[c][0].length + 1.5) * wu;
    });
  }

  function jaTocou() { try { return sessionStorage.getItem('firmopolis.abertura') === '1'; } catch (e) { return false; } }
  function marcar() { try { sessionStorage.setItem('firmopolis.abertura', '1'); } catch (e) { /* sem armazenamento */ } }

  function tocar(opcoes) {
    opcoes = opcoes || {};
    if (!opcoes.sempre && jaTocou()) return Promise.resolve();
    marcar();
    var parado = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise(function (resolver) {
      var tela = document.createElement('canvas');
      tela.setAttribute('aria-label', 'Firmópolis');
      tela.setAttribute('role', 'img');
      tela.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;cursor:pointer;' +
        'image-rendering:pixelated;transition:opacity ' + SAIDA + 'ms ease';
      document.body.appendChild(tela);
      var ctx = tela.getContext('2d');
      var inicio = performance.now(), saindo = false, pedido = 0;

      function medir() {
        var r = window.devicePixelRatio || 1;
        tela.width = Math.round(innerWidth * r); tela.height = Math.round(innerHeight * r);
      }
      function sair() {
        if (saindo) return;
        saindo = true;
        tela.style.opacity = '0';
        setTimeout(function () {
          cancelAnimationFrame(pedido);
          removeEventListener('resize', medir);
          removeEventListener('keydown', sair);
          tela.remove();
          resolver();
        }, SAIDA);
      }
      function passo(agora) {
        var t = parado ? DURACAO : agora - inicio;
        desenhar(ctx, tela.width, tela.height, t);
        if (t >= DURACAO) { setTimeout(sair, parado ? 700 : 250); return; }
        pedido = requestAnimationFrame(passo);
      }
      medir();
      addEventListener('resize', medir);
      addEventListener('keydown', sair);
      tela.addEventListener('pointerdown', sair);
      pedido = requestAnimationFrame(passo);
    });
  }

  window.Abertura = { tocar: tocar, desenhar: desenhar, DURACAO: DURACAO, MASCOTE: MASCOTE, COR: COR };
})();
