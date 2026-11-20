"use strict";
// Clima por andar no navegador: o elevador mostra a cidade de cada andar (static/expediente.js: Andar) e a hora do mapa
// segue o fuso da cidade do andar (static/ceu.js: Ceu.definirFuso), com Brasília quando não há fuso.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function carregar(arquivo, extra = {}) {
  const contexto = { location: { hash: "", search: "" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {}, Intl, Date, performance: { now: () => 0 }, URLSearchParams, ...extra };
  vm.runInNewContext(fs.readFileSync(arquivo, "utf8") + "\nwindow.__Ceu = typeof Ceu === 'undefined' ? null : Ceu;", contexto);
  return contexto.window;
}

// o elevador: "Andar · Cidade", e a conexão só quando não está conectado
{
  const { Andar } = carregar("static/expediente.js");
  assert.equal(Andar.rotuloAndar({ nome: "Dev Maniac's", cidade: "Mateus Leme", conexao: "conectado" }), "Dev Maniac's · Mateus Leme");
  assert.equal(Andar.rotuloAndar({ nome: "Outra", cidade: "Lisboa", conexao: "sem_conexao" }), "Outra · Lisboa · sem conexão");
  assert.equal(Andar.rotuloAndar({ nome: "Saguão", cidade: null, conexao: null }), "Saguão");   // sem clima: só o nome
  assert.equal(Andar.rotuloAndar({ nome: "Antigo", conexao: "conectado" }), "Antigo");   // servidor antigo, sem a chave
  // a cidade é texto do servidor: só string de até 60, sem caractere de controle
  for (const ruim of [42, {}, "x".repeat(61), "Linha\nnova", "\u0007"]) assert.equal(Andar.cidadeOk(ruim), "", String(ruim));
  assert.equal(Andar.cidadeOk(" Recife "), "Recife");
}

// a hora do mapa: o fuso da cidade do andar; sem fuso ou com um que o navegador não conhece, Brasília
{
  const { __Ceu: Ceu } = carregar("static/ceu.js");
  assert.equal(Ceu.fuso, "America/Sao_Paulo");
  assert.equal(Ceu.definirFuso("Asia/Tokyo"), "Asia/Tokyo");
  const hTokyo = Ceu.agora().h;
  assert.equal(Ceu.definirFuso(undefined), "America/Sao_Paulo");
  const hSp = Ceu.agora().h;
  assert.ok(Math.abs(((hTokyo - hSp + 24) % 24) - 12) < 0.1, `Tóquio fica 12 h à frente de São Paulo (${hTokyo} x ${hSp})`);
  for (const ruim of ["Nao/Existe", 7, "", "x".repeat(41)]) {
    Ceu.definirFuso("Asia/Tokyo");
    assert.equal(Ceu.definirFuso(ruim), "America/Sao_Paulo", String(ruim));
  }
}

console.log("ok test_clima_andar");
