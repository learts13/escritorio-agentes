"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function principal() {
  const ids = ["estado", "mensagens", "mensagens-vazio", "caracteres-restantes", "formulario", "texto", "sair", "cena", "mapa-estado", "ver-sala", "ver-escritorio"];
  const transforms = [], requisicoes = [], retangulos = [], preenchimentos = [], textos = [], recortes = [];
  const ctx = { clearRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {}, clip() { recortes.push(true); },
    rect(...v) { retangulos.push(v); }, fill(regra) { preenchimentos.push(regra); }, fillText(texto, x, y) { textos.push([texto, x, y]); },
    setTransform(...v) { transforms.push(v); } };
  const elementos = Object.fromEntries(ids.map(id => [id, {
    disabled: true, textContent: "", value: "", width: 640, height: 360,
    addEventListener() {}, replaceChildren() {}, getContext() { return ctx; },
    querySelector() { return { disabled: true }; }
  }]));
  const contexto = {
    document: { getElementById: id => elementos[id] }, location: { hash: "", pathname: "/visita.html" },
    history: { replaceState() {} }, window: { addEventListener() {} }, navigator: {}, Blob,
    Image: class { set src(_) { queueMicrotask(() => this.onload()); } },
    setTimeout() {}, clearTimeout() {},
    Mapa: { montarPredio(_, config, grupos) {
      assert.deepEqual(grupos, []);
      return { W: 640, H: 360, fundo: {}, objetos: [],
        baixo: [{ chave: "reuniao", px: 20, py: 200, pw: 200, ph: 100 }],
        salas: [{ chave: "recepcao", px: 20, py: 20, pw: 200, ph: 100 }, { chave: "lounge", px: 300, py: 20, pw: 100, ph: 100 }] };
    } },
    fetch: async (url, opcoes) => {
      requisicoes.push([url, opcoes]);
      if (url.endsWith("/recepcao")) return { ok: true, json: async () => ({ grupos: [], planta: { rev: 0 } }) };
      if (url.endsWith("atlas.json")) return { ok: true, json: async () => ({ sprites: {} }) };
      throw new Error("Rota privada acessada sem convite: " + url);
    }
  };
  vm.runInNewContext(fs.readFileSync("static/visita.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  const recepcao = requisicoes.find(([url]) => url.endsWith("/recepcao"));
  assert.equal(recepcao[1].credentials, "omit");
  assert.deepEqual(JSON.parse(recepcao[1].body), {});
  assert.equal(elementos["ver-sala"].disabled, true);
  assert.match(elementos["mapa-estado"].textContent, /Recepção pública/);
  assert.match(elementos["mapa-estado"].textContent, /apagadas exigem convite/);
  // prédio inteiro em escala 1, sem recorte; tudo fora da recepção fica coberto
  assert.deepEqual(transforms[1], [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(recortes, []);
  assert.deepEqual(retangulos, [[0, 0, 640, 360], [20, 20, 200, 100]]);
  assert.deepEqual(preenchimentos, ["evenodd"]);
  assert.deepEqual(textos, [["Com convite", 350, 70], ["Com convite", 120, 250]]);
  assert.deepEqual(requisicoes.map(([url]) => url).sort(), ["/api/visitas/recepcao", "/tema/atlas.json"].sort());
}
principal().catch(e => { console.error(e); process.exitCode = 1; });
