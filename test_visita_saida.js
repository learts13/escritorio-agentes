"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function testar(falhar) {
  const ids = ["estado", "mensagens", "mensagens-vazio", "caracteres-restantes", "formulario", "texto", "sair", "cena", "mapa-estado", "ver-sala", "ver-escritorio"];
  const elementos = Object.fromEntries(ids.map(id => [id, {
    disabled: false, value: "", textContent: "", children: [],
    addEventListener(_, fn) { this.acao = fn; },
    replaceChildren() { this.children = []; }, append(item) { this.children.push(item); },
    querySelector() { return { disabled: false }; }, getContext() { return { clearRect() {} }; }
  }]));
  let resolver, rejeitar, timers = 0;
  const pendente = new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject; });
  const contexto = {
    document: { getElementById: id => elementos[id], createElement: () => ({ textContent: "" }) },
    location: { hash: "#" + "a".repeat(43), pathname: "/visita.html" }, history: { replaceState() {} },
    window: { addEventListener() {} }, navigator: { sendBeacon() {} }, Blob,
    Image: class {}, setTimeout() { timers++; }, clearTimeout() {},
    fetch: async url => {
      if (url.endsWith("/entrar")) return { ok: true, json: async () => ({ sessao: "teste" }) };
      if (url.endsWith("/receber")) return pendente;
      return new Promise(() => {});
    }
  };
  vm.runInNewContext(fs.readFileSync("static/visita.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  elementos.sair.acao();
  if (falhar) rejeitar(new Error("rede"));
  else resolver({ ok: true, json: async () => ({ mensagens: ["mensagem tardia"] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elementos.estado.textContent, "Você saiu da sala.");
  assert.equal(elementos.mensagens.children.length, 0);
  assert.equal(timers, 0);
  assert.equal(elementos["ver-sala"].disabled, true);
}

async function limitarTemporariamente() {
  const ids = ["estado", "mensagens", "mensagens-vazio", "caracteres-restantes", "formulario", "texto", "sair", "cena", "mapa-estado", "ver-sala", "ver-escritorio"];
  const elementos = Object.fromEntries(ids.map(id => [id, {
    disabled: false, value: "", textContent: "", children: [],
    addEventListener(_, fn) { this.acao = fn; }, replaceChildren() {}, append() {},
    querySelector() { return { disabled: false }; }, getContext() { return { clearRect() {} }; }
  }]));
  let atraso = null, proximaTentativa, consultas = 0;
  const contexto = {
    document: { getElementById: id => elementos[id], createElement: () => ({}) },
    location: { hash: "#" + "a".repeat(43), pathname: "/visita.html" }, history: { replaceState() {} },
    window: { addEventListener() {} }, navigator: { sendBeacon() {} }, Blob, Image: class {},
    setTimeout(fn, ms) { proximaTentativa = fn; atraso = ms; }, clearTimeout() {},
    fetch: async url => {
      if (url.endsWith("/entrar")) return { ok: true, json: async () => ({ sessao: "teste" }) };
      if (url.endsWith("/receber")) {
        consultas++;
        return consultas === 1 ? { ok: false, status: 429, json: async () => ({ erro: "limite" }) }
          : { ok: true, json: async () => ({ mensagens: [] }) };
      }
      return new Promise(() => {});
    }
  };
  vm.runInNewContext(fs.readFileSync("static/visita.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(atraso, 10000);
  assert.match(elementos.estado.textContent, /Tentando novamente/);
  assert.equal(elementos.texto.disabled, false);
  proximaTentativa();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elementos.estado.textContent, "Conectado à sala.");
}

async function entradaLimitada(sairDuranteEspera) {
  const ids = ["estado", "mensagens", "mensagens-vazio", "caracteres-restantes", "formulario", "texto", "sair", "cena", "mapa-estado", "ver-sala", "ver-escritorio"];
  const elementos = Object.fromEntries(ids.map(id => [id, {
    disabled: false, value: "", textContent: "", children: [],
    addEventListener(_, fn) { this.acao = fn; }, replaceChildren() {}, append() {},
    querySelector() { return { disabled: false }; }, getContext() { return { clearRect() {} }; }
  }]));
  let callback, atraso, cancelado = false, entradas = 0;
  const contexto = {
    document: { getElementById: id => elementos[id], createElement: () => ({}) },
    location: { hash: "#" + "a".repeat(43), pathname: "/visita.html" }, history: { replaceState() {} },
    window: { addEventListener() {} }, navigator: { sendBeacon() {} }, Blob, Image: class {},
    setTimeout(fn, ms) { callback = fn; atraso = ms; return 1; }, clearTimeout() { cancelado = true; },
    fetch: async (url, opcoes) => {
      if (url.endsWith("/entrar")) {
        entradas++;
        assert.equal(JSON.parse(opcoes.body).convite, "a".repeat(43));
        return entradas === 1 ? { ok: false, status: 429, json: async () => ({ erro: "limite" }) }
          : { ok: true, json: async () => ({ sessao: "teste" }) };
      }
      return new Promise(() => {});
    }
  };
  vm.runInNewContext(fs.readFileSync("static/visita.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(atraso, 10000);
  assert.match(elementos.estado.textContent, /Tentando novamente/);
  if (sairDuranteEspera) {
    elementos.sair.acao();
    assert.equal(cancelado, true);
    callback(); // Mesmo se a chamada já estava na fila, não deve entrar.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entradas, 1);
    assert.equal(elementos.estado.textContent, "Você saiu da sala.");
  } else {
    callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entradas, 2);
    assert.equal(elementos.estado.textContent, "Conectado à sala.");
  }
}

async function avisoDoAgente(agente) {
  const ids = ["estado", "mensagens", "mensagens-vazio", "caracteres-restantes", "formulario", "texto", "sair", "cena", "mapa-estado", "ver-sala", "ver-escritorio", "aviso-agente"];
  const elementos = Object.fromEntries(ids.map(id => [id, {
    disabled: false, value: "", textContent: "", hidden: true, addEventListener() {}, replaceChildren() {}, append() {},
    querySelector() { return { disabled: false }; }, getContext() { return { clearRect() {} }; }
  }]));
  const contexto = {
    document: { getElementById: id => elementos[id], createElement: () => ({ textContent: "" }) },
    location: { hash: "#" + "a".repeat(43), pathname: "/visita.html" }, history: { replaceState() {} },
    window: { addEventListener() {} }, navigator: { sendBeacon() {} }, Blob, Image: class {}, setTimeout() {}, clearTimeout() {},
    fetch: async url => url.endsWith("/entrar") ? { ok: true, json: async () => ({ sessao: "s", agente }) } : new Promise(() => {})
  };
  vm.runInNewContext(fs.readFileSync("static/visita.js", "utf8"), contexto);
  await new Promise(resolve => setImmediate(resolve));
  const aviso = elementos["aviso-agente"];
  if (agente) {
    assert.equal(aviso.hidden, false);
    assert.match(aviso.textContent, /Senku \(agente\) participa desta sala/);
    assert.match(aviso.textContent, /fica guardado/);
  } else assert.equal(aviso.hidden, true);
}

(async () => { await testar(false); await testar(true); await limitarTemporariamente(); await entradaLimitada(false); await entradaLimitada(true);
  await avisoDoAgente("Senku"); await avisoDoAgente(null); })().catch(e => { console.error(e); process.exitCode = 1; });
