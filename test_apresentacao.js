"use strict";
// O modo apresentação (static/apresentacao.js, 1.6 Onda 3): um interruptor que troca os nomes do mapa por "Agente 1" e
// "Pessoa 2", tira os balões (app.js pergunta ligado()) e esconde por CSS o que tem nome, tarefa, conversa, mural e recado
// (estilo.css, html.apresentacao). Lembrado por aba (sessionStorage, que pode faltar), com botão criado por JS e atalho.
// DOM falso mínimo, no molde dos outros test_*.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const CODIGO = fs.readFileSync("static/apresentacao.js", "utf8");

function elemento(tag) {
  const e = {
    tagName: tag.toUpperCase(), filhos: [], atributos: {}, ouvintes: {}, textContent: "", hidden: false, type: "", className: "",
    classes: new Set(),
    classList: {
      add: c => e.classes.add(c), remove: c => e.classes.delete(c), contains: c => e.classes.has(c),
      toggle: (c, sim) => { if (sim === undefined ? !e.classes.has(c) : sim) e.classes.add(c); else e.classes.delete(c); return e.classes.has(c); },
    },
    setAttribute(n, v) { e.atributos[n] = String(v); }, getAttribute: n => (n in e.atributos ? e.atributos[n] : null),
    removeAttribute(n) { delete e.atributos[n]; },
    append(...f) { e.filhos.push(...f); }, appendChild(f) { e.filhos.push(f); return f; },
    addEventListener(t, f) { (e.ouvintes[t] = e.ouvintes[t] || []).push(f); },
    click() { for (const f of e.ouvintes.click || []) f({ preventDefault() {} }); },
  };
  return e;
}

function carregar({ guardado = null, semStorage = false, semControles = false } = {}) {
  const raiz = elemento("html"), controles = elemento("div"), ouvintes = {}, eventos = [];
  const guarda = new Map(guardado === null ? [] : [["escritorio:apresentacao", guardado]]);
  const sessionStorage = semStorage
    ? { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); }, removeItem() { throw new Error("bloqueado"); } }
    : { getItem: k => (guarda.has(k) ? guarda.get(k) : null), setItem: (k, v) => guarda.set(k, String(v)), removeItem: k => guarda.delete(k) };
  const document = {
    documentElement: raiz,
    querySelector: s => (s === ".controles" && !semControles ? controles : null),
    createElement: elemento, createElementNS: (_, tag) => elemento(tag),
    addEventListener(t, f) { (ouvintes[t] = ouvintes[t] || []).push(f); },
    activeElement: { tagName: "BODY" },
  };
  const ctx = { document, sessionStorage, console, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } } };
  ctx.window = ctx;
  ctx.renomeados = 0; ctx.Vida = { renomear() { ctx.renomeados++; } };
  ctx.dispatchEvent = ev => eventos.push(ev);
  vm.runInNewContext(CODIGO, ctx);
  const tecla = o => { let evitou = false; for (const f of ouvintes.keydown || []) f({ preventDefault() { evitou = true; }, key: "", code: "", altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...o }); return evitou; };
  return { A: ctx.Apresentacao, ctx, raiz, controles, guarda, eventos, tecla, document };
}

// desligado por padrão: os nomes de sempre, sem classe, botão no lugar com aria-pressed false
{
  const t = carregar();
  assert.equal(t.A.ligado(), false);
  assert.equal(t.raiz.classList.contains("apresentacao"), false);
  assert.equal(t.A.nome({ id: "a1", handle: "ana-bot", nome: "Ana Bot" }), "Ana Bot");
  assert.equal(t.A.nome({ usuario: "joao", nome: "João Silva" }), "João Silva");
  assert.equal(t.controles.filhos.length, 1, "o botão entra na barra da câmera");
  const b = t.controles.filhos[0];
  assert.equal(b.tagName, "BUTTON"); assert.equal(b.type, "button");
  assert.equal(b.getAttribute("aria-pressed"), "false");
  assert.ok(/apresenta/i.test(b.getAttribute("aria-label")));
  assert.equal(b.getAttribute("aria-keyshortcuts"), "Alt+Shift+P");
}

// ligado: pseudônimos estáveis e separados por tipo, "Você" para mim, classe na raiz, lembrado na aba, evento para a tela
{
  const t = carregar();
  t.controles.filhos[0].click();
  assert.equal(t.A.ligado(), true);
  assert.equal(t.raiz.classList.contains("apresentacao"), true);
  assert.equal(t.controles.filhos[0].getAttribute("aria-pressed"), "true");
  assert.equal(t.guarda.get("escritorio:apresentacao"), "1");
  assert.equal(t.ctx.renomeados, 1, "o mapa troca os nomes na hora (Vida.renomear)");
  assert.equal(t.eventos.at(-1).type, "apresentacao"); assert.equal(t.eventos.at(-1).detail.ligado, true);
  const ana = { id: "a1", handle: "ana-bot", nome: "Ana Bot" }, beto = { id: "a2", handle: "beto", nome: "Beto" };
  const joao = { usuario: "joao", nome: "João Silva" }, maria = { usuario: "maria", nome: "Maria" };
  assert.equal(t.A.nome(ana), "Agente 1");
  assert.equal(t.A.nome(joao), "Pessoa 1");
  assert.equal(t.A.nome(beto), "Agente 2");
  assert.equal(t.A.nome(maria), "Pessoa 2");
  assert.equal(t.A.nome(ana), "Agente 1", "o mesmo agente, o mesmo número");
  assert.equal(t.A.nome({ ...joao, nome: "João S." }), "Pessoa 1", "o número segue a pessoa, não o nome");
  assert.equal(t.A.nome({ usuario: "eu", eu: true, nome: "Eu Mesmo (você)" }), "Você");
  assert.equal(t.A.nome(null), "");
  // desligar devolve tudo
  t.controles.filhos[0].click();
  assert.equal(t.A.ligado(), false);
  assert.equal(t.raiz.classList.contains("apresentacao"), false);
  assert.equal(t.guarda.has("escritorio:apresentacao"), false);
  assert.equal(t.A.nome(ana), "Ana Bot");
}

