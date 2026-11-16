"use strict";
// Linha do tempo (static/linha_tempo.js): a faixa "Enquanto você esteve fora" (só depois de 1 h longe e com algo a
// contar; fechável; cada item leva ao agente) e a linha de hoje no cartão do agente. Relógio injetado.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function no(tag) {
  const e = {
    tag, children: [], atributos: {}, ouvintes: {}, textContent: "", hidden: false, className: "", type: "",
    append(...f) { this.children.push(...f); }, replaceChildren(...f) { this.children = f; },
    setAttribute(k, v) { this.atributos[k] = String(v); }, removeAttribute(k) { delete this.atributos[k]; },
    addEventListener(t, fn) { this.ouvintes[t] = fn; }, focus() {},
  };
  return e;
}
const todos = (e, saida = []) => { for (const f of e.children) if (f && typeof f === "object") { saida.push(f); todos(f, saida); } return saida; };
const texto = e => (typeof e === "string" ? e : e.textContent + e.children.map(texto).join(""));

function carregar({ guardado, quebrado = false } = {}) {
  const faixa = Object.assign(no("section"), { hidden: true });   // o index.html a traz escondida
  const ids = new Map([["faixa-ausencia", faixa]]), guardados = new Map(guardado ? [["escritorio:visita:principal", guardado]] : []);
  const localStorage = quebrado ? { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } }
    : { getItem: k => guardados.get(k) ?? null, setItem: (k, v) => guardados.set(k, String(v)) };
  const document = { getElementById: id => { if (!ids.has(id)) ids.set(id, no("div")); return ids.get(id); },
    createElement: no, createTextNode: t => ({ textContent: t, children: [] }), addEventListener() {}, visibilityState: "visible" };
  const contexto = { window: {}, document, localStorage, Intl, Date, Math, Number, String, Map, Promise, setInterval() {}, console };
  vm.runInNewContext(fs.readFileSync("static/linha_tempo.js", "utf8"), contexto);
  return { LT: contexto.window.LinhaTempo, faixa: () => faixa, guardados };
}

const AGORA = Date.parse("2026-11-16T11:00:00Z");   // 08:00 em Brasília
const H = 3600 * 1000;

