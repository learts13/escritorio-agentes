"use strict";
// Ponte local (static/ponte.js, Firmópolis onda 2): liga só com token, pede o subprotocolo certo, confere cada morador do
// contrato v1, tira o terminal no "saiu", limpa tudo quando a ponte cai e tenta de novo sozinha.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const TOKEN = "ab".repeat(32);
const abertos = [], timers = [], pedidos = [];
let respostaSrv = { status: 404, corpo: "" };   // o GET /api/ponte (o espelho no servidor)
class FalsoWS {
  constructor(url, protocolos) { this.url = url; this.protocolos = protocolos; abertos.push(this); }
  close() { this.fechado = true; }
}
function criar(tokenSalvo) {
  abertos.length = 0; timers.length = 0; pedidos.length = 0;
  const guardado = new Map(tokenSalvo ? [["firmopolis.ponte", tokenSalvo]] : []), eventos = [];
  const contexto = {
    WebSocket: FalsoWS, JSON, Object, Math, Map, Array, CustomEvent: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: k => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v), removeItem: k => guardado.delete(k) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    document: { readyState: "complete", hidden: false, getElementById: () => null, addEventListener() {} },
    location: { origin: "https://escritorio.exemplo.com" },
    fetch: async (url, op) => { pedidos.push({ url, op }); const r = respostaSrv; return { ok: r.status === 200, status: r.status, text: async () => r.corpo }; },
  };
  contexto.window = { dispatchEvent: e => eventos.push(e.type), addEventListener() {} };
  vm.runInNewContext(fs.readFileSync("static/ponte.js", "utf8"), contexto);
  return { Ponte: contexto.window.Ponte, eventos, guardado };
}
const mensagem = (ws, d) => ws.onmessage({ data: JSON.stringify(d) });
const morador = (id, estado, extra = {}) => ({ id, nome: "Ada", provedor: "codex", estado, projeto: "loja", atividade: { ferramenta: "Edit" }, ...extra });

// sem token salvo: nenhuma conexão
let { Ponte } = criar(null);
assert.equal(abertos.length, 0, "sem token, a ponte nem é procurada");
assert.equal(Ponte.situacao(), "desligada");

// token inválido no armazenamento é ignorado
criar("nao-e-hex");
assert.equal(abertos.length, 0);

// com token: um WebSocket para 127.0.0.1, com o token como subprotocolo
const p = criar(TOKEN);
Ponte = p.Ponte;
assert.equal(abertos.length, 1);
const ws = abertos[0];
assert.equal(ws.url, "ws://127.0.0.1:47820/ws");
assert.deepEqual([...ws.protocolos], ["firmopolis.v1", "token." + TOKEN]);
ws.onopen();
assert.equal(Ponte.situacao(), "ligada");

// snapshot: só moradores válidos, com o estado traduzido e o programa pelo nome
mensagem(ws, { v: 1, tipo: "snapshot", moradores: [
  morador("a", "ocupado"), morador("b", "esperando_permissao"), morador("c", "esperando_resposta"), morador("d", "ocioso"), morador("e", "erro"),
  morador("f", "dormindo"), { id: "", estado: "ocupado" }, null, morador("g\u0000", "ocupado", { nome: "x".repeat(300), provedor: "outro" })] });
const lista = Ponte.terminais();
assert.deepEqual([...lista.map(t => t.estado)], ["ocupado", "aprovacao", "pergunta", "livre", "erro", "ocupado"]);
assert.equal(lista[0].provedor, "Codex");
assert.equal(lista[5].id, "g", "caractere de controle sai");
assert.equal(lista[5].nome.length, 40, "nome cortado");
assert.equal(lista[5].provedor, "Terminal", "programa desconhecido");
assert.ok(p.eventos.includes("ponte"));

// versão do contrato diferente: ignorada
const v0 = Ponte.versao();
mensagem(ws, { v: 2, tipo: "saiu", id: "a" });
assert.equal(Ponte.versao(), v0);

// mudança e saída
mensagem(ws, { v: 1, tipo: "morador", morador: morador("a", "esperando_resposta") });
assert.equal(Ponte.terminais().find(t => t.id === "a").estado, "pergunta");
mensagem(ws, { v: 1, tipo: "saiu", id: " a " });
assert.ok(!Ponte.terminais().some(t => t.id === "a"), "o id do saiu passa pela mesma limpeza");

// os campos novos (onda 6): papel, workspace, band, ajudantes, desde e solto, conferidos e cortados
mensagem(ws, { v: 1, tipo: "snapshot", workspaces: [
  { id: "w1", nome: "Loja", bands: [{ id: "b1", nome: "Front" }, { id: "", nome: "sem id" }, ...Array.from({ length: 40 }, (_, i) => ({ id: "x" + i, nome: "B" }))] },
  ...Array.from({ length: 40 }, (_, i) => ({ id: "w" + (i + 2), nome: "W\u0007" + i, bands: null })), null],
  moradores: [
    morador("m", "ocupado", { gerente: true, papel: "Maestro", workspace_id: "w1", band_id: "b1", ajudantes: 2, desde: "2026-11-20T10:00:00Z", solto: false }),
    morador("n", "ocioso", { papel: "p".repeat(80), workspace_id: 5, band_id: null, ajudantes: 500, desde: "ontem", solto: true }),
    morador("o", "ocioso", { ajudantes: -3 }), morador("q", "ocioso", { ajudantes: 1.5 })] });
