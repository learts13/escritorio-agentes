"use strict";
// Convite (static/convite.js): as regras do formulário que o servidor confere de novo (usuário, senha, nome) e o formato do token.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const contexto = { window: {} };   // sem document: só a parte pura carrega
vm.runInNewContext(fs.readFileSync("static/convite.js", "utf8"), contexto);
const { validar, tokenValido } = contexto.window.Convite;

const ok = { usuario: "ana.silva", senha: "uma-senha-longa", confirmar: "uma-senha-longa", nome: "Ana" };
assert.equal(validar(ok), null);
assert.equal(validar({ ...ok, usuario: "  Ana.Silva " }), null, "maiúsculas e espaços nas pontas são normalizados");

for (const usuario of ["", "ab", "a".repeat(33), ".ana", "-ana", "ana silva", "ana@x", "ânia"])
  assert.equal(validar({ ...ok, usuario }).campo, "usuario", `usuário inválido: ${usuario}`);
assert.equal(validar({ ...ok, usuario: "a1_" }), null);
assert.equal(validar({ ...ok, usuario: "a".repeat(32) }), null);

assert.equal(validar({ ...ok, senha: "curta123", confirmar: "curta123" }).campo, "senha");
assert.equal(validar({ ...ok, senha: "1234567890", confirmar: "1234567890" }), null, "10 caracteres bastam");
assert.equal(validar({ ...ok, confirmar: "outra-senha-longa" }).campo, "confirmar");

for (const nome of ["", "   ", "x".repeat(41), "Ana\u0000"]) assert.equal(validar({ ...ok, nome }).campo, "nome", `nome inválido: ${JSON.stringify(nome)}`);
assert.equal(validar({ ...ok, nome: "x".repeat(40) }), null);
assert.equal(validar({ ...ok, usuario: "", senha: "" }).campo, "usuario", "o primeiro problema é o que aparece");

assert.ok(tokenValido("a".repeat(43)));
assert.ok(tokenValido("Ab-_".repeat(10) + "abc"));
for (const t of ["", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "="]) assert.ok(!tokenValido(t));

console.log("test_convite: ok");