(async () => {
  {   // as frases puras
    const { LT } = carregar();
    assert.equal(LT.duracao(30), "menos de 1 min");
    assert.equal(LT.duracao(2400), "40 min");
    assert.equal(LT.duracao(4800), "1 h 20 min");
    assert.equal(LT.duracao(7200), "2 h");
    assert.equal(LT.frase({ de: "livre", para: "trabalhando" }), "começou uma tarefa");
    assert.equal(LT.frase({ de: "trabalhando", para: "aprovacao" }), "pediu aprovação");
    assert.equal(LT.frase({ de: "livre", para: "resposta" }), "fez uma pergunta");
    assert.equal(LT.frase({ de: "aprovacao", para: "trabalhando" }), "voltou a trabalhar");
    assert.equal(LT.frase({ de: "resposta", para: "livre" }), "terminou uma tarefa");
    assert.equal(LT.resumoDoAgente({ tarefas: 3, esperas: [
      { tipo: "aprovacao", duracao_s: 2400, resolvida: true }, { tipo: "resposta", duracao_s: 7200, resolvida: false }] }),
    "3 tarefas concluídas · esperou aprovação 40 min, resolvido · espera resposta há 2 h");
    assert.equal(LT.resumoDoAgente({ tarefas: 1, esperas: [] }), "1 tarefa concluída");
  }

  {   // sem localStorage (aba anônima): não quebra nem pede nada
    const { LT, faixa } = carregar({ quebrado: true });
    let pedidos = 0;
    await LT.iniciar({ json: async () => { pedidos++; return {}; }, nome: () => "X", ir() {}, andar: "principal", agora: () => AGORA });
    assert.equal(pedidos, 0);
    assert.equal(faixa().hidden, true);
  }

  {   // primeira visita: só marca
    const { LT, guardados } = carregar();
    let pedidos = 0;
    await LT.iniciar({ json: async () => { pedidos++; return {}; }, nome: () => "X", ir() {}, andar: "principal", agora: () => AGORA });
    assert.equal(pedidos, 0);
    assert.equal(guardados.get("escritorio:visita:principal"), String(AGORA));
  }

  {   // voltou em menos de 1 h: nada
    const { LT } = carregar({ guardado: String(AGORA - 50 * 60 * 1000) });
    let pedidos = 0;
    await LT.iniciar({ json: async () => { pedidos++; return {}; }, nome: () => "X", ir() {}, andar: "principal", agora: () => AGORA });
    assert.equal(pedidos, 0);
  }

  {   // mais de 1 h e nada aconteceu: a faixa fica escondida
    const { LT, faixa } = carregar({ guardado: String(AGORA - 14 * H) });
    const urls = [];
    await LT.iniciar({ json: async u => { urls.push(u); return { desde: 0, ate: 0, agentes: [] }; }, nome: () => "X", ir() {},
      andar: "principal", agora: () => AGORA });
    assert.deepEqual(urls, [`api/fora?desde=${(AGORA - 14 * H) / 1000}`]);
    assert.equal(faixa().hidden, true);
  }

  {   // mais de 1 h com algo: a faixa, um item por agente, cada um leva ao agente; fechável
    const desde = AGORA - 14 * H;
    const { LT, faixa } = carregar({ guardado: String(desde) });
    const fomos = [];
    await LT.iniciar({
      json: async () => ({ desde: desde / 1000, ate: AGORA / 1000, agentes: [
        { agente: "b1", tarefas: 3, esperas: [{ tipo: "aprovacao", inicio: 0, fim: 1, duracao_s: 2400, resolvida: true }] },
        { agente: "s2", tarefas: 0, esperas: [{ tipo: "resposta", inicio: 0, fim: null, duracao_s: 600, resolvida: false }] }] }),
      nome: id => ({ b1: "Bento", s2: "Sol" })[id], ir: id => fomos.push(id), andar: "principal", agora: () => AGORA });
    const f = faixa();
    assert.equal(f.hidden, false);
    const tudo = texto(f);
    assert.match(tudo, /Enquanto você esteve fora/);
    assert.match(tudo, /desde ontem, 18:00/);
    assert.match(tudo, /Bento.*3 tarefas concluídas · esperou aprovação 40 min, resolvido/);
    assert.match(tudo, /Sol.*espera resposta há 10 min/);
    const nomes = todos(f).filter(e => "data-sensivel" in e.atributos).map(texto);
    assert.deepEqual(nomes, ["Bento", "Sol"], "o modo apresentação esconde os nomes");
    const itens = todos(f).filter(e => e.className === "lt-item");
    assert.equal(itens.length, 2);
    for (const b of itens) assert.equal(b.tag, "button");
    itens[1].ouvintes.click();
    assert.deepEqual(fomos, ["s2"]);
    const fechar = todos(f).find(e => e.className === "lt-fechar");
    assert.equal(fechar.atributos["aria-label"], "Fechar o resumo de enquanto você esteve fora");
    fechar.ouvintes.click();
    assert.equal(f.hidden, true);
  }

  {   // a linha de hoje no cartão: pede uma vez por minuto por agente
    const { LT } = carregar();
    const urls = [];
    let agora = AGORA;
    LT.configurar({ json: async u => { urls.push(u); return { agente: "b1", dia: "2026-11-16", itens: [
      { de: "livre", para: "trabalhando", em: Date.parse("2026-11-16T12:05:00Z") / 1000 },
      { de: "trabalhando", para: "aprovacao", em: Date.parse("2026-11-16T12:30:00Z") / 1000 }] }; }, agora: () => agora });
    const el = LT.noCard("b1");
    assert.equal(el.tag, "ol");
    assert.equal(el.atributos["aria-label"], "Linha do tempo de hoje");
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(urls, ["api/linha?agente=b1"]);
    assert.deepEqual(el.children.map(texto), ["09:05 começou uma tarefa", "09:30 pediu aprovação"]);
    const de_novo = LT.noCard("b1");
    assert.deepEqual(de_novo.children.map(texto), ["09:05 começou uma tarefa", "09:30 pediu aprovação"], "do cache, na hora");
    agora += 61 * 1000;
    LT.noCard("b1");
    await new Promise(r => setTimeout(r, 0));
    assert.equal(urls.length, 2, "passado 1 min, pede de novo");
  }

  {   // a ficha é refeita antes da resposta chegar: o cartão novo (o que está na tela) recebe a linha
    const { LT } = carregar();
    let solta;
    LT.configurar({ json: () => new Promise(r => { solta = r; }), agora: () => AGORA });
    const velho = LT.noCard("b1"), novo = LT.noCard("b1");
    assert.deepEqual(novo.children.map(texto), ["Carregando…"]);
    solta({ itens: [{ de: "livre", para: "trabalhando", em: Date.parse("2026-11-16T12:05:00Z") / 1000 }] });
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(novo.children.map(texto), ["09:05 começou uma tarefa"]);
    assert.ok(velho);
  }

  {   // nada hoje, ou o pedido falhou
    const { LT } = carregar();
    LT.configurar({ json: async () => ({ itens: [] }), agora: () => AGORA });
    const el = LT.noCard("x9");
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(el.children.map(texto), ["Nada registrado hoje."]);
    LT.configurar({ json: async () => { throw new Error("HTTP 500"); }, agora: () => AGORA });
    const el2 = LT.noCard("x8");
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(el2.children.map(texto), ["Não deu para carregar agora."]);
  }

  console.log("test_linha_tempo: ok");
})().catch(e => { console.error(e); process.exit(1); });
