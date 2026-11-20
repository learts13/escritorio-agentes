/* Firmópolis — site: céu e rua animados, o prédio-mascote que olha o cursor, o elevador que desce com a rolagem,
 * crachás, TV com chiado e a rua à noite no rodapé. Segredo: digite "pizza" em qualquer lugar da página. */
(function () {
  'use strict';
  var A = window.Abertura;
  var parado = window.matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]estatico\b/.test(location.search);
  var COR = A ? A.COR : {};

  /* ---------- Um laço só para todas as animações ----------
   * Cada cena roda no próprio ritmo (fps) e só enquanto o canvas está na tela e a aba está aberta.
   * Com movimento reduzido, cada cena é desenhada uma vez e fica parada. */
  var cenas = [], laco = 0;
  function cena(el, fps, desenhar) {
    var c = { el: el, passo: 1000 / fps - 2, ultimo: -1e9, desenhar: desenhar, visivel: !('IntersectionObserver' in window) };
    cenas.push(c);
    if (parado) { desenhar(0, 16); return c; }
    if (!c.visivel) new IntersectionObserver(function (es) { c.visivel = es[es.length - 1].isIntersecting; acordar(); }, { rootMargin: '80px' }).observe(el);
    acordar();
    return c;
  }
  function rodar(agora) {
    laco = 0;
    var algum = false;
    for (var i = 0; i < cenas.length; i++) {
      var c = cenas[i];
      if (!c.visivel) continue;
      algum = true;
      if (agora - c.ultimo < c.passo) continue;
      var dt = Math.min(agora - c.ultimo, 100); c.ultimo = agora;
      c.desenhar(agora, dt);
    }
    if (algum && !document.hidden) laco = requestAnimationFrame(rodar);
  }
  function acordar() { if (!laco && !parado && !document.hidden) laco = requestAnimationFrame(rodar); }
  function depois(fn) { var t = 0; return function () { clearTimeout(t); t = setTimeout(fn, 120); }; }   // resize sem tremer
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(laco); laco = 0; } else acordar();
  });

  /* ---------- Mascote ---------- */
  var OLHOS = [9, 18];
  var JANELAS = [[21, 25, 2, 2], [9, 22, 2, 2], [18, 22, 2, 2], [21, 22, 2, 2], [14, 26, 4, 4]];
  var FALAS = ['Bom dia, firma!', 'Quem pediu pizza?', 'Deploy na sexta, não!', 'Reunião às 15h?', 'Tem gente esperando você.',
    'Café passado agora.', 'Ninguém gastou token hoje.', 'O ringue tá aberto.', 'Ei, isso faz cócegas!', 'Já bateu o ponto?'];

  function grade(e) {
    var g = A.MASCOTE.map(function (l) { return l.split(''); });
    JANELAS.forEach(function (j, i) {
      if (i < e.janelas) return;
      for (var y = j[1]; y < j[1] + j[3]; y++) for (var x = j[0]; x < j[0] + j[2]; x++) if (g[y][x] === 'a' || g[y][x] === 'A') g[y][x] = 'd';
    });
    OLHOS.forEach(function (ex) {
      for (var y = 13; y <= 17; y++) for (var x = ex; x < ex + 5; x++) g[y][x] = e.olho === 'aberto' ? 'w' : 'b';
      if (e.olho === 'fechado') { for (var a = ex; a < ex + 5; a++) g[16][a] = 'p'; return; }
      if (e.olho === 'feliz') { g[16][ex] = 'p'; g[15][ex + 1] = 'p'; g[14][ex + 2] = 'p'; g[15][ex + 3] = 'p'; g[16][ex + 4] = 'p'; return; }
      var px = ex + 1 + e.dx, py = 14 + e.dy;
      g[py][px] = 'h'; g[py][px + 1] = 'p'; g[py + 1][px] = 'p'; g[py + 1][px + 1] = 'p';
    });
    if (!e.antena) { g[1][15] = 'o'; g[1][16] = 'o'; g[2][15] = 'o'; g[2][16] = 'o'; }
    return g;
  }
  function pintar(ctx, g, u, sobe, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    var corte = 30 - Math.round((sobe == null ? 1 : sobe) * 30);
    for (var y = 0; y < 32; y++) {
      if (y < 30 && y < corte) continue;
      for (var x = 0; x < 32; x++) {
        var c = g[y][x]; if (c === '.') continue;
        ctx.fillStyle = COR[c]; ctx.fillRect(ox + x * u, oy + y * u, u, u);
      }
    }
  }

  var botaoMascote = document.querySelector('.mascote-botao');
  var tela = document.querySelector('.mascote');
  var balao = document.querySelector('.balao');
  var falaTimer = 0;
  function falar(texto) {
    if (!balao) return;
    balao.textContent = texto || FALAS[Math.floor(Math.random() * FALAS.length)];
    balao.classList.add('mostrar');
    clearTimeout(falaTimer);
    falaTimer = setTimeout(function () { balao.classList.remove('mostrar'); }, 2600);
  }

  if (tela && A) {
    var ctx = tela.getContext('2d');
    var est = { janelas: 0, olho: 'fechado', dx: 1, dy: 1, antena: true };
    var alvo = { dx: 1, dy: 1 }, inicio = performance.now(), piscada = 2600, felizAte = 0, falou = false;
    addEventListener('pointermove', function (e) {
      var r = tela.getBoundingClientRect();
      var ox = r.left + r.width / 2, oy = r.top + r.height * 0.47;
      var ang = Math.atan2(e.clientY - oy, e.clientX - ox);
      if (Math.hypot(e.clientX - ox, e.clientY - oy) < r.width * 0.12) { alvo.dx = 1; alvo.dy = 1; return; }
      alvo.dx = Math.max(0, Math.min(2, Math.round(1 + Math.cos(ang) * 1.4)));
      alvo.dy = Math.max(0, Math.min(2, Math.round(1 + Math.sin(ang) * 1.4)));
    }, { passive: true });
    botaoMascote.addEventListener('click', function () { felizAte = performance.now() + 900; falar(); });

    var ultimoDesenho = '';
    var quadro = function (agora) {
      var t = agora - inicio;
      var sobe = parado ? 1 : Math.min(1, t / 700); sobe = sobe * sobe * (3 - 2 * sobe);
      est.janelas = parado ? 5 : Math.max(0, Math.min(5, Math.floor((t - 700) / 120)));
      est.antena = parado || (t > 900 && Math.floor(t / 600) % 2 === 0);
      est.dx = alvo.dx; est.dy = alvo.dy;
      if (agora < felizAte) est.olho = 'feliz';
      else if (!parado && (t < 1400 || (t > piscada && t < piscada + 130))) est.olho = 'fechado';
      else est.olho = 'aberto';
      if (t > piscada + 130) piscada = t + 2200 + Math.random() * 2600;
      if (!falou && t > 1500) { falou = true; if (!parado) falar('Bom dia, firma!'); }
      var chave = est.janelas + est.olho + est.dx + est.dy + est.antena + sobe.toFixed(2);   // só repinta quando algo muda
      if (chave === ultimoDesenho) return;
      ultimoDesenho = chave;
      ctx.clearRect(0, 0, tela.width, tela.height);
      pintar(ctx, grade(est), 10, sobe);
    };
    if (parado) quadro(performance.now()); else cena(tela, 30, quadro);
  }

  /* ---------- Céu do hero ---------- */
  var ceu = document.querySelector('.ceu');
  if (ceu) {
    var c2 = ceu.getContext('2d'), P = 4, estrelas = [], predios = [];
    var montarCeu = function () {
      ceu.width = Math.ceil(ceu.clientWidth / P); ceu.height = Math.ceil(ceu.clientHeight / P);
      var W = ceu.width, H = ceu.height; estrelas = []; predios = [];
      for (var i = 0; i < W * H / 140; i++) estrelas.push({ x: Math.random() * W | 0, y: Math.random() * H * 0.6 | 0, f: Math.random() * 6.28 });
      for (var x = -4; x < W;) {
        var w = 10 + (Math.random() * 18 | 0), h = 10 + (Math.random() * H * 0.28 | 0), jan = [];
        for (var yy = H - h + 3; yy < H - 4; yy += 4) for (var xx = x + 2; xx < x + w - 2; xx += 3) if (Math.random() < 0.35) jan.push([xx, yy, Math.random()]);
        predios.push({ x: x, w: w, h: h, jan: jan }); x += w + (Math.random() * 4 | 0);
      }
    };
    var desenharCeu = function (agora) {
      var W = ceu.width, H = ceu.height;
      c2.clearRect(0, 0, W, H);
      estrelas.forEach(function (s) {
        c2.fillStyle = 'rgba(255,244,220,' + (parado ? 0.6 : 0.35 + 0.35 * Math.sin(agora / 700 + s.f)).toFixed(2) + ')';
        c2.fillRect(s.x, s.y, 1, 1);
      });
      predios.forEach(function (p) {
        c2.fillStyle = '#15162e'; c2.fillRect(p.x, H - p.h, p.w, p.h);
        p.jan.forEach(function (j) {
          c2.fillStyle = (parado ? j[2] > 0.3 : ((agora / 4000 + j[2] * 7) % 7) > 1.6) ? 'rgba(245,184,61,.55)' : 'rgba(40,42,80,.9)';
          c2.fillRect(j[0], j[1], 1, 2);
        });
      });
    };
    montarCeu();
    addEventListener('resize', depois(function () { montarCeu(); if (parado) desenharCeu(0); }));
    cena(ceu, 12, desenharCeu);
  }

  /* ---------- Ruas (hero e rodapé à noite): os três tipos de morador na calçada, carros, van e o motoboy da pizza ---------- */
  var S = window.Sprites, ruas = [];
  var ESPECIES = ['bichinho', 'terminal', 'gente'];
  function Rua(canvas, noite) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.noite = noite; this.coisas = []; this.proxima = 0; this.n = 0; this.medir();
    for (var i = 0; i < 5; i++) { this.nova(); var o = this.coisas[this.coisas.length - 1]; o.x = (i + 0.3) * this.c.width / 5; }
  }
  Rua.prototype.medir = function () {
    this.c.width = Math.ceil(this.c.clientWidth / 3); this.c.height = Math.ceil(this.c.clientHeight / 3);
    if (this.noite) this.predios = montarPredios(this.c.width, this.c.height);
  };
  // pista de baixo (vai para a direita) e de cima (vai para a esquerda); calçada acima das pistas
  Rua.prototype.nova = function (tipo) {
    var W = this.c.width, H = this.c.height, n = this.n++;
    if (tipo === 'pizza') { this.coisas.push({ tipo: 'moto', x: -20, esq: false, y: H - 2, v: 1.6, n: n, z: 2 }); return; }
    var esq = Math.random() < 0.5;
    if (Math.random() < 0.5) {
      var t = Math.random() < 0.25 ? 'van' : 'carro';
      this.coisas.push({ tipo: t, x: esq ? W + 30 : -34, esq: esq, y: esq ? H - 13 : H - 2, v: 0.7 + Math.random() * 0.7, n: n, z: esq ? 1 : 2 });
    } else {
      this.coisas.push({ tipo: ESPECIES[n % 3], x: esq ? W + 20 : -24, esq: esq, y: H - 25 + (esq ? 0 : 3), v: 0.22 + Math.random() * 0.12, n: n, z: esq ? 0 : 0.5, f: 0, acao: 'andar' });
    }
  };
  // cada pedestre anda, às vezes para (olha em volta, mexe no celular, digita, toma café) e, quando cruza com alguém
  // vindo do outro lado, os dois param, acenam e soltam um balãozinho
  var PARADAS = { gente: ['parar', 'celular', 'celular'], terminal: ['parar', 'parar', 'esperar'], bichinho: ['parar'] };
  var BALOES = ['oi', 'oi', 'coracao', 'nota', 'cafe'];
  var ALTURA = { gente: 30, terminal: 28, bichinho: 34 };
  Rua.prototype.viver = function (agora, k) {
    var gente = this.coisas.filter(function (o) { return o.f != null; });
    gente.forEach(function (o) {
      if (o.ate && agora > o.ate) { o.acao = 'andar'; o.ate = 0; o.balao = null; }
      if (o.acao === 'andar' && Math.random() < 0.0018 * k) {
        var ops = PARADAS[o.tipo]; o.acao = ops[(Math.random() * ops.length) | 0]; o.ate = agora + 1500 + Math.random() * 1800;
        if (o.tipo === 'bichinho' && Math.random() < 0.5) o.balao = 'cafe';
      }
    });
    for (var i = 0; i < gente.length; i++) for (var j = i + 1; j < gente.length; j++) {
      var a = gente[i], b = gente[j];
      if (a.esq === b.esq || a.acao !== 'andar' || b.acao !== 'andar' || a.viu === b.n || b.viu === a.n) continue;
      if (Math.abs(a.x - b.x) > 14) continue;
      a.viu = b.n; b.viu = a.n; a.acao = b.acao = 'acenar'; a.ate = b.ate = agora + 1700;
      a.balao = BALOES[(Math.random() * BALOES.length) | 0]; b.balao = Math.random() < 0.6 ? 'oi' : null;
    }
  };
  // o cenário (bairro, calçada e asfalto) fica pintado num canvas à parte; o bairro só repinta quando as janelas mudam
  Rua.prototype.fundo = function (agora) {
    var W = this.c.width, H = this.c.height, quando = parado ? 0 : Math.floor(agora / 400);
    var mesmoTamanho = this.cenario && this.cenario.width === W && this.cenario.height === H;
    if (mesmoTamanho && (!this.noite || this.cenarioQuando === quando)) return this.cenario;
    if (!mesmoTamanho) {
      this.cenario = document.createElement('canvas'); this.cenario.width = W; this.cenario.height = H;
    }
    var c = this.cenario.getContext('2d');
    c.clearRect(0, 0, W, H);
    if (this.noite) desenharBairro(c, this.predios, W, H, quando * 400);
    c.fillStyle = '#7a8196'; c.fillRect(0, H - 33, W, 2);            // calçada
    c.fillStyle = '#5b6275'; c.fillRect(0, H - 31, W, 8);
    c.fillStyle = '#4e5468'; for (var x0 = 0; x0 < W; x0 += 12) c.fillRect(x0, H - 31, 1, 8);
    c.fillStyle = '#9aa3b8'; c.fillRect(0, H - 23, W, 2);            // meio-fio
    c.fillStyle = '#2b2b35'; c.fillRect(0, H - 21, W, 21);           // asfalto
    c.fillStyle = 'rgba(255,244,220,.7)';
    for (var x = 4; x < W; x += 20) c.fillRect(x, H - 11, 10, 1);
    this.cenarioQuando = quando;
    return this.cenario;
  };
  Rua.prototype.desenhar = function (agora, dt) {
    var c = this.ctx, W = this.c.width, H = this.c.height, k = (dt || 16.7) / 16.7;   // k: passos de 60 Hz neste quadro
    c.clearRect(0, 0, W, H);
    c.drawImage(this.fundo(agora), 0, 0);
    if (this.noite) dorminhoco(c, W, H, agora);
    if (!parado && agora > this.proxima) { this.nova(); this.proxima = agora + 700 + Math.random() * 1800; }
    if (!parado) this.viver(agora, k);
    var self = this, t = parado ? 0 : agora;
    this.coisas.sort(function (a, b) { return a.z - b.z; });
    this.coisas = this.coisas.filter(function (o) {
      var anda = o.f == null || o.acao === 'andar';
      if (!parado && anda) { o.x += o.v * k * (o.esq ? -1 : 1); if (o.f != null) o.f += o.v * k; }
      var px = Math.round(o.x), passo = o.f != null ? Math.floor(o.f / 2.6) % 4 : 0, acao = parado ? 'andar' : o.acao || 'andar';
      if (o.tipo === 'gente') S.gente(c, px, o.y, passo, o.esq, o.n, acao, t);
      else if (o.tipo === 'terminal') S.terminal(c, px, o.y, passo, o.esq, o.n, t, acao);
      else if (o.tipo === 'bichinho') S.bichinho(c, px, o.y, passo, o.esq, o.n, t, acao);
      else S.veiculo(c, o.tipo, px, o.y, o.esq, o.n, self.noite, t);
      if (o.balao && !parado) S.balao(c, o.balao, px + (o.esq ? -2 : 5), o.y - ALTURA[o.tipo] - 2 - (Math.floor(agora / 300) % 2));
      return o.x > -40 && o.x < W + 40;
    });
  };
  function montarPredios(W, H) {
    var ps = [], base = H - 33;
    for (var x = 0; x < W;) {
      var w = 16 + (Math.random() * 22 | 0), h = 20 + (Math.random() * (base - 26) | 0), jan = [];
      for (var y = base - h + 4; y < base - 4; y += 5) for (var xx = x + 3; xx < x + w - 3; xx += 4) jan.push([xx, y, Math.random()]);
      ps.push({ x: x, w: w, h: h, jan: jan }); x += w + 2;
    }
    return ps;
  }
  function desenharBairro(c, ps, W, H, agora) {
    var base = H - 33, ox = Math.round(W * 0.5 - 32), oy = base - 60;
    ps.forEach(function (p) {
      if (p.x + p.w > ox - 2 && p.x < ox + 66) return;  // espaço do mascote
      c.fillStyle = '#1f2040'; c.fillRect(p.x, base - p.h, p.w, p.h);
      p.jan.forEach(function (j) {
        var acesa = parado ? j[2] > 0.55 : ((agora / 5000 + j[2] * 9) % 9) > 4.5;
        c.fillStyle = acesa ? '#f5b83d' : '#2c2e5a'; c.fillRect(j[0], j[1], 2, 2);
      });
    });
  }
  // o prédio-mascote dormindo no meio do bairro, com zzz (as duas poses da antena ficam prontas em canvas)
  var dormindo = [];
  function dorminhoco(c, W, H, agora) {
    if (!A) return;
    var ox = Math.round(W * 0.5 - 32), oy = H - 33 - 60, antena = !parado && Math.floor(agora / 900) % 2 === 0 ? 1 : 0;
    if (!dormindo[antena]) {
      var cv = document.createElement('canvas'); cv.width = 64; cv.height = 60;   // a base fica atrás da calçada
      pintar(cv.getContext('2d'), grade({ janelas: 2, olho: 'fechado', dx: 1, dy: 1, antena: !!antena }), 2, 1);
      dormindo[antena] = cv;
    }
    c.drawImage(dormindo[antena], ox, oy);
    var z = parado ? 1 : (agora / 600) % 3;
    c.fillStyle = 'rgba(255,244,220,.85)';
    var zx = ox + 54 + Math.floor(z * 3), zy = oy + 10 - Math.floor(z * 5);
    c.fillRect(zx, zy, 4, 1); c.fillRect(zx + 2, zy + 1, 1, 1); c.fillRect(zx + 1, zy + 2, 1, 1); c.fillRect(zx, zy + 3, 4, 1);
  }
  if (S) document.querySelectorAll('.rua, .rua-noite').forEach(function (cv) { ruas.push(new Rua(cv, cv.classList.contains('rua-noite'))); });
  if (ruas.length) {
    addEventListener('resize', depois(function () { ruas.forEach(function (r) { r.medir(); r.cenario = null; if (parado) r.desenhar(0); }); }));
    ruas.forEach(function (r) { cena(r.c, 60, function (agora, dt) { r.desenhar(agora, dt); }); });
  }

  /* ---------- Quem mora aqui: cada espécie num ciclo de anda, acena e para; passar o mouse faz acenar ---------- */
  var ROTINA = { gente: [['andar', 3200], ['acenar', 1600], ['celular', 2400]], terminal: [['andar', 3200], ['acenar', 1600], ['parar', 2600], ['esperar', 1400]],
    bichinho: [['andar', 3200], ['acenar', 1600], ['parar', 2400]] };
  // o palco é uma faixa baixa em escala inteira (4 px por pixel, 3 no celular estreito): o morador anda de um lado ao outro
  // e o pixel continua nítido em qualquer largura de cartão
  document.querySelectorAll('[data-especie]').forEach(function (cv, i) {
    var cx = cv.getContext('2d'), esp = cv.dataset.especie, rot = ROTINA[esp] || ROTINA.gente, oi = false;
    var total = rot.reduce(function (s, r) { return s + r[1]; }, 0);
    var cartao = cv.closest('.especie') || cv;
    cartao.addEventListener('pointerenter', function () { oi = true; });
    cartao.addEventListener('pointerleave', function () { oi = false; });
    var W = 60, H = 36, x = 10 + i * 9, esq = false, ultimo = 0;
    var medir = function () {
      var largura = (cv.parentNode.clientWidth || 240), esc = largura < 330 ? 3 : 4;
      W = Math.max(40, Math.floor(largura / esc)); cv.width = W; cv.height = H;
      cv.style.width = W * esc + 'px'; cv.style.height = H * esc + 'px';
      x = Math.min(x, W - 18);
    };
    medir();
    addEventListener('resize', depois(function () { medir(); if (parado) loop(0); }));
    var loop = function (agora) {
      var dt = Math.min(100, agora - ultimo || 0); ultimo = agora;
      cx.fillStyle = '#2b2a52'; cx.fillRect(0, 0, W, H);               // parede
      cx.fillStyle = '#3a3968'; for (var q = 3; q < W; q += 16) cx.fillRect(q, 6, 8, 10);   // quadros na parede
      cx.fillStyle = '#5b6275'; cx.fillRect(0, H - 9, W, 2);             // rodapé
      cx.fillStyle = '#34343f'; cx.fillRect(0, H - 7, W, 7);             // chão
      cx.fillStyle = '#2c2c36'; for (var r = 2; r < W; r += 8) cx.fillRect(r, H - 4, 4, 1);
      var t = parado ? 0 : (agora + i * 1700) % total, acao = 'andar';
      for (var k = 0, soma = 0; k < rot.length; k++) { soma += rot[k][1]; if (t < soma) { acao = rot[k][0]; break; } }
      if (oi) acao = 'acenar';
      if (parado) acao = 'andar';
      if (!parado && acao === 'andar') {
        x += (esq ? -1 : 1) * dt * 0.011;
        if (x > W - 18) esq = true; else if (x < 4) esq = false;
      }
      var px = Math.round(x), passo = parado ? 0 : Math.floor(agora / 170) % 4, ag = parado ? 0 : agora;
      if (esp === 'gente') S.gente(cx, px, H - 3, passo, esq, 3, acao, ag);
      else if (esp === 'terminal') S.terminal(cx, px, H - 3, passo, esq, i + 1, ag, acao);
      else S.bichinho(cx, px - 4, H - 2, passo, esq, 7, ag, acao);
    };
    cena(cv, 30, loop);
  });

  addEventListener('keydown', function (e) {
    if (!e.key || e.key.length !== 1 || /input|textarea/i.test(e.target.tagName)) return;
    digitado = (digitado + e.key.toLowerCase()).slice(-5);
    if (digitado === 'pizza') { ruas.forEach(function (r) { r.nova('pizza'); }); falar('PIZZA CHEGOU!'); }
  });

  /* ---------- Elevador: desce pelo poço junto com a rolagem e mostra o andar ---------- */
  var andares = Array.prototype.slice.call(document.querySelectorAll('.andar'));
  var poco = document.querySelector('.poco'), elevador = document.querySelector('.elevador'), visor = document.querySelector('.elevador-visor');
  var miniEl = document.querySelector('.elevador-mascote');
  if (miniEl && A) pintar(miniEl.getContext('2d'), grade({ janelas: 5, olho: 'aberto', dx: 1, dy: 1, antena: true }), 1, 1);
  var andarAtual = null, pocoVisivel = false, elevadorPedido = 0;
  function medirPoco() { pocoVisivel = !!(poco && elevador && getComputedStyle(poco).display !== 'none'); }
  function moverElevador() {
    elevadorPedido = 0;
    var meio = innerHeight * 0.45, atual = null;
    andares.forEach(function (a) { var ar = a.getBoundingClientRect(); if (ar.top < meio && ar.bottom > meio) atual = a; });
    if (atual !== andarAtual) {   // só mexe nas classes quando troca de andar
      if (andarAtual) andarAtual.classList.remove('ativo');
      if (atual) atual.classList.add('ativo');
      andarAtual = atual;
    }
    if (!pocoVisivel) return;
    var r = poco.getBoundingClientRect();
    var y = Math.max(0, Math.min(r.height - 64, meio - r.top - 32));
    elevador.style.transform = 'translateY(' + Math.round(y) + 'px)';
    if (atual && visor.textContent !== atual.dataset.andar) visor.textContent = atual.dataset.andar;
  }
  addEventListener('scroll', function () { if (!elevadorPedido) elevadorPedido = requestAnimationFrame(moverElevador); }, { passive: true });
  addEventListener('resize', depois(function () { medirPoco(); moverElevador(); }));
  medirPoco(); moverElevador();

  if ('IntersectionObserver' in window && !parado) {
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('visivel'); obs.unobserve(e.target); } });
    }, { threshold: 0.15 });
    andares.forEach(function (a) {
      if (a.getBoundingClientRect().top > innerHeight) { a.classList.add('revelar'); obs.observe(a); }
    });
  }

  /* ---------- Crachás viram com toque ---------- */
  if ('IntersectionObserver' in window && !parado) {
    var longe = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle('longe', !e.isIntersecting); }); });
    document.querySelectorAll('.cracha').forEach(function (b) { longe.observe(b); });
  }
  document.querySelectorAll('.cracha').forEach(function (b) {
    b.addEventListener('click', function () { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); });
  });

  /* ---------- Clima e folhinha: gravações do modo demonstração (paradas com movimento reduzido) ---------- */
  var gravacao = function (nome) { return 'img/tempo/' + nome + (parado ? '-parado' : '') + '.webp?v=2'; };   // ?v=2: as gravações do prédio inteiro, sem o recorte antigo do cache
  var climaImg = document.querySelector('.clima-img'), climaLegenda = document.querySelector('.clima-legenda');
  var climaBotoes = document.querySelectorAll('[data-clima]');
  climaBotoes.forEach(function (b) {
    b.addEventListener('click', function () {
      climaBotoes.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      climaImg.src = gravacao('clima-' + b.dataset.clima);
      climaImg.alt = 'O escritório com ' + b.textContent.toLowerCase() + ', gravado do modo demonstração.';
      climaLegenda.textContent = b.dataset.legenda;
    });
  });
  if (climaImg && parado) climaImg.src = gravacao('clima-chuva');

  // o mundo: a gravação de cada lugar da página Mundo (o Brasil é uma foto)
  var mundoImg = document.querySelector('.mundo-img'), mundoLegenda = document.querySelector('.mundo-legenda');
  var lugares = document.querySelectorAll('[data-cidade]');
  var gravacaoMundo = function (id) {
    if (id === 'brasil') return 'img/19-mundo-brasil.webp';
    return 'img/mundo/' + (id === 'globo' ? 'mundo-globo' : 'cidade-' + id) + (parado ? '-parado' : '') + '.webp?v=2';
  };
  lugares.forEach(function (b) {
    b.addEventListener('click', function () {
      lugares.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      mundoImg.src = gravacaoMundo(b.dataset.cidade);
      mundoImg.alt = b.textContent + ', gravado da página Mundo.';
      mundoLegenda.textContent = b.dataset.legenda;
    });
  });
  if (mundoImg && parado) mundoImg.src = gravacaoMundo('rio-de-janeiro');

  var festaImg = document.querySelector('.festa-img'), festaFala = document.querySelector('.festa-fala'), festaLegenda = document.querySelector('.festa-legenda');
  var folhas = document.querySelectorAll('[data-festa]'), falas = [], falaN = 0;
  var mostrarFala = function () {
    if (!falas.length) return;
    festaFala.textContent = falas[falaN++ % falas.length];
    festaFala.classList.remove('troca'); void festaFala.offsetWidth; festaFala.classList.add('troca');
  };
  folhas.forEach(function (b) {
    b.addEventListener('click', function () {
      folhas.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      festaImg.src = gravacao('festa-' + b.dataset.festa);
      festaImg.alt = 'O escritório enfeitado para ' + b.dataset.nome + ', gravado do modo demonstração.';
      festaLegenda.innerHTML = '';
      var forte = document.createElement('strong'); forte.textContent = b.dataset.nome + '. ';
      festaLegenda.append(forte, b.dataset.enfeites);
      falas = b.dataset.falas.split('|'); falaN = 0; mostrarFala();
    });
  });
  var natal = document.querySelector('[data-festa="natal"]');
  if (natal) { falas = natal.dataset.falas.split('|'); falaN = 1; if (parado) festaImg.src = gravacao('festa-natal'); }
  if (festaFala && !parado) {   // as falas só trocam com a folhinha na tela
    var falaNaTela = !('IntersectionObserver' in window);
    if (!falaNaTela) new IntersectionObserver(function (es) { falaNaTela = es[es.length - 1].isIntersecting; }).observe(festaFala);
    setInterval(function () { if (falaNaTela && !document.hidden) mostrarFala(); }, 3200);
  }

  /* ---------- TV com chiado (só enquanto está na tela) ---------- */
  var chiado = document.querySelector('.tv-chiado');
  if (chiado) {
    chiado.width = 160; chiado.height = 90;
    var tctx = chiado.getContext('2d'), img = tctx.createImageData(160, 90), px32 = new Uint32Array(img.data.buffer);
    cena(chiado, 14, function () {
      for (var i = 0; i < px32.length; i++) px32[i] = 0xff000000 | (Math.random() * 255 | 0) * 0x10101;
      tctx.putImageData(img, 0, 0);
    });
  }

  /* ---------- Copiar comando ---------- */
  document.querySelectorAll('[data-copiar]').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = navigator.clipboard ? navigator.clipboard.writeText(b.getAttribute('data-copiar')) : Promise.reject();
      p.then(function () { b.textContent = 'Copiado!'; }, function () { b.textContent = 'Selecione e copie'; })
        .then(function () { setTimeout(function () { b.textContent = 'Copiar'; }, 1800); });
    });
  });

  /* ---------- Chamar o elevador (voltar ao topo) ---------- */
  var chamar = document.querySelector('.chamar-elevador');
  if (chamar) chamar.addEventListener('click', function () {
    scrollTo({ top: 0, behavior: parado ? 'auto' : 'smooth' });
    setTimeout(function () { falar('Subiu! Bem-vindo de volta.'); }, parado ? 0 : 700);
  });

  var ano = document.querySelector('[data-ano]');
  if (ano) ano.textContent = String(new Date().getFullYear());
})();
