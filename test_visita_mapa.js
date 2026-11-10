"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function principal() {
  const ids = ["estado", "mensagens", "mensagens-vazio", "caracteres-restantes", "formulario", "texto", "sair", "cena", "mapa-estado", "ver-sala", "ver-escritorio", "titulo-conversa"];
  const chamadas = [], transformacoes = [];
  const ctx = { clearRect() {}, drawImage() {}, setTransform(...v) { transformacoes.push(v); } };
  const elementos = Object.fromEntries(ids.map(id => [id, {
    disabled: false, value: "", textContent: "", children: [], width: 640, height: 360,
    addEventListener(_, fn) { this.acao = fn; }, replaceChildren() { this.children = []; },
    querySelector() { return { disabled: false }; }, getContext() { return ctx; }, scrollIntoView() {}
  }]));
  let removeuHash = false;
  const contexto = {
    document: { getElementById: id => elementos[id] },
    location: { hash: "#" + "a".repeat(43), pathname: "/visita.html" },
    history: { replaceState(_, __, caminho) { removeuHash = caminho === "/visita.html"; } },
    window: { addEventListener() {} }, navigator: { sendBeacon() {} }, Blob,
    Image: class { set src(_) { queueMicrotask(() => this.onload()); } }, setTimeout() {}, clearTimeout() {},
    Mapa: { montarPredio(_, config, grupos) {
      assert.deepEqual(grupos, []); assert.equal(config.planta.rev, 0);
      return { W: 640, H: 360, fundo: {}, objetos: [], baixo: [{ chave: "reuniao", px: 20, py: 20, pw: 200, ph: 100 }] };
    } },
    fetch: async (url, opcoes) => {
      chamadas.push([url, opcoes]);
      if (url.endsWith("/entrar")) return { ok: true, json: async () => ({ sessao: "teste" }) };
      if (url.endsWith("/mapa")) return { ok: true, json: async () => ({ grupos: [], planta: { rev: 0 } }) };
      if (url.endsWith("atlas.json")) return { ok: true, json: async () => ({ sprites: {} }) };
      return new Promise(() => {});
    }
  };
  vm.runInNewContext(fs.readFileSync("static/visita.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(removeuHash, true);
  assert.equal(elementos["ver-sala"].disabled, false);
  const mapa = chamadas.find(([url]) => url.endsWith("/mapa"));
  assert.equal(mapa[1].credentials, "omit");
  assert.equal(JSON.parse(mapa[1].body).sessao, "teste");
  const antes = transformacoes.length;
  elementos["ver-sala"].acao();
  assert.ok(transformacoes.length > antes);
  assert.equal(transformacoes[antes + 1][0], 3.2);
  elementos.sair.acao();
  assert.equal(elementos["ver-sala"].disabled, true);
}
principal().catch(e => { console.error(e); process.exitCode = 1; });
