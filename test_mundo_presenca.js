"use strict";
// Pessoas da equipe no mapa (static/vida.js: Vida.aoVivo, Vida.irAte, Vida.pessoas): o polling do /api/ao-vivo com o
// andar e o seq, os eventos "aovivo" e "minha-sala" (contrato com o chat_sala.js), o backoff, a troca de andar, a TV que
// só lê e o meu boneco, que manda só o destino do clique, no máximo 2 por segundo. Relógio, fetch e prédio falsos.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ANDAR = fs.readFileSync("static/expediente.js", "utf8");
const VIDA = fs.readFileSync("static/vida.js", "utf8");
const ID = "a1b2c3d4";

// um prédio mínimo: a recepção (em cima, porta embaixo), o corredor e a reunião (embaixo, porta em cima)
function predio() {
  const recepcao = { tipo: "recepcao", chave: "recepcao", nome: "Recepção", px: 100, py: 40, pw: 120, ph: 100, chao: 60, porta: { x: 160 } };
  const reuniao = { tipo: "reuniao", chave: "reuniao", nome: "Reunião", px: 100, py: 200, pw: 120, ph: 100, chao: 220, portas: [160] };
  return { salas: [recepcao], baixo: [reuniao], vagas: [], objetos: [], livre: () => true, corredorY: 170, corredorTopo: 150,
    corredorAlt: 40, predioRet: { x: 60, y: 30, w: 400, h: 300 }, entrada: { x: 62, calcadaY: 350 } };
}

