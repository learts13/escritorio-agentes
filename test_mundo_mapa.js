"use strict";
// Mapa do Brasil ilustrado (nível Brasil): a miniatura do marco em cada capital (e o ícone genérico sem o quadro), os
// nomes em Silkscreen (a casa sempre, a cidade em foco e todas a partir de 2x, sem um cobrir o outro), barcos, ondas e
// aviões do atlas parados com movimento reduzido, o brilho da noite sem gradiente novo a cada quadro e o clique que desce
// à cidade. Usa o arnês do test_mundo_navegacao.js (a página inteira numa VM, sem navegador).
const assert = require("node:assert/strict");
const { abrir, carregar, ATLAS, CLIMA, MUNDO, UFS_PERTO } = require("./test_mundo_navegacao.js");

const cruza = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const cidade = id => MUNDO.cidades.find(c => c.id === id);

async function brasil(opcoes = {}) {
  const m = await abrir("#brasil", { passo: 50, ...opcoes });
  await carregar(m);
  return m;
}

let m_ = null;
async function principal() {
  // cada capital desenha a miniatura do seu marco (o recorte do atlas); a casa, o chalé com a bandeira
  const m = await brasil();
  m_ = m;
  m.contexto.gravar = []; m.rodar(2);
  const usados = new Set(m.contexto.gravar.map(r => JSON.stringify(r)));
  for (const c of MUNDO.cidades) {
    const nome = "mini-" + c.marco;
    assert.ok(ATLAS.quadros[nome], "o atlas tem " + nome);
    if (c.id === CLIMA.casa) continue;
    assert.ok(usados.has(JSON.stringify(ATLAS.quadros[nome])), `${c.id}: desenha ${nome}`);
  }
  const icones = m.M.niveis.brasil.icones;
  assert.equal(icones["mateus-leme"], "casa", "a cidade do escritório é o chalé");
  assert.equal(icones["recife"], "mini-recife-antigo");
  // sem o quadro da miniatura (ou sem o atlas), o ícone genérico, sem erro
  const sem = { ...ATLAS, quadros: { ...ATLAS.quadros } };
  delete sem.quadros["mini-recife-antigo"];
  const s = await brasil({ atlas: sem });
  s.rodar(3);
  assert.equal(s.M.niveis.brasil.icones["recife"], "generico");
  assert.equal(s.M.niveis.brasil.icones["manaus"], "mini-teatro-amazonas");
  const nada = await abrir("#brasil");
  nada.rodar(3);
  assert.equal(nada.M.niveis.brasil.icones["manaus"], "generico", "antes do atlas chegar, o genérico");

  // nomes: a 1x só o da casa; com o foco numa cidade, o dela também; a 2x, os das cidades à vista, sem sobrepor
  const nomes = () => JSON.stringify(m.M.niveis.brasil.nomes.map(n => n.id).sort());
  m.rodar(2);
  assert.equal(nomes(), '["mateus-leme"]');
  const botoes = m.elementos["mundo-alvos"].filhos, i = MUNDO.cidades.findIndex(c => c.id === "manaus");
  botoes[i].disparar("focus"); m.rodar(2);
  assert.equal(nomes(), '["manaus","mateus-leme"]', "o foco mostra o nome");
  botoes[i].disparar("blur"); m.rodar(2);
  const rec = cidade("recife");
  m.M.camera.zoomPara(2); m.rodar(80);   // a 1x a caixa cabe na tela e a câmera fica no meio: só depois do zoom ela anda
  m.M.camera.x = rec.x; m.M.camera.y = rec.y; m.M.camera.limitar(); m.rodar(2);
  assert.ok(Math.abs(m.M.camera.P / m.M.camera.base - 2) < 1e-6, "zoom 2x");
  const lista = m.M.niveis.brasil.nomes;
  const vistas = MUNDO.cidades.filter(c => { const [x, y] = m.M.camera.tela(c.x, c.y); return x > 20 && y > 20 && x < 620 && y < 380; });
  assert.ok(vistas.length >= 5, "cidades à vista: " + vistas.length);
  assert.ok(lista.length >= Math.ceil(vistas.length * 0.6), `nomes a 2x: ${lista.length} de ${vistas.length}`);
  assert.ok(lista.some(n => n.id === "recife"));
  for (let a = 0; a < lista.length; a++) for (let b = a + 1; b < lista.length; b++) {
    assert.ok(!cruza(lista[a], lista[b]), `${lista[a].id} e ${lista[b].id} se cobrem`);
  }

  // clique no meio da miniatura (onde ela está desenhada, que a 1x pode ser afastada do ponto) desce a #cidade=<id>
  const k = await brasil();
  k.rodar(2);
  const cr = k.M.niveis.brasil.caixas.find(c => c.id === "recife");
  k.clicar(cr.x + cr.w / 2, cr.y + cr.h - 10); k.rodar(40);
  assert.equal(k.contexto.location.hash, "#cidade=recife");

  // o nome sob o cursor aparece (sem foco nem zoom)
  const cu = await brasil();
  cu.rodar(2);
  const cm = cu.M.niveis.brasil.caixas.find(c => c.id === "manaus");
  cu.canvas.disparar("pointermove", { pointerId: 9, clientX: cm.x + cm.w / 2, clientY: cm.y + cm.h - 10, button: 0 });
  cu.rodar(2);
  assert.ok(cu.M.niveis.brasil.nomes.some(n => n.id === "manaus"), "o cursor sobre Manaus mostra o nome");

  // a 1x (desktop, celular em pé e o arnês), com nuvem de chuva em todas: nenhuma caixa (miniatura + ícone do tempo) cobre
  // outra e nenhuma sai da tela; a cidade sem vizinha fica no ponto; Mateus Leme, que não é capital, tem marcador menor
  const chuva = { cidades: Object.fromEntries(MUNDO.cidades.map(c => [c.id, { tipo: "chuva", vento: 0, noite: false }])),
    casa: "sao-paulo", versao: 1 };
  for (const tela of [[640, 400, 1], [940, 800, 1], [390, 507, 3]]) {
    const v = await brasil({ tela, clima: chuva });
    v.rodar(3);
    const b = v.M.niveis.brasil, caixas = b.caixas, W = tela[0] * tela[2], H = tela[1] * tela[2];
    assert.equal(caixas.length, 28, `${tela}: as 28 à vista`);
    for (const c of caixas) assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H, `${tela}: ${c.id} cortada pela borda`);
    for (let i = 0; i < caixas.length; i++) for (let j = i + 1; j < caixas.length; j++) {
      assert.ok(!cruza(caixas[i], caixas[j]), `${tela}: ${caixas[i].id} e ${caixas[j].id} se cobrem`);
    }
    const ma = caixas.find(c => c.id === "manaus");   // no arnês (mapa de 400 px na tela) tudo é apertado; nos outros, não
    if (tela[0] !== 640) assert.ok(ma.px === ma.ax && ma.py === ma.ay, `${tela}: Manaus no ponto (${ma.px - ma.ax}, ${ma.py - ma.ay})`);
    assert.ok(caixas.some(c => c.px !== c.ax || c.py !== c.ay), `${tela}: o Nordeste se afasta do ponto`);
    assert.equal(b.icones["mateus-leme"], "pequena");
    const ml = caixas.find(c => c.id === "mateus-leme"), bh = caixas.find(c => c.id === "belo-horizonte");
    assert.ok(ml.iw < bh.iw && ml.ih < bh.ih, `${tela}: Mateus Leme menor que BH`);
  }

  // a miniatura cresce com o zoom, em degraus inteiros: o dobro a 2x
  const z = await brasil();
  z.rodar(2);
  const w1 = z.M.niveis.brasil.caixas.find(c => c.id === "manaus").iw;
  z.M.camera.zoomPara(2); z.rodar(80);
  const man = cidade("manaus");
  z.M.camera.x = man.x; z.M.camera.y = man.y; z.M.camera.limitar(); z.rodar(2);
  assert.equal(z.M.niveis.brasil.caixas.find(c => c.id === "manaus").iw, 2 * w1, "a 2x, a miniatura dobra");

  // a rosa dos ventos não espera a fonte (o nome do oceano, sim)
  const f = await brasil({ fontePendente: true });
  f.rodar(2);
  assert.equal(JSON.stringify(f.M.niveis.brasil.enfeites), '{"rosa":true,"oceano":false}');

  // movimento reduzido: barcos, ondas e aviões parados; sem ele, barcos e ondas andam e os aviões vêm do atlas
  for (const reduzido of [true, false]) {
    const r = await abrir("#brasil", { passo: 50, reduzido });
    r.contexto.gravar = [];   // desde o começo: o avião girado é pintado uma vez por direção e depois só copiado
    await carregar(r);
    const b = r.M.niveis.brasil, antes = JSON.stringify([b.barcos, b.ondas]);
    assert.ok(b.barcos.length >= 3 && b.barcos.length <= 5, "barcos: " + b.barcos.length);
    let voando = 0;
    for (let i = 0; i < 120; i++) { r.rodar(); voando = Math.max(voando, b.avioes.length); }
    const depois = JSON.stringify([b.barcos, b.ondas]);
    if (reduzido) {   // os barcos ficam onde nasceram, nenhum brilho de onda chega a aparecer e nenhum avião decola
      assert.equal(JSON.stringify(b.barcos), JSON.stringify(JSON.parse(antes)[0]), "barcos parados");
      assert.equal(b.ondas.length, 0, "reduzido: nenhum brilho de onda");
      assert.equal(voando, 0);
      assert.equal(depois, antes);
    }
    else {
      assert.notEqual(JSON.stringify(b.barcos), JSON.stringify(JSON.parse(antes)[0]), "os barcos navegam");
      assert.notEqual(JSON.stringify(b.ondas), JSON.stringify(JSON.parse(antes)[1]), "as ondas brilham");
      const usados = new Set(r.contexto.gravar.map(g => JSON.stringify(g)));
      assert.ok(voando > 0);
      assert.ok(["mini-aviao-1", "mini-aviao-2"].some(n => usados.has(JSON.stringify(ATLAS.quadros[n]))), "aviões do atlas");
    }
  }

  // a noite: o brilho quente das cidades sai de sprites guardados, sem gradiente novo depois de aquecer
  const n = await brasil({ escuro: 1, busca: "?data=2026-11-18" });
  n.rodar(60);
  const g0 = n.contexto.gradientes || 0;
  n.rodar(120);
  assert.equal((n.contexto.gradientes || 0) - g0, 0, "brilhos em cache");
  // de perto também (azulejos, estados, cidades médias): nada de gradiente novo por quadro
  n.M.camera.zoomPara(3); n.rodar(40); await carregar(n); n.rodar(20);
  const g1 = n.contexto.gradientes || 0;
  n.rodar(60);
  assert.equal((n.contexto.gradientes || 0) - g1, 0, "de perto, brilhos em cache");

  await niveisDeDetalhe();
  await casaEmMateusLeme();
  await estados();
  await arranjoSemPuxarNemCruzar();
  // rodada 1
  await nadaSobOsBotoesNemCortado();
  await terceiroNivel();
  await contornoNaDivisa();
  descruzarSintetico(m.contexto.window.MundoMapa);
  await azulejoQueFalhaVoltaSozinho();
  // rodada 2
  await quatroXEmTodaTela();
  await camadaCobertaNaoDesenhada();
  await iconesForaDosBotoes();
  await nomesComMargem();
  await ufNaGradeDoContorno();
  // rodada 3
  await trocaSemBuraco();
  await nomesAcompanhamOsIcones();
  // rodada 4
  await nomeNaoCobreIcone();
}

