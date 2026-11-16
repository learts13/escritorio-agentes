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

// a linha "Este andar" do elevador: o saguão (conexao null, que o app.js lê como "") não ganha "sem leitura"
{
  const { Andar } = carregar();
  for (const c of ["", null, undefined, "conectado"]) assert.equal(Andar.estadoDoAndar(c), "", String(c));
  assert.equal(Andar.estadoDoAndar("sem_conexao"), "Este andar: sem conexão");
  assert.equal(Andar.estadoDoAndar("<b>"), "Este andar: sem leitura");
}

// as telas pelo #: Conversas só para o admin do andar; o saguão não tem conversas nem jornal
{
  const { Andar } = carregar();
  const classico = { terreo: "classico", andar: "principal", papel: "admin", admin_predio: true };
  const saguao = { terreo: "saguao", andar: "principal", papel: "pessoa", admin_predio: false };
  for (const t of ["escritorio", "conversas", "jornal", "personalizar"]) assert.equal(Andar.telaLiberada(t, classico), true, t);
  assert.equal(Andar.telaLiberada("conversas", { ...classico, papel: "membro", admin_predio: false }), false);
  assert.equal(Andar.telaLiberada("jornal", { ...classico, papel: "membro", admin_predio: false }), true);
  for (const c of [saguao, { ...saguao, papel: "admin", admin_predio: true }]) {
    assert.equal(Andar.telaLiberada("jornal", c), false);
    assert.equal(Andar.telaLiberada("conversas", c), false);
    assert.equal(Andar.telaLiberada("personalizar", c), true);
  }
  for (const c of [saguao, { ...saguao, papel: "admin", admin_predio: true }]) assert.equal(Andar.telaLiberada("aprovacoes", c), false);
  assert.equal(Andar.telaLiberada("aprovacoes", { ...classico, papel: "membro", admin_predio: false }), true);
  assert.equal(Andar.telaLiberada("aprovacoes", { ...saguao, andar: ID, papel: "membro" }), true);
  // no andar extra do modo saguão o jornal volta
  assert.equal(Andar.telaLiberada("jornal", { ...saguao, andar: ID, papel: "membro" }), true);
  assert.equal(Andar.telaLiberada("jornal", null), true);   // servidor antigo: a tela de sempre
}

// Visitas é do prédio: o link leva "so-predio", que só aparece com data-predio (admin do prédio)
{
  const html = fs.readFileSync("static/index.html", "utf8"), css = fs.readFileSync("static/estilo.css", "utf8");
  assert.match(html, /<a class="[^"]*\bso-predio\b[^"]*" href="\/visitas-admin\.html">/);
  assert.match(css, /body:not\(\[data-predio\]\) \.so-predio\b[^{]*\{ display: none !important; \}/);
  assert.match(css, /body\[data-saguao\] a\[data-rota="jornal"\]/);
  // o saguão não tem agentes: some tudo o que é deles (estados, painéis, lista da lateral, aprovações)
  for (const s of ['a[data-rota="aprovacoes"]', "#estados", ".widgets", "#lat-agentes", ".lat-externos", "section.agora", ".dica-mapa"])
    assert.ok(css.includes(`body[data-saguao] ${s}`), s);
  assert.match(html, /<section id="lat-agentes" class="lat-secao">/);
  assert.match(fs.readFileSync("static/app.js", "utf8"), /noSaguao \? "Saguão do prédio"/);
  const { Andar } = carregar();
  assert.equal(Andar.perfil({ papel: "admin", admin_predio: false, andar: ID }).predio, false);   // admin da empresa
  assert.equal(Andar.perfil({ papel: "admin", admin_predio: true }).predio, true);
}

// o toque no aviso pessoal com o escritório aberto (sw.js → postMessage {tipo: "aviso", andar, canal}): o andar e o canal
// para o app.js trocar de andar e abrir o canal; o que não for andar válido ou canal do contrato não passa
{
  const { Andar } = carregar();
  const de = d => { const r = Andar.doAviso(d); return r && { ...r }; };   // cópia: vem de outro realm (vm)
  assert.deepEqual(de({ tipo: "aviso", andar: ID, canal: "geral" }), { andar: ID, canal: "geral" });
  assert.deepEqual(de({ tipo: "aviso", andar: ID, canal: "dm:42" }), { andar: ID, canal: "dm:42" });
  assert.deepEqual(de({ tipo: "aviso", andar: ID, canal: "sala:time:Design & Arte" }), { andar: ID, canal: "sala:time:Design & Arte" });
  assert.deepEqual(de({ tipo: "aviso", andar: ID }), { andar: ID, canal: null }, "aceno e porta: só o andar");
  assert.deepEqual(de({ tipo: "aviso", andar: "principal", canal: "dm:4" }), { andar: "principal", canal: "dm:4" }, "empresa só no principal");
  assert.deepEqual(de({ tipo: "aviso", andar: ID, canal: "dm:x" }), { andar: ID, canal: null });
  assert.deepEqual(de({ tipo: "aviso", andar: ID, canal: "sala:a\nb" }), { andar: ID, canal: null }, "controle não passa");
  assert.deepEqual(de({ tipo: "aviso", andar: ID, canal: "sala:" + "x".repeat(200) }), { andar: ID, canal: null });
  for (const ruim of [null, "x", { tipo: "agente", andar: ID }, { tipo: "aviso", andar: "../x" }, { tipo: "aviso" }]) assert.equal(Andar.doAviso(ruim), null);
}

console.log("test_andar.js: ok");
