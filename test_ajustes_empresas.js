"use strict";
// Personalizar por andar (static/ajustes.js): o que cada perfil vê. No modo clássico (sem andares.json) a tela é a de sempre:
// o admin vê clima, datas, andares e membros; o membro não chega a pedir nada de admin.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const EXPEDIENTE = fs.readFileSync("static/expediente.js", "utf8");
const AJUSTES = fs.readFileSync("static/ajustes.js", "utf8");

// um elemento falso: guarda o que a tela escreve e aceita o que ela chama
function elemento(id = "") {
  const e = {
    id, hidden: false, textContent: "", value: "", className: "", disabled: false, checked: false, type: "", href: "",
    dataset: {}, style: {}, attrs: {}, filhos: [], ouvintes: {},
    addEventListener(t, f) { (e.ouvintes[t] ||= []).push(f); },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: k => e.attrs[k] ?? null, removeAttribute(k) { delete e.attrs[k]; },
    replaceChildren(...f) { e.filhos = f; }, append(...f) { e.filhos.push(...f); }, prepend(...f) { e.filhos.unshift(...f); },
    before() {}, replaceWith() {}, focus() {}, select() {}, closest: () => elemento(), querySelector: () => elemento(), querySelectorAll: () => [],
    getContext: () => new Proxy({}, { get: () => () => {} }), classList: { toggle() {}, add() {}, remove() {} },
  };
  return e;
}

// o navegador falso: `respostas` diz o que cada rota devolve ({status, corpo}); `pedidos` guarda as urls pedidas
function carregar({ hash = "", respostas = {} } = {}) {
  const ids = new Map(), pedidos = [], envios = [];
  const document = {
    getElementById: id => { if (!ids.has(id)) ids.set(id, elemento(id)); return ids.get(id); },
    createElement: tag => elemento(tag), querySelector: () => null, querySelectorAll: () => [], body: elemento("body"),
    get activeElement() { return null; },
  };
  const fetch = async (url, op = {}) => {
    pedidos.push(url); envios.push({ url, metodo: op.method || "GET", corpo: op.body ? JSON.parse(op.body) : null });
    const rota = url.split("?")[0], r = respostas[rota] || { status: 404, corpo: {} };
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.corpo };
  };
  const contexto = {
    document, fetch, location: { hash, href: "" }, localStorage: null, window: {}, setInterval() {}, setTimeout() {}, clearTimeout() {},
    Avatar: { OPCOES: { cores: [], olhos: [], acessorios: [] }, padrao: () => ({}), desenhar: () => ({}) },
    Festas: { temas: () => [{ chave: "generico", nome: "Festa", cores: [], falas: [] }], embutidas: () => [] }, Intl, JSON, Date, Math,
  };
  vm.runInNewContext(EXPEDIENTE, contexto);
  contexto.Andar = contexto.window.Andar;
  vm.runInNewContext(AJUSTES, contexto);
  return { Ajustes: contexto.window.Ajustes, $: document.getElementById, pedidos, envios };
}
const espera = () => new Promise(r => setImmediate(r));

const ID = "a1b2c3d4", OUTRO = "0badc0de";
const LISTAS = { "api/andares": { status: 200, corpo: { andares: [] } }, "api/membros": { status: 200, corpo: { contas: [], convites: [] } },
  "api/perfil": { status: 200, corpo: { usuario: "ana" } }, "/oauth/desconectar": { status: 200, corpo: { ok: true } } };
const enviar = async (el, evento = "submit") => { for (const f of el.ouvintes[evento] || []) await f({ preventDefault() {} }); await espera(); };
// as caixas de andar do convite (#cv-andares > label > input): os ids que aparecem para marcar
const caixas = $ => $("cv-andares").filhos.map(l => l.filhos[0].value);

