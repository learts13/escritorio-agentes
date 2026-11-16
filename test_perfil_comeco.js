"use strict";
// Meu perfil (static/personalizar.js): "Mostrar o começo da mensagem no aviso" (E.4), perto do Não perturbe. Só aparece
// com as conversas da equipe ligadas (config.equipe); o padrão é ligado; o POST /api/perfil leva avisos.comeco.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// um contexto 2D que aceita qualquer chamada (o personalizar desenha as miniaturas ao abrir)
const TELA = new Proxy(function () {}, { get: () => TELA, apply: () => TELA, set: () => true });
function elemento(id = "") {
  const e = {
    id, hidden: false, textContent: "", value: "", className: "", disabled: false, checked: false, type: "", href: "",
    dataset: {}, style: {}, attrs: {}, filhos: [], antes: [], ouvintes: {},
    addEventListener(t, f) { (e.ouvintes[t] ||= []).push(f); },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: k => e.attrs[k] ?? null, removeAttribute(k) { delete e.attrs[k]; },
    replaceChildren(...f) { e.filhos = f; }, append(...f) { e.filhos.push(...f); }, prepend(...f) { e.filhos.unshift(...f); },
    before(...f) { e.antes.push(...f); }, after() {}, replaceWith() {}, focus() {}, select() {}, closest: () => elemento(), querySelector: () => elemento(),
    querySelectorAll: () => [], getContext: () => TELA, classList: { toggle() {}, add() {}, remove() {} },
  };
  return e;
}

function carregar(perfil) {
  const ids = new Map(), envios = [];
  const document = {
    getElementById: id => { if (!ids.has(id)) ids.set(id, elemento(id)); return ids.get(id); },
    createElement: () => elemento(), querySelector: () => null, querySelectorAll: () => [], body: elemento("body"),
  };
  const fetch = async (url, op = {}) => {
    if (op.method === "POST") envios.push(JSON.parse(op.body));
    return { status: 200, ok: true, json: async () => (op.method === "POST" ? { ...perfil, avisos: JSON.parse(op.body).avisos } : perfil) };
  };
  const contexto = {
    document, fetch, location: { hash: "", href: "" }, localStorage: null, window: { addEventListener() {} }, setTimeout() {}, clearTimeout() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }), Expediente: { abre: "09:00", fecha: "18:00" },
    Avatar: { padrao: () => ({}), seletor: () => ({ valor: () => ({}) }) }, aplicarCor() {}, contraste: () => 4.5, textoSobre: () => "#000", JSON, Promise,
  };
  vm.runInNewContext(fs.readFileSync("static/expediente.js", "utf8"), contexto);
  contexto.Andar = contexto.window.Andar;
  vm.runInNewContext(fs.readFileSync("static/personalizar.js", "utf8"), contexto);
  return { P: contexto.window.Personalizar, $: document.getElementById, envios };
}
const espera = () => new Promise(r => setImmediate(r));
const salvar = async $ => { for (const f of $("form-avisos").ouvintes.submit) await f({ preventDefault() {} }); await espera(); };
const caixa = $ => $("av-aviso").antes.flatMap(l => l.filhos || []).find(x => x.type === "checkbox");

(async () => {
  // store ligado: a caixa aparece antes do aviso do formulário, marcada pelo padrão, e o POST leva comeco
  {
    const { P, $, envios } = carregar({ usuario: "ana", nome: "Ana", avisos: { modo: "sempre" } });
    P.abrir({ empresa: "Acme", equipe: { retencao: 365 } }); await espera(); await espera();
    const c = caixa($);
    assert.ok(c, "a caixa existe");
    assert.equal(c.checked, true, "ausente = ligado");
    assert.match($("av-aviso").antes.map(l => l.textContent + (l.filhos || []).map(f => f.textContent).join("")).join(" "), /Mostrar o começo da mensagem no aviso/);
    c.checked = false;
    await salvar($);
    assert.deepEqual(envios.at(-1), { avisos: { modo: "sempre", comeco: false } });
  }
  // o servidor diz que está desligado: a caixa vem desmarcada
  {
    const { P, $ } = carregar({ usuario: "ana", avisos: { modo: "sempre", comeco: false } });
    P.abrir({ equipe: { retencao: 365 } }); await espera(); await espera();
    assert.equal(caixa($).checked, false);
  }
  // store desligado (config.equipe null): nada de caixa e o POST de sempre
  {
    const { P, $, envios } = carregar({ usuario: "ana", avisos: { modo: "sempre" } });
    P.abrir({ equipe: null }); await espera(); await espera();
    assert.equal(caixa($), undefined);
    await salvar($);
    assert.deepEqual(envios.at(-1), { avisos: { modo: "sempre" } });
  }
  console.log("test_perfil_comeco.js ok");
})().catch(e => { console.error(e); process.exit(1); });
