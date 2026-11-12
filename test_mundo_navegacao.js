"use strict";
// Mundo público em níveis (Globo → Brasil → Cidade → Bairro): fragmento inválido, Esc, clique numa cidade, câmera presa à
// caixa, aba escondida, movimento reduzido e clima vazio. O mesmo arnês de VM do test_visita_mundo.js, com os scripts da página.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const MUNDO = JSON.parse(fs.readFileSync("static/mundo/mundo.json", "utf8"));
const ATLAS = JSON.parse(fs.readFileSync("static/mundo/atlas.json", "utf8"));
const UFS_PERTO = JSON.parse(fs.readFileSync("static/mundo/perto/ufs.json", "utf8"));
const CLIMA = { cidades: { recife: { tipo: "chuva", vento: 0.3, noite: false } }, casa: "mateus-leme", versao: MUNDO.versao };

const COMPILADOS = new Map();

function elemento() {
  const el = {
    ouvintes: {}, style: {}, dataset: {}, hidden: false, textContent: "", filhos: [], disabled: false,
    addEventListener(t, f) { (el.ouvintes[t] ||= []).push(f); },
    disparar(t, ev = {}) { for (const f of el.ouvintes[t] || []) f({ preventDefault() {}, stopPropagation() {}, target: el, ...ev }); },
    setAttribute(k, v) { el[k] = String(v); }, removeAttribute(k) { delete el[k]; },
    appendChild(c) { el.filhos.push(c); return c; }, replaceChildren(...c) { el.filhos = c; },
    contains: () => false, focus() {}, setPointerCapture() {}, releasePointerCapture() {},
    classList: { add() {}, remove() {}, toggle() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 400 }),
  };
  return el;
}

// Opções: clima (a resposta da rota), climaFalha (a rota cai), climaPendente (a resposta nunca chega), reduzido, tela
// [w, h, dpr], atlas, som, busca (location.search, como "?data=2026-12-25"), escuro (a noite do Ceu, de 0 a 1), opaco
// (getImageData devolve pixels opacos: o contorno dos telhados), passo (ms de relógio por quadro; o dt vai até 0,25 s) e
// globoFalha (Globo.criar lança erro) e fontePendente (document.fonts.load nunca termina). O globo é sempre o de verdade: o
// campo de nuvens só é montado quando ele desenha
async function abrir(hash, { clima = CLIMA, reduzido = false, climaFalha = false, climaPendente = false, tela = [640, 400, 1],
  atlas = ATLAS, som = null, busca = "", escuro = 0, opaco = false, passo = 16, globoFalha = false, fontePendente = false } = {}) {
  const quadros = [], requisicoes = [], intervalos = [], tamanho = [...tela];
  // putImageData conta as passadas pixel a pixel do globo; getImageData dá pixels zerados (ou opacos) quando o teste faz uma
  // imagem carregar. drawImage guarda o recorte de origem [sx, sy, sw, sh] quando o teste liga contexto.gravar (um array);
  // fillRect guarda a cor de cada retângulo quando o teste liga contexto.cores (um Set) e o retângulo com a cor quando liga
  // contexto.retangulos (um array); os gradientes são contados
  // (as funções do pincel são feitas uma vez: o Proxy só as devolve, sem montar nada a cada chamada)
  const pincel = {}, nada = () => {}, gradiente = () => { contexto.gradientes = (contexto.gradientes || 0) + 1; return { addColorStop() {} }; };
  const metodos = { createLinearGradient: gradiente, createRadialGradient: gradiente, getTransform: () => ({ a: 1 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(opaco ? 255 : 0) }),
    putImageData: () => { contexto.passadas = (contexto.passadas || 0) + 1; },
    fillRect: (...r) => {
      if (contexto.cores) contexto.cores.add(String(pincel.fillStyle).toLowerCase());
      if (contexto.retangulos) contexto.retangulos.push([...r, String(pincel.fillStyle)]);
    },
    drawImage: (img, ...a) => { if (contexto.gravar) contexto.gravar.push(a.slice(0, 4)); } };
  // os métodos e os valores (fillStyle...) moram no próprio pincel; só o que ele não tem cai no Proxy do protótipo (nada)
  Object.assign(pincel, metodos);
  Object.setPrototypeOf(pincel, new Proxy({}, { get: (o, k) => (typeof k === "string" ? nada : undefined) }));
  const ctx = pincel;
  const canvas = elemento(); canvas.getContext = () => ctx;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: tamanho[0], height: tamanho[1] });
  const ids = ["mundo", "entrar", "mundo-estado", "mundo-alvos", "mundo-dica", "mundo-voltar", "mundo-mais", "mundo-menos"];
  const elementos = Object.fromEntries(ids.map(id => [id, id === "mundo" ? canvas : elemento()]));
  // os botões no canto de baixo à direita do canvas, como na página (Voltar, + e −)
  const botao = (dx, w) => () => ({ left: tamanho[0] - dx, top: tamanho[1] - 52, width: w, height: 40 });
  elementos["mundo-voltar"].getBoundingClientRect = botao(236, 98);
  elementos["mundo-mais"].getBoundingClientRect = botao(130, 48);
  elementos["mundo-menos"].getBoundingClientRect = botao(72, 48);
  const janela = elemento();
  janela.devicePixelRatio = tela[2];
  janela.matchMedia = q => ({ matches: reduzido && q === "(prefers-reduced-motion: reduce)", addEventListener() {} });
  const documento = elemento();
  documento.hidden = false;
  documento.getElementById = id => elementos[id];
  documento.createElement = () => { const e = elemento(); e.getContext = () => ctx; return e; };
  if (fontePendente) documento.fonts = { load: () => new Promise(() => {}) };
  const contexto = {
    window: janela, document: documento, location: { hash, pathname: "/mundo.html", search: busca, href: "" },
    history: {
      replaceState(_, __, url) { contexto.endereco = url; const i = url.indexOf("#"); contexto.location.hash = i < 0 ? "" : url.slice(i); },
      pushState(_, __, url) { this.replaceState(_, __, url); },
    },
    performance: { now: () => 0 }, requestAnimationFrame: f => quadros.push(f),
    console: { error: (...a) => (contexto.erros ||= []).push(a.map(String).join(" ")), warn() {}, log() {} },
    setInterval(f, ms) { intervalos.push(ms); }, clearInterval() {}, setTimeout, Math, Promise, JSON, URLSearchParams,
    // as imagens só carregam (ou falham) quando o teste pede (carregar, falhar)
    Image: class {
      constructor() { this.complete = false; this.naturalWidth = 0; this.ouvintes = {}; (contexto.imagens ||= []).push(this); }
      addEventListener(t, f) { (this.ouvintes[t] ||= []).push(f); }
      carregar() { this.width = 512; this.height = 2048; for (const f of this.ouvintes.load || []) f(); }   // o tamanho do atlas
      falhar() { for (const f of this.ouvintes.error || []) f(); }
    },
    Som: som,
    Ceu: { agora: () => ({ h: escuro > 0.5 ? 22 : 12, cima: "#3d95ee", baixo: "#a9d8ff", escuro, hora: escuro > 0.5 ? "22:00" : "12:00" }) },
    // desenhar conta as chamadas: as partículas de chuva e neve e o clarão do raio só saem do Clima.desenhar
    Clima: { definir(c) { contexto.clima = c; }, tipo: () => (contexto.clima && contexto.clima.tipo) || "limpo", texto: () => "céu limpo",
             desenhar() { contexto.desenhos = (contexto.desenhos || 0) + 1; }, balanco: () => 0 },
    fetch: async (url, opcoes) => {
      requisicoes.push([url, opcoes]);
      if (url.startsWith("/mundo/mundo.json")) return { ok: true, json: async () => JSON.parse(JSON.stringify(MUNDO)) };
      if (url.startsWith("/mundo/atlas.json")) return { ok: true, json: async () => JSON.parse(JSON.stringify(atlas)) };
      if (url.startsWith("/mundo/perto/ufs.json")) return { ok: true, json: async () => JSON.parse(JSON.stringify(UFS_PERTO)) };
      if (climaFalha) throw new Error("rede");
      if (climaPendente) return new Promise(() => {});
      return { ok: true, json: async () => clima };
    },
  };
  vm.createContext(contexto);
  // o Math numa ligação léxica da VM: os scripts o acham sem passar pelo objeto global contextualizado (lento a cada busca)
  vm.runInContext("const Math = globalThis.Math;", contexto);
  contexto.window.Som = som;
  const scripts = ["static/festas.js", "static/avatar.js", "static/mundo_bairro.js", "static/mundo_mapa_arte.js", "static/mundo_mapa_perto.js",
    "static/mundo_mapa.js",
    "static/mundo_globo.js", "static/mundo_cidade_planta.js", "static/mundo_festa.js",
    "static/mundo_cidade_chao.js", "static/mundo_cidade_letreiro.js", "static/mundo_cidade.js", "static/mundo.js"];
  for (const f of scripts) {   // cada script compilado uma vez para o arquivo todo (as páginas abertas o reaproveitam)
    if (!COMPILADOS.has(f)) COMPILADOS.set(f, new vm.Script(fs.readFileSync(f, "utf8"), { filename: f }));
    COMPILADOS.get(f).runInContext(contexto);
  }
  if (globoFalha) vm.runInContext("Globo.criar = () => { throw new Error('globo quebrado'); };", contexto);
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));   // mundo.json e clima chegam
  let relogio = 0;
  const rodar = (n = 1) => { for (let i = 0; i < n; i++) { const f = quadros.shift(); if (!f) return; relogio += passo; f(relogio); } };
  const redimensionar = (w, h) => { tamanho[0] = w; tamanho[1] = h; janela.disparar("resize"); };
  const M = contexto.window.Mundo;
  const ponteiro = (tipo, x, y) => canvas.disparar(tipo, { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true });
  const clicar = (x, y) => { ponteiro("pointerdown", x, y); ponteiro("pointerup", x, y); };
  const arrastar = (dx, dy) => { ponteiro("pointerdown", 320, 200); ponteiro("pointermove", 320 + dx / 2, 200 + dy / 2); ponteiro("pointermove", 320 + dx, 200 + dy); ponteiro("pointerup", 320 + dx, 200 + dy); };
  const tecla = key => janela.disparar("keydown", { key, target: documento });
  rodar(2);
  const toque = (tipo, id, x, y) => canvas.disparar(tipo, { pointerId: id, clientX: x, clientY: y, button: 0 });
  return { contexto, M, canvas, elementos, documento, quadros, requisicoes, intervalos, rodar, clicar, arrastar, tecla, toque,
           redimensionar };
}
const espera = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const carregar = async m => { await espera(); for (const img of m.contexto.imagens || []) img.carregar(); m.rodar(2); };