const [tm, tn, to, tq] = Ponte.terminais();
assert.deepEqual([tm.papel, tm.workspace, tm.band, tm.ajudantes, tm.desde, tm.solto, tm.gerente], ["Maestro", "w1", "b1", 2, "2026-11-20T10:00:00Z", false, true]);
assert.deepEqual([tn.papel.length, tn.workspace, tn.band, tn.ajudantes, tn.desde, tn.solto], [40, "", "", 99, "", true], "corta, confere e limita");
assert.equal(to.ajudantes, 0); assert.equal(tq.ajudantes, 0);
assert.equal(Ponte.workspace("w1"), "Loja");
assert.equal(Ponte.band("w1", "b1"), "Front");
assert.equal(Ponte.band("w1", "x29"), "B");
assert.equal(Ponte.band("w1", "x30"), "", "32 bands por workspace (o sem id conta)");
assert.equal(Ponte.workspace("w32"), "W30", "controle sai");
assert.equal(Ponte.workspace("w33"), "", "32 workspaces");
assert.equal(Ponte.workspace("nada"), ""); assert.equal(Ponte.band("nada", "b1"), "");
// só as bands em uso (com terminal vivo) viram sugestão de sala; a band "B" das 30 vazias não entra
assert.deepEqual([...Ponte.bands()], ["Loja"], "a sala é o workspace, não a band");
mensagem(ws, { v: 1, tipo: "morador", morador: morador("r", "ocupado", { workspace_id: "w2", band_id: null }) });
assert.deepEqual([...Ponte.bands()], ["Loja", "W0"], "um por workspace em uso");

// o dia: por morador, com a hora em ms, o estado traduzido (desconhecido sai), a ferramenta cortada e os 200 mais novos
const evs = [{ ts: "2026-11-20T10:05:00Z", morador_id: "m", estado: "ocioso", ferramenta: "" },
  { ts: "2026-11-20T10:00:00Z", morador_id: "m", estado: "ocupado", ferramenta: "Edit".repeat(20), alvo: "segredo" },
  { ts: "2026-11-20T10:06:00Z", morador_id: "m", estado: "dormindo", ferramenta: "x" }, { ts: "quando?", morador_id: "m", estado: "ocupado" },
  ...Array.from({ length: 250 }, (_, i) => ({ ts: new Date(Date.UTC(2026, 10, 20, 11, 0, i)).toISOString(), morador_id: "n", estado: "ocupado", ferramenta: "Bash" + i }))];
mensagem(ws, { v: 1, tipo: "dia", eventos: evs });
const dm = Ponte.dia("m");
assert.deepEqual([...dm.map(e => e.estado)], ["ocupado", "livre"], "em ordem, sem o desconhecido nem a hora quebrada");
assert.equal(dm[0].ts, Date.parse("2026-11-20T10:00:00Z"));
assert.equal(dm[0].ferramenta.length, 40);
assert.ok(!("alvo" in dm[0]), "o alvo nunca fica");
const dn = Ponte.dia("n");
assert.equal(dn.length, 200, "teto de 200");
assert.equal(dn.at(-1).ferramenta, "Bash249", "ficam os mais novos");
dm.push({}); assert.equal(Ponte.dia("m").length, 2, "o dia sai em cópia");

// mudou o estado ou a ferramenta: um evento a mais, com a hora de agora; igual, nada
mensagem(ws, { v: 1, tipo: "morador", morador: morador("m", "ocupado", { atividade: { ferramenta: "Bash" } }) });
assert.equal(Ponte.dia("m").length, 3);
assert.equal(Ponte.dia("m").at(-1).ferramenta, "Bash");
assert.ok(Date.now() - Ponte.dia("m").at(-1).ts < 5000);
mensagem(ws, { v: 1, tipo: "morador", morador: morador("m", "ocupado", { atividade: { ferramenta: "Bash" }, projeto: "outro" }) });
assert.equal(Ponte.dia("m").length, 3, "sem duplicar");
mensagem(ws, { v: 1, tipo: "morador", morador: morador("m", "esperando_permissao", { atividade: { ferramenta: "Bash" } }) });
assert.equal(Ponte.dia("m").at(-1).estado, "aprovacao");

// um dia novo substitui o inteiro
mensagem(ws, { v: 1, tipo: "dia", eventos: [] });
assert.equal(Ponte.dia("m").length, 0); assert.equal(Ponte.dia("n").length, 0);
mensagem(ws, { v: 1, tipo: "dia", eventos: [{ ts: "2026-11-20T10:00:00Z", morador_id: "m", estado: "ocupado", ferramenta: "Edit" }] });