function carregar({ hash = "" } = {}) {
  let agora = 0, prox = 1;
  const timers = new Map(), pedidos = [], eventos = [], respostas = [];
  const doc = { hidden: false, ouvintes: {}, addEventListener(t, f) { (doc.ouvintes[t] ||= []).push(f); } };
  const contexto = {
    location: { hash }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: doc, console,
    performance: { now: () => agora },
    setTimeout: (f, ms) => { const id = prox++; timers.set(id, { f, em: agora + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    CustomEvent: class { constructor(tipo, o) { this.type = tipo; this.detail = o.detail; } },
    Ceu: { agora: () => ({ h: 10, escuro: 0 }) },
    Avatar: { padrao: u => ({ color: "padrao:" + u, eyes: "round", accessory: "" }) },
    matchMedia: () => ({ matches: false }), URLSearchParams, Date, Math,
    // cada fetch fica pendente até o teste responder (respostas, na ordem)
    fetch: (url, opcoes = {}) => new Promise(ok => { const p = { url, opcoes, ok }; pedidos.push(p); respostas.push(p); }),
  };
  contexto.window = contexto;
  contexto.dispatchEvent = ev => eventos.push(ev);
  vm.runInNewContext(ANDAR + "\n" + VIDA, contexto);
  const json = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  const t = {
    Vida: contexto.Vida, Andar: contexto.Andar, doc, pedidos, eventos, timers,
    // responde o pedido pendente mais antigo cuja url contém `trecho`
    async responder(trecho, status, corpo) {
      const i = respostas.findIndex(p => p.url.includes(trecho));
      assert.ok(i >= 0, `sem pedido pendente para ${trecho}: ${respostas.map(p => p.url)}`);
      respostas.splice(i, 1)[0].ok(json(status, corpo));
      for (let k = 0; k < 5; k++) await null;
    },
    pendentes: trecho => respostas.filter(p => p.url.includes(trecho)).length,
    // avança o relógio rodando os timers que vencem
    async andar(ms) {
      const fim = agora + ms;
      for (;;) {
        const [id, tm] = [...timers].sort((a, b) => a[1].em - b[1].em)[0] || [];
        if (!tm || tm.em > fim) break;
        agora = tm.em; timers.delete(id); tm.f();
        for (let k = 0; k < 5; k++) await null;
      }
      agora = fim;
    },
    proximoTimer: () => Math.min(...[...timers.values()].map(x => x.em)) - agora,
    get agora() { return agora; },
    set agora(v) { agora = v; },
  };
  return t;
}
const AO_VIVO = (seq, pessoas = [], mensagens = []) => ({ seq, pessoas, mensagens });
const ANA = { usuario: "ana", nome: "Ana", aparencia: { color: "#e11d48", eyes: "round", accessory: "" }, x: 160, y: 100, destino: null, sala: "recepcao", olha: "dir" };

(async () => {
  // polling: andar na query, desde = último seq, evento "aovivo" com a resposta inteira, 1,5 s visível e 10 s escondida
  {
    const t = carregar({ hash: `#andar=${ID}` });
    t.Vida.aoVivo({ invisivel: () => false });
    assert.equal(t.pendentes(`api/perfil?andar=${ID}`), 1);
    assert.equal(t.pendentes(`api/ao-vivo?desde=0&andar=${ID}`), 1);
    const r = AO_VIVO(7, [ANA], [{ seq: 6, usuario: "ana", nome: "Ana", texto: "<b>oi</b>", em: "x" }]);
    await t.responder("api/ao-vivo", 200, r);
    const ev = t.eventos.filter(e => e.type === "aovivo");
    assert.equal(ev.length, 1);
    assert.equal(ev[0].detail.mensagens[0].texto, "<b>oi</b>");   // o vida.js repassa; quem mostra (textContent) é o chat
    assert.equal(t.proximoTimer(), 1500);
    await t.andar(1500);
    assert.equal(t.pendentes(`api/ao-vivo?desde=7&andar=${ID}`), 1);
    t.doc.hidden = true;
    await t.responder("api/ao-vivo", 200, AO_VIVO(7, [ANA]));
    assert.equal(t.proximoTimer(), 10000);
    // a pessoa aparece com nome e boneco do servidor; sem destino, fica onde está
    const [p] = t.Vida.pessoas();
    assert.equal(p.nome, "Ana"); assert.equal(p.ap.color, "#e11d48"); assert.deepEqual([p.x, p.y], [160, 100]);
  }

  // backoff em 429 e queda; volta ao normal quando responde
  {
    const t = carregar();
    t.Vida.aoVivo({ invisivel: () => false });
    assert.equal(t.pendentes("api/ao-vivo?desde=0"), 1);
    assert.ok(!t.pedidos.some(p => p.url.includes("andar=")), "no principal nada é acrescentado");
    await t.responder("api/ao-vivo", 429, { erro: "limite" });
    assert.equal(t.proximoTimer(), 3000);
    await t.andar(3000);
    await t.responder("api/ao-vivo", 500, {});
    assert.equal(t.proximoTimer(), 6000);
    await t.andar(6000);
    await t.responder("api/ao-vivo", 200, { lixo: true });   // resposta sem seq nem pessoas: conta como falha
    assert.equal(t.proximoTimer(), 12000);
    await t.andar(12000);
    await t.responder("api/ao-vivo", 200, AO_VIVO(1));
    assert.equal(t.proximoTimer(), 1500);
    assert.equal(t.eventos.filter(e => e.type === "aovivo").length, 1);
  }

  // a TV (e quem desligou "Aparecer") lê com ?invisivel=1, não ganha boneco e não manda presença
  {
    const t = carregar();
    t.Vida.aoVivo({ invisivel: () => true });
    assert.equal(t.pendentes("api/ao-vivo?desde=0&invisivel=1"), 1);
    await t.responder("api/perfil", 200, { usuario: "eu", nome: "Eu", avatar: null });
    const m = t.Vida.criarMundo(predio());
    t.Vida.passo(m, 0.05);
    assert.equal(t.Vida.pessoas().length, 0);
    assert.equal(t.Vida.irAte(m, { x: 160, y: 250 }), false);
    assert.equal(t.pendentes("api/presenca"), 0);
    assert.ok(!t.eventos.some(e => e.type === "minha-sala"));
  }

  // o meu boneco: nasce na calçada, manda a posição, entra na recepção ("minha-sala"), anda pelo clique mandando só o
  // destino, no máximo 2 POST por segundo, e avisa ao chegar
  {
    const t = carregar({ hash: `#andar=${ID}` });
    t.Vida.aoVivo({ invisivel: () => false });
    await t.responder("api/perfil", 200, { usuario: "eu", nome: "Eu Mesmo", avatar: null });
    const m = t.Vida.criarMundo(predio());
    t.Vida.passo(m, 0.05);
    const eu = t.Vida.pessoas().find(p => p.eu);
    assert.equal(eu.nome, "Eu Mesmo (você)");
    assert.equal(eu.ap.color, "padrao:eu");   // sem boneco salvo: o mesmo padrão do "Meu perfil"
    const salas = () => t.eventos.filter(e => e.type === "minha-sala").map(e => ({ ...e.detail }));   // cópia: o objeto vem de outro realm (vm)
    assert.deepEqual(salas(), [], "só depois de o servidor aceitar a sala");
    const posts = () => t.pedidos.filter(p => p.url.startsWith("api/presenca"));
    assert.equal(posts().length, 1);
    assert.equal(posts()[0].url, `api/presenca?andar=${ID}`);
    assert.equal(posts()[0].opcoes.method, "POST");
    assert.equal(posts()[0].opcoes.headers["Content-Type"], "application/json");
    const corpo0 = JSON.parse(posts()[0].opcoes.body);
    assert.deepEqual(Object.keys(corpo0).sort(), ["destino", "olha", "sala", "x", "y"]);
    assert.ok(corpo0.destino[1] < 140 && corpo0.destino[1] > 60, "o destino é dentro da recepção");
    await t.responder("api/presenca", 200, { seq: 1 });
    assert.deepEqual(salas(), [{ sala: "", nome: "Corredor", andar: ID, seq: 1 }], "o seq do POST que mudou a sala vai junto");
    const okPosts = async () => { while (t.pendentes("api/presenca")) await t.responder("api/presenca", 200, { seq: 2 }); };
    // anda até entrar na recepção
    for (let i = 0; i < 400 && eu.sala !== "recepcao"; i++) { t.agora += 50; t.Vida.passo(m, 0.05); await t.andar(0); }
    assert.equal(eu.sala, "recepcao");
    await t.andar(600);
    // o servidor recusou (429): nada de evento; 2 s depois manda de novo e, aceito, avisa com o nome da sala
    await t.responder("api/presenca", 429, { erro: "limite" });
    assert.equal(salas().at(-1).sala, "");
    await t.andar(2000);
    await t.responder("api/presenca", 200, { seq: 3 });
    assert.deepEqual(salas().at(-1), { sala: "recepcao", nome: "Recepção", andar: ID, seq: 3 });
    for (let i = 0; i < 400 && eu.rota.length; i++) { t.agora += 50; t.Vida.passo(m, 0.05); await t.andar(0); await okPosts(); }
    await t.andar(600); await okPosts();
    const chegou = JSON.parse(posts().at(-1).opcoes.body);
    assert.equal(chegou.destino, null); assert.equal(chegou.sala, "recepcao");
    // clique fora do prédio: nada; clique na reunião: rota pela porta e corredor, um POST com o destino
    assert.equal(t.Vida.irAte(m, { x: 5, y: 5 }), false);
    const antes = posts().length;
    t.agora += 1000;
    assert.equal(t.Vida.irAte(m, { x: 160, y: 260 }), true);
    assert.equal(posts().length, antes + 1);
    const ida = JSON.parse(posts().at(-1).opcoes.body);
    assert.ok(Math.abs(ida.destino[0] - 160) <= 4 && Math.abs(ida.destino[1] - 260) <= 4, JSON.stringify(ida));
    assert.ok(eu.rota.some(([x, y]) => y === 170), "passa pelo corredor");
    // cliques seguidos: no máximo 2 por segundo, e o último destino vence
    t.Vida.irAte(m, { x: 120, y: 260 }); t.Vida.irAte(m, { x: 200, y: 260 });
    assert.equal(posts().length, antes + 1);
    await t.andar(500);
    assert.equal(posts().length, antes + 2);
    assert.ok(Math.abs(JSON.parse(posts().at(-1).opcoes.body).destino[0] - 200) <= 4);
    // outro andar: some o meu boneco ("minha-sala" null do andar de antes), as pessoas saem, o seq recomeça
    await t.responder("api/ao-vivo", 200, AO_VIVO(40, [ANA]));
    assert.equal(t.Vida.pessoas().filter(p => !p.eu).length, 1);
    await t.andar(1500);   // o pedido seguinte (desde=40) fica no ar durante a troca
    t.Andar.definir("principal");
    const velho = t.pedidos.length;
    t.Vida.aoVivo(null);
    assert.deepEqual(salas().at(-1), { sala: null, nome: null, andar: ID, seq: 40 });
    assert.equal(t.Vida.pessoas().length, 0);
    t.Vida.aoVivo({ invisivel: () => false });
    assert.ok(t.pedidos.slice(velho).some(p => p.url === "api/ao-vivo?desde=0"));
    // a resposta atrasada do andar de antes é ignorada (nem pessoas nem evento)
    const nEv = t.eventos.filter(e => e.type === "aovivo").length;
    await t.responder(`api/ao-vivo?desde=40&andar=${ID}`, 200, AO_VIVO(41, [ANA]));
    assert.equal(t.eventos.filter(e => e.type === "aovivo").length, nEv);
    assert.equal(t.Vida.pessoas().filter(p => !p.eu).length, 0);
  }

  // os outros: andam até o destino novo pelo caminho; quem some da lista sai do mapa; nome longo é cortado
  {
    const t = carregar();
    t.Vida.aoVivo({ invisivel: () => true });
    const m = t.Vida.criarMundo(predio());
    t.Vida.passo(m, 0.05);
    await t.responder("api/ao-vivo", 200, AO_VIVO(1, [{ ...ANA, nome: "N".repeat(90), destino: [160, 260] }]));
    const [p] = t.Vida.pessoas();
    assert.equal(p.nome.length, 40);
    assert.deepEqual([p.x, p.y], [160, 100]);
    assert.equal(p.pose, "parado");
    t.Vida.passo(m, 0.05);
    assert.equal(p.pose, "andando");
    for (let i = 0; i < 400 && p.rota.length; i++) t.Vida.passo(m, 0.05);
    assert.deepEqual([Math.round(p.x), Math.round(p.y)], [160, 260]);
    assert.equal(p.olha, "dir");   // parado, olha para onde o servidor diz
    await t.andar(1500);
    await t.responder("api/ao-vivo", 200, AO_VIVO(2, []));
    assert.equal(t.Vida.pessoas().length, 0);
  }
  // o meu nome e boneco vêm do servidor (a aparência efetiva do /api/perfil, a mesma que os outros veem), relidos a cada
  // ~15 s; a minha entrada no /api/ao-vivo, se vier, também vale e não vira outra pessoa. Vida.olhando conta os outros
  {
    const t = carregar();
    t.Vida.aoVivo({ invisivel: () => false });
    assert.equal(t.Vida.olhando(), null, "antes da 1ª leitura");
    await t.responder("api/perfil", 200, { usuario: "eu", nome: "Eu", avatar: null, papel: "membro", aparencia: { color: "teal", eyes: "dots", accessory: "" } });
    const m = t.Vida.criarMundo(predio());
    t.Vida.passo(m, 0.05);
    const eu = t.Vida.pessoas().find(p => p.eu);
    assert.equal(eu.ap.color, "teal", "sem boneco salvo: o padrão do servidor, não o do front");
    await t.responder("api/ao-vivo", 200, AO_VIVO(1, [ANA]));
    assert.equal(t.Vida.olhando(), 1);
    for (let i = 0; i < 10; i++) { await t.andar(1500); await t.responder("api/ao-vivo", 200, AO_VIVO(1, [ANA])); }
    assert.equal(t.pendentes("api/perfil"), 1, "relê o perfil a cada ~15 s");
    await t.responder("api/perfil", 200, { usuario: "eu", nome: "Eu Novo", avatar: { color: "rose", eyes: "happy", accessory: "cap" }, aparencia: { color: "rose", eyes: "happy", accessory: "cap" } });
    assert.equal(eu.nome, "Eu Novo (você)"); assert.equal(eu.ap.color, "rose");
    await t.andar(1500);
    await t.responder("api/ao-vivo", 200, AO_VIVO(2, [ANA, { ...ANA, usuario: "eu", nome: "Eu De Novo", aparencia: { color: "amber", eyes: "round", accessory: "" } }]));
    assert.equal(t.Vida.olhando(), 1, "eu não conto como outro");
    assert.equal(t.Vida.pessoas().filter(p => !p.eu).length, 1);
    assert.equal(eu.nome, "Eu De Novo (você)"); assert.equal(eu.ap.color, "amber");
    t.Vida.aoVivo(null);
    assert.equal(t.Vida.olhando(), null);
  }
  console.log("test_mundo_presenca: ok");
})().catch(e => { console.error(e); process.exit(1); });