// nenhum nome de cidade cobre o ícone de outra, em nenhum degrau (2x, 3x e o teto), nas telas dos achados, com a casa em São
// Paulo e em Mateus Leme: Mateus Leme junto de BH, Brasília e Goiânia, Salvador e Aracaju, Curitiba e Florianópolis
async function nomeNaoCobreIcone() {
  const telas = [[940, 800, 1], [940, 596, 1], [1026, 650, 1], [940, 580, 1], [360, 520, 3], [390, 507, 3]];
  const alvos = ["belo-horizonte", "brasilia", "salvador", "curitiba", "rio-de-janeiro", "recife"];
  for (const casa of ["sao-paulo", "mateus-leme"]) for (const tela of telas) {
    const v = await brasil({ tela, clima: { ...CLIMA, casa } });
    const c = v.M.camera, W = tela[0] * tela[2], H = tela[1] * tela[2];
    for (const z of [1, 2, 3, 99]) for (const id of alvos) {
      const alvo = cidade(id);
      c.zoomPara(z); v.rodar(40); centrar(v, alvo.x, alvo.y);
      const b = v.M.niveis.brasil, caixas = b.caixas.filter(k => k.ax >= -40 && k.ay >= -40 && k.ax < W + 40 && k.ay < H + 40);
      for (const n of b.nomes) for (const k of caixas) {
        if (k.id === n.id) continue;
        const icone = { x: k.px - k.iw / 2, y: k.py - k.ih, w: k.iw, h: k.ih };
        assert.ok(!cruza(n, icone), `casa ${casa}, ${tela}, ${z}x em ${id}: o nome de ${n.id} cobre o ícone de ${k.id}`);
      }
      if (casa === "mateus-leme") {
        const ml = caixas.find(k => k.id === "mateus-leme");
        if (ml && ml.ax >= 0 && ml.ay >= 0 && ml.ax < W && ml.ay < H) {
          assert.ok(b.nomes.some(n => n.id === "mateus-leme"), `${tela}, ${z}x em ${id}: o nome da casa sumiu`);
        }
      }
    }
  }
}

