"use strict";
// Modo econômico (static/vida.js: Vida.mexendo e Vida.intervaloQuadro): o laço do app.js desenha a toda taxa só quando
// algo se mexe; com tudo parado, desenha menos vezes, e menos ainda com a janela sem foco (num segundo monitor ou numa TV).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const FONTE = fs.readFileSync("static/vida.js", "utf8");
let agora = 100;   // segundos, como o performance.now() / 1000 da vida.js

function carregar() {
  const contexto = { document: { addEventListener() {}, hidden: false }, window: {}, performance: { now: () => agora * 1000 }, Ceu: { agora: () => ({ h: 10 }) } };
  vm.runInNewContext(FONTE, contexto);
  return contexto.window.Vida;
}
const Vida = carregar();

const parado = (extra = {}) => ({ rota: [], festa: 0, aceno: 0, arremesso: 0, ...extra });
const mundo = (lista, extra = {}) => ({ lista, cenaSocial: null, entrega: null, ...extra });

// tudo parado: ninguém andando, sem festa, sem cena social, sem entrega
assert.equal(Vida.mexendo(mundo([parado(), parado()])), false);
assert.equal(Vida.mexendo(mundo([])), false);

// qualquer um desses mexe a cena
assert.equal(Vida.mexendo(mundo([parado(), parado({ rota: [[1, 2]] })])), true, "agente andando");
assert.equal(Vida.mexendo(mundo([parado({ festa: agora + 1 })])), true, "comemorando");
assert.equal(Vida.mexendo(mundo([parado({ aceno: agora + 1 })])), true, "acenando");
assert.equal(Vida.mexendo(mundo([parado({ arremesso: agora + 0.5 })])), true, "arremessando");
assert.equal(Vida.mexendo(mundo([parado()], { cenaSocial: { fase: "luta" } })), true, "briga ou greve");
assert.equal(Vida.mexendo(mundo([parado()], { entrega: { fase: "chegando" } })), true, "entrega");

// festa e aceno que já passaram não contam
assert.equal(Vida.mexendo(mundo([parado({ festa: agora - 1, aceno: agora - 0.1 })])), false);

// intervalo mínimo entre quadros (ms): 0 é a toda taxa (cada requestAnimationFrame)
assert.equal(Vida.intervaloQuadro({ mexendo: true, foco: true }), 0);
assert.equal(Vida.intervaloQuadro({ mexendo: true, foco: false }), 0, "sem foco, mas com gente andando: a toda taxa (TV)");
const calmo = Vida.intervaloQuadro({ mexendo: false, foco: true }), semFoco = Vida.intervaloQuadro({ mexendo: false, foco: false });
assert.ok(calmo > 0, "parado com foco: taxa menor");
assert.ok(semFoco > calmo, "parado e sem foco: menor ainda");
// chuva, neve ou festa sem mais nada se mexendo: até 60 quadros/s, com ou sem foco (num monitor de 144 Hz eram 144)
assert.equal(Vida.intervaloQuadro({ mexendo: false, animando: true, foco: true }), 1000 / 60);
assert.equal(Vida.intervaloQuadro({ mexendo: false, animando: true, foco: false }), 1000 / 60);
assert.equal(Vida.intervaloQuadro({ mexendo: true, animando: true, foco: false }), 0, "andando vale mais que a chuva");
// as animações paradas (monitores, digitando, café: até ~8 quadros/s) e os carros da rua continuam lisas
assert.ok(1000 / semFoco >= 16, `sem foco desenha pelo menos 16 quadros/s (deu ${1000 / semFoco})`);

console.log("test_ritmo.js: ok");
