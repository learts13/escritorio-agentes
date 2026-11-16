"use strict";
// Painel de conversa da equipe (static/chat_sala.js, 1.6 Onda 2): como uma mensagem do store vira tela, num DOM falso.
// Nome, texto e nome de arquivo só por textContent; imagem só dos 4 tipos; o resto do anexo é "Baixar".
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// um DOM falso mínimo: árvore, texto, atributos e classes
function elemento(tag) {
  const e = {
    tagName: tag.toUpperCase(), filhos: [], attrs: {}, dataset: {}, style: {}, hidden: false, disabled: false, ouvintes: {}, _texto: "",
    classes: new Set(),
    get className() { return [...e.classes].join(" "); }, set className(v) { e.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get classList() { return { add: (...c) => c.forEach(x => e.classes.add(x)), remove: (...c) => c.forEach(x => e.classes.delete(x)),
      toggle: (c, f) => ((f ?? !e.classes.has(c)) ? e.classes.add(c) : e.classes.delete(c)), contains: c => e.classes.has(c) }; },
    get textContent() { return e._texto + e.filhos.map(f => (typeof f === "string" ? f : f.textContent)).join(""); },
    set textContent(v) { e._texto = String(v); e.filhos = []; },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: k => e.attrs[k] ?? null, removeAttribute(k) { delete e.attrs[k]; },
    append(...f) { e.filhos.push(...f); }, replaceChildren(...f) { e.filhos = f; e._texto = ""; },
    addEventListener(t, f) { (e.ouvintes[t] ||= []).push(f); },
  };
  return e;
}
const todos = (e, saida = []) => { for (const f of e.filhos) if (typeof f !== "string") { saida.push(f); todos(f, saida); } return saida; };
const achar = (e, classe) => todos(e).filter(f => f.classes.has(classe));

const document = { getElementById: () => null, createElement: elemento, createTextNode: t => t, body: elemento("body") };
const contexto = { window: {}, document, location: { hash: "" }, localStorage: null, URLSearchParams, Intl, Date };
vm.runInNewContext(fs.readFileSync("static/expediente.js", "utf8"), contexto);
contexto.Andar = contexto.window.Andar;
vm.runInNewContext(fs.readFileSync("static/chat_sala.js", "utf8"), contexto);
const { elMensagem } = contexto.window.ChatSala;

const base = { id: 9, canal: "geral", usuario: "ana.lima", nome: "Ana", texto: "oi @joao, olha", apagada: false,
  em: "2026-11-16T13:05:00Z", reacoes: [], anexo: null };
const ctx = { eu: "joao", logins: new Set(["joao", "ana.lima"]), andar: "a1b2c3d4", moderar: false };

// de outra pessoa: nome, hora, a menção destacada e sem "Apagar"
{
  const li = elMensagem(base, ctx);
  assert.equal(li.dataset.id, "9");
  assert.equal(achar(li, "chat-sala-cabeca")[0].filhos[0].textContent, "Ana");
  const mencao = achar(li, "chat-sala-mencao");
  assert.equal(mencao.length, 1);
  assert.equal(mencao[0].textContent, "@joao");
  assert.ok(mencao[0].classes.has("a-mim"), "a menção a mim chama atenção");
  assert.equal(achar(li, "chat-sala-texto")[0].textContent, "oi @joao, olha");
  assert.equal(achar(li, "chat-sala-apagar").length, 0);
  assert.ok(!li.classes.has("de-mim"));
}
// a lista de pessoas do andar vem sem mim, mas a menção a mim também destaca
{
  const li = elMensagem(base, { ...ctx, logins: new Set(["ana.lima"]) });
  assert.equal(achar(li, "chat-sala-mencao")[0].textContent, "@joao");
}
// a minha: "Você", com "Apagar"; o moderador apaga a dos outros no canal, nunca na DM
{
  const li = elMensagem({ ...base, usuario: "joao" }, ctx);
  assert.ok(li.classes.has("de-mim"));
  assert.equal(achar(li, "chat-sala-cabeca")[0].filhos[0].textContent, "Você");
  assert.equal(achar(li, "chat-sala-apagar").length, 1);
  assert.equal(achar(elMensagem(base, { ...ctx, moderar: true }), "chat-sala-apagar").length, 1);
  assert.equal(achar(elMensagem({ ...base, canal: "dm:3" }, { ...ctx, moderar: true }), "chat-sala-apagar").length, 0);
}
// nome com markup é texto; ex-membro aparece como tal
{
  const li = elMensagem({ ...base, nome: "<img src=x onerror=alert(1)>", texto: "<b>oi</b>" }, ctx);
  assert.equal(achar(li, "chat-sala-cabeca")[0].filhos[0].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(todos(li).filter(f => f.tagName === "IMG" || f.tagName === "B").length, 0);
  assert.equal(achar(elMensagem({ ...base, usuario: null, nome: "ex-membro" }, ctx), "chat-sala-cabeca")[0].filhos[0].textContent, "ex-membro");
}
// apagada: só o aviso, sem texto, anexo, reações nem botões
{
  const li = elMensagem({ ...base, texto: null, apagada: true, reacoes: [{ emoji: "👍", n: 1, eu: true }] }, ctx);
  assert.equal(achar(li, "chat-sala-texto")[0].textContent, "Mensagem apagada.");
  assert.ok(li.classes.has("apagada"));
  assert.equal(achar(li, "chat-sala-reacoes").length, 0);
  assert.equal(achar(li, "chat-sala-acoes").length, 0);
}
// reações: um botão por emoji com aria-pressed na minha; e o "Reagir"
{
  const li = elMensagem({ ...base, reacoes: [{ emoji: "👍", n: 2, eu: true }, { emoji: "🎉", n: 1, eu: false }] }, ctx);
  const bs = achar(li, "chat-sala-reacao");
  assert.equal(bs.length, 2);
  assert.equal(bs[0].attrs["aria-pressed"], "true");
  assert.equal(bs[1].attrs["aria-pressed"], "false");
  assert.equal(bs[0].dataset.emoji, "👍");
  assert.match(bs[0].attrs["aria-label"], /👍.*2/);
  assert.equal(achar(li, "chat-sala-reagir").length, 1);
}
// anexo imagem: <img> com a URL do anexo (inline) e o "Baixar" com ?baixar=1
{
  const li = elMensagem({ ...base, texto: "", anexo: { id: 4, nome: "foto.png", tipo: "image/png", tamanho: 2048 } }, ctx);
  const img = todos(li).find(f => f.tagName === "IMG");
  assert.equal(img.src, "api/anexo?id=4&andar=a1b2c3d4");
  assert.equal(img.alt, "foto.png");
  const baixar = achar(li, "chat-sala-baixar")[0];
  assert.equal(baixar.href, "api/anexo?id=4&baixar=1&andar=a1b2c3d4");
  assert.equal(baixar.attrs.download, "");
  assert.equal(achar(li, "chat-sala-texto").length, 0, "sem texto, sem parágrafo vazio");
}
// anexo que não é imagem (ou SVG que chegasse): nunca <img>, só nome, tamanho e "Baixar"
for (const tipo of ["application/pdf", "application/zip", "image/svg+xml"]) {
  const li = elMensagem({ ...base, anexo: { id: 5, nome: "a<b>.zip", tipo, tamanho: 1536 } }, ctx);
  assert.equal(todos(li).filter(f => f.tagName === "IMG").length, 0, tipo);
  assert.equal(achar(li, "chat-sala-arquivo-nome")[0].textContent, "a<b>.zip");
  assert.equal(achar(li, "chat-sala-arquivo-tam")[0].textContent, "1,5 KB");
  assert.equal(achar(li, "chat-sala-baixar")[0].href, "api/anexo?id=5&baixar=1&andar=a1b2c3d4");
}
// modo apresentação (o mapa esconde html.apresentacao [data-sensivel]): o nome, o texto e o anexo
{
  const li = elMensagem({ ...base, anexo: { id: 4, nome: "foto.png", tipo: "image/png", tamanho: 2048 } }, ctx);
  assert.ok("data-sensivel" in achar(li, "chat-sala-cabeca")[0].filhos[0].attrs, "nome");
  assert.ok("data-sensivel" in achar(li, "chat-sala-texto")[0].attrs, "texto");
  assert.ok("data-sensivel" in achar(li, "chat-sala-anexo")[0].attrs, "anexo");
  const apagada = elMensagem({ ...base, apagada: true, texto: null }, ctx);
  assert.ok("data-sensivel" in achar(apagada, "chat-sala-cabeca")[0].filhos[0].attrs, "nome da apagada");
}
console.log("test_painel_conversa.js ok");