// ao sair do 4x (para 3x), nenhum quadro fica sem chão: em cada quadro, ou o brasil.png é desenhado, ou todo azulejo de 2x
// à vista é desenhado, ou o de 4x por cima dele (com e sem movimento reduzido)
async function trocaSemBuraco() {
  for (const reduzido of [true, false]) {
    const p = await abrir("#brasil", { passo: 50, reduzido, tela: [940, 800, 1] });
    await carregar(p);
    const c = p.M.camera;
    c.zoomPara(99, ...c.tela(230, 230)); p.rodar(40); c.x = 230; c.y = 230; c.limitar(); p.rodar(3);
    await carregar(p); p.rodar(20);
    assert.ok(p.M.niveis.brasil.perto.niveis.perto4x.desenhados > 0);
    c.zoomPara(3);
    for (let q = 0; q < 12; q++) {
      p.contexto.gravar = []; p.rodar(1);
      const g = p.contexto.gravar, [x0, y0] = c.mundo(0, 0), [x1, y1] = c.mundo(c.W, c.H);
      const longe = g.some(r => r.length === 2 && r[0] === 0 && r[1] === 0);
      const desenhado = (x, y, L) => g.some(r => r.length === 4 && r[0] === x && r[1] === y && r[2] === L);
      let buraco = null;
      for (let j = Math.max(0, Math.floor(y0 / 100)); j <= Math.min(3, Math.floor((y1 - 1e-9) / 100)) && !buraco; j++) {
        for (let i = Math.max(0, Math.floor(x0 / 100)); i <= Math.min(3, Math.floor((x1 - 1e-9) / 100)) && !buraco; i++) {
          const por4 = [0, 1].every(b => [0, 1].every(a => desenhado((2 * i + a) * 50, (2 * j + b) * 50, 50)));
          if (!desenhado(i * 100, j * 100, 100) && !por4) buraco = [i, j];
        }
      }
      assert.ok(longe || !buraco, `${reduzido ? "reduzido" : "animado"}, quadro ${q}: buraco no azulejo ${buraco}`);
    }
  }
}

// o nome acompanha o ícone deslocado (para fora dos botões ou da borda); o da casa nunca some
async function nomesAcompanhamOsIcones() {
  const v = await brasil({ tela: [390, 507, 3], clima: { ...CLIMA, casa: "mateus-leme" } });
  const c = v.M.camera, r = cidade("recife");
  c.zoomPara(2); v.rodar(40); c.x = r.x; c.y = r.y; c.limitar(); v.rodar(3);
  const nomes = v.M.niveis.brasil.nomes, caixas = v.M.niveis.brasil.caixas;
  for (const id of ["mateus-leme", "belo-horizonte", "vitoria"]) {
    const n = nomes.find(k => k.id === id), k = caixas.find(q => q.id === id);
    assert.ok(n, `${id}: o nome sumiu`);
    const gx = Math.max(0, k.x - (n.x + n.w), n.x - (k.x + k.w)), gy = Math.max(0, k.y - (n.y + n.h), n.y - (k.y + k.h));
    const perto = gx <= 8 * 3 && gy <= 8 * 3;   // a menos de 8 px de CSS da caixa do ícone
    assert.ok(perto, `${id}: o nome longe do ícone`);
  }
  for (const tela of [[390, 507, 3], [640, 400, 1]]) {   // a casa: em qualquer vista, o nome dela aparece
    const w = await brasil({ tela, clima: { ...CLIMA, casa: "mateus-leme" } });
    for (const [z, x, y] of [[1, 200, 200], [2, 300, 280], [2, 330, 330], [4, 296, 262], [4, 320, 300]]) {
      w.M.camera.zoomPara(z); w.rodar(30); w.M.camera.x = x; w.M.camera.y = y; w.M.camera.limitar(); w.rodar(3);
      const k = w.M.niveis.brasil.caixas.find(q => q.id === "mateus-leme"), W = tela[0] * tela[2], H = tela[1] * tela[2];
      if (k && k.ax >= 0 && k.ay >= 0 && k.ax < W && k.ay < H) {
        assert.ok(w.M.niveis.brasil.nomes.some(n => n.id === "mateus-leme"), `${tela} ${z}x (${x}, ${y}): o nome da casa sumiu`);
      }
    }
  }
}

