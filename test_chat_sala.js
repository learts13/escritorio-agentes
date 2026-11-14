"use strict";
// Chat da sala (static/chat_sala.js): o evento minha-sala (sala e nome), o texto que o servidor aceita e a deduplicação por seq.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const contexto = { window: {} };   // sem document: só a parte pura carrega
vm.runInNewContext(fs.readFileSync("static/chat_sala.js", "utf8"), contexto);
const { daSala, validar, limpar, novas, TEXTO_MAX } = contexto.window.ChatSala;

assert.equal(JSON.stringify(daSala({ sala: "cozinha", nome: "Cozinha", andar: "principal" })), '{"sala":"cozinha","nome":"Cozinha"}');
assert.equal(daSala({ sala: "time:Design", nome: " Design " }).nome, "Design");
for (const d of [{ sala: null, nome: null }, { sala: "", nome: "" }, { sala: "cozinha", nome: null }, { sala: "cozinha" }, { sala: 3, nome: "x" }, null, undefined])
  assert.equal(daSala(d).sala, "", `sem chat: ${JSON.stringify(d)}`);

assert.equal(validar("oi"), null);
assert.equal(validar("   "), "Escreva a mensagem.");
assert.equal(validar("\u0000​"), "Escreva a mensagem.", "só controle e invisível é vazio");
assert.equal(validar("é".repeat(TEXTO_MAX)), null);
assert.equal(validar("😀".repeat(TEXTO_MAX)), null, "conta por caractere, como o len() do servidor");
assert.match(validar("a".repeat(TEXTO_MAX + 1)), /500/);
assert.equal(limpar(" a\u0007b‮c\r\nd "), "abc\nd", "tira controle e bidi, mantém a quebra de linha");

const vistos = new Set([2]);
const ms = [{ seq: 3, texto: "c" }, { seq: 1, texto: "a" }, { seq: 2, texto: "b" }, { seq: "4", texto: "x" }, null, { seq: 5 }];
assert.deepEqual([...novas(ms, vistos).map(m => m.seq)], [1, 3], "fora as já vistas e as malformadas, em ordem de seq");
assert.equal(novas(undefined, vistos).length, 0);
// GET atrasado depois do "minha-sala" (entrei na sala nova no seq 3): a mensagem 1, da sala de antes, fica de fora
assert.deepEqual([...novas(ms, new Set(), 3).map(m => m.seq)], [3], "só o seq da entrada em diante");
assert.deepEqual([...novas(ms, new Set(), 0).map(m => m.seq)], [1, 2, 3], "sem seq de entrada, tudo vale");
console.log("test_chat_sala.js ok");