// recarregar a aba: volta ligado (sessionStorage); a classe entra antes do primeiro quadro
{
  const t = carregar({ guardado: "1" });
  assert.equal(t.A.ligado(), true);
  assert.equal(t.raiz.classList.contains("apresentacao"), true);
  assert.equal(t.controles.filhos[0].getAttribute("aria-pressed"), "true");
}

// sem sessionStorage (aba anônima com o armazenamento bloqueado): liga e desliga só na memória, sem erro
{
  const t = carregar({ semStorage: true });
  assert.equal(t.A.ligado(), false);
  t.A.alternar();
  assert.equal(t.A.ligado(), true);
  t.A.alternar();
  assert.equal(t.A.ligado(), false);
}

// atalho Alt+Shift+P (pelo code, que não muda com o layout do teclado); fora disso e dentro de campo de texto, nada
{
  const t = carregar();
  assert.equal(t.tecla({ code: "KeyP", key: "P", altKey: true, shiftKey: true }), true);
  assert.equal(t.A.ligado(), true);
  t.tecla({ code: "KeyP", key: "p", altKey: true });
  assert.equal(t.A.ligado(), true, "só Alt não basta");
  t.tecla({ code: "KeyP", key: "P", altKey: true, shiftKey: true, ctrlKey: true });
  assert.equal(t.A.ligado(), true, "com Ctrl, não");
  t.document.activeElement = { tagName: "INPUT" };
  t.tecla({ code: "KeyP", key: "P", altKey: true, shiftKey: true });
  assert.equal(t.A.ligado(), true, "escrevendo num campo, o atalho não rouba a tecla");
  t.document.activeElement = { tagName: "BODY" };
  t.tecla({ code: "KeyP", key: "P", altKey: true, shiftKey: true });
  assert.equal(t.A.ligado(), false);
}

// página sem a barra da câmera (outra tela): sem botão, o resto funciona
{
  const t = carregar({ semControles: true });
  t.A.ligar(true);
  assert.equal(t.A.ligado(), true);
}

// o CSS: no modo apresentação, some tudo o que mostra nome de gente ou de agente, título de tarefa, texto de conversa,
// mural e recado de status (display:none tira também do leitor de tela, com o title e o aria-label junto)
{
  const css = fs.readFileSync("static/estilo.css", "utf8"), html = fs.readFileSync("static/index.html", "utf8");
  const regra = css.match(/\/\* modo apresentação[\s\S]*?\*\/\s*([^{}]+)\{\s*display:\s*none\s*!important;?\s*\}/);
  assert.ok(regra, "a regra do modo apresentação no estilo.css");
  const seletores = regra[1].split(",").map(s => s.trim());
  assert.ok(seletores.every(s => s.startsWith("html.apresentacao ")), "toda a regra presa à classe");
  const cobertos = new Set(seletores.map(s => s.slice("html.apresentacao ".length)));
  const SENSIVEIS = [
    "#lista", "#busca-lista", "#usuario-nome", "#usuario-ini", "#cartao-agente", "#ficha", "#conversa", "#chat-sala",
    "#greve-motivo", "#tv-legenda", "#social-anuncio", "#equipe", "#equipe-lista", "#meu-status", "#equipe-mural", "#equipe-aviso",
    "#aceno-aviso", "#mural-lista", "#placar-tabela", "#ringue-lista", "#ringue-texto", ".widgets", "section.agora", "#v-conversas > *", "#v-aprovacoes > *", "#v-jornal > *",
    "[data-sensivel]",
  ];
  for (const s of SENSIVEIS) assert.ok(cobertos.has(s), `escondido no modo apresentação: ${s}`);
  assert.ok(cobertos.has("#reuniao-aviso-entrar") && html.includes('id="reuniao-aviso-entrar"'), "o Entrar do aviso de 5 min some");
  // os links das salas no Personalizar: o do Zoom pode levar a senha (?pwd=); a lista inteira some, com os campos
  assert.ok(cobertos.has("#reunioes-links"), "os campos com os links das salas somem");
  assert.match(html, /<section id="a-reunioes"[^>]*>[\s\S]*?<ul id="reunioes-links"[\s\S]*?<\/section>/, "a lista dos links fica no cartão do Personalizar");
  assert.match(css, /^html\.apresentacao #a-reunioes::after \{ content: "[^"]*escondid/m, "o cartão diz por que está vazio");
  assert.match(css, /^\.reuniao-aviso-generico \{ display: none; \}/m, "o texto genérico do aviso fica escondido fora do modo");
  assert.match(css, /^html\.apresentacao \.reuniao-aviso-generico \{ display: block; \}/m, "e aparece no modo apresentação");
  assert.ok(!cobertos.has(".agora"), "o cartão da reunião em andamento (li.reuniao.agora) não some inteiro, só o título e os nomes");
  for (const s of SENSIVEIS) if (s.startsWith("#")) assert.ok(html.includes(`id="${s.slice(1).split(" ")[0]}"`), `${s} existe no index.html`);
}

console.log("test_apresentacao: ok");