// o zoom máximo em qualquer tela: entre 3,2x e 4,8x, acima do degrau das cidades médias, com o pixel do 4x inteiro sempre
// que a faixa deixa (senão, o mais perto do inteiro). A varredura: o menor lado do palco de 320 a 2200 px, em seis dpr,
// pela câmera de verdade com o teto do Brasil (rápida, sem página)
function tetoEmTodoPalco(janela) {
  const { Camera } = janela.Mundo, { tetoDoBrasil } = janela.MundoMapa, Z_MEDIAS = janela.MapaPerto.Z_MEDIAS;
  let fora = 0, total = 0;
  for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) for (let lado = 320; lado <= 2200; lado++) {
    const c = Camera([0, 0, 400, 400], { max: 8, multiplo: 2 });
    c.teto = () => tetoDoBrasil(c.base); c.tetoExato = true;
    const W = Math.round(lado * dpr), H = Math.round(lado * dpr * 1.4);
    c.tamanho(W, H, dpr);
    c.zoomPara(99); c.passo(1, true);
    const z = c.z, q = c.P / 4, inteiro = Math.abs(q - Math.round(q)) < 1e-9;
    assert.ok(z >= 3.2 - 1e-9 && z <= 4.8 + 1e-9, `palco ${lado} dpr ${dpr}: teto ${z.toFixed(3)}`);
    assert.ok(z >= Z_MEDIAS, `palco ${lado} dpr ${dpr}: as médias não aparecem no teto ${z}`);
    total++;
    if (!inteiro) fora++;
  }
  return { fora, total };
}

// no zoom máximo, em telas comuns (inclusive as do palco baixo, 940x596 e 1280x720), os azulejos de 4x são pedidos e o
// zoom fica na faixa
async function quatroXEmTodaTela() {
  const telas = { "1366x768": [1026, 650, 1], "Android 360": [360, 520, 3], "Pixel 412": [412, 560, 2.625],
    "iPhone 375": [375, 520, 3], "4K a 200%": [1500, 950, 2], "940x800": [940, 800, 1], "iPhone 390": [390, 507, 3],
    "940x596": [940, 596, 1], "1280x720": [940, 580, 1] };
  const bh = cidade("belo-horizonte");
  for (const [nome, tela] of Object.entries(telas)) {
    const p = await brasil({ tela });
    const c = p.M.camera;
    c.zoomPara(99, ...c.tela(bh.x, bh.y)); p.rodar(60);
    const quatro = azulejosPedidos(p).filter(u => u.startsWith("/mundo/perto4x/"));
    assert.ok(c.z >= 3.2 - 1e-9 && c.z <= 4.8 + 1e-9, `${nome}: teto ${c.z.toFixed(2)} fora da faixa`);
    assert.ok(quatro.length > 0, `${nome}: nenhum azulejo de 4x no teto (z ${c.z.toFixed(2)}, P ${c.P})`);
    assert.ok(p.M.niveis.brasil.rotulos.some(r => r.tipo === "media"), `${nome}: as cidades médias no teto`);
  }
  const { fora, total } = tetoEmTodoPalco(m_.contexto.window);
  console.log(`teto: ${total} palcos, ${fora} com o pixel do 4x fora do inteiro`);
}

// a 4x, onde o azulejo de 4x já chegou e está inteiro (opaco), o de 2x e o brasil.png por baixo não são desenhados (a vista
// no interior, em Goiás, onde todo azulejo de 4x existe)
async function camadaCobertaNaoDesenhada() {
  const p = await brasil({ tela: [940, 800, 1] });
  const c = p.M.camera;
  c.zoomPara(99, ...c.tela(230, 230)); p.rodar(60); centrar(p, 230, 230);
  await carregar(p); p.rodar(30);   // a transição acaba
  const n = p.M.niveis.brasil.perto.niveis;
  assert.ok(n.perto4x.desenhados > 0, JSON.stringify(n));
  assert.equal(n.perto.desenhados, 0, "a 4x coberto, o de 2x não é desenhado: " + JSON.stringify(n));
  assert.equal(p.M.niveis.brasil.perto.longe, false, "nem o brasil.png");
}

// um ícone de cidade (com o ponto na tela) nunca fica sob os botões: sai de baixo deles, com linha guia
async function iconesForaDosBotoes() {
  const casos = [[[390, 507, 3], "recife", 2, null], [[390, 507, 3], "belo-horizonte", 2, [240, 40]],
    [[390, 507, 3], "porto-alegre", 2, [150, 40]], [[940, 800, 1], "rio-de-janeiro", 3, [150, 40]]];
  for (const [tela, id, z, canto] of casos) {
    const v = await brasil({ tela, clima: { ...CLIMA, casa: "mateus-leme" } });
    const c = v.M.camera, alvo = cidade(id);
    c.zoomPara(z); v.rodar(40);
    // a vista de Recife (a do r1-celular-2x) ou a cidade logo acima dos botões, no canto de baixo à direita da tela
    if (canto) { c.x = alvo.x - (c.W / 2 - (tela[0] - canto[0]) * tela[2]) / c.P; c.y = alvo.y - (c.H / 2 - (tela[1] - canto[1]) * tela[2]) / c.P; }
    else { c.x = alvo.x; c.y = alvo.y; }
    c.limitar(); v.rodar(3);
    const W = tela[0] * tela[2], H = tela[1] * tela[2];
    for (const k of v.M.niveis.brasil.caixas.filter(k => k.ax >= 0 && k.ay >= 0 && k.ax < W && k.ay < H)) {
      const icone = { x: k.px - k.iw / 2, y: k.py - k.ih, w: k.iw, h: k.ih };
      for (const o of botoes(tela)) assert.ok(!cruza(icone, o), `${tela} ${id}: ${k.id} sob os botões`);
    }
  }
}

