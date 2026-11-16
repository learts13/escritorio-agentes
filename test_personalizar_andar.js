"use strict";
// Marca por andar (static/personalizar.js): nome, cor, logo, expediente e modo sério vão para o andar atual (?andar=X).
// No principal o pedido sai idêntico ao de sempre. O assistente de instalação usa o mesmo Personalizar.enviar.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const EXPEDIENTE = fs.readFileSync("static/expediente.js", "utf8");
const PERSONALIZAR = fs.readFileSync("static/personalizar.js", "utf8");
const ID = "a1b2c3d4";

function carregar(hash = "") {
  const pedidos = [];
  const el = () => ({ addEventListener() {}, setAttribute() {}, append() {}, prepend() {}, querySelector: () => null, closest: () => null, classList: { toggle() {}, add() {}, remove() {} }, style: {}, dataset: {} });
  const document = { getElementById: () => el(), createElement: () => el(), querySelector: () => null, querySelectorAll: () => [] };
  const fetch = async (url, op) => { pedidos.push({ url, metodo: op.method }); return { ok: true, status: 200, json: async () => ({ logo: "/logo?v=1" }) }; };
  const contexto = { document, fetch, location: { hash }, localStorage: null, window: { addEventListener() {} }, matchMedia: () => ({ matches: true, addEventListener() {} }) };
  vm.runInNewContext(EXPEDIENTE, contexto);
  contexto.Andar = contexto.window.Andar;
  vm.runInNewContext(PERSONALIZAR, contexto);
  return { Personalizar: contexto.window.Personalizar, pedidos };
}

(async () => {
  // principal: as rotas de sempre, sem query
  {
    const { Personalizar, pedidos } = carregar();
    await Personalizar.enviar("/api/marca", "{}", "application/json");
    await Personalizar.enviar("/api/logo/remover", "{}", "application/json");
    assert.deepEqual(pedidos.map(p => p.url), ["/api/marca", "/api/logo/remover"]);
  }
  // andar extra: a marca e o logo são do andar
  {
    const { Personalizar, pedidos } = carregar(`#andar=${ID}`);
    await Personalizar.enviar("/api/marca", "{}", "application/json");
    await Personalizar.enviar("/api/logo", "x", "image/png");
    await Personalizar.enviar("/api/logo/remover", "{}", "application/json");
    assert.deepEqual(pedidos.map(p => p.url), [`/api/marca?andar=${ID}`, `/api/logo?andar=${ID}`, `/api/logo/remover?andar=${ID}`]);
    assert.ok(pedidos.every(p => p.metodo === "POST"));
  }
  console.log("test_personalizar_andar.js: ok");
})().catch(e => { console.error(e); process.exit(1); });