// JSON quebrado não derruba nada
ws.onmessage({ data: "{nao" });

const religar = () => timers.filter(t => t.fn.name === "conectar").at(-1);
// a ponte caiu: os terminais saem do mapa e a reconexão é agendada, com espera crescente
ws.onclose();
assert.equal(Ponte.terminais().length, 0);
assert.equal(Ponte.dia("m").length, 0, "o dia sai junto");
assert.equal(Ponte.workspace("w1"), "", "e os workspaces");
assert.equal(Ponte.situacao(), "sem-ponte");
assert.equal(religar().ms, 3000);
religar().fn();
assert.equal(abertos.length, 2, "tentou de novo");
abertos[1].onclose();
assert.equal(religar().ms, 6000, "a espera dobra");

// ---------- espelho: sem a ponte local, lê do servidor, com a mesma conferência; a local tem prioridade ----------
(async () => {
  const solta = () => new Promise(r => setImmediate(r));
  const lerSrv = () => timers.filter(t => t.fn.name === "lerServidor").at(-1);
  const espelho = (moradores, extra = {}) => ({ status: 200, corpo: JSON.stringify({ ativo: true, idade_s: 3, moradores,
    workspaces: [{ id: "w1", nome: "Loja\u0007", bands: [] }], dia: [{ ts: "2026-11-20T10:00:00Z", morador_id: "s1", estado: "ocupado", ferramenta: "Edit", alvo: "x" }], ...extra }) });

  respostaSrv = { status: 200, corpo: JSON.stringify({ ativo: false }) };
  let q = criar(null); await solta();
  assert.equal(pedidos[0].url, "api/ponte", "sem token, pergunta ao servidor");
  assert.equal(pedidos[0].op.cache, "no-store");
  assert.equal(q.Ponte.situacao(), "desligada");
  assert.equal(lerSrv().ms, 30000, "sem espelho, pergunta devagar");

  respostaSrv = espelho([morador("s1", "ocupado", { nome: "x".repeat(90) }), morador("s2", "dormindo"), null]);
  lerSrv().fn(); await solta();
  assert.equal(q.Ponte.situacao(), "servidor");
  assert.deepEqual([...q.Ponte.terminais().map(t => t.id)], ["s1"], "a mesma conferência");
  assert.equal(q.Ponte.terminais()[0].nome.length, 40);
  assert.equal(q.Ponte.workspace("w1"), "Loja");
  assert.equal(q.Ponte.dia("s1").length, 1); assert.ok(!("alvo" in q.Ponte.dia("s1")[0]));
  assert.equal(lerSrv().ms, 3000, "ativo: a cada 3 s");
  const v1 = q.Ponte.versao();
  respostaSrv = espelho([morador("s1", "ocupado", { nome: "x".repeat(90) }), morador("s2", "dormindo"), null], { idade_s: 6 });
  lerSrv().fn(); await solta();
  assert.equal(q.Ponte.versao(), v1, "igual (só a idade mudou): a tela não redesenha");

  respostaSrv = { status: 200, corpo: JSON.stringify({ ativo: false }) };
  lerSrv().fn(); await solta();
  assert.equal(q.Ponte.terminais().length, 0, "o espelho parou: os terminais saem");
  assert.equal(q.Ponte.situacao(), "desligada");

  respostaSrv = { status: 403, corpo: "" };
  lerSrv().fn(); await solta();
  assert.equal(lerSrv().ms, 60000, "sem permissão (saguão): espaça");

  // com a ponte local: o espelho só enquanto ela não liga; ligada, ela manda e o servidor nem é lido
  respostaSrv = espelho([morador("s1", "ocupado")]);
  q = criar(TOKEN); await solta();
  assert.equal(q.Ponte.situacao(), "servidor");
  const local = abertos[0];
  local.onopen();
  assert.equal(q.Ponte.situacao(), "ligada");
  mensagem(local, { v: 1, tipo: "snapshot", moradores: [morador("l1", "ocioso")] });
  const n = pedidos.length;
  lerSrv().fn(); await solta();
  assert.equal(pedidos.length, n, "ligada, o servidor não é lido");
  assert.deepEqual([...q.Ponte.terminais().map(t => t.id)], ["l1"]);
  local.onclose(); await solta();
  assert.equal(q.Ponte.situacao(), "servidor", "a local caiu: volta ao espelho na hora");
  assert.deepEqual([...q.Ponte.terminais().map(t => t.id)], ["s1"]);
  abertos.at(-1).onclose(); await solta();
  assert.deepEqual([...q.Ponte.terminais().map(t => t.id)], ["s1"], "tentar a local de novo não apaga o espelho");

  console.log("test_ponte.js: ok");
})().catch(e => { console.error(e); process.exit(1); });