// os nomes de estados, vizinhos e cidades médias guardam a mesma margem da borda que os das capitais (2·T)
async function nomesComMargem() {
  for (const tela of [[940, 800, 1], [390, 507, 3]]) {
    const v = await brasil({ tela }), T = T_DE(tela), W = tela[0] * tela[2], H = tela[1] * tela[2];
    const centros = [[60, 60], [340, 60], [60, 340], [340, 340], [200, 200], [150, 300], [300, 260]];
    const vistas = [2, 3, 4].flatMap(z => centros.map(([x, y]) => [z, x, y]));
    for (const [z, x, y] of vistas) {
      v.M.camera.zoomPara(z); v.rodar(40); centrar(v, x, y);
      for (const r of v.M.niveis.brasil.rotulos) {
        assert.ok(r.x >= 2 * T && r.y >= 2 * T && r.x + r.w <= W - 2 * T && r.y + r.h <= H - 2 * T, `${tela} ${z}x: ${r.id} colado na borda`);
      }
    }
  }
}

// a UF sob o cursor sai da mesma grade do contorno desenhado: a 2x em diante, a de 2x (um ponto de beira de Minas que na
// grade de 400 cai em Goiás e na de 800 cai em Minas é Minas)
async function ufNaGradeDoContorno() {
  const e = await brasil({ tela: [940, 800, 1] });
  const bh = cidade("belo-horizonte"), cam = e.M.camera;
  cam.zoomPara(4, ...cam.tela(bh.x, bh.y)); e.rodar(60); await carregar(e); e.rodar(3);
  const MP = e.contexto.window.MapaPerto, lista = MUNDO.niveis.brasil.ufs.lista;
  const m800 = MP.decodificar(UFS_PERTO.mapa, 800, 800, 27), m400 = MP.decodificar(MUNDO.niveis.brasil.ufs.mapa, 400, 400, 27);
  let alvo = null;   // um ponto à vista, longe das cidades, onde as duas grades discordam
  for (let y = 0; y < 800 && !alvo; y++) for (let x = 0; x < 800 && !alvo; x++) {
    const a = m800[y * 800 + x], b = m400[(y >> 1) * 400 + (x >> 1)];
    const [sx, sy] = cam.tela(x / 2 + 0.25, y / 2 + 0.25);
    if (a && b && a !== b && sx > 50 && sy > 50 && sx < 890 && sy < 750 && e.M.niveis.brasil.sobre(x / 2 + 0.25, y / 2 + 0.25) === null) {
      alvo = [x / 2 + 0.25, y / 2 + 0.25, a];
    }
  }
  assert.ok(alvo, "um ponto em que as grades discordam");
  e.M.niveis.brasil.sobre(alvo[0], alvo[1]);
  assert.equal(e.M.niveis.brasil.uf, lista[alvo[2] - 1].uf, "a UF da grade de 2x");
}

// os botões (Voltar, + e −) no canto de baixo à direita, como o arnês os põe: a caixa deles no canvas, com a folga
const botoes = ([w, h, d]) => [[236, 98], [130, 48], [72, 48]].map(([dx, bw]) => ({ x: (w - dx - 6) * d, y: (h - 52 - 6) * d,
  w: (bw + 12) * d, h: 52 * d }));
const T_DE = tela => Math.max(1, Math.round(tela[2]));
// dois nomes nunca se leem como um: entre eles, ao menos FOLGA·T de lado e T em cima e embaixo
function comFolga(a, b, T, F) { return !cruza({ x: a.x - F * T, y: a.y - T, w: a.w + 2 * F * T, h: a.h + 2 * T }, b); }

// o nome do oceano, a rosa e os nomes (capitais, estados, médias, vizinhos) nunca saem cortados nem caem sob os botões,
// em nenhum degrau, com a vista encostada no canto de baixo à direita (o mar, onde ficam os dois enfeites)
async function nadaSobOsBotoesNemCortado() {
  for (const tela of [[940, 800, 1], [390, 507, 3], [640, 400, 1]]) {
    const v = await brasil({ tela });
    const W = tela[0] * tela[2], H = tela[1] * tela[2], cobertos = botoes(tela), T = T_DE(tela), F = v.contexto.window.MapaPerto.FOLGA;
    for (const z of [1, 2, 3, 4]) for (const [x, y] of [[400, 400], [330, 300], [360, 250]]) {
      v.M.camera.zoomPara(z); v.rodar(40); centrar(v, x, y);
      const b = v.M.niveis.brasil, rotulo = `${tela} ${z}x (${x}, ${y})`;
      const caixas = [...Object.entries(b.enfeitesNaTela).filter(([, c]) => c).map(([id, c]) => ({ ...c, id })),
        ...b.nomes, ...b.rotulos.filter(r => r.tipo !== "marca")];
      for (const c of caixas) {
        assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H, `${rotulo}: ${c.id} cortado`);
        for (const o of cobertos) assert.ok(!cruza(c, o), `${rotulo}: ${c.id} sob os botões`);
      }
      const nomes = [...b.nomes, ...b.rotulos.filter(r => r.tipo !== "marca")];
      for (let i = 0; i < nomes.length; i++) for (let j = i + 1; j < nomes.length; j++) {
        assert.ok(comFolga(nomes[i], nomes[j], T, F), `${rotulo}: ${nomes[i].id} e ${nomes[j].id} sem respiro`);
      }
    }
  }
}