(async () => {
  // modo clássico, admin: as abas do prédio continuam como hoje (andares e membros aparecem depois do GET)
  {
    const { Ajustes, $, pedidos } = carregar({ respostas: LISTAS });
    Ajustes.abrir({ papel: "admin", times: [], andares: [{ id: "principal", nome: "Térreo" }, { id: ID, nome: "Empresa B" }] });
    await espera(); await espera();
    assert.equal($("a-clima").hidden, false);
    assert.equal($("a-datas").hidden, false);
    assert.equal($("a-equipe").hidden, false);
    assert.equal($("a-andares").hidden, false);
    assert.equal($("a-membros").hidden, false);
    assert.ok(pedidos.includes("api/andares") && pedidos.includes("api/membros"), "o admin pede as duas listas, sem ?andar no principal");
    assert.equal($("a-conexao").hidden, true, "no principal a conexão é a da faixa do mapa, como hoje");
    assert.equal($("cv-andares-campo").hidden, false);
    assert.deepEqual(caixas($), ["principal", ID], "o principal continua sempre no convite");
  }

  // membro: nada de admin é pedido (o servidor também barra)
  {
    const m = carregar();
    m.Ajustes.abrir({ papel: "membro", times: [] });
    await espera();
    assert.ok(!m.pedidos.some(u => /api\/(andares|membros)/.test(u)));
  }

  // admin da empresa no andar dele: nada do prédio (clima, datas, andares, org); membros e convite só do andar
  {
    const { Ajustes, $, pedidos, envios } = carregar({ hash: `#andar=${ID}`, respostas: LISTAS });
    Ajustes.abrir({ papel: "admin", admin_predio: false, terreo: "saguao", andar: ID, times: [],
      andares: [{ id: "principal", nome: "Saguão", conexao: null }, { id: ID, nome: "Empresa B", conexao: "conferindo" }] });
    await espera(); await espera();
    assert.equal($("a-clima").hidden, true);
    assert.equal($("a-datas").hidden, true);
    assert.equal($("a-andares").hidden, true);
    assert.ok(!pedidos.some(u => u.startsWith("api/andares")), "não pede a lista de andares (org de todos)");
    assert.ok(pedidos.includes(`api/membros?andar=${ID}`));
    assert.equal($("a-membros").hidden, false);
    assert.equal($("cv-andares-campo").hidden, true, "o convite é só para este andar: sem caixas");
    // a conexão do andar: estado, Conectar e Desconectar
    assert.equal($("a-conexao").hidden, false);
    assert.match($("cx-estado").textContent, /conferindo o workspace/);
    assert.equal($("cx-conectar").href, `/oauth/conectar?andar=${ID}`);
    $("cv-nome").value = "Bia"; $("cv-senha").value = "segredo";
    await enviar($("form-convite"));
    const cv = envios.find(e => e.metodo === "POST" && e.corpo.acao === "convidar");
    assert.equal(cv.url, `api/membros?andar=${ID}`);
    assert.deepEqual({ ...cv.corpo }, { acao: "convidar", nome: "Bia", senha: "segredo" });
    $("cx-senha").value = "segredo";
    await enviar($("form-desconectar"));
    const dx = envios.find(e => e.url.startsWith("/oauth/desconectar"));
    assert.equal(dx.url, `/oauth/desconectar?andar=${ID}`);
    assert.deepEqual({ ...dx.corpo }, { senha: "segredo" });
    assert.equal($("cx-senha").value, "", "a senha não fica no campo");
  }

  // admin do prédio olhando um andar extra: a visão do andar (e a conexão dele), mais o que é do prédio
  {
    const { Ajustes, $, pedidos } = carregar({ hash: `#andar=${ID}`, respostas: LISTAS });
    Ajustes.abrir({ papel: "admin", admin_predio: true, terreo: "classico", andar: ID, times: [],
      andares: [{ id: "principal", nome: "Térreo" }, { id: ID, nome: "Empresa B", conexao: "conectado" }] });
    await espera(); await espera();
    assert.equal($("a-clima").hidden, false);
    assert.ok(pedidos.includes("api/andares") && pedidos.includes(`api/membros?andar=${ID}`));
    assert.equal($("a-conexao").hidden, false);
  }

  // saguão, admin do prédio no saguão: sem times nem conexão; o convite não tem o saguão como caixa
  {
    const { Ajustes, $, pedidos } = carregar({ respostas: LISTAS });
    Ajustes.abrir({ papel: "admin", admin_predio: true, terreo: "saguao", andar: "principal", times: [],
      andares: [{ id: "principal", nome: "Saguão", conexao: null }, { id: ID, nome: "Dev Maniac's" }, { id: OUTRO, nome: "Empresa B" }] });
    await espera(); await espera();
    assert.equal($("a-equipe").hidden, true);
    assert.equal($("a-conexao").hidden, true);
    assert.ok(pedidos.includes("api/membros"));
    assert.deepEqual(caixas($), [ID, OUTRO]);
  }

  // pessoa do prédio no saguão: nada de admin
  {
    const { Ajustes, pedidos } = carregar({ respostas: LISTAS });
    Ajustes.abrir({ papel: "pessoa", admin_predio: false, terreo: "saguao", andar: "principal", times: [] });
    await espera();
    assert.ok(!pedidos.some(u => /api\/(andares|membros)/.test(u)));
  }

  console.log("test_ajustes_empresas.js: ok");
})().catch(e => { console.error(e); process.exit(1); });
