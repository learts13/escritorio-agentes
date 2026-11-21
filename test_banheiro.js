"use strict";
// O banheiro dos terminais (static/vida.js, predio.banheiro do mapa.js): quem precisa entra na fila do corredor, na frente
// da porta; o da frente vai à primeira cabine vaga e some lá dentro (a cabine fica ocupada), até uma pessoa por cabine;
// quem está apertado fura a fila; mudou de estado, sai da fila (e libera a cabine). Ponte e prédio falsos.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ANDAR = fs.readFileSync("static/expediente.js", "utf8");
const VIDA = fs.readFileSync("static/vida.js", "utf8");

// a recepção em cima; embaixo, a sala comunal e o banheiro (porta em x=400, três cabines na parede do fundo)
function predio() {
  const recepcao = { tipo: "recepcao", chave: "recepcao", nome: "Recepção", px: 100, py: 40, pw: 120, ph: 100, chao: 60, porta: { x: 160 } };
  const lounge = { tipo: "lounge", chave: "lounge", nome: "Sala comunal", px: 100, py: 200, pw: 120, ph: 100, chao: 236, portas: [160] };
  const wc = { tipo: "banheiro", chave: "banheiro", nome: "Banheiro", px: 240, py: 200, pw: 192, ph: 100, chao: 236, portas: [400] };
  const cabines = [0, 1, 2].map(i => ({ x: 258 + i * 26, y: 283, px: 244 + i * 26, chao: 236, ocupada: false }));
  return { salas: [recepcao], baixo: [lounge, wc], vagas: [], objetos: [], animados: [], livre: () => true, corredorY: 170, corredorTopo: 150,
    corredorAlt: 40, predioRet: { x: 60, y: 30, w: 460, h: 300 }, entrada: { x: 62, calcadaY: 350 },
    banheiro: { x: 400, y: 170, sala: wc, cabines } };
}

function carregar(terminais) {
  let agora = 0, versao = 1;
  const contexto = {
    location: { hash: "" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { hidden: false, addEventListener() {} }, console,
    performance: { now: () => agora }, setTimeout: () => 0, clearTimeout() {},
    CustomEvent: class { constructor(tipo, o) { this.type = tipo; this.detail = o.detail; } },
    Ceu: { agora: () => ({ h: 10, escuro: 0 }) }, matchMedia: () => ({ matches: false }), URLSearchParams, Date, Math,
    Ponte: { versao: () => versao, terminais: () => terminais, workspace: () => "", band: () => "" },
    fetch: () => new Promise(() => {}),
  };
  contexto.window = contexto; contexto.dispatchEvent = () => {};
  vm.runInNewContext(ANDAR + "\n" + VIDA, contexto);
  const Vida = contexto.Vida, m = Vida.criarMundo(predio());
  return {
    Vida, m, mudar() { versao++; },
    passos(n, ate = () => false) { for (let i = 0; i < n; i++) { agora += 50; Vida.passo(m, 0.05); if (ate()) return true; } return false; },
  };
}
const terminal = (id, estado = "livre") => ({ id, nome: id, provedor: id, estado, ajudantes: 0, workspace: "w", band: "" });
// todo mundo satisfeito, menos a bexiga: a próxima atividade de cada um é o banheiro
function apertar(t, bexiga) {
  for (const k of t.Vida.terminais()) { for (const n in k.nec) k.nec[n] = 100; k.nec.bexiga = bexiga(k); k.proxAtiv = 0; }
}

// quatro precisam ao mesmo tempo: três entram, um por cabine (que ficam ocupadas), e o quarto espera na fila do corredor,
// na frente da porta; depois todos saem com a bexiga cheia e as cabines vagam
{
  const t = carregar(["a", "b", "c", "d"].map(id => terminal(id)));
  t.passos(2);
  apertar(t, () => 40);
  const b = t.m.predio.banheiro, dentro = () => t.Vida.terminais().filter(k => k.dentro);
  assert.ok(t.passos(400, () => dentro().length === 3), "três lá dentro ao mesmo tempo");
  assert.ok(b.cabines.every(c => c.ocupada), "as três cabines ocupadas");
  const fora = t.Vida.terminais().find(k => !k.dentro);
  assert.equal(fora.ativ.tipo, "wc"); assert.equal(fora.ativ.fase, "fila");
  t.passos(100, () => !fora.rota.length);
  assert.deepEqual([fora.x, fora.y], [b.x, b.y], "espera no corredor, na porta do banheiro");
  for (const k of dentro()) {
    const c = b.cabines.find(q => q.quem === k.id);
    assert.ok(c && k.x === c.x && k.y === c.y, "entrou na cabine reservada para ele");
  }
  assert.ok(t.passos(800, () => t.Vida.terminais().every(k => k.nec.bexiga > 90 && !k.dentro && !k.ativ)), "todos usaram e saíram");
  assert.ok(b.cabines.every(c => !c.ocupada && !c.quem), "as cabines vagaram");
}

// o apertado fura a fila: com as cabines tomadas, quem chega apertado vai para a frente (com o "!") e entra primeiro
{
  const t = carregar(["a", "b", "c"].map(id => terminal(id)));
  t.passos(2);
  const b = t.m.predio.banheiro, [ka, kb, kc] = t.Vida.terminais();
  for (const c of b.cabines) c.quem = "outro";   // tomadas por alguém de fora
  apertar(t, k => (k === kc ? 100 : 40));
  assert.ok(t.passos(400, () => [ka, kb].every(k => k.ativ && k.ativ.fase === "fila" && !k.rota.length)), "os dois na fila");
  kc.nec.bexiga = 5; kc.proxAtiv = 0;
  assert.ok(t.passos(400, () => kc.ativ && kc.ativ.fase === "fila" && !kc.rota.length), "o apertado chegou");
  assert.deepEqual([kc.x, kc.y], [b.x, b.y], "furou: está na porta");
  assert.ok(kc.ativ.alerta, "com o \"!\"");
  assert.deepEqual([ka, kb].map(k => b.x - k.x).sort((x, y) => x - y), [14, 28], "os outros andaram um lugar para trás");
  b.cabines[1].quem = null;
  assert.ok(t.passos(400, () => kc.dentro), "entra primeiro");
  assert.equal(b.cabines[1].quem, kc.id);
  assert.ok(![ka, kb].some(k => k.dentro));
}

// mudou de estado lá dentro: sai na hora e a cabine vaga
{
  const lista = [terminal("a")];
  const t = carregar(lista);
  t.passos(2);
  apertar(t, () => 40);
  const b = t.m.predio.banheiro, a = t.Vida.terminais()[0];
  assert.ok(t.passos(400, () => a.dentro), "entrou");
  assert.equal(b.cabines.filter(c => c.ocupada).length, 1);
  lista[0] = terminal("a", "ocupado"); t.mudar();
  t.passos(2);
  assert.equal(a.dentro, false, "saiu"); assert.ok(b.cabines.every(c => !c.ocupada && !c.quem), "a cabine vagou");
}

console.log("test_banheiro.js: ok");
