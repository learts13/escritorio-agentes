"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const IDS = ["criar", "copiar", "entrar", "revogar", "link", "estado", "agente", "form-senha", "senha", "senha-confirmar", "senha-cancelar"];

async function testar(momentoFalha) {
  const falhaAntes = momentoFalha === "antes";
  const elementos = Object.fromEntries(IDS.map(id => [id, { disabled: false, value: "", textContent: "", focus() {},append() {}, addEventListener(_, fn) { this.click = fn; } }]));
  let chamadas = [];
  let ativo = false;
  const contexto = { document: { getElementById: id => elementos[id] }, location: { origin: "https://exemplo.test" }, navigator: {}, window: {}, fetch: async (url) => {
    if (url === "/api/visitas/anfitrioes") return { ok: true, json: async () => ({ agentes: [] }) };
    chamadas.push(url);
    if (url.endsWith("/criar")) { ativo = true; return { ok: true, json: async () => ({ convite: "primeiro" }) }; }
    if (momentoFalha === "antes") { momentoFalha = null; throw new Error("falha de rede"); }
    const revogado = ativo; ativo = false;
    if (momentoFalha === "depois") { momentoFalha = null; throw new Error("resposta perdida"); }
    return { ok: true, json: async () => ({ ok: revogado }) };
  } };
  vm.runInNewContext(fs.readFileSync("static/visitas-admin.js", "utf8"), contexto);
  await elementos.criar.click();
  await elementos.criar.click();
  assert.equal(elementos.link.value, "https://exemplo.test/visita.html#primeiro");
  assert.equal(elementos.revogar.disabled, false);
  assert.equal(ativo, falhaAntes);
  assert.equal(chamadas.filter(c => c.endsWith("/criar")).length, 1);
  await elementos.revogar.click();
  assert.equal(elementos.link.value, "");
  assert.equal(chamadas.filter(c => c.endsWith("/revogar")).length, 2);
}
async function concorrencia() {
  const elementos = Object.fromEntries(IDS.map(id => [id, { disabled: false, value: "", textContent: "", focus() {},append() {}, addEventListener(_, fn) { this.click = fn; } }]));
  let resolver, criacoes = 0;
  const pendente = new Promise(resolve => { resolver = resolve; });
  const contexto = { document: { getElementById: id => elementos[id] }, location: { origin: "https://exemplo.test" }, navigator: {}, window: {}, fetch: async url => {
    if (url === "/api/visitas/anfitrioes") return { ok: true, json: async () => ({ agentes: [] }) };
    if (url.endsWith("/criar")) return { ok: true, json: async () => ({ convite: `convite${++criacoes}` }) };
    await pendente;
    return { ok: true, json: async () => ({ ok: true }) };
  } };
  vm.runInNewContext(fs.readFileSync("static/visitas-admin.js", "utf8"), contexto);
  await elementos.criar.click();
  const revogacao = elementos.revogar.click();
  const tentativa = elementos.criar.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(criacoes, 1);
  resolver();
  await revogacao;
  await tentativa;
  await elementos.criar.click();
  assert.equal(elementos.link.value, "https://exemplo.test/visita.html#convite2");
}
async function comAgente() {
  const opcoes = [];
  const elementos = Object.fromEntries(IDS.map(id => [id, { disabled: false, value: "", textContent: "", focus() {},append(o) { opcoes.push(o); }, addEventListener(_, fn) { this.click = fn; } }]));
  const corpos = [];
  const contexto = { document: { getElementById: id => elementos[id], createElement: () => ({}) }, location: { origin: "https://exemplo.test" }, navigator: {}, window: {}, fetch: async (url, opcoes) => {
    if (url === "/api/visitas/anfitrioes") return { ok: true, json: async () => ({ agentes: [{ id: "ag-1", nome: "Senku" }, { id: 7 }, { nome: "sem id" }] }) };
    corpos.push(JSON.parse(opcoes.body));
    return { ok: true, json: async () => ({ convite: "c1" }) };
  } };
  vm.runInNewContext(fs.readFileSync("static/visitas-admin.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(opcoes.map(o => [o.value, o.textContent])), '[["ag-1","Senku"]]');
  elementos.agente.value = "ag-1";
  await elementos.criar.click();
  assert.equal(JSON.stringify(corpos), '[{"agente":"ag-1"}]');
}
async function semModoResposta() {
  // o servidor recusa (403, modo resposta fechado): a tela mostra o motivo dele, sem link de convite
  const elementos = Object.fromEntries(IDS.map(id => [id, { disabled: false, value: "", textContent: "", focus() {},append() {}, addEventListener(_, fn) { this.click = fn; } }]));
  const contexto = { document: { getElementById: id => elementos[id], createElement: () => ({}) }, location: { origin: "https://exemplo.test" }, navigator: {}, window: {}, fetch: async url => {
    if (url === "/api/visitas/anfitrioes") return { ok: true, json: async () => ({ agentes: [{ id: "ag-1", nome: "Senku" }] }) };
    return { ok: false, json: async () => ({ erro: "Para pôr um agente na sala, abra antes o modo resposta (com a senha) na tela Conversas." }) };
  } };
  vm.runInNewContext(fs.readFileSync("static/visitas-admin.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  elementos.agente.value = "ag-1";
  await elementos.criar.click();
  assert.match(elementos.estado.textContent, /modo resposta/);
  assert.equal(elementos.link.value, "");
  assert.notEqual(elementos["form-senha"].hidden, false, "sem o código do servidor, não pede senha");
}
async function senhaAliMesmo() {
  // 403 com codigo modo_fechado: a tela pede a senha ali, abre o modo e cria o convite com o agente, sem ir à Conversas
  const elementos = Object.fromEntries(IDS.map(id => [id, { disabled: false, value: "", textContent: "", focus() { this.focado = true; }, append() {}, addEventListener(_, fn) { this.click = fn; } }]));
  const pedidos = [];
  let aberto = false;
  const contexto = { document: { getElementById: id => elementos[id], createElement: () => ({}) }, location: { origin: "https://exemplo.test" }, navigator: {}, window: {}, fetch: async (url, op) => {
    if (url === "/api/visitas/anfitrioes") return { ok: true, json: async () => ({ agentes: [{ id: "ag-1", nome: "Recepção" }] }) };
    const corpo = JSON.parse(op.body); pedidos.push([url, corpo]);
    if (url === "/api/conversa/modo") {
      if (corpo.senha !== "certa") return { ok: false, json: async () => ({ erro: "senha_incorreta", mensagem: "Senha incorreta." }) };
      aberto = true; return { ok: true, json: async () => ({ resta_s: 3600, teto_s: 28800 }) };
    }
    if (!aberto) return { ok: false, json: async () => ({ erro: "Para pôr um agente na sala, confirme a senha do escritório.", codigo: "modo_fechado" }) };
    return { ok: true, json: async () => ({ convite: "c-agente" }) };
  } };
  vm.runInNewContext(fs.readFileSync("static/visitas-admin.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  elementos.agente.value = "ag-1";
  await elementos.criar.click();
  assert.equal(elementos["form-senha"].hidden, false);
  assert.equal(elementos.senha.focado, true);
  const ev = { preventDefault() {} };
  elementos.senha.value = "errada";
  await elementos["form-senha"].click(ev);
  assert.equal(elementos.estado.textContent, "Senha incorreta.");
  assert.equal(elementos["form-senha"].hidden, false, "senha errada: o campo continua");
  assert.equal(elementos.senha.value, "", "a senha não fica no campo");
  elementos.senha.value = "certa";
  await elementos["form-senha"].click(ev);
  assert.equal(elementos["form-senha"].hidden, true);
  assert.equal(elementos.link.value, "https://exemplo.test/visita.html#c-agente");
  assert.equal(JSON.stringify(pedidos.map(p => p[0])), JSON.stringify(["/api/visitas/criar", "/api/conversa/modo", "/api/conversa/modo", "/api/visitas/criar"]));
  assert.equal(JSON.stringify(pedidos[3][1]), '{"agente":"ag-1"}');
  elementos.senha.value = "";
  await elementos["form-senha"].click(ev);
  assert.equal(pedidos.length, 4, "senha vazia não sai da tela");
}
(async () => { for (const scenario of ["antes", "depois"]) await testar(scenario); await concorrencia(); await comAgente(); await semModoResposta(); await senhaAliMesmo(); })().catch(e => { console.error(e); process.exitCode = 1; });
