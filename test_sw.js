"use strict";
// Service worker (static/sw.js): o push chega vazio e o texto sai do GET /api/avisos. Os avisos de agente ficam como
// sempre; os pessoais (menção, DM, aceno, porta: E.4) usam o título e o corpo que o servidor já manda limpos.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function carregar(resposta, abas = []) {
  const ouvintes = {}, mostradas = [], abertas = [], focadas = [];
  const self = {
    addEventListener: (t, f) => (ouvintes[t] = f),
    registration: { scope: "https://escritorio.exemplo/", showNotification: (titulo, op) => { mostradas.push({ titulo, ...op }); return Promise.resolve(); } },
    clients: { claim() {}, matchAll: async () => abas, openWindow: async url => abertas.push(url) },
    skipWaiting() {},
  };
  const fetch = async () => (resposta instanceof Error ? Promise.reject(resposta) : { ok: true, json: async () => resposta });
  vm.runInNewContext(fs.readFileSync("static/sw.js", "utf8"), { self, fetch, URL, Object, Promise });
  const push = async () => { let p; ouvintes.push({ waitUntil: x => (p = x) }); await p; return mostradas[0]; };
  const tocar = async data => { let p; ouvintes.notificationclick({ notification: { close() {}, data }, waitUntil: x => (p = x) }); await p; return abertas[0]; };
  return { push, tocar, focadas };
}