const cidade = id => MUNDO.cidades.find(c => c.id === id);
const NOITE_TODAS = { ...CLIMA, cidades: Object.fromEntries(MUNDO.cidades.map(c => [c.id, { tipo: "limpo", vento: 0, noite: true }])) };

async function principal() {
  // fragmento inválido cai no Brasil; o convite sai da barra na hora e segue só pela porta do chalé
  const x = await abrir("#cidade=xyz");
  assert.equal(x.M.nivel, "brasil");
  assert.equal(x.contexto.location.hash, "#brasil");
  const convite = "a".repeat(43);
  const c = await abrir("#" + convite);
  assert.equal(c.M.nivel, "brasil", "convite colado não é nível: abre no Brasil");
  assert.ok(!c.contexto.endereco.includes(convite), "o convite sai da barra de endereço");
  c.M.ir("bairro"); c.rodar(40);
  assert.equal(c.M.nivel, "bairro");
  const B = c.contexto.window.MundoBairro, p = B.porta(B.CHALES.find(h => !h.vizinho));
  c.clicar(2, 2); c.rodar();
  assert.equal(c.contexto.location.href, "", "clicar no céu não entra");
  c.clicar(...c.M.camera.tela(p.x + p.w / 2, p.y + p.h / 2)); c.rodar();
  assert.equal(c.contexto.location.href, "/visita.html#" + convite, "a porta leva à visita com o convite");
  const sem = await abrir("#nao-e-convite");
  sem.elementos.entrar.disparar("click");
  assert.equal(sem.contexto.location.href, "/visita.html", "fragmento inválido não é repassado");

  // só o mapa (com o atlas das miniaturas) e o clima do mundo são pedidos, sem cookie e com o corpo vazio; o clima de novo
  // a cada 15 min
  assert.deepEqual(c.requisicoes.map(([u]) => u.split("?")[0]), ["/mundo/mundo.json", "/mundo/atlas.json", "/api/mundo/clima"]);
  assert.ok(c.requisicoes.every(([, o]) => o && o.credentials === "omit"));
  const [, op] = c.requisicoes[2];
  assert.equal(op.method, "POST"); assert.equal(op.credentials, "omit"); assert.equal(op.body, "{}");
  assert.ok(c.intervalos.includes(15 * 60 * 1000));

  // Esc no bairro sobe para a cidade; Esc na cidade sobe para o Brasil. O bairro usa o tempo da cidade (a casa).
  // (aqui os quadros são de 100 ms: cada troca de nível, 0,48 s de cortina, cabe em 12 quadros)
  const e = await abrir("#cidade=recife", { clima: { ...CLIMA, casa: "recife" }, passo: 100 });
  assert.equal(e.M.nivel, "cidade");
  e.M.ir("bairro"); e.rodar(12);
  assert.equal(e.contexto.location.hash, "#bairro");
  assert.equal(JSON.stringify(e.contexto.clima), '{"tipo":"chuva","vento":15}', "o bairro de Recife chove como Recife");
  e.tecla("Escape"); e.rodar(12);
  assert.equal(e.M.nivel, "cidade"); assert.equal(e.contexto.location.hash, "#cidade=recife");
  e.tecla("Escape"); e.rodar(12);
  assert.equal(e.M.nivel, "brasil"); assert.equal(e.contexto.location.hash, "#brasil");
  e.elementos["mundo-voltar"].disparar("click"); e.rodar(12);
  assert.equal(e.M.nivel, "globo", "Voltar no Brasil sobe para o globo"); assert.equal(e.contexto.location.hash, "#globo");
  assert.equal(e.elementos["mundo-voltar"].disabled, true, "o globo é o topo: Voltar desabilitado");
  e.tecla("Escape"); e.rodar(12);
  assert.equal(e.M.nivel, "globo", "Esc no globo não sai dele");

  // sem fragmento, abre no globo (e #globo também vale); um clique no espaço não faz nada, um clique no Brasil desce
  const g = await abrir("", { passo: 100 }), G = g.contexto.window.Globo;
  assert.equal(g.M.nivel, "globo"); assert.equal(g.contexto.location.hash, "#globo");
  assert.equal(g.elementos["mundo-voltar"].disabled, true);
  assert.equal(g.elementos["mundo-menos"].disabled, true, "o − não faz nada no globo: desabilitado");
  assert.equal((await abrir("#globo")).M.nivel, "globo");
  g.clicar(3, 3); g.rodar(12);
  assert.equal(g.M.nivel, "globo", "clique no espaço");
  // o alvo do clique são as células do Brasil no mundo.json (sem esperar imagem nenhuma): a Bolívia, dentro da caixa
  // do mapa, não desce
  const gb = await abrir("", { reduzido: true, passo: 100 }), bolivia = G.projetar(-17.5, -64, -50, -15, G.R);
  gb.clicar(...gb.M.camera.tela(bolivia.x, bolivia.y)); gb.rodar(12);
  assert.equal(gb.M.nivel, "globo", "clique na Bolívia");
  g.clicar(...g.M.camera.tela(G.B / 2, G.B / 2)); g.rodar(12);
  assert.equal(g.M.nivel, "brasil", "clique no Brasil"); assert.equal(g.contexto.location.hash, "#brasil");
  assert.equal(g.elementos["mundo-menos"].disabled, false, "no Brasil o − afasta");
  g.tecla("Escape"); g.rodar(12);
  assert.equal(g.M.nivel, "globo", "Esc no Brasil volta ao globo"); assert.equal(g.contexto.location.hash, "#globo");
  // o globo que falha ao abrir não derruba o mapa: a página abre no Brasil, sem Voltar, e as cidades seguem
  const gf = await abrir("", { globoFalha: true, passo: 100 });
  assert.equal(gf.M.nivel, "brasil"); assert.equal(gf.contexto.location.hash, "#brasil");
  assert.equal(gf.elementos["mundo-voltar"].disabled, true, "sem globo, nada acima do Brasil");
  assert.ok((gf.contexto.erros || []).some(e => e.includes("globo quebrado")), "a falha do globo fica no console");
  gf.tecla("Escape"); gf.rodar(12);
  assert.equal(gf.M.nivel, "brasil", "Esc no Brasil sem globo fica");
  const mg = cidade("manaus");
  gf.clicar(...gf.M.camera.tela(mg.x, mg.y)); gf.rodar(12);
  assert.equal(gf.M.nivel, "cidade", "sem globo, o clique numa cidade ainda desce");
  // o + no globo com o Brasil escondido: o globo gira até ele e então desce
  const gz = await abrir("", { passo: 100 });
  for (let i = 0; i < 3; i++) { gz.arrastar(-150, 0); gz.rodar(); }
  const lon = gz.M.niveis.globo.rotacao.lon;
  assert.ok(Math.abs((((lon + 50) % 360) + 540) % 360 - 180) > 60, "o arraste levou o Brasil para longe: " + lon);
  gz.elementos["mundo-mais"].disparar("click"); gz.rodar(3);
  assert.equal(gz.M.nivel, "globo", "ainda girando até o Brasil");
  gz.rodar(40);
  assert.equal(gz.M.nivel, "brasil", "o + leva ao Brasil");

  // um clique numa cidade leva a #cidade=<id>; no mar, nada
  const k = await abrir("#brasil", { passo: 100 });
  k.clicar(5, 395); k.rodar(12);
  assert.equal(k.M.nivel, "brasil");
  const manaus = cidade("manaus");
  k.clicar(...k.M.camera.tela(manaus.x, manaus.y)); k.rodar(12);
  assert.equal(k.M.nivel, "cidade"); assert.equal(k.contexto.location.hash, "#cidade=manaus");
  k.clicar(320, 200); k.rodar(12);
  assert.equal(k.M.nivel, "cidade", "Manaus não é a casa: o clique na cidade não desce ao bairro");

  // nível Cidade: a planta sai da semente do id e dos dados da cidade, nas 28 cidades (sempre a mesma para o mesmo id)
  const Cid = k.contexto.window.MundoCidade, CP = k.contexto.window.CidadePlanta;
  const plantaDe = id => Cid.planta(id, cidade(id)), planta = id => JSON.stringify(plantaDe(id));
  assert.equal(planta("recife"), planta("recife"), "a mesma cidade, a mesma planta");
  assert.notEqual(planta("recife"), planta("manaus"));
  const BORDA = CP.E / 2 + CP.C;   // do eixo da rua ao fim da calçada
  const cruza = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const naCaixa = s => s.x > -20 && s.x < CP.W + 20 && s.y > -20 && s.y < CP.H + 70;   // o que aparece a 1x (o pé até 70 abaixo)
  const predios = {}, totais = {}, frota = new Set(), arranjos = new Set(), parques = new Set(), esportes = new Set(), centros = new Set();
  // as cidades cujo marco já é uma igreja não ganham outra igreja (a predios-9)
  const IGREJAS = new Set(["matriz-mateus-leme", "catedral-fortaleza", "igreja-rosario", "pampulha", "convento-penha", "pelourinho"]);
  for (const cc of MUNDO.cidades) {
    const p = plantaDe(cc.id), id = cc.id, itens = [p.centro, p.casa, ...p.pecas], de = re => itens.filter(s => re.test(s.peca));
    assert.equal(planta(id), JSON.stringify(p), `${id}: determinística`);
    assert.equal(p.porte, cc.porte, id);
    // as zonas: o marco no centro, o parque com a praça (fonte ou lago) e o coreto ou a feira, o esporte com o campo e a
    // quadra ou o parquinho, e as casas (casas e chalés, cada uma num lote cercado)
    assert.ok(p.zonas.centro.centro && p.zonas.parque.anel === 1 && p.zonas.esporte.anel === 1, id);
    assert.ok(/^(praca-1|lazer-3)$/.test(p.praca.peca) && p.praca.zona === "parque", `${id}: ${p.praca.peca}`);
    const zona = (z, re) => itens.filter(s => s.zona === z && re.test(s.peca));
    assert.equal(zona("parque", /^lazer-[45]$/).length, 1, `${id}: coreto ou feira no parque`);
    assert.equal(zona("esporte", /^lazer-1$/).length, 1, `${id}: o campo`);
    assert.ok(zona("esporte", /^lazer-[26]$/).length >= 1, `${id}: quadra ou parquinho`);
    assert.ok(de(/^lazer-5$/).length >= 1, `${id}: a feira`);
    assert.ok(de(/^rua-4$/).length === 1 && cruza(p.sorvete.r, [p.zonas.parque.x0, p.zonas.parque.y0, p.zonas.parque.x1, p.zonas.parque.y1]),
      `${id}: o caminhão de sorvete parado no parque`);
    const casas = itens.filter(s => s.zona === "casas" && /^(casa-[1-6]|chale-[1-8])$/.test(s.peca));
    assert.ok(casas.length >= 10 && p.cercas.length >= casas.length, `${id}: ${casas.length} casas`);
    for (const c of p.cercas) assert.ok(c.tipo === "sebe" || c.tipo === "cerca", id);
    const MOBILIA = /^(banca-1|ponto-onibus-1|banco-poste-1|carrinho-1|rua-[123])$/;
    const CONHECIDA = /^(predios-([1-9]|1[0-4])|casa-[1-6]|chale-[1-8]|arvore-[1-7]|canteiro-[12]|lazer-[1-6]|praia-[1-4]|praca-1|rua-4)$/;
    assert.ok(itens.every(s => CONHECIDA.test(s.peca) || MOBILIA.test(s.peca)), `${id}: peça desconhecida`);
    assert.ok(de(MOBILIA).filter(naCaixa).length >= (cc.litoral ? 1 : 2), `${id}: mobiliário à vista`);
    predios[id] = de(/^predios-/).filter(naCaixa).length; totais[id] = de(/^predios-/).length;
    // litoral: a orla depois da avenida da praia, com as peças da praia e coqueiros na areia, nenhuma quadra nem rua no
    // mar e carros só nas ruas verticais; sem litoral, nada disso
    const praia = de(/^praia-/);
    if (cc.litoral) {
      assert.ok(p.orla && p.orla.x === p.ruas.v[p.ruas.v.length - 1] + CP.E / 2 && p.orla.x < CP.W - 120, `${id}: a orla à vista`);
      const naAreia = praia.filter(s => s.peca !== "praia-4"), piers = praia.filter(s => s.peca === "praia-4");
      assert.ok(naAreia.filter(naCaixa).length >= 2 && naAreia.every(s => s.x > p.orla.areia && s.x < p.orla.mar), `${id}: praia`);
      // o píer sai da beira e entra no mar: o pé dele na linha d'água e a vaga atravessando a beira
      assert.ok(piers.length >= 1 && piers.every(s => Math.abs(s.x - p.orla.mar - 8) <= 6 && s.r[0] < p.orla.mar - 4 && s.r[2] > p.orla.mar + 14),
        `${id}: píer na beira: ${piers.map(s => s.x)} / ${p.orla.mar}`);
      assert.ok(new Set(praia.map(s => s.peca)).size >= 3, `${id}: peças de praia variadas`);
      assert.ok(itens.some(s => s.zona === "orla" && /^arvore-[37]$/.test(s.peca)), `${id}: coqueiros`);
      assert.ok(!p.quadras.some(q => q.x1 > p.orla.x) && !itens.some(s => s.zona !== "orla" && s.r[2] > p.orla.x), `${id}: nada no mar`);
      assert.ok(p.carros.every(c => c.eixo === "v"), `${id}: carros só nas verticais`);
    } else assert.ok(!p.orla && !praia.length, `${id}: sem praia`);
    // as árvores da região: pinheiro no Sul, palmeira e coqueiro no Norte e Nordeste, ipês no Centro-Oeste e Sudeste
    const arv = new Set(de(/^arvore-/).map(s => s.peca));
    const regiao = { PR: "S", RS: "S", SC: "S", DF: "CO", GO: "CO", MT: "CO", MS: "CO", ES: "SE", MG: "SE", RJ: "SE", SP: "SE" }[cc.uf] || "NNE";
    if (IGREJAS.has(cc.marco)) assert.equal(de(/^predios-9$/).length, 0, `${id}: o marco já é a igreja`);
    // no parque, o desenho do coreto (ou da feira) e o da praça (fonte ou lago) não se encostam: folga de 3 px ou mais
    const caixa = s => { const [, , w, h] = ATLAS.quadros[s.peca]; return [s.x - w / 2, s.y - h, s.x + w / 2, s.y]; };
    const folga = (a, b) => Math.max(a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3]);
    for (const s of itens.filter(s => s.zona === "parque" && /^lazer-[45]$/.test(s.peca))) {
      assert.ok(folga(caixa(s), caixa(p.praca)) >= 3, `${id}: ${s.peca} encosta em ${p.praca.peca}: ${folga(caixa(s), caixa(p.praca))}`);
    }
    // o arranjo em volta do marco varia pela semente: onde ficam o parque e o esporte, a ordem das filas do parque e a
    // praça do marco
    const { parque: qp, esporte: qe } = p.zonas, filaPraca = p.praca.y > (qp.y0 + qp.y1) / 2 ? 1 : 0;
    if (!cc.litoral) parques.add(`${qp.a},${qp.b}`);
    esportes.add(`${qe.a},${qe.b}`); centros.add(p.arranjo);
    arranjos.add(`${qp.a},${qp.b}|${filaPraca}|${qe.a},${qe.b}|${p.arranjo}`);
    if (regiao === "S") assert.ok(arv.has("arvore-6"), `${id}: pinheiros`);
    if (regiao === "NNE") assert.ok(arv.has("arvore-3") && arv.has("arvore-7"), `${id}: palmeiras e coqueiros`);
    if (regiao === "CO" || regiao === "SE") assert.ok(arv.has("arvore-2") || arv.has("arvore-4"), `${id}: ipês`);
    if (regiao !== "S") assert.ok(!arv.has("arvore-6"), `${id}: pinheiro fora do Sul`);
    const nP = { metropole: [14, 18], grande: [11, 14], media: [8, 12], pequena: [6, 9] }[cc.porte];
    assert.ok(p.pedestres.length >= nP[0] && p.pedestres.length <= nP[1], `${id}: ${p.pedestres.length} pedestres`);
    // carros, ônibus (da cidade média para cima) e bicicletas dividem as faixas
    const conta = re => p.carros.filter(c => re.test(c.peca)).length;
    assert.equal(conta(/^carro-/), { metropole: 8, grande: 6, media: 5, pequena: 3 }[cc.porte], `${id}: carros`);
    assert.equal(conta(/^onibus-cima-[12]$/), { metropole: 2, grande: 1, media: 1, pequena: 0 }[cc.porte], `${id}: ônibus`);
    assert.equal(conta(/^bici-[123]$/), { metropole: 3, grande: 2, media: 2, pequena: 2 }[cc.porte], `${id}: bicicletas`);
    assert.equal(p.carros.length, conta(/^carro-/) + conta(/^onibus-cima-/) + conta(/^bici-/), `${id}: só esses veículos`);
    for (const c of p.carros) if (c.peca.startsWith("carro-")) frota.add(c.peca);
    // vagas distintas: nada divide chão com outra peça, e tudo fica fora da rua e da calçada (o ônibus saiu: fica o ponto)
    for (const s of itens) {
      assert.ok(s.r[0] <= s.x && s.x <= s.r[2] && s.r[1] <= s.y && s.y <= s.r[3], `${id}: o pé de ${s.peca} na vaga`);
      assert.ok(!p.ruas.v.some(v => s.r[0] < v + BORDA && v - BORDA < s.r[2]), `${id}: ${s.peca} na rua (x)`);
      assert.ok(!p.ruas.h.some(h => s.r[1] < h + BORDA && h - BORDA < s.r[3]), `${id}: ${s.peca} na rua (y)`);
    }
    const porX = itens.slice().sort((a, b) => a.r[0] - b.r[0]);   // varredura em x: só os que ainda podem cruzar
    for (let i = 0; i < porX.length; i++) for (let j = i + 1; j < porX.length && porX[j].r[0] < porX[i].r[2]; j++) {
      assert.ok(!cruza(porX[i].r, porX[j].r), `${id}: ${porX[i].peca} e ${porX[j].peca} na mesma vaga`);
    }
    assert.ok(!("onibus" in p) && !itens.some(s => /^onibus-/.test(s.peca)), `${id}: sem ônibus na planta`);
    // nenhum carro começa dentro de um cruzamento (onde outro poderia estar)
    for (const c of p.carros) {
      const cruzes = [...new Set(p.cruzamentos.map(([x, y]) => (c.eixo === "h" ? x : y)))];
      assert.ok(cruzes.every(k => Math.abs(c.s - k) >= CP.E / 2 + 16), `${id}: carro começa no cruzamento ${c.s}`);
    }
  }
  // o porte: a cidade pequena tem menos prédios (à vista e no todo) que as metrópoles; Mateus Leme é do interior, com a
  // Matriz e a praça (o Rio, com a praia num lado, mostra menos quadras a 1x: lá vale o todo)
  assert.ok(predios["mateus-leme"] < predios["sao-paulo"], JSON.stringify(predios));
  assert.ok(totais["mateus-leme"] * 3 < totais["sao-paulo"] && totais["mateus-leme"] * 2 < totais["rio-de-janeiro"], JSON.stringify(totais));
  assert.ok(predios["mateus-leme"] <= 3 && predios["sao-paulo"] >= 7, JSON.stringify(predios));
  // o piso da metrópole de praia: à vista, o Rio nunca mostra menos prédios que a cidade pequena
  assert.ok(predios["rio-de-janeiro"] >= predios["mateus-leme"] && predios["rio-de-janeiro"] >= 3, JSON.stringify(predios));
  const ml = plantaDe("mateus-leme");
  assert.ok(!ml.pecas.some(s => s.peca === "predios-9"), "Mateus Leme tem uma igreja só, a Matriz");
  const [, , cw0, ch0] = ATLAS.quadros["lazer-4"], [, , mw0, mh0] = ATLAS.quadros["marco-matriz-mateus-leme"];
  assert.ok(cw0 < mw0 && ch0 < mh0, "o coreto menor que a Matriz");
  assert.ok(arranjos.size >= 6 && parques.size >= 3 && esportes.size >= 3 && centros.size >= 3,
    `arranjos variados: ${arranjos.size} / parques ${[...parques]} / esportes ${[...esportes]} / centros ${[...centros]}`);
  assert.ok(ml.pecas.some(s => s.peca === "lazer-4" && s.zona === "parque"), "o coreto na praça de Mateus Leme");
  assert.ok(frota.has("carro-5"), "o fusca na frota");
  // na casa, o chalé com placa tem a porta (só depois que o desenho do chalé chega): o clique nela leva a #bairro
  const ca = await abrir("#cidade=mateus-leme", { passo: 100 });
  ca.rodar(5);
  assert.equal(ca.M.nivel, "cidade");
  assert.equal(ca.M.niveis.cidade.alvos().length, 0, "sem o desenho do chalé, nem placa nem porta");
  await carregar(ca);
  assert.match(ca.canvas["aria-label"], /chalé do escritório com a placa/, "a casa chegou do clima: o rótulo cita o chalé");
  assert.match(ca.canvas["aria-label"], /o marco da cidade/);
  const portas = ca.M.niveis.cidade.alvos().filter(a => a.id === "porta");
  assert.equal(portas.length, 1); assert.equal(portas[0].id, "porta"); assert.deepEqual({ ...portas[0].acao }, { ir: "bairro", cidade: "mateus-leme" });
  ca.clicar(...ca.M.camera.tela(portas[0].x, portas[0].y - 10)); ca.rodar(12);
  assert.equal(ca.M.nivel, "bairro", "a porta da casa desce ao bairro"); assert.equal(ca.contexto.location.hash, "#bairro");
  // a cidade média também abre: sem marco (o centro com prédios), com o porte e a praia do mundo.json e o tempo da capital
  // mais perto (Santos: a de São Paulo); Esc volta ao Brasil
  const st = await abrir("#cidade=santos", { passo: 100, clima: { ...CLIMA, cidades: { "sao-paulo": { tipo: "chuva" } } } });
  st.rodar(5);
  assert.equal(st.M.nivel, "cidade", "a média abre a cidade");
  const sp = st.M.niveis.cidade.planta;
  assert.equal(sp.porte, "grande"); assert.ok(sp.orla, "Santos tem praia");
  assert.equal(st.contexto.clima && st.contexto.clima.tipo, "chuva", "o tempo da capital mais perto");
  await carregar(st);
  assert.match(st.canvas["aria-label"], /^Santos vista de cima/); assert.match(st.canvas["aria-label"], /No centro, prédios/);
  st.tecla("Escape"); st.rodar(12);
  assert.equal(st.M.nivel, "brasil");
  // a cidade de fora do Brasil abre do mesmo jeito, com as árvores da região dela e o tempo que vem do servidor; Esc sobe
  // direto ao globo, onde ela é um alvo que desce de volta
  const pa = await abrir("#cidade=paris", { passo: 100, clima: { ...CLIMA, cidades: { paris: { tipo: "neblina" } } } });
  pa.rodar(5);
  assert.equal(pa.M.nivel, "cidade", "Paris abre a cidade");
  assert.equal(pa.M.niveis.cidade.planta.regiao, "S"); assert.equal(pa.M.niveis.cidade.planta.porte, "metropole");
  assert.equal(pa.contexto.clima && pa.contexto.clima.tipo, "neblina", "o tempo de Paris");
  pa.tecla("Escape"); pa.rodar(12);
  assert.equal(pa.M.nivel, "globo", "da cidade de fora, Esc sobe ao globo");
  const alvoParis = pa.M.niveis.globo.alvos().find(a => a.id === "paris");
  assert.ok(alvoParis, "Paris é um alvo do globo"); assert.deepEqual({ ...alvoParis.acao }, { ir: "cidade", cidade: "paris" });
  // fora da casa, nenhum alvo e nenhum clique desce; o bairro é sempre o da casa
  const mn = await abrir("#cidade=manaus", { passo: 100 });
  mn.rodar(5);
  assert.equal(mn.M.niveis.cidade.alvos().filter(a => a.id === "porta").length, 0, "Manaus não tem chalé com placa");
  for (let sx = 20; sx < 640; sx += 60) for (let sy = 20; sy < 400; sy += 60) { mn.clicar(sx, sy); mn.rodar(); }
  mn.rodar(12);
  assert.equal(mn.M.nivel, "cidade", "nenhum ponto de Manaus desce ao bairro");
  mn.M.ir("bairro"); mn.rodar(12);
  assert.equal(mn.M.nivel, "bairro");
  mn.tecla("Escape"); mn.rodar(12);
  assert.equal(mn.contexto.location.hash, "#cidade=mateus-leme", "o bairro é o da casa: Esc sobe para ela");
  // a arte do marco faltando no atlas: a cidade desenha os prédios genéricos da planta (e nenhum marco), sem erro, e o
  // rótulo não promete o marco; com a arte, desenha o marco dela e nenhum outro
  const semRecife = { ...ATLAS, quadros: { ...ATLAS.quadros } };
  delete semRecife.quadros["marco-recife-antigo"];
  for (const [id, peca, atlas] of [["recife", plantaDe("recife").centro.peca, semRecife], ["belo-horizonte", "marco-pampulha", ATLAS]]) {
    const sm = await abrir("#cidade=" + id, { atlas });
    await espera();
    assert.ok(sm.requisicoes.some(([u]) => u.startsWith("/mundo/atlas.json")), "a cidade pede o atlas");
    for (const img of sm.contexto.imagens || []) img.carregar();
    sm.contexto.gravar = [];
    sm.rodar(3);
    const usados = new Set(sm.contexto.gravar.map(r => JSON.stringify(r)));
    assert.ok(usados.has(JSON.stringify(ATLAS.quadros[peca])), `${id}: desenha ${peca}`);
    const marcos = Object.keys(ATLAS.quadros).filter(n => n.startsWith("marco-") && n !== peca);
    assert.ok(!marcos.some(n => usados.has(JSON.stringify(ATLAS.quadros[n]))), `${id}: nenhum outro marco`);
    assert.equal(sm.M.nivel, "cidade"); assert.equal(sm.quadros.length, 1);
    assert.equal(/marco/.test(sm.canvas["aria-label"]), peca.startsWith("marco-"), `${id}: ${sm.canvas["aria-label"]}`);
  }
  // o atlas.png que falha ao carregar é pedido de novo na próxima entrada
  const fa = await abrir("#cidade=manaus", { passo: 100 });
  await espera();
  for (const img of fa.contexto.imagens || []) img.falhar();
  const pedidosAtlas = () => fa.requisicoes.filter(([u]) => u.startsWith("/mundo/atlas.json")).length, n0 = pedidosAtlas();
  assert.equal(n0, 2, "o mapa (miniaturas) e a cidade pedem o atlas");
  fa.tecla("Escape"); fa.rodar(12); await espera();
  assert.equal(fa.M.nivel, "brasil");
  assert.equal(pedidosAtlas(), n0 + 1, "a falha libera um novo pedido do mapa ao voltar a ele");
  fa.M.ir("cidade", { cidade: "manaus" }); fa.rodar(12); await espera();
  assert.equal(pedidosAtlas(), n0 + 2, "a falha libera um novo pedido da cidade");
  // a cidade usa o tempo dela; com movimento reduzido carros e pedestres ficam parados e não há partículas (nada de
  // Clima.desenhar), nem fumaça, passarinhos ou copa balançando, e o zoom chega na hora; sem ele, tudo isso anda
  const temporal = { cidades: { curitiba: { tipo: "tempestade", vento: 1, noite: false } }, casa: null, versao: 1 };
  for (const reduz of [true, false]) {
    const z = await abrir("#cidade=curitiba", { clima: temporal, reduzido: reduz });
    z.contexto.Clima.balanco = () => 1.6; z.contexto.Clima.vento = 0.8;   // o vento forte do temporal
    await carregar(z);
    assert.equal(z.contexto.clima.tipo, "tempestade", "a cidade chove como ela");
    const cid = z.M.niveis.cidade, antes = JSON.stringify([cid.carros, cid.pedestres]), d0 = z.contexto.desenhos || 0;
    let vida = { fumaca: 0, passaros: 0, balanco: 0 };
    for (let i = 0; i < 60; i++) {
      z.rodar();
      for (const k of Object.keys(vida)) vida[k] = Math.max(vida[k], cid.vida[k]);
    }
    const depois = JSON.stringify([cid.carros, cid.pedestres]), d1 = (z.contexto.desenhos || 0) - d0;
    if (reduz) {
      assert.equal(depois, antes, "reduzido: carros e pedestres parados"); assert.equal(d1, 0, "reduzido: sem partículas");
      assert.deepEqual(vida, { fumaca: 0, passaros: 0, balanco: 0 }, "reduzido: sem fumaça, passarinhos nem balanço");
      z.elementos["mundo-mais"].disparar("click"); z.rodar();
      assert.ok(z.M.camera.z > 1 && z.M.camera.z === z.M.camera.alvoZ, "reduzido: o zoom chega sem animação");
    } else {
      assert.notEqual(JSON.stringify(cid.carros), JSON.stringify(JSON.parse(antes)[0]), "os carros andam");
      assert.notEqual(JSON.stringify(cid.pedestres), JSON.stringify(JSON.parse(antes)[1]), "os pedestres andam");
      assert.ok(d1 >= 60, "o clima desenha a cada quadro");
      assert.ok(vida.fumaca > 0 && vida.passaros > 0 && vida.balanco > 0, "fumaça, passarinhos e copas: " + JSON.stringify(vida));
    }
  }
  // pedestres: sempre na calçada ou na faixa de pedestre (nunca no meio da rua nem dentro das quadras), virando nas
  // esquinas e atravessando nas faixas
  // (o passo de 250 ms por quadro, o maior que o mundo.js aceita, cobre os mesmos 32 s em 128 quadros)
  const pe = await abrir("#cidade=curitiba", { passo: 250, opaco: true }), pp = plantaDe("curitiba");   // opaco: o atlas tem pixels (sombras)
  await carregar(pe);
  const banda = d => d >= CP.E / 2 - 1e-6 && d <= BORDA + 1e-6;
  const naCalcadaH = (x, y) => pp.ruas.h.some(h => banda(Math.abs(y - h))), naCalcadaV = (x, y) => pp.ruas.v.some(v => banda(Math.abs(x - v)));
  let faixas = 0, viradas = 0;
  const lado = pe.M.niveis.cidade.pedestres.map(([x, y]) => naCalcadaH(x, y));
  for (let i = 0; i < 128; i++) {
    pe.rodar();
    pe.M.niveis.cidade.pedestres.forEach(([x, y], j) => {
      const h = naCalcadaH(x, y), v = naCalcadaV(x, y);
      assert.ok(h || v, `pedestre ${j} fora da calçada e da faixa: ${x}, ${y}`);
      if (h && pp.ruas.v.some(rv => Math.abs(x - rv) < CP.E / 2 - 1) || v && pp.ruas.h.some(rh => Math.abs(y - rh) < CP.E / 2 - 1)) faixas++;
      if (h !== v && h !== lado[j]) { viradas++; lado[j] = h; }
    });
  }
  assert.ok(faixas > 0, "algum pedestre atravessou na faixa"); assert.ok(viradas > 0, "algum pedestre virou a esquina");
  // tela larga (a vista passa da caixa): o carro só dá a volta fora da vista, com o desenho todo para fora
  // (80 s de relógio, em quadros de 250 ms: um carro anda no máximo 7,5 px por quadro)
  const lg = await abrir("#cidade=goiania", { tela: [1600, 400, 1], passo: 250 });
  await carregar(lg);
  // a entrada não pinta todos os ladrilhos de uma vez: no máximo alguns por quadro (o resto, esboçado), e logo todos
  assert.ok(lg.M.niveis.cidade.vida.novos <= 8 && lg.M.niveis.cidade.vida.faltam > 0, JSON.stringify(lg.M.niveis.cidade.vida));
  lg.rodar(8);
  assert.equal(lg.M.niveis.cidade.vida.faltam, 0, "todos os ladrilhos pintados em poucos quadros");
  const lc = lg.M.camera, [vx0, vy0] = lc.mundo(0, 0), [vx1, vy1] = lc.mundo(lc.W, lc.H);
  assert.ok(vx0 < -100 && vx1 > CP.W + 100, `a vista passa da caixa: ${vx0} a ${vx1}`);
  let antesCarros = lg.M.niveis.cidade.carros, voltas = 0;
  for (let i = 0; i < 320; i++) {
    lg.rodar();
    const agora = lg.M.niveis.cidade.carros;
    agora.forEach(([x, y], j) => {
      const [ax, ay] = antesCarros[j];
      if (Math.abs(x - ax) + Math.abs(y - ay) < 12) return;
      voltas++;
      for (const [px, py] of [[ax, ay], [x, y]]) assert.ok(px <= vx0 - 10 || px >= vx1 + 10 || py <= vy0 - 10 || py >= vy1 + 10, `volta dentro da vista: ${px}, ${py}`);
    });
    antesCarros = agora;
  }
  assert.ok(voltas > 0, "algum carro deu a volta");
  // veículos nunca sobrepostos: o carro espera antes do cruzamento enquanto houver outro dentro dele, e o par da mesma
  // faixa não se encosta, nem quando a vista encolhe de uma vez (o celular girado)
  const caixas = cid => cid.veiculos.map(([x, y, w, h]) => [x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
  const semSobrepor = (cid, quando) => {
    const l = caixas(cid);
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      assert.ok(!cruza(l[i], l[j]), `${quando}: veículos ${i} e ${j} sobrepostos: ${l[i]} / ${l[j]}`);
    }
  };
  let esperas = 0;
  for (const id of ["goiania", "curitiba", "palmas"]) {   // cidades sem praia: carros nas duas ruas do cruzamento
    // 25 s largos e 15 s encolhidos (Goiânia segue da tela larga de cima)
    const vc = id === "goiania" ? lg : await abrir("#cidade=" + id, { tela: [1600, 400, 1], passo: 250 });
    if (vc !== lg) await carregar(vc);
    const cid = vc.M.niveis.cidade;
    assert.ok(cid.veiculos.length >= 4, id);
    let antes = cid.carros;
    for (let i = 0; i < 100; i++) {
      vc.rodar(); semSobrepor(cid, `${id} (larga), quadro ${i}`);
      const agora = cid.carros;
      esperas += agora.filter(([x, y], j) => x === antes[j][0] && y === antes[j][1]).length;
      antes = agora;
    }
    vc.redimensionar(390, 507); vc.rodar();
    for (let i = 0; i < 60; i++) { vc.rodar(); semSobrepor(cid, `${id} (encolhida), quadro ${i}`); }
  }
  assert.ok(esperas > 0, "algum carro esperou num cruzamento");
  // os brilhos da noite saem de sprites guardados: nada de gradiente novo a cada quadro (num dia sem festa)
  const nt = await abrir("#cidade=sao-paulo", { escuro: 1, busca: "?data=2026-11-18", opaco: true });   // opaco: o atlas tem pixels
  await carregar(nt);
  let recortes = 0, cobertas = 0;   // (os brilhos recortados e as janelas cobertas, conferidos mais abaixo)
  for (let i = 0; i < 60; i++) {   // cada raio e cor de brilho que aparece pinta o seu sprite uma vez
    nt.rodar(); recortes += nt.M.niveis.cidade.vida.recortes; cobertas += nt.M.niveis.cidade.vida.janelasCobertas;
  }
  const g0 = nt.contexto.gradientes || 0;
  assert.ok(g0 > 0 && g0 < 10, "sprites de brilho: " + g0);
  nt.rodar(60);
  assert.equal((nt.contexto.gradientes || 0) - g0, 0, "brilhos em cache");
  // pedestres em 1:1 (o boneco inteiro de 22 px): o desenho cai na escala do mundo, sem dobrar as coordenadas
  nt.contexto.gravar = []; nt.rodar();
  assert.ok(nt.contexto.gravar.some(r => r[2] === 22 && r[3] === 22), "boneco desenhado em 22x22");
  assert.ok(!nt.contexto.gravar.some(r => r[2] === 11 && r[3] === 11), "nenhum boneco na metade");
  // nenhum array novo por quadro depois de aquecer: o código da cidade (planta, chão, letreiros, festa e peças) não chama
  // map, filter, slice, sort e afins a cada quadro, de noite (São Paulo) nem de dia com gente virando esquina (Curitiba)
  for (const pg of [nt, pe]) {
    vm.runInContext(`globalThis.__arrays = [];
      for (const k of ["map", "filter", "slice", "concat", "flatMap", "sort", "reduce", "from", "of", "fill", "splice"]) {
        const dono = k === "from" || k === "of" ? Array : Array.prototype, o = dono[k];
        dono[k] = function (...a) { const p = new Error().stack; if (/mundo_cidade|mundo_festa/.test(p)) __arrays.push(k); return o.apply(this, a); };
      }`, pg.contexto);
    pg.rodar(40);
    assert.deepEqual([...vm.runInContext("__arrays", pg.contexto)], [], "arrays por quadro");
  }
  // o brilho guardado não cresce ao trocar de cidade numa festa (a cor da festa é a chave, não o array dela)
  const br = await abrir("#cidade=sao-paulo", { escuro: 1, busca: "?data=2026-12-25", reduzido: true, clima: NOITE_TODAS });
  await carregar(br);
  const ir = id => { br.M.ir("cidade", { cidade: id }); br.rodar(2); };
  ir("recife");
  const g1 = br.contexto.gradientes;
  ir("sao-paulo"); ir("recife");
  assert.ok(g1 > 0 && br.contexto.gradientes === g1, `trocar de cidade não pinta brilho novo: ${g1}, ${br.contexto.gradientes}`);
  // à noite, janelas acesas (umas sim, outras não) e nenhuma sombra; de dia, sombras no chão e nenhuma janela acesa
  const noite = nt.M.niveis.cidade.vida;
  assert.ok(noite.janelas > 20 && noite.sombras === 0 && noite.forca === 0, "à noite: " + JSON.stringify(noite));
  // a luz atrás de uma construção não clareia a construção da frente: o brilho é recortado por ela, e a janela que ela
  // cobre não acende por cima
  assert.ok(recortes > 0 && cobertas > 0, `luzes atrás das construções: ${recortes} brilhos recortados, ${cobertas} janelas cobertas`);
  const dia = pe.M.niveis.cidade.vida;   // Curitiba de dia, depois da volta dos pedestres
  assert.ok(dia.janelas === 0 && dia.sombras > 20 && dia.forca > 0, "de dia: " + JSON.stringify(dia));
  // o sol: de manhã a sombra cai para o oeste e à tarde para o leste, mais longa no fim da tarde; céu fechado, mais fraca
  const sol = k.contexto.window.CidadeChao.criar({ recorte: () => null, atlas: () => null }).sol;
  const manha = sol({ h: 8, escuro: 0 }, "limpo"), meio = sol({ h: 12.5, escuro: 0 }, "limpo"), tarde = sol({ h: 17.5, escuro: 0 }, "limpo");
  assert.ok(manha.sx < 0 && tarde.sx > 0 && Math.abs(tarde.sx) > Math.abs(meio.sx) && tarde.sy > meio.sy, JSON.stringify([manha, meio, tarde]));
  assert.ok(sol({ h: 12, escuro: 0 }, "chuva").forca < meio.forca && sol({ h: 21, escuro: 0.8 }, "limpo").forca === 0);

  // zoom: a 1x a cena fica limpa; o duplo clique aproxima no ponto (o ponto sob o cursor não escorrega); o teto ainda
  // mostra uma quadra inteira, e de perto aparecem as placas das ruas, os pombos na praça e os detalhes do chão
  const zm = await abrir("#cidade=mateus-leme", { passo: 50 });
  await carregar(zm);
  const cz = zm.M.camera, cml = zm.M.niveis.cidade;
  assert.ok(!cml.vida.perto && cml.vida.placas + cml.vida.pombos + cml.vida.detalhes === 0, "a 1x: " + JSON.stringify(cml.vida));
  // as construções notáveis à vista têm botão (Tab) e mostram o nome (o marco, o do ponto turístico) no foco, no Enter
  // e no clique, em Silkscreen no próprio canvas (sem a dica de HTML)
  const alvosML = cml.alvos(), marcoML = alvosML.find(a => a.titulo === "Igreja Matriz"), coreto = alvosML.find(a => a.titulo === "Coreto");
  const pracaML = alvosML.find(a => a.titulo === "Praça da Fonte" || a.titulo === "Lago da Praça");
  assert.ok(marcoML && coreto && pracaML, alvosML.map(a => a.titulo).join());
  assert.ok(alvosML.every(a => a.id === "porta" || (a.etiqueta && /: mostrar o nome$/.test(a.rotulo))));
  const botoes = zm.elementos["mundo-alvos"].filhos, bCoreto = botoes[alvosML.indexOf(coreto)];
  assert.equal(botoes.length, alvosML.length);
  bCoreto.disparar("focus"); zm.rodar();
  assert.equal(cml.vida.etiqueta, "Coreto"); assert.equal(zm.elementos["mundo-dica"].hidden, true, "a etiqueta não usa a dica de HTML");
  bCoreto.disparar("blur"); zm.rodar();
  assert.equal(cml.vida.etiqueta, null);
  bCoreto.disparar("click"); zm.rodar();
  assert.equal(cml.vida.etiqueta, "Coreto", "Enter mostra o nome");
  const anuncio1 = zm.elementos["mundo-estado"].textContent;
  assert.match(anuncio1, /^Coreto, em Mateus Leme\.\s?$/, "o status anuncia o nome mostrado");
  bCoreto.disparar("click"); zm.rodar();   // o Enter de novo na mesma construção: o texto muda, para o leitor repetir
  const anuncio2 = zm.elementos["mundo-estado"].textContent;
  assert.ok(/^Coreto, em Mateus Leme\.\s?$/.test(anuncio2) && anuncio2 !== anuncio1, JSON.stringify([anuncio1, anuncio2]));
  zm.rodar(110);   // passados os 5 s da etiqueta, o status volta ao texto da cidade
  assert.match(zm.elementos["mundo-estado"].textContent, /^Mateus Leme \(MG\)/, "o texto da cidade de volta");
  zm.clicar(...cz.tela(marcoML.x, marcoML.y)); zm.rodar();
  assert.equal(cml.vida.etiqueta, "Igreja Matriz", "o clique no marco mostra o nome do ponto turístico");
  assert.match(zm.elementos["mundo-estado"].textContent, /Igreja Matriz/);
  assert.equal(zm.M.nivel, "cidade");
  const praca = cml.planta.praca, alvoZoom = [praca.x, praca.y - 12], [px0, py0] = cz.tela(...alvoZoom);
  zm.canvas.disparar("dblclick", { clientX: px0, clientY: py0 }); zm.rodar(30);
  const [wx, wy] = cz.mundo(px0, py0);
  assert.ok(cz.z > 1 && Math.hypot(wx - alvoZoom[0], wy - alvoZoom[1]) < 1, `o ponto sob o cursor: ${wx}, ${wy}`);
  for (let i = 0; i < 3; i++) { zm.canvas.disparar("dblclick", { clientX: px0, clientY: py0 }); zm.rodar(15); }   // 2x, 3x e o teto
  assert.ok(cz.z >= 2 && cz.W / cz.P >= 192 - 1e-6 && cz.H / cz.P >= 160 - 1e-6, `o teto mostra uma quadra: z ${cz.z}, P ${cz.P}`);
  assert.ok(cz.W / cz.P < 200 || cz.H / cz.P < 168, "e não mais que isso perto do teto");
  const perto = cml.vida;
  assert.ok(perto.perto && perto.placas > 0 && perto.pombos > 0 && perto.detalhes > 0, "de perto: " + JSON.stringify(perto));
  // a placa entra na ordem de profundidade: há peças desenhadas depois dela (as que ficam na frente a cobrem)
  for (let i = 0; i < 10 && !cml.vida.depoisDaPlaca; i++) zm.rodar();
  assert.ok(cml.vida.depoisDaPlaca > 0, "peças na frente da placa: " + JSON.stringify(cml.vida));
  // de perto também nada novo por quadro
  vm.runInContext(`globalThis.__arrays = [];
    for (const k of ["map", "filter", "slice", "concat", "flatMap", "sort", "reduce", "from", "of", "fill", "splice", "toUpperCase"]) {
      const dono = k === "from" || k === "of" ? Array : k === "toUpperCase" ? String.prototype : Array.prototype, o = dono[k];
      dono[k] = function (...a) { const p = new Error().stack; if (/mundo_cidade|mundo_festa/.test(p)) __arrays.push(k); return o.apply(this, a); };
    }`, zm.contexto);
  zm.rodar(20);
  assert.deepEqual([...vm.runInContext("__arrays", zm.contexto)], [], "de perto, nada montado por quadro");
  // no celular, o duplo toque aproxima no ponto (um toque só, não)
  const dtq = pe;   // Curitiba ainda em 1x
  assert.equal(dtq.M.camera.z, 1);
  const tocar = (x, y) => ["pointerdown", "pointerup"].forEach(t =>
    dtq.canvas.disparar(t, { pointerId: 7, clientX: x, clientY: y, button: 0, pointerType: "touch" }));
  tocar(300, 200); dtq.rodar(20);
  assert.equal(dtq.M.camera.z, 1, "um toque não aproxima");
  tocar(300, 200); dtq.rodar(20);
  assert.ok(dtq.M.camera.z > 1, "o duplo toque aproxima");

  // a chuva do som vai a zero ao sair da cidade para o Brasil, e só enquanto ainda pode estar tocando: no globo e no Brasil
  // abertos direto (sem passar pela cidade), nenhuma chamada a Som.chuva (que criaria o áudio sem nada para tocar)
  const chamadas = [], somFalso = { ligado: true, chuva(v) { chamadas.push(v); } };
  const sc = await abrir("#cidade=recife", { som: somFalso });
  sc.rodar(10);
  sc.tecla("Escape"); sc.rodar(60);
  assert.equal(sc.M.nivel, "brasil");
  assert.ok(chamadas.length >= 30 && chamadas.slice(-30).every(v => v === 0), "no Brasil, Som.chuva(0) a cada quadro");
  sc.rodar(400);
  const feitas = chamadas.length;
  sc.rodar(60);
  assert.equal(chamadas.length, feitas, "depois de silenciar, Som.chuva não é mais chamado");
  for (const hash of ["", "#brasil"]) {
    const so = [], sg = await abrir(hash, { som: { ligado: true, chuva(v) { so.push(v); } } });
    sg.rodar(40);
    assert.equal(so.length, 0, `${hash || "globo"}: nenhuma chamada a Som.chuva`);
  }

  // a câmera fica presa à caixa: 30 arrastes para o mesmo lado (bem mais que a largura do mapa no teto) e zoom de 1x ao
  // teto do Brasil (4x, em escalas pares:
  // a camada de perto, no dobro da resolução, fica em pixel inteiro). O + no meio do mar, no teto, não mergulha
  const a = await abrir("#brasil", { passo: 100 });   // quadros de 100 ms: o mesmo relógio em menos quadros
  const cam = () => a.M.camera, dentro = () => {
    const c = cam(), [x0, y0, x1, y1] = c.caixa, mw = c.W / 2 / c.P, mh = c.H / 2 / c.P;
    assert.ok(c.z >= 1 && c.z <= 4, "zoom " + c.z);
    if (mw * 2 <= x1 - x0) assert.ok(c.x - mw >= x0 - 1e-6 && c.x + mw <= x1 + 1e-6, "x " + c.x);
    if (mh * 2 <= y1 - y0) assert.ok(c.y - mh >= y0 - 1e-6 && c.y + mh <= y1 + 1e-6, "y " + c.y);
  };
  const escalas = new Set();
  for (let i = 0; i < 5; i++) { a.elementos["mundo-mais"].disparar("click"); a.rodar(5); escalas.add(cam().P); }
  a.rodar(10);
  assert.equal(cam().z, 4); dentro();
  assert.equal(a.M.nivel, "brasil", "o + no meio do mapa, sem capital sob ele, para no teto");
  assert.ok([...escalas].every(p => p === 1 || p % 2 === 0), "parado, a escala é par: " + [...escalas]);
  for (const [dx, dy] of [[150, 0], [-150, 0], [0, 150], [0, -150]]) {
    for (let i = 0; i < 30; i++) { a.arrastar(dx, dy); a.rodar(); dentro(); }
    a.rodar(8); dentro();
  }
  // a roda no canto da tela, onde nenhuma cidade (capital ou média) fica: no teto, ela só segura a câmera
  for (let i = 0; i < 30; i++) a.canvas.disparar("wheel", { deltaY: -120, clientX: 1, clientY: 1 });
  a.rodar(10); dentro();
  for (let i = 0; i < 10 && cam().alvoZ > 1; i++) { a.elementos["mundo-menos"].disparar("click"); a.rodar(5); }
  for (let i = 0; i < 30 && cam().z !== cam().alvoZ; i++) a.rodar(1);
  assert.equal(cam().z, 1); dentro();
  assert.equal(a.M.nivel, "brasil");
  // afastar mais uma vez no mínimo do mapa volta ao globo, logo que ele chega (a pausa é só da roda)
  a.elementos["mundo-menos"].disparar("click"); a.rodar(4);
  assert.equal(a.M.nivel, "globo", "o − no mínimo do Brasil sobe ao globo");

  // zoom centrado no cursor: o ponto do mapa sob ele é o mesmo antes e depois (roda e duplo clique, medidos antes do gesto)
  const zc = await abrir("#brasil", { passo: 50 });
  const czc = zc.M.camera, [mx0, my0] = czc.mundo(380, 230);
  zc.canvas.disparar("wheel", { deltaY: -120, clientX: 380, clientY: 230 }); zc.rodar(20);
  const [mx1, my1] = czc.mundo(380, 230);
  assert.ok(czc.z >= 2 && Math.hypot(mx1 - mx0, my1 - my0) < 0.6, `a roda: ${mx0},${my0} → ${mx1},${my1}`);
  const [dx0, dy0] = czc.mundo(300, 210);
  zc.canvas.disparar("dblclick", { clientX: 300, clientY: 210 }); zc.rodar(20);
  const [dx1, dy1] = czc.mundo(300, 210);
  assert.ok(czc.z >= 3 && Math.hypot(dx1 - dx0, dy1 - dy0) < 0.6, `o duplo clique: ${dx0},${dy0} → ${dx1},${dy1}`);
  // movimento reduzido: o zoom chega sem animação; e afastar com a roda no mínimo (parado) sobe ao globo
  const zr = await abrir("#brasil", { reduzido: true, passo: 50 });
  zr.canvas.disparar("wheel", { deltaY: -120, clientX: 380, clientY: 230 }); zr.rodar(1);
  assert.ok(zr.M.camera.z > 1 && zr.M.camera.z === zr.M.camera.alvoZ, "reduzido: o zoom do mapa chega na hora");
  zr.canvas.disparar("wheel", { deltaY: 120, clientX: 380, clientY: 230 }); zr.rodar(1);
  zr.canvas.disparar("wheel", { deltaY: 120, clientX: 380, clientY: 230 }); zr.rodar(2);
  assert.equal(zr.M.nivel, "brasil", "logo depois de chegar ao mínimo (a inércia da roda), ainda não sobe");
  zr.rodar(10);
  zr.canvas.disparar("wheel", { deltaY: 120, clientX: 300, clientY: 200 }); zr.rodar(6);
  assert.equal(zr.contexto.location.hash, "#globo", "a roda no mínimo do Brasil, parado, sobe ao globo");

  // mergulho contínuo: no teto, aproximar mais uma vez sobre uma capital entra nela; sobre o mar, o zoom só para. A roda
  // rápida no caminho até o teto, ou logo que ele chega (a inércia do trackpad), só aproxima: o mergulho espera a pausa
  const mgl = zc;   // a mesma página, de volta a 2x
  await carregar(mgl);
  const rec = cidade("recife"), cmg = mgl.M.camera;
  cmg.zoomPara(2); mgl.rodar(20); cmg.x = rec.x; cmg.y = rec.y; mgl.rodar(2);
  const roda = () => { const [x, y] = cmg.tela(rec.x, rec.y - 3); mgl.canvas.disparar("wheel", { deltaY: -120, clientX: x, clientY: y }); };
  for (let i = 0; i < 8; i++) { roda(); mgl.rodar(1); }
  assert.equal(mgl.M.nivel, "brasil", "a roda rápida não mergulha antes de parar no teto");
  for (let i = 0; i < 60 && cmg.z !== cmg.alvoZ; i++) mgl.rodar(1);
  assert.equal(cmg.z, 4, "no teto");
  roda(); mgl.rodar(1);
  assert.equal(mgl.M.nivel, "brasil", "logo que para no teto, a roda ainda não mergulha");
  mgl.rodar(12);
  const cr = mgl.M.niveis.brasil.caixas.find(k => k.id === "recife");
  mgl.canvas.disparar("wheel", { deltaY: -120, clientX: cr.px, clientY: cr.py - cr.ih / 2 }); mgl.rodar(20);
  assert.equal(mgl.contexto.location.hash, "#cidade=recife", "a roda no teto, parado, sobre Recife entra nela");
  // no teto, o + com Brasília no meio da tela entra nela logo que o teto chega (a pausa é só da roda; sem capital sob o
  // ponto, o + só para no teto: a página da câmera)
  const mm = await abrir("#brasil", { passo: 50 });
  await carregar(mm);
  const bsb = cidade("brasilia"), cmm = mm.M.camera;
  cmm.zoomPara(2); mm.rodar(20); cmm.x = bsb.x; cmm.y = bsb.y; mm.rodar(2);
  mm.elementos["mundo-mais"].disparar("click");
  for (let i = 0; i < 40 && (cmm.z !== cmm.alvoZ || cmm.z < 4); i++) mm.rodar(1);
  const cm = mm.M.niveis.brasil.caixas.find(k => k.id === "brasilia");
  cmm.x += (cm.px - cmm.W / 2) / cmm.P; cmm.y += (cm.py - cm.ih / 2 - cmm.H / 2) / cmm.P; mm.rodar(1);
  mm.elementos["mundo-mais"].disparar("click"); mm.rodar(20);
  assert.equal(mm.contexto.location.hash, "#cidade=brasilia", "o + logo que chega ao teto, sobre Brasília, entra nela");
  const solta = a.M.Camera([0, 0, 400, 400]);
  solta.tamanho(640, 400, 1); solta.x = -999; solta.y = 9999; solta.z = 9; solta.limitar();
  assert.equal(solta.z, 4); assert.ok(solta.x - 320 / solta.P >= 0 && solta.y + 200 / solta.P <= 400);
  // a 1x o mapa inteiro cabe na maior escala possível (fracionária): celular (canvas de 1170 px, dpr 3) e desktop
  const celular = a.M.Camera([0, 0, 400, 400]).tamanho(1170, 1521, 3);
  assert.ok(celular.P >= 2.9 && celular.P <= 2.93, "escala a 1x no celular: " + celular.P);
  for (const [w, h, d] of [[1170, 1521, 3], [1170, 1290, 3], [940, 800, 1]]) {
    const c = a.M.Camera([0, 0, 400, 400]).tamanho(w, h, d);
    assert.ok(c.x - w / 2 / c.P <= 0 && c.x + w / 2 / c.P >= 400, `x de 0 a 400 inteiro em ${w}x${h}`);
    assert.ok(c.y - h / 2 / c.P <= 0 && c.y + h / 2 / c.P >= 400, `y de 0 a 400 inteiro em ${w}x${h}`);
  }

  // celular (390x507 de CSS, dpr 3): uma pinça que volta ao tamanho de partida para em z = 1, a base exata (sem arredondar
  // para a escala inteira acima dela, que cortaria o mapa ou os chalés); a cidade também entra em z = 1
  const CEL = [390, 507, 3];
  for (const [hash, base] of [["#brasil", 2.925], ["#bairro", 1170 / 320]]) {
    const p = await abrir(hash, { tela: CEL });
    assert.ok(Math.abs(p.M.camera.base - base) < 1e-9, `${hash}: base ${p.M.camera.base}`);
    p.toque("pointerdown", 1, 100, 250); p.toque("pointerdown", 2, 300, 250);
    p.toque("pointermove", 2, 380, 250); p.toque("pointermove", 2, 300, 250);
    p.toque("pointerup", 2, 300, 250); p.toque("pointerup", 1, 100, 250);
    p.rodar(60);
    const c = p.M.camera;
    assert.equal(c.z, 1, `${hash}: a pinça termina em z = 1`); assert.equal(c.alvoZ, 1);
    assert.ok(c.x - c.W / 2 / c.P <= c.caixa[0] + 1e-9 && c.x + c.W / 2 / c.P >= c.caixa[2] - 1e-9, `${hash}: a largura inteira cabe`);
  }
  const pc = await abrir("#cidade=recife", { tela: CEL });
  pc.rodar(30);
  const [, , cw, ch] = pc.M.camera.caixa;
  assert.ok(Math.abs(pc.M.camera.base - Math.min(1170 / cw, 1521 / ch)) < 1e-9, "cidade: base " + pc.M.camera.base);
  assert.equal(pc.M.camera.z, 1, "cidade entra em z = 1"); assert.equal(pc.M.camera.alvoZ, 1);

  // aba escondida: nenhum quadro novo; de volta, um só
  const h = await abrir("#brasil");
  assert.equal(h.quadros.length, 1);
  h.documento.hidden = true; h.rodar();
  assert.equal(h.quadros.length, 0, "escondida, não pede quadro");
  h.documento.hidden = false; h.documento.disparar("visibilitychange"); h.documento.disparar("visibilitychange");
  assert.equal(h.quadros.length, 1, "de volta, um quadro só");

  // o globo gira sozinho a 6°/s; com movimento reduzido fica parado no centro inicial (mas o arraste ainda gira)
  const gg = await abrir("");
  const antes = gg.M.niveis.globo.rotacao.lon;
  gg.rodar(60);
  assert.ok(Math.abs(Math.abs(gg.M.niveis.globo.rotacao.lon - antes) - 60 * 0.016 * 6) < 0.05, "6°/s: " + (gg.M.niveis.globo.rotacao.lon - antes));
  const gr = await abrir("", { reduzido: true, passo: 100 });   // 2 s de relógio em 20 quadros
  const r0 = JSON.stringify(gr.M.niveis.globo.rotacao);
  assert.equal(r0, JSON.stringify({ lon: -50, lat: -15 }), "centro inicial");
  gr.rodar(20);
  assert.equal(JSON.stringify(gr.M.niveis.globo.rotacao), r0, "reduzido: a rotação não muda entre quadros");
  gr.arrastar(100, 0); gr.rodar(5);
  const r1 = JSON.stringify(gr.M.niveis.globo.rotacao);
  assert.notEqual(r1, r0, "o arraste gira o globo à mão");
  gr.rodar(10);
  assert.equal(JSON.stringify(gr.M.niveis.globo.rotacao), r1, "reduzido: sem inércia nem giro depois do arraste");
  // com o Brasil longe depois do arraste, o foco no Brasil (Tab) realça sem girar o globo até ele
  gr.elementos["mundo-alvos"].filhos[0].disparar("focus"); gr.rodar(5);
  assert.equal(gr.M.niveis.globo.destaque, "brasil");
  assert.equal(JSON.stringify(gr.M.niveis.globo.rotacao), r1, "reduzido: o foco no Brasil não gira o globo");
  // terra.png e brasil.png chegam depois dos primeiros quadros: com movimento reduzido e nada mexendo, o globo se refaz
  const gi = await abrir("", { reduzido: true });
  gi.rodar(30);
  const passadas = gi.contexto.passadas;
  assert.ok(passadas > 0, "o primeiro quadro desenha o globo");
  gi.rodar(30);
  assert.equal(gi.contexto.passadas, passadas, "reduzido e parado: sem passada nova");
  for (const img of gi.contexto.imagens) img.carregar();
  gi.rodar(2);
  assert.ok(gi.contexto.passadas > passadas, "reduzido: as imagens que chegam refazem a passada");

  // movimento reduzido: nem aviões nem partículas; sem ele, até 6 aviões e partículas sobre as cidades
  const tempo = { cidades: Object.fromEntries(MUNDO.cidades.map((c, i) => [c.id, { tipo: ["chuva", "neve", "tempestade", "garoa"][i % 4], vento: 0.5, noite: false }])), casa: null, versao: 1 };
  const r = await abrir("#brasil", { clima: tempo, reduzido: true, passo: 100 });
  r.rodar(96);
  assert.equal(r.M.niveis.brasil.avioes.length, 0); assert.equal(r.M.niveis.brasil.particulas, 0);
  const v = await abrir("#brasil", { clima: tempo, passo: 100 });   // 9,6 s de relógio em quadros de 100 ms
  let maximo = 0;
  for (let i = 0; i < 96; i++) { v.rodar(); maximo = Math.max(maximo, v.M.niveis.brasil.avioes.length); }
  assert.ok(maximo > 0 && maximo <= 6, "aviões: " + maximo);
  assert.ok(v.M.niveis.brasil.particulas > 0);
  // no bairro também: com tempestade e movimento reduzido, nem partículas nem o clarão do raio (nada de Clima.desenhar)
  const tormenta = { cidades: { recife: { tipo: "tempestade", vento: 1, noite: false } }, casa: "recife", versao: 1 };
  for (const reduz of [true, false]) {
    const b = await abrir("#bairro", { clima: tormenta, reduzido: reduz });
    b.rodar(60);
    assert.equal(b.M.nivel, "bairro");
    assert.equal(b.contexto.clima.tipo, "tempestade", "#bairro direto fica na casa assim que o clima chega");
    if (reduz) assert.equal(b.contexto.desenhos || 0, 0, "reduzido: sem chuva nem raio no bairro");
    else assert.ok(b.contexto.desenhos >= 60, "sem reduzir, o clima desenha a cada quadro");
  }

  // clima vazio, estranho ou fora do ar não quebra o quadro
  for (const opcoes of [{ clima: {} }, { clima: { cidades: { recife: "lixo", manaus: { tipo: "<b>", vento: "x" } }, casa: 7 } }, { climaFalha: true }]) {
    const q = await abrir("#brasil", opcoes);
    q.rodar(30);
    assert.equal(q.M.nivel, "brasil");
    assert.equal(q.quadros.length, 1);
  }
  // o tempo da etiqueta não vaza de nível: Enter numa construção, Esc para o Brasil e foco numa capital antes dos 5 s; o
  // status da capital fica, em vez de ser trocado pelo texto geral do Brasil quando o tempo da etiqueta acabaria
  const ze = await abrir("#cidade=mateus-leme", { passo: 50 });
  await carregar(ze);
  const ce = ze.M.niveis.cidade, alvosE = ce.alvos(), iCoreto = alvosE.findIndex(a => a.titulo === "Coreto");
  ze.elementos["mundo-alvos"].filhos[iCoreto].disparar("click"); ze.rodar();
  assert.match(ze.elementos["mundo-estado"].textContent, /^Coreto, em Mateus Leme/);
  ze.tecla("Escape"); ze.rodar(30);
  assert.equal(ze.M.nivel, "brasil");
  const geral = ze.elementos["mundo-estado"].textContent;
  ze.elementos["mundo-alvos"].filhos[0].disparar("focus"); ze.rodar();
  const daCapital = ze.elementos["mundo-estado"].textContent;
  assert.notEqual(daCapital, geral, "o foco numa capital muda o status");
  ze.rodar(110);
  assert.equal(ze.elementos["mundo-estado"].textContent, daCapital, "o tempo da etiqueta da cidade não troca o status do Brasil");

}
module.exports = { abrir, espera, carregar, MUNDO, ATLAS, CLIMA, UFS_PERTO };
if (require.main === module) principal().catch(e => { console.error(e); process.exitCode = 1; });
