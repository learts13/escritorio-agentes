"use strict";
// Perfil da conta no andar (static/expediente.js: Andar.perfil), lido do /api/config (contrato da Onda 1, seção 3):
// admin do prédio, admin da empresa, membro e pessoa do prédio (só no saguão). Servidor antigo, sem os campos: a tela de sempre.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const contexto = { location: { hash: "" }, localStorage: null, window: {} };
vm.runInNewContext(fs.readFileSync("static/expediente.js", "utf8"), contexto);
const { Andar } = contexto.window;
const ID = "a1b2c3d4";

// servidor antigo (sem papel, sem admin_predio, sem terreo): admin do prédio no modo clássico, como hoje
{
  const p = Andar.perfil({});
  assert.deepEqual({ ...p }, { papel: "admin", admin: true, predio: true, saguao: false, noSaguao: false });
  assert.equal(Andar.perfil({ papel: "membro" }).admin, false);
  assert.equal(Andar.perfil({ papel: "membro" }).predio, false);
}

// admin do prédio: admin em qualquer andar
{
  const p = Andar.perfil({ papel: "admin", admin_predio: true, terreo: "classico", andar: ID });
  assert.equal(p.admin, true); assert.equal(p.predio, true); assert.equal(p.saguao, false);
}

// admin da empresa: admin no andar dele, mas nada do prédio
{
  const p = Andar.perfil({ papel: "admin", admin_predio: false, terreo: "saguao", andar: ID });
  assert.equal(p.admin, true); assert.equal(p.predio, false); assert.equal(p.saguao, true); assert.equal(p.noSaguao, false);
}

// pessoa do prédio no saguão: nem admin nem membro de andar; papel desconhecido vira o mais fechado
{
  const p = Andar.perfil({ papel: "pessoa", admin_predio: false, terreo: "saguao", andar: "principal" });
  assert.equal(p.papel, "pessoa"); assert.equal(p.admin, false); assert.equal(p.predio, false); assert.equal(p.noSaguao, true);
  for (const x of ["dono", "<b>", 7, null]) assert.equal(Andar.perfil({ papel: x, admin_predio: true }).admin, false, String(x));
  assert.equal(Andar.perfil({ terreo: "saguao" }).noSaguao, true, "sem andar na resposta é o principal");
  assert.equal(Andar.perfil({ papel: "membro", admin_predio: true }).predio, false, "admin_predio só vale com papel admin");
}

// conexão nova: conectado, conferindo o workspace (o andar fica sem agentes até confirmar)
assert.match(Andar.rotuloConexao("conferindo"), /conferindo o workspace/);

// conta só de andar extra (modo clássico): sem ?andar o servidor responde pelo primeiro andar dela, e o front passa a
// mandar esse ?andar daí em diante (Andar.seguir). Valor ruim ou ausente não mexe no andar.
{
  const c = { location: { hash: "" }, localStorage: null, window: {} };
  vm.runInNewContext(fs.readFileSync("static/expediente.js", "utf8"), c);
  const A = c.window.Andar;
  assert.equal(A.seguir({ andar: ID }), true);
  assert.equal(A.atual, ID);
  assert.equal(A.com("api/estado"), `api/estado?andar=${ID}`);
  assert.equal(A.seguir({ andar: ID }), false);
  for (const ruim of [{}, null, { andar: "../x" }, { andar: 7 }]) { assert.equal(A.seguir(ruim), false); assert.equal(A.atual, ID); }
  assert.equal(A.seguir({ andar: "principal" }), true);
  assert.equal(A.atual, "principal");
}

console.log("test_empresas_perfil.js: ok");
