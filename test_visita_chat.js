"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
async function main() {
  const ids = ["estado", "mensagens", "mensagens-vazio", "caracteres-restantes", "formulario", "texto", "sair", "cena", "mapa-estado", "ver-sala", "ver-escritorio"];
  const el = Object.fromEntries(ids.map(id => [id, { value: "", maxLength: 1000, hidden: true, children: [], listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, querySelector() { return {}; },
    append(item) { this.children.push(item); }, replaceChildren() { this.children = []; }, getContext() { return { clearRect() {} }; } }]));
  let next, recebimentos = 0;
  const ctx = { document: { getElementById: id => el[id], createElement: () => ({}) },
    location: { hash: "#" + "a".repeat(43), pathname: "/visita.html" }, history: { replaceState() {} },
    window: { addEventListener() {} }, navigator: { sendBeacon() {} }, Blob, Image: class {},
    setTimeout(fn) { next = fn; }, clearTimeout() {},
    fetch: async url => {
      if (url.endsWith('/entrar')) return {ok: true, json: async () => ({sessao: 'teste'})};
      if (url.endsWith('/receber')) return {ok: true, json: async () => ({mensagens: ++recebimentos === 1 ? [] : ['Olá']})};
      if (url.endsWith('/enviar')) return {ok: true, json: async () => ({})};
      return new Promise(() => {});
    } };
  vm.runInNewContext(fs.readFileSync('static/visita.js', 'utf8'), ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el['mensagens-vazio'].hidden, false);
  el.texto.value = 'Olá'; el.texto.listeners.input();
  assert.equal(el['caracteres-restantes'].textContent, '997 caracteres restantes');
  await el.formulario.listeners.submit({preventDefault() {}});
  assert.equal(el['caracteres-restantes'].textContent, '1000 caracteres restantes');
  next(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(el['mensagens-vazio'].hidden, true);
  assert.equal(el.mensagens.children[0].textContent, 'Olá');
  console.log('Visita: contador, envio e primeira mensagem OK');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
