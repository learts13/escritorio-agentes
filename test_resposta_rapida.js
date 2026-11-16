"use strict";
// Resposta rápida (static/resposta_rapida.js): os botões prontos da caixa de responder PREENCHEM o campo e nunca enviam.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function no(tag) {
  return { tag, children: [], atributos: {}, ouvintes: {}, textContent: "",
    append(...f) { this.children.push(...f); }, setAttribute(k, v) { this.atributos[k] = String(v); },
    addEventListener(t, fn) { this.ouvintes[t] = fn; } };
}
const contexto = { window: {}, document: { createElement: no },
  fetch() { throw new Error("a resposta rápida não envia nada"); } };
vm.runInNewContext(fs.readFileSync("static/resposta_rapida.js", "utf8"), contexto);
const { RESPOSTAS, montar } = contexto.window.RespostaRapida;

assert.deepEqual([...RESPOSTAS], ["Pode seguir", "Sim", "Não", "Pare", "Resuma o que fez"]);
const ta = { value: "", maxLength: 2000, disabled: false, readOnly: false };
const preenchidos = [];
const grupo = montar(ta, campo => preenchidos.push(campo));
assert.equal(grupo.atributos.role, "group");
assert.match(grupo.atributos["aria-label"], /Respostas prontas/);
assert.match(grupo.atributos["aria-label"], /envi/, "o leitor de tela sabe que o toque só preenche");
const bs = grupo.children;
assert.deepEqual(bs.map(b => b.textContent), [...RESPOSTAS]);
for (const b of bs) { assert.equal(b.tag, "button"); assert.equal(b.type, "button", "type=button: nada de submit"); }

bs[0].ouvintes.click();
assert.equal(ta.value, "Pode seguir", "o toque preenche o campo vazio");
assert.deepEqual(preenchidos, [ta], "quem chamou ajusta o contador e o foco");
bs[4].ouvintes.click();
assert.equal(ta.value, "Pode seguir\nResuma o que fez", "com rascunho, entra na linha de baixo: o texto escrito não se perde");

ta.value = "x".repeat(1995);
bs[4].ouvintes.click();
assert.equal(ta.value, "x".repeat(1995), "passaria do limite: não mexe");
ta.value = ""; ta.disabled = true;
bs[1].ouvintes.click();
assert.equal(ta.value, "", "caixa desabilitada: não preenche");
ta.disabled = false; ta.readOnly = true;
bs[2].ouvintes.click();
assert.equal(ta.value, "", "enviando (readOnly): não preenche");
assert.equal(preenchidos.length, 2);

console.log("test_resposta_rapida: ok");
