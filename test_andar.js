"use strict";
// Andar atual (static/expediente.js: Andar): de onde ele vem, o que o pedido leva e como a conexão aparece na tela.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const codigo = fs.readFileSync("static/expediente.js", "utf8");
const ID = "a1b2c3d4";

// o navegador falso: hash e localStorage; `quebrado` faz o armazenamento lançar (aba anônima, dados bloqueados)
function carregar({ hash = "", guardado = null, quebrado = false } = {}) {
  const mem = new Map(guardado ? [["escritorio:andar", guardado]] : []);
  const localStorage = quebrado ? { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); }, removeItem() { throw new Error("bloqueado"); } }
    : { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const contexto = { location: { hash }, localStorage, window: {} };
  vm.runInNewContext(codigo, contexto);
  return { Andar: contexto.window.Andar, mem };
}

// sem andar guardado nem no endereço: principal, e os pedidos saem idênticos aos de sempre
{
  const { Andar } = carregar();
  assert.equal(Andar.atual, "principal");
  for (const u of ["api/estado", "api/estado?invisivel=1", "/api/planta", "http://x/oauth/conectar"]) assert.equal(Andar.com(u), u);
}

// o endereço vale mais que o localStorage; os dois só valem com 8 hex minúsculos
{
  assert.equal(carregar({ hash: `#andar=${ID}`, guardado: "ffffffff" }).Andar.atual, ID);
  assert.equal(carregar({ guardado: ID }).Andar.atual, ID);
  for (const ruim of ["#andar=ABCDEF12", "#andar=abc", "#andar=../../x", "#andar=a1b2c3d4&x=1", "#conversas", "#andar=a1b2c3d4/..", "#andar="])
    assert.equal(carregar({ hash: ruim }).Andar.atual, "principal", ruim);
  assert.equal(carregar({ guardado: "../etc" }).Andar.atual, "principal");
  assert.equal(carregar({ hash: "#andar=principal" }).Andar.atual, "principal");
}

// armazenamento quebrado: não derruba, e o hash continua valendo
{
  assert.equal(carregar({ quebrado: true }).Andar.atual, "principal");
  const { Andar } = carregar({ hash: `#andar=${ID}`, quebrado: true });
  assert.equal(Andar.atual, ID);
  assert.equal(Andar.definir("principal"), true);   // não lança com o armazenamento quebrado
  assert.equal(Andar.atual, "principal");
}

// a query: ? ou &, antes do #, sem duplicar nada no principal
{
  const { Andar } = carregar({ hash: `#andar=${ID}` });
  assert.equal(Andar.com("api/estado"), `api/estado?andar=${ID}`);
  assert.equal(Andar.com("api/estado?invisivel=1"), `api/estado?invisivel=1&andar=${ID}`);
  assert.equal(Andar.com("/oauth/conectar"), `/oauth/conectar?andar=${ID}`);
  assert.equal(Andar.com("api/conversa?id=1#x"), `api/conversa?id=1&andar=${ID}#x`);
  assert.equal(Andar.com("api/jornal", "principal"), "api/jornal");
  assert.equal(Andar.com("api/jornal", "ZZ"), "api/jornal");   // id inválido nunca vai na url
}

// trocar de andar: grava, devolve se mudou, e id inválido vira o principal e limpa o guardado
{
  const { Andar, mem } = carregar();
  assert.equal(Andar.definir(ID), true);
  assert.equal(Andar.definir(ID), false);
  assert.equal(mem.get("escritorio:andar"), ID);
  assert.equal(Andar.definir("<script>"), true);
  assert.equal(Andar.atual, "principal");
  assert.equal(mem.has("escritorio:andar"), false);
  Andar.definir(ID); Andar.limpar();   // 404 do andar: volta e esquece
  assert.equal(Andar.atual, "principal");
  assert.equal(mem.has("escritorio:andar"), false);
}

// o rótulo da conexão: o que o servidor ainda não conhece não vira texto livre
{
  const { Andar } = carregar();
  assert.equal(Andar.rotuloConexao("conectado"), "conectado");
  assert.equal(Andar.rotuloConexao("sem_conexao"), "sem conexão");
  assert.match(Andar.rotuloConexao("outra_org"), /workspace errado, reconecte/);
  for (const x of ["<img onerror=1>", "constructor", "__proto__", undefined, 7]) assert.equal(Andar.rotuloConexao(x), "sem leitura");
}

console.log("test_andar.js: ok");