// o terceiro nível: nenhum azulejo de 4x antes do teto; no teto, só os da vista que existem (a máscara do mundo.json),
// desenhados por cima do de 2x quando chegam
async function terceiroNivel() {
  const p = await brasil({ tela: [940, 800, 1] });
  const quatro = () => azulejosPedidos(p).filter(u => u.startsWith("/mundo/perto4x/"));
  const bh = cidade("belo-horizonte"), mascara = MUNDO.niveis.brasil.perto4x.azulejos;
  for (const z of [1, 2, 3]) { p.M.camera.zoomPara(z, ...p.M.camera.tela(bh.x, bh.y)); p.rodar(60); }
  assert.deepEqual(quatro(), [], "até 3x, nenhum azulejo de 4x");
  p.M.camera.zoomPara(4, ...p.M.camera.tela(bh.x, bh.y)); p.rodar(2);
  const pedidos = quatro();
  assert.ok(pedidos.length > 0 && pedidos.length <= 12, "no caminho até 4x, só os da vista de chegada: " + pedidos.length);
  p.rodar(60); centrar(p, 395, 30);   // o canto de mar aberto: azulejos que não existem não são pedidos
  for (const u of quatro()) {
    const [i, j] = /(\d)-(\d)\.png/.exec(u).slice(1).map(Number);
    assert.equal(mascara[j * 8 + i], "1", u + " não existe e foi pedido");
  }
  centrar(p, bh.x, bh.y); await carregar(p); p.rodar(20);
  assert.ok(p.M.niveis.brasil.perto.niveis.perto4x.desenhados > 0, JSON.stringify(p.M.niveis.brasil.perto));
}

// o contorno do estado realçado segue a divisa do nível em uso: a 4x (grade de 2x, perto/ufs.json), cada traço claro fica
// dentro de Minas e cada traço escuro, fora; e toda beirada calculada separa um pixel da UF de um de fora
async function contornoNaDivisa() {
  const e = await brasil({ tela: [940, 800, 1] });
  const bh = cidade("belo-horizonte"), cam = e.M.camera;
  cam.zoomPara(4, ...cam.tela(bh.x, bh.y)); e.rodar(60); centrar(e, bh.x - 6, bh.y - 6);
  await carregar(e); e.rodar(5);
  assert.equal(e.M.niveis.brasil.grade, 800, "a grade de 2x chegou");
  const MP = e.contexto.window.MapaPerto, mg = MUNDO.niveis.brasil.ufs.lista.findIndex(u => u.uf === "MG") + 1;
  const mapa = MP.decodificar(UFS_PERTO.mapa, 800, 800, 27);
  for (const [vertical, x, y, n, lado] of MP.bordas(mapa, 800, 800, mg)) {   // a beirada separa dentro de fora
    for (let q = 0; q < n; q++) {
      const [ix, iy] = vertical ? [x, y + q] : [x + q, y], [fx, fy] = vertical ? [x - 1, y + q] : [x + q, y - 1];
      const den = (a, b) => a >= 0 && b >= 0 && a < 800 && b < 800 && mapa[b * 800 + a] === mg;
      assert.ok(den(ix, iy) !== den(fx, fy) && den(...(lado > 0 ? [ix, iy] : [fx, fy])), `beirada ${vertical} ${x},${y}`);
    }
  }
  // o realce desenhado: o cursor sobre Minas, um quadro gravando os retângulos
  const [sx, sy] = cam.tela(bh.x - 14, bh.y - 10);
  e.canvas.disparar("pointermove", { pointerId: 9, clientX: sx, clientY: sy, button: 0 });
  e.contexto.retangulos = []; e.rodar(1);
  assert.equal(e.M.niveis.brasil.uf, "MG");
  const den = (px, py) => { const [mx, my] = cam.mundo(px, py), a = Math.floor(mx * 2), b = Math.floor(my * 2);
    return a >= 0 && b >= 0 && a < 800 && b < 800 && mapa[b * 800 + a] === mg; };
  const claros = e.contexto.retangulos.filter(r => r[4] === "#fff4dc" && Math.min(r[2], r[3]) === 2 && Math.max(r[2], r[3]) >= 4);
  const escuros = e.contexto.retangulos.filter(r => r[4] === "rgba(18,14,22,.8)");
  assert.ok(claros.length > 20 && escuros.length > 20, `${claros.length} claros, ${escuros.length} escuros`);
  for (const [x, y, w, h] of claros) assert.ok(den(x + w / 2, y + h / 2), `traço claro fora de Minas em ${x},${y}`);
  for (const [x, y, w, h] of escuros) assert.ok(!den(x + w / 2, y + h / 2), `traço escuro dentro de Minas em ${x},${y}`);
}

// duas linhas guia que se cruzam (o ícone de A do lado do ponto de B, e o de B do lado do de A): descruzar troca os dois
// de lugar e elas deixam de se cruzar
function descruzarSintetico(MundoMapa) {
  const a = { id: "a", ax: 0, ay: 0, px: 40, py: 30, dentro: true }, b = { id: "b", ax: 40, ay: 0, px: 0, py: 30, dentro: true };
  assert.ok(MundoMapa.cortam(a, b), "o caso se cruza");
  MundoMapa.descruzar([a, b]);
  assert.ok(!MundoMapa.cortam(a, b), "depois da troca, não");
  assert.deepEqual([a.px, a.py, b.px, b.py], [0, 30, 40, 30]);
  const c = { ...a, dentro: false, px: 40, py: 30 }, d = { ...b, px: 0, py: 30 };   // quem tem o ponto fora da tela não troca
  MundoMapa.descruzar([c, d]);
  assert.deepEqual([c.px, d.px], [40, 0]);
}

// o azulejo que falha volta a ser pedido sozinho, depois da espera, sem sair do mapa
async function azulejoQueFalhaVoltaSozinho() {
  const f = await abrir("#brasil", { passo: 250, tela: [940, 800, 1] });
  await carregar(f);
  const bh = cidade("belo-horizonte");
  f.M.camera.zoomPara(2, ...f.M.camera.tela(bh.x, bh.y)); f.rodar(12);
  const antes = azulejosPedidos(f).length;
  assert.ok(antes > 0);
  for (const img of f.contexto.imagens) if (String(img.src).includes("/mundo/perto/")) img.falhar();
  f.rodar(20);
  assert.equal(azulejosPedidos(f).length, antes, "não pede de novo na hora");
  f.rodar(40);   // 10 s de relógio
  assert.ok(azulejosPedidos(f).length >= 2 * antes, "depois da espera, pede de novo: " + azulejosPedidos(f).length);
}

