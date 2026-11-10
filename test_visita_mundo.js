"use strict";
// Bairro público (o nível final do mundo): a porta do chalé chama o destino; o céu e as portas dos vizinhos, não.
// A página em níveis (convite no fragmento, pedidos e Esc) está no test_mundo_navegacao.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function abrir() {
  const ouvintes = {}, quadros = [], destinos = [];
  const ctx = new Proxy({}, { get: (_, k) => k === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  const canvas = { getContext: () => ctx, style: {}, addEventListener(t, f) { ouvintes[t] = f; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
  const contexto = {
    window: {}, performance: { now: () => 0 }, requestAnimationFrame: f => quadros.push(f), Math,
    Ceu: { agora: () => ({ h: 12, cima: "#000", baixo: "#000", escuro: 0, hora: "12:00" }) },
    Clima: { definir() {}, tipo: () => "limpo", texto: () => "céu limpo", desenhar() {} },
  };
  vm.runInNewContext(fs.readFileSync("static/mundo_bairro.js", "utf8"), contexto);
  const B = contexto.window.MundoBairro;
  B.criar(canvas, () => destinos.push("porta"));
  quadros.shift()(16); // um quadro inteiro sem erro
  return { B, ouvintes, destinos };
}

const b = abrir();
const p = b.B.porta(b.B.CHALES.find(c => !c.vizinho));
b.ouvintes.click({ clientX: 2, clientY: 2 });
assert.deepEqual(b.destinos, [], "clicar no céu não entra");
b.ouvintes.click({ clientX: (p.x + p.w / 2) * 2, clientY: (p.y + p.h / 2) * 2 });
assert.deepEqual(b.destinos, ["porta"]);
for (const v of b.B.CHALES.filter(c => c.vizinho)) {   // vizinhos são cenário: a porta deles não leva a lugar nenhum
  const q = b.B.porta(v);
  b.ouvintes.click({ clientX: (q.x + 6) * 2, clientY: (q.y + 9) * 2 });
}
assert.deepEqual(b.destinos, ["porta"]);