(async () => {
  // agente: o de sempre, sem o rótulo da tarefa
  {
    const n = await carregar({ aviso: { agente: "a1", nome: "Rex", tipo: "pediu_aprovacao", quando: 1 } }).push();
    assert.equal(n.titulo, "Rex pede a sua aprovação");
    assert.equal(n.body, "Toque para abrir o escritório.");
    assert.equal(n.data.agente, "a1");
  }
  // menção e DM: o título e o começo da mensagem vêm prontos do servidor
  {
    const n = await carregar({ aviso: { tipo: "mencao", quando: 1, titulo: "Ana · #geral", corpo: "olha o relatório de…", andar: "a1b2c3d4", canal: "geral" } }).push();
    assert.equal(n.titulo, "Ana · #geral");
    assert.equal(n.body, "olha o relatório de…");
    assert.equal(n.data.agente, null);
    assert.equal(n.data.andar, "a1b2c3d4");
    assert.equal(n.data.canal, "geral");
  }
  // o canal só no formato do contrato (geral, sala:<chave>, dm:<n>); fora disso fica de fora
  for (const [canal, esperado] of [["sala:cozinha", "sala:cozinha"], ["dm:4", "dm:4"], ["dm:x", null], ["outro", null], [3, null]]) {
    const n = await carregar({ aviso: { tipo: "dm", titulo: "Ana", corpo: "", andar: "a1b2c3d4", canal } }).push();
    assert.equal(n.data.canal, esperado, String(canal));
  }
  // "mostrar o começo" desligado: corpo vazio vira o texto genérico, sem nada da mensagem
  {
    const n = await carregar({ aviso: { tipo: "dm", quando: 1, titulo: "Ana · mensagem direta", corpo: "", andar: "a1b2c3d4", canal: "dm:4" } }).push();
    assert.equal(n.titulo, "Ana · mensagem direta");
    assert.equal(n.body, "Toque para abrir o escritório.");
  }
  // aceno e porta também
  for (const tipo of ["aceno", "porta"]) {
    const n = await carregar({ aviso: { tipo, quando: 1, titulo: "Ana acenou para você", corpo: "", andar: "a1b2c3d4" } }).push();
    assert.equal(n.titulo, "Ana acenou para você");
  }
  // resposta estranha (tipo fora da lista, título longo demais ou que não é texto, andar fora do formato) e falha de rede:
  // o aviso genérico, sem andar
  for (const r of [{ aviso: { tipo: "outro", titulo: "x", corpo: "y" } }, { aviso: { tipo: "dm", titulo: "x".repeat(121), corpo: "" } },
    { aviso: { tipo: "dm", titulo: 3, corpo: "" } }, { aviso: { tipo: "mencao", titulo: "Ana", corpo: "oi", andar: "../x" } }, new Error("rede")]) {
    const n = await carregar(r).push();
    if (r.aviso && r.aviso.andar === "../x") { assert.equal(n.titulo, "Ana"); assert.equal(n.data.andar, null, "andar fora do formato fica de fora"); continue; }
    assert.equal(n.titulo, "Um agente precisa de você", JSON.stringify(r));
  }
  // o toque abre o escritório no andar do aviso
  {
    const url = await carregar({}).tocar({ agente: null, andar: "a1b2c3d4" });
    assert.equal(url, "https://escritorio.exemplo/#andar=a1b2c3d4");
    assert.equal(await carregar({}).tocar({ agente: "a1", andar: null }), "https://escritorio.exemplo/?agente=a1");
  }
  // com o escritório já aberto: foca a aba e manda o andar e o canal do aviso pessoal (o app.js troca de andar e abre o canal)
  {
    const recebidas = [], focos = [];
    const aba = { url: "https://escritorio.exemplo/#andar=0badc0de", postMessage: m => recebidas.push(m), focus: () => focos.push(1) };
    const sw = carregar({}, [aba]);
    assert.equal(await sw.tocar({ agente: null, andar: "a1b2c3d4", canal: "dm:4" }), undefined, "não abre outra aba");
    assert.deepEqual(JSON.parse(JSON.stringify(recebidas)), [{ tipo: "aviso", andar: "a1b2c3d4", canal: "dm:4" }]);
    assert.equal(focos.length, 1);
    recebidas.length = 0;
    await carregar({}, [aba]).tocar({ agente: "a1", andar: null, canal: null });
    assert.deepEqual(JSON.parse(JSON.stringify(recebidas)), [{ tipo: "agente", agente: "a1" }], "o aviso de agente continua o de sempre");
  }
  // instalação de uma empresa só: o aviso pessoal vem do principal e o toque também leva ao canal
  {
    const n = await carregar({ aviso: { tipo: "dm", titulo: "Ana", corpo: "", andar: "principal", canal: "dm:4" } }).push();
    assert.equal(n.data.andar, "principal");
    assert.equal(await carregar({}).tocar({ agente: null, andar: "principal" }), "https://escritorio.exemplo/#andar=principal");
    const recebidas = [], aba = { url: "https://escritorio.exemplo/", postMessage: m => recebidas.push(m), focus() {} };
    await carregar({}, [aba]).tocar({ agente: null, andar: "principal", canal: "dm:4" });
    assert.deepEqual(JSON.parse(JSON.stringify(recebidas)), [{ tipo: "aviso", andar: "principal", canal: "dm:4" }]);
  }
  // Onda 3: "Reunião em 5 min" e a convocação para a reunião geral, com título e corpo do servidor
  {
    const n = await carregar({ aviso: { tipo: "reuniao", titulo: "Reunião em 5 min · Planejamento", corpo: "Sala de reunião", andar: "a1b2c3d4",
      canal: null, sala: "reuniao", reuniao: 12, quando: 1 } }).push();
    assert.equal(n.titulo, "Reunião em 5 min · Planejamento");
    assert.equal(n.body, "Sala de reunião");
    assert.equal(n.data.andar, "a1b2c3d4");
    assert.equal(n.data.reuniao, 12);
    assert.equal(n.data.canal, null);
    const c = await carregar({ aviso: { tipo: "convocacao", titulo: "Beto chamou a equipe", corpo: "", andar: "a1b2c3d4", canal: null, sala: "reuniao" } }).push();
    assert.equal(c.titulo, "Beto chamou a equipe");
    assert.equal(c.body, "Toque para abrir o escritório.", "sem o começo: o genérico");
    assert.equal(c.data.reuniao, null);
    for (const reuniao of ["12", -1, 1.5, 2 ** 60]) {
      const x = await carregar({ aviso: { tipo: "reuniao", titulo: "Reunião em 5 min", corpo: "", andar: "a1b2c3d4", reuniao } }).push();
      assert.equal(x.data.reuniao, null, String(reuniao));
    }
  }
  // o toque na reunião: abre a agenda do andar nessa reunião (?reuniao=); com a aba aberta, manda para ela
  {
    assert.equal(await carregar({}).tocar({ agente: null, andar: "a1b2c3d4", canal: null, reuniao: 12 }), "https://escritorio.exemplo/?reuniao=12#andar=a1b2c3d4");
    const recebidas = [], aba = { url: "https://escritorio.exemplo/", postMessage: m => recebidas.push(m), focus() {} };
    await carregar({}, [aba]).tocar({ agente: null, andar: "a1b2c3d4", canal: null, reuniao: 12 });
    assert.deepEqual(JSON.parse(JSON.stringify(recebidas)), [{ tipo: "reuniao", andar: "a1b2c3d4", reuniao: 12 }]);
    // a convocação vai ao mapa do andar (o boneco anda até a sala pelo /api/ao-vivo)
    recebidas.length = 0;
    await carregar({}, [aba]).tocar({ agente: null, andar: "a1b2c3d4", canal: null, reuniao: null });
    assert.deepEqual(JSON.parse(JSON.stringify(recebidas)), [{ tipo: "aviso", andar: "a1b2c3d4", canal: null }]);
  }
  console.log("test_sw.js ok");
})().catch(e => { console.error(e); process.exit(1); });