const azulejosPedidos = m => (m.contexto.imagens || []).map(i => String(i.src || "")).filter(s => /^\/mundo\/perto(4x)?\//.test(s));
const centrar = (m, x, y) => { m.M.camera.x = x; m.M.camera.y = y; m.M.camera.limitar(); m.rodar(3); };

// a camada de perto: nenhum azulejo a 1x; a partir de 2x, só os da vista (com versão), e desenhados quando chegam. Os
// nomes dos estados entram a 2x e as cidades médias a 3x, sem cobrir um ao outro, os nomes das capitais nem os ícones
async function niveisDeDetalhe() {
  const p = await brasil({ tela: [940, 800, 1] });   // a tela do desktop (o arnês de 640x400 aperta tudo a 2x)
  p.rodar(30);
  assert.deepEqual(azulejosPedidos(p), [], "a 1x, nenhum azulejo pedido");
  assert.ok(!p.M.niveis.brasil.rotulos.some(r => r.tipo === "estado" || r.tipo === "media"), "a 1x, sem estados nem médias");
  const bh = cidade("belo-horizonte");
  p.M.camera.zoomPara(4, ...p.M.camera.tela(bh.x, bh.y)); p.rodar(2);   // o pedido sai assim que o zoom pedido passa de 2x,
  const pedidos = azulejosPedidos(p).filter(u => u.startsWith("/mundo/perto/"));   // só os da vista de chegada
  assert.ok(pedidos.length > 0 && pedidos.length <= 9, "azulejos pedidos: " + pedidos.length);
  assert.ok(pedidos.every(u => /^\/mundo\/perto\/[0-3]-[0-3]\.png\?v=\d+$/.test(u)), pedidos.join());
  p.M.camera.zoomPara(2); p.rodar(80); centrar(p, bh.x, bh.y);
  await carregar(p); p.rodar(30);
  const b = p.M.niveis.brasil;
  assert.ok(b.perto.desenhados > 0, "os azulejos à vista são desenhados: " + JSON.stringify(b.perto));
  assert.ok(new Set(azulejosPedidos(p)).size === azulejosPedidos(p).length, "cada azulejo pedido uma vez");
  const semColisao = (m, rotulo) => {
    const b = m.M.niveis.brasil, todos = [...b.rotulos, ...b.nomes.map(n => ({ ...n, tipo: "capital" }))];
    for (let i = 0; i < todos.length; i++) for (let j = i + 1; j < todos.length; j++) {
      assert.ok(!cruza(todos[i], todos[j]), `${rotulo}: ${todos[i].tipo} ${todos[i].id} cobre ${todos[j].tipo} ${todos[j].id}`);
    }
    for (const r of b.rotulos) for (const c of b.caixas) assert.ok(!cruza(r, c), `${rotulo}: ${r.tipo} ${r.id} cobre o ícone de ${c.id}`);
  };
  const estados2 = b.rotulos.filter(r => r.tipo === "estado");
  assert.ok(estados2.some(r => r.id === "MG"), "a 2x, o nome de Minas: " + estados2.map(r => r.id));
  assert.ok(!b.rotulos.some(r => r.tipo === "media"), "a 2x, ainda sem as cidades médias");
  semColisao(p, "2x");
  p.M.camera.zoomPara(3); p.rodar(80); centrar(p, bh.x, bh.y - 20);
  const medias = p.M.niveis.brasil.rotulos.filter(r => r.tipo === "media");
  assert.ok(medias.length >= 2, "a 3x, cidades médias à vista: " + medias.map(r => r.id));
  semColisao(p, "3x");
}

// a casa real (Mateus Leme) colada em Belo Horizonte: a 1x, nas três telas, a caixa da casa (chalé, bandeira e o halo
// no maior tamanho) não cobre a de BH; a bandeira e o halo ficam dentro da caixa da casa
async function casaEmMateusLeme() {
  for (const tela of [[640, 400, 1], [940, 800, 1], [390, 507, 3]]) {
    const v = await brasil({ tela, clima: { ...CLIMA, casa: "mateus-leme" } });
    v.rodar(3);
    const caixas = v.M.niveis.brasil.caixas, ml = caixas.find(c => c.id === "mateus-leme"), bh = caixas.find(c => c.id === "belo-horizonte");
    assert.ok(ml.bandeira && ml.halo, `${tela}: a casa traz a bandeira e o halo`);
    for (const r of [ml.bandeira, ml.halo]) {
      assert.ok(r.x >= ml.x && r.y >= ml.y && r.x + r.w <= ml.x + ml.w && r.y + r.h <= ml.y + ml.h, `${tela}: dentro da caixa da casa`);
    }
    assert.ok(!cruza(ml, bh), `${tela}: a casa cobre BH`);
    for (let i = 0; i < caixas.length; i++) for (let j = i + 1; j < caixas.length; j++) {
      assert.ok(!cruza(caixas[i], caixas[j]), `${tela}: ${caixas[i].id} e ${caixas[j].id} se cobrem`);
    }
  }
}

// os estados: o cursor sobre uma UF (longe das cidades) a realça e põe nome e capital no status; o clique nela anuncia
// sem sair do mapa; o clique numa cidade continua descendo a ela; o foco de teclado numa cidade diz o estado dela
async function estados() {
  const ufs = MUNDO.niveis.brasil.ufs, letras = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const mapa = ufs.mapa.map(l => {
    const o = [];
    for (const [, c, n] of l.matchAll(/([.a-zA-Z])(\d+)/g)) for (let i = 0; i < +n; i++) o.push(c);
    return o;
  });
  const e = await brasil();
  e.rodar(3);
  const cam = e.M.camera, b = e.M.niveis.brasil, mg = letras[ufs.lista.findIndex(u => u.uf === "MG")];
  let alvo = null;   // um pixel de Minas a mais de 6 px de tela da caixa de todo ícone (o alvo do clique fica dentro dela)
  for (let y = 0; y < 400 && !alvo; y += 2) for (let x = 0; x < 400 && !alvo; x += 2) {
    if (mapa[y][x] !== mg) continue;
    const [sx, sy] = cam.tela(x + 0.5, y + 0.5);
    if (b.caixas.every(c => sx < c.x - 6 || sx > c.x + c.w + 6 || sy < c.y - 6 || sy > c.y + c.h + 6)) alvo = [sx, sy];
  }
  assert.ok(alvo, "um ponto de Minas longe das cidades");
  e.canvas.disparar("pointermove", { pointerId: 9, clientX: alvo[0], clientY: alvo[1], button: 0 });
  e.rodar(2);
  assert.equal(b.uf, "MG", "o cursor realça Minas");
  assert.match(e.elementos["mundo-estado"].textContent, /Minas Gerais.*Belo Horizonte/, "status com o estado e a capital");
  e.canvas.disparar("pointerleave", {}); e.rodar(2);
  assert.equal(b.uf, null, "fora do mapa, sem realce");
  assert.doesNotMatch(e.elementos["mundo-estado"].textContent, /Minas Gerais/);
  e.clicar(...alvo); e.rodar(20);
  assert.equal(e.M.nivel, "brasil", "o clique no estado não sai do mapa");
  assert.match(e.elementos["mundo-estado"].textContent, /Minas Gerais/);
  assert.equal(b.uf, "MG", "o toque deixa o estado realçado");
  const cb = b.caixas.find(c => c.id === "belo-horizonte");
  e.clicar(cb.x + cb.w / 2, cb.y + cb.h - 10); e.rodar(20);
  assert.equal(e.contexto.location.hash, "#cidade=belo-horizonte", "o estado não rouba o clique da cidade");
  // teclado: o foco numa cidade põe o estado dela no status (os estados não entram no Tab: um botão por cidade)
  const t = await brasil();
  t.rodar(3);
  const botoes = t.elementos["mundo-alvos"].filhos, i = MUNDO.cidades.findIndex(c => c.id === "recife");
  assert.equal(botoes.length, MUNDO.cidades.length, "só as cidades no Tab");
  botoes[i].disparar("focus"); t.rodar(2);
  assert.match(t.elementos["mundo-estado"].textContent, /Recife.*Pernambuco/);
  assert.equal(t.M.niveis.brasil.uf, "PE", "o foco realça o estado da cidade");
  botoes[i].disparar("blur"); t.rodar(2);
  assert.doesNotMatch(t.elementos["mundo-estado"].textContent, /Pernambuco/);
}

// o arranjo: a cidade com o ponto real fora da tela não é presa na borda (a 2x em Salvador, Aracaju e Maceió ficam no
// ponto delas, fora da vista); no celular a 1x, as linhas guia não se cruzam; os botões de Tab acompanham o ícone quando
// o atlas chega depois do clima
async function arranjoSemPuxarNemCruzar() {
  for (const [tela, id] of [[[640, 400, 1], "salvador"], [[940, 800, 1], "salvador"], [[940, 800, 1], "brasilia"]]) {
    const s = await brasil({ tela });
    s.rodar(2);
    const sa = cidade(id);
    s.M.camera.zoomPara(3); s.rodar(80); centrar(s, sa.x, sa.y);
    const W = tela[0] * tela[2], H = tela[1] * tela[2], cs = s.M.niveis.brasil.caixas;
    const fora = cs.filter(c => c.ax < 0 || c.ay < 0 || c.ax >= W || c.ay >= H);
    assert.ok(fora.length > 0, `${tela} ${id}: há cidades à beira, com o ponto fora da tela`);
    for (const c of fora) assert.ok(c.px === c.ax && c.py === c.ay, `${tela} ${id}: ${c.id} fora da tela e puxada para a borda`);
  }
  const chuva = { cidades: Object.fromEntries(MUNDO.cidades.map(c => [c.id, { tipo: "chuva", vento: 0, noite: false }])),
    casa: "mateus-leme", versao: 1 };
  const corta = ([a, b, c, d], [e, f, g, h]) => {   // os segmentos (a,b)-(c,d) e (e,f)-(g,h) se cruzam (não só se tocam)
    const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    return o(a, b, c, d, e, f) * o(a, b, c, d, g, h) < 0 && o(e, f, g, h, a, b) * o(e, f, g, h, c, d) < 0;
  };
  for (const tela of [[390, 507, 3], [390, 760, 3], [940, 800, 1]]) {
    const v = await brasil({ tela, clima: chuva });
    v.rodar(3);
    const guias = v.M.niveis.brasil.guias;
    for (let i = 0; i < guias.length; i++) for (let j = i + 1; j < guias.length; j++) {
      assert.ok(!corta(guias[i].s, guias[j].s), `${tela}: as linhas de ${guias[i].id} e ${guias[j].id} se cruzam`);
    }
  }
  // o atlas chega depois do clima: os botões se refazem no lugar novo do ícone
  const a = await abrir("#brasil", { passo: 50 });
  a.rodar(3);
  await carregar(a);
  a.rodar(3);
  const cam = a.M.camera, alvos = a.M.niveis.brasil.alvos();
  a.elementos["mundo-alvos"].filhos.forEach((b, i) => {
    const [x, y] = cam.tela(alvos[i].x, alvos[i].y);
    assert.equal(b.style.transform, `translate(${x}px, ${y - alvos[i].alto / 2}px)`, alvos[i].id);
  });
}
principal().catch(e => { console.error(e); process.exitCode = 1; });
