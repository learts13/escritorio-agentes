"use strict";
// Reuniões na tela (static/reunioes.js, 1.6 Onda 3) num DOM falso: a agenda da semana, marcar, cancelar com confirmação,
// a reunião geral, o link de cada sala no Personalizar (com a lista de hosts), o "Entrar na reunião" em aba nova e o aviso
// de 5 min. Sem config.equipe.reunioes (saguão, store desligado), nada aparece e nada é pedido.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let foco = null;
function elemento(tag) {
  const e = {
    tagName: tag.toUpperCase(), filhos: [], pai: null, attrs: {}, dataset: {}, style: {}, hidden: false, disabled: false, ouvintes: {},
    _texto: "", classes: new Set(), value: "", id: "", checked: false, open: false, href: "", target: "", rel: "",
    get className() { return [...e.classes].join(" "); }, set className(v) { e.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get classList() { return { add: (...c) => c.forEach(x => e.classes.add(x)), remove: (...c) => c.forEach(x => e.classes.delete(x)),
      toggle: (c, f) => ((f ?? !e.classes.has(c)) ? e.classes.add(c) : e.classes.delete(c)), contains: c => e.classes.has(c) }; },
    get textContent() { return e._texto + e.filhos.map(f => (typeof f === "string" ? f : f.textContent)).join(""); },
    set textContent(v) { e._texto = String(v); e.filhos = []; },
    get children() { return e.filhos.filter(f => typeof f !== "string"); },
    setAttribute(k, v) { e.attrs[k] = String(v); if (k === "href") e.href = String(v); }, getAttribute: k => e.attrs[k] ?? null,
    removeAttribute(k) { delete e.attrs[k]; if (k === "href") e.href = ""; }, hasAttribute: k => k in e.attrs,
    toggleAttribute(k, f) { if (f) e.attrs[k] = ""; else delete e.attrs[k]; },
    append(...f) { for (const x of f) { if (typeof x !== "string") x.pai = e; e.filhos.push(x); } },
    replaceChildren(...f) { e.filhos = []; e._texto = ""; e.append(...f); },
    addEventListener(t, f) { (e.ouvintes[t] ||= []).push(f); },
    focus() { foco = e; }, click() { disparar(e, "click"); },
    showModal() { e.open = true; }, close() { e.open = false; disparar(e, "close"); },
    closest(sel) { for (let x = e; x; x = x.pai) if (casa(x, sel)) return x; return null; },
    querySelector(sel) { return todos(e).find(x => casa(x, sel)) || null; },
    querySelectorAll(sel) { return todos(e).filter(x => casa(x, sel)); },
  };
  return e;
}
const casa = (x, sel) => (sel.startsWith(".") ? x.classes.has(sel.slice(1)) : sel.startsWith("[") ? sel.slice(1, -1).split("=")[0] in x.attrs : x.tagName === sel.toUpperCase());
const todos = (e, saida = []) => { for (const f of e.children) { saida.push(f); todos(f, saida); } return saida; };
function disparar(alvo, tipo, extra = {}) {
  const ev = { type: tipo, target: alvo, key: extra.key, preventDefault() { ev.evitou = true; }, stopPropagation() { ev.parou = true; } };
  for (let x = alvo; x && !ev.parou; x = x.pai) for (const f of x.ouvintes[tipo] || []) f(ev);
  return ev;
}
const espera = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const achar = (raiz, classe) => todos(raiz).filter(x => x.classes.has(classe));
const botaoTexto = (raiz, t) => todos(raiz).find(x => (x.tagName === "BUTTON" || x.tagName === "A") && x.textContent.trim() === t);

const IDS = ["nav-reunioes", "v-reunioes", "reunioes-marcar", "reunioes-geral", "reunioes-antes", "reunioes-hoje", "reunioes-depois", "reunioes-titulo",
  "reunioes-aviso", "reunioes-dias", "dlg-reuniao", "form-reuniao", "reuniao-titulo", "r-titulo", "r-sala", "r-dia", "r-hora", "r-duracao", "r-convidados",
  "r-sem-pessoas", "r-aviso", "r-salvar", "r-fechar", "dlg-reuniao-confirmar", "form-rc", "rc-titulo", "rc-texto", "rc-sala-caixa", "rc-sala", "rc-aviso",
  "rc-sim", "rc-nao", "a-reunioes", "reunioes-links", "reunioes-links-aviso", "reuniao-entrar", "reuniao-aviso", "reuniao-aviso-txt", "reuniao-aviso-entrar",
  "reuniao-aviso-fechar"];
const TAGS = { "dlg-reuniao": "dialog", "dlg-reuniao-confirmar": "dialog", "form-reuniao": "form", "form-rc": "form", "r-sala": "select", "rc-sala": "select",
  "r-duracao": "select", "reuniao-entrar": "a", "reuniao-aviso-entrar": "a" };

const ID = "a1b2c3d4", AGORA = new Date(2026, 10, 18, 10, 0).getTime();   // quarta, 18/11/2026, 10:00 local
const s = d => Math.floor(d.getTime() / 1000);
const REU = { hosts: ["meet.google.com", "*.zoom.us", "meet.jit.si", "teams.microsoft.com", "whereby.com"], pode_marcar: true, pode_link: false,
  pode_convocar: false, duracao_min: 5, duracao_max: 480, titulo_max: 80, convidados_max: 50, aviso_min: 5 };
const CONFIG = { andar: ID, papel: "membro", equipe: { pode_escrever: true, reunioes: REU } };
const R1 = { id: 12, titulo: "Planejamento", sala: "reuniao", inicio: s(new Date(2026, 10, 18, 14, 0)), duracao: 30, fim: s(new Date(2026, 10, 18, 14, 30)),
  usuario: "ana", nome: "Ana", convidados: [{ usuario: "joao", nome: "João" }], meu: false, pode_mudar: false, link: "https://meet.google.com/abc-defg-hij", agora: false };
const R2 = { ...R1, id: 13, titulo: "Daily", sala: "time:Design", inicio: s(new Date(2026, 10, 20, 9, 0)), fim: s(new Date(2026, 10, 20, 9, 15)), duracao: 15,
  usuario: "joao", nome: "João", convidados: [], meu: true, pode_mudar: true, link: null };
const SALAS = [{ chave: "recepcao", nome: "Recepção" }, { chave: "reuniao", nome: "Sala de reunião" }, { chave: "", nome: "Corredor" }, { chave: "time:Design", nome: "Design" }];
const RESP = {
  "GET api/reunioes": { status: 200, corpo: { reunioes: [R1, R2], v: 4 } },
  "GET api/reunioes/links": { status: 200, corpo: { links: { reuniao: "https://meet.google.com/abc-defg-hij" } } },
  "GET api/pessoas": { status: 200, corpo: { pessoas: [{ usuario: "ana", nome: "Ana" }, { usuario: "bia", nome: "Bia" }] } },
  "POST api/reunioes/marcar": { status: 200, corpo: { reuniao: { ...R2, id: 14 } } },
  "POST api/reunioes/cancelar": { status: 200, corpo: { ok: true } },
  "POST api/reunioes/convocar": { status: 200, corpo: { ok: true, seq: 9 } },
  "POST api/reunioes/link": { status: 200, corpo: { links: { reuniao: "https://zoom.us/j/1" } } },
};

function carregar({ config = CONFIG, respostas = RESP, agora = AGORA } = {}) {
  foco = null;
  const ids = {}, pedidos = [], timers = [];
  for (const id of IDS) { ids[id] = elemento(TAGS[id] || (id.startsWith("r-") || id.startsWith("rc-") ? "input" : "div")); ids[id].id = id; }
  for (const id of ["v-reunioes", "a-reunioes", "reuniao-entrar", "reuniao-aviso", "r-sem-pessoas", "rc-sala-caixa", "reunioes-marcar", "reunioes-geral", "nav-reunioes"]) ids[id].hidden = true;
  const corpo = elemento("body"); for (const id of IDS) corpo.append(ids[id]);
  const document = { getElementById: id => ids[id] || null, createElement: elemento, createElementNS: (ns, t) => elemento(t), body: corpo,
    querySelectorAll: sel => corpo.querySelectorAll(sel), get activeElement() { return foco; } };
  const fetch = async (url, op = {}) => {
    const [rota, q] = url.split("?");
    pedidos.push({ rota, q: new URLSearchParams(q || ""), metodo: op.method || "GET", corpo: op.body ? JSON.parse(op.body) : null });
    const r = respostas[`${op.method || "GET"} ${rota}`] || { status: 404, corpo: {} };
    return { status: r.status, ok: r.status < 300, json: async () => r.corpo };
  };
  const ouvintes = {};
  const window = { addEventListener: (t, f) => (ouvintes[t] ||= []).push(f) };
  class DataFalsa extends Date { constructor(...a) { if (a.length) super(...a); else super(agora); } static now() { return agora; } }
  const contexto = { window, document, fetch, location: { hash: `#andar=${ID}`, href: "" }, localStorage: null, config, estado: { usuario: "joao" },
    setTimeout: f => timers.push(f), clearTimeout() {}, setInterval: f => timers.push(f), clearInterval() {}, URLSearchParams, Intl, Date: DataFalsa, JSON };
  vm.runInNewContext(fs.readFileSync("static/expediente.js", "utf8"), contexto);
  contexto.Andar = contexto.window.Andar;
  vm.runInNewContext(fs.readFileSync("static/reunioes.js", "utf8"), contexto);
  const R = contexto.window.Reunioes;
  R.iniciar({ salas: () => SALAS });
  const evento = (t, detail) => (ouvintes[t] || []).forEach(f => f({ detail }));
  return { ids, pedidos, evento, timers, R, corpo, window };
}

(async () => {
  // sem reuniões (saguão, store desligado): o menu some, a rota não abre e nada é pedido
  for (const config of [{ andar: "principal", terreo: "saguao", papel: "pessoa", equipe: { reunioes: null } }, { andar: "principal", equipe: null }]) {
    const { ids, pedidos, R } = carregar({ config });
    R.configurar(config); await espera();
    assert.equal(ids["nav-reunioes"].hidden, true);
    assert.equal(R.ligado(config), false);
    assert.equal(R.entrar("reuniao", "Sala de reunião").hidden, true);
    assert.equal(pedidos.length, 0, JSON.stringify(config));
  }

  // a agenda da semana: de segunda a domingo, o GET com o "de" da segunda e dias=7, cada reunião no seu dia
  {
    const { ids, pedidos, R } = carregar();
    R.configurar(CONFIG); await espera();
    assert.equal(ids["nav-reunioes"].hidden, false);
    assert.equal(R.ligado(CONFIG), true);
    assert.ok(pedidos.some(p => p.rota === "api/reunioes/links" && p.q.get("andar") === ID), "lê os links do andar");
    await R.abrir(); await espera();
    const g = pedidos.filter(p => p.rota === "api/reunioes").pop();
    assert.equal(g.q.get("de"), String(s(new Date(2026, 10, 16))));
    assert.equal(g.q.get("dias"), "7");
    assert.equal(g.q.get("andar"), ID);
    assert.match(ids["reunioes-titulo"].textContent, /16.*22 de nov/);
    const dias = achar(ids["reunioes-dias"], "reunioes-dia");
    assert.equal(dias.length, 7);
    assert.ok(dias[2].classes.has("hoje"), "a quarta é hoje");
    assert.equal(dias[2].attrs["aria-current"], "date");
    const cartoes = achar(ids["reunioes-dias"], "reuniao");
    assert.equal(cartoes.length, 2);
    // o cartão: hora, título, sala, quem marcou e os convidados; título e nomes com data-sensivel (o modo apresentação esconde)
    const c1 = cartoes[0];
    assert.equal(achar(c1, "reuniao-hora")[0].textContent, "14:00 – 14:30");
    const titulo = achar(c1, "reuniao-nome")[0];
    assert.equal(titulo.textContent, "Planejamento");
    assert.ok("data-sensivel" in titulo.attrs);
    assert.match(achar(c1, "reuniao-sala")[0].textContent, /Sala de reunião/);
    const gente = achar(c1, "reuniao-gente")[0];
    assert.match(gente.textContent, /Ana.*João/);
    assert.ok("data-sensivel" in gente.attrs);
    // "Entrar na reunião": aba nova, sem opener nem referrer
    const entrar = botaoTexto(c1, "Entrar na reunião");
    assert.equal(entrar.href, "https://meet.google.com/abc-defg-hij");
    assert.equal(entrar.target, "_blank");
    assert.equal(entrar.rel, "noopener noreferrer");
    assert.match(entrar.attrs["aria-label"], /abre em outra aba/);
    // o .ics vem do servidor, com download, no andar
    const ics = botaoTexto(c1, "Baixar .ics");
    assert.equal(ics.href, `api/reunioes/ics?id=12&andar=${ID}`);
    assert.ok("download" in ics.attrs);
    assert.equal(botaoTexto(c1, "Editar"), undefined, "sem pode_mudar, sem editar");
    assert.equal(botaoTexto(c1, "Cancelar"), undefined);
    // a minha: sem link na sala, sem "Entrar"; com Editar e Cancelar
    assert.equal(botaoTexto(cartoes[1], "Entrar na reunião"), undefined);
    assert.ok(botaoTexto(cartoes[1], "Editar") && botaoTexto(cartoes[1], "Cancelar"));
    // os rótulos dos botões dizem hora e sala, nunca o título (o modo apresentação não esconde aria-label)
    for (const b of [ics, botaoTexto(cartoes[1], "Editar"), botaoTexto(cartoes[1], "Cancelar")]) assert.doesNotMatch(b.attrs["aria-label"], /Planejamento|Daily/);
    assert.match(ics.attrs["aria-label"], /14:00 – 14:30 na Sala de reunião/);
    assert.equal(ids["reunioes-marcar"].hidden, false, "pode_marcar");
    assert.equal(ids["reunioes-geral"].hidden, true, "membro não convoca");
    // a próxima semana
    ids["reunioes-depois"].click(); await espera();
    assert.equal(pedidos.filter(p => p.rota === "api/reunioes").pop().q.get("de"), String(s(new Date(2026, 10, 23))));
  }

  // o toque no aviso de reunião: a agenda abre com o foco no cartão da reunião
  {
    const { ids, R } = carregar();
    R.configurar(CONFIG); await espera();
    R.destacar(13); await R.abrir(); await espera();
    const c = achar(ids["reunioes-dias"], "reuniao").find(x => x.dataset.id === "13");
    assert.ok(c.classes.has("destaque"));
    assert.equal(foco, c);
    await R.abrir(); await espera();
    assert.equal(achar(ids["reunioes-dias"], "destaque").length, 0, "só uma vez");
  }
  // marcar: o diálogo com as salas do mapa (sem o corredor) e a gente do andar; o POST com as chaves do contrato
  {
    const { ids, pedidos, R } = carregar();
    R.configurar(CONFIG); await R.abrir(); await espera();
    ids["reunioes-marcar"].click(); await espera();
    assert.equal(ids["dlg-reuniao"].open, true);
    assert.equal(foco, ids["r-titulo"]);
    assert.deepEqual(ids["r-sala"].children.map(o => o.value), ["recepcao", "reuniao", "time:Design"]);
    const caixas = todos(ids["r-convidados"]).filter(x => x.tagName === "INPUT");
    assert.deepEqual(caixas.map(c => c.value), ["ana", "bia"]);
    assert.ok("data-sensivel" in ids["r-convidados"].attrs);
    ids["r-titulo"].value = "Revisão"; ids["r-sala"].value = "reuniao"; ids["r-dia"].value = "2026-11-19"; ids["r-hora"].value = "15:00"; ids["r-duracao"].value = "45";
    caixas[1].checked = true;
    disparar(ids["form-reuniao"], "submit"); await espera();
    const p = pedidos.find(x => x.rota === "api/reunioes/marcar");
    assert.deepEqual(p.corpo, { titulo: "Revisão", sala: "reuniao", inicio: s(new Date(2026, 10, 19, 15, 0)), duracao: 45, convidados: ["bia"] });
    assert.equal(p.q.get("andar"), ID);
    assert.equal(ids["dlg-reuniao"].open, false, "fecha ao marcar");
    assert.ok(pedidos.filter(x => x.rota === "api/reunioes").length >= 2, "relê a semana");
    // fechar devolve o foco a quem abriu
    ids["reunioes-marcar"].click(); await espera();
    ids["r-fechar"].click();
    assert.equal(foco, ids["reunioes-marcar"]);
    // problema na tela antes do servidor; e o erro do servidor (sala ocupada) aparece como veio
    ids["reunioes-marcar"].click(); ids["r-titulo"].value = ""; disparar(ids["form-reuniao"], "submit"); await espera();
    assert.match(ids["r-aviso"].textContent, /título/);
    assert.equal(pedidos.filter(x => x.rota === "api/reunioes/marcar").length, 1);
  }
  {
    const respostas = { ...RESP, "POST api/reunioes/marcar": { status: 409, corpo: { erro: "sala_ocupada", mensagem: "Já tem reunião nessa sala nesse horário." } } };
    const { ids, R } = carregar({ respostas });
    R.configurar(CONFIG); await R.abrir(); await espera();
    ids["reunioes-marcar"].click(); await espera();
    ids["r-titulo"].value = "X"; ids["r-sala"].value = "reuniao"; ids["r-dia"].value = "2026-11-19"; ids["r-hora"].value = "15:00"; ids["r-duracao"].value = "30";
    disparar(ids["form-reuniao"], "submit"); await espera();
    assert.equal(ids["r-aviso"].textContent, "Já tem reunião nessa sala nesse horário.");
    assert.equal(ids["dlg-reuniao"].open, true);
  }

  // editar abre o diálogo preenchido e manda o id; cancelar pede confirmação antes
  {
    const respostas = { ...RESP, "POST api/reunioes/editar": { status: 200, corpo: { reuniao: R2 } } };
    const { ids, pedidos, R } = carregar({ respostas });
    R.configurar(CONFIG); await R.abrir(); await espera();
    botaoTexto(achar(ids["reunioes-dias"], "reuniao")[1], "Editar").click(); await espera();
    assert.equal(ids["r-titulo"].value, "Daily");
    assert.equal(ids["r-sala"].value, "time:Design");
    assert.equal(ids["r-dia"].value, "2026-11-20");
    assert.equal(ids["r-hora"].value, "09:00");
    assert.equal(ids["r-duracao"].value, "15");
    disparar(ids["form-reuniao"], "submit"); await espera();
    const ed = pedidos.find(x => x.rota === "api/reunioes/editar");
    assert.equal(ed.corpo.id, 13);
    assert.deepEqual(Object.keys(ed.corpo).sort(), ["convidados", "duracao", "id", "inicio", "sala", "titulo"]);

    const cancelar = botaoTexto(achar(ids["reunioes-dias"], "reuniao")[1], "Cancelar");
    cancelar.click(); await espera();
    assert.equal(ids["dlg-reuniao-confirmar"].open, true);
    assert.match(ids["rc-texto"].textContent, /Daily/);
    assert.equal(pedidos.some(x => x.rota === "api/reunioes/cancelar"), false, "nada sem confirmar");
    ids["rc-nao"].click();
    assert.equal(ids["dlg-reuniao-confirmar"].open, false);
    assert.equal(foco, cancelar, "voltar devolve o foco ao Cancelar");
    botaoTexto(achar(ids["reunioes-dias"], "reuniao")[1], "Cancelar").click(); await espera();
    disparar(ids["form-rc"], "submit"); await espera();
    assert.deepEqual(pedidos.find(x => x.rota === "api/reunioes/cancelar").corpo, { id: 13 });
    assert.equal(foco, ids["reunioes-titulo"], "o cartão some: o foco vai ao título da semana");
  }

  // reunião geral: só o admin do andar (pode_convocar); escolhe a sala e confirma
  {
    const config = { ...CONFIG, papel: "admin", equipe: { ...CONFIG.equipe, reunioes: { ...REU, pode_convocar: true, pode_link: true } } };
    const { ids, pedidos, R } = carregar({ config });
    R.configurar(config); await R.abrir(); await espera();
    assert.equal(ids["reunioes-geral"].hidden, false);
    ids["reunioes-geral"].click(); await espera();
    assert.equal(ids["dlg-reuniao-confirmar"].open, true);
    assert.equal(ids["rc-sala-caixa"].hidden, false);
    assert.equal(ids["rc-sala"].value, "reuniao", "a sala de reunião vem escolhida");
    assert.match(ids["rc-texto"].textContent, /todo mundo do andar/);
    disparar(ids["form-rc"], "submit"); await espera();
    assert.deepEqual(pedidos.find(x => x.rota === "api/reunioes/convocar").corpo, { sala: "reuniao" });
    assert.match(ids["reunioes-aviso"].textContent, /chamou/i);
  }

  // o link de cada sala no Personalizar: só com pode_link; a lista de hosts do servidor vale antes do POST
  {
    const { ids, pedidos, R } = carregar();
    R.configurar(CONFIG); R.ajustes(CONFIG); await espera();
    assert.equal(ids["a-reunioes"].hidden, true, "membro não vê");
    const config = { ...CONFIG, papel: "admin", equipe: { ...CONFIG.equipe, reunioes: { ...REU, pode_link: true } } };
    R.configurar(config); R.ajustes(config); await espera();
    assert.equal(ids["a-reunioes"].hidden, false);
    const linhas = achar(ids["reunioes-links"], "reunioes-link");
    assert.deepEqual(linhas.map(l => l.dataset.sala), ["recepcao", "reuniao", "time:Design"]);
    const campo = todos(linhas[1]).find(x => x.tagName === "INPUT");
    assert.equal(campo.value, "https://meet.google.com/abc-defg-hij");
    assert.equal(campo.type, "url");
    campo.value = "http://evil.com/x";
    botaoTexto(linhas[1], "Salvar").click(); await espera();
    // o erro fica na linha da sala (no celular, o fim da lista sai da tela), ligado ao campo
    const erro = achar(linhas[1], "reunioes-link-erro")[0];
    assert.equal(erro.textContent, "Use um link https de Meet, Zoom, Jitsi, Teams ou Whereby, sem senha no endereço.");
    assert.equal(campo.attrs["aria-describedby"], erro.id);
    assert.equal(campo.attrs["aria-invalid"], "true");
    assert.equal(pedidos.some(x => x.rota === "api/reunioes/link"), false);
    campo.value = " https://zoom.us/j/1 ";
    botaoTexto(linhas[1], "Salvar").click(); await espera();
    assert.deepEqual(pedidos.find(x => x.rota === "api/reunioes/link").corpo, { sala: "reuniao", url: "https://zoom.us/j/1" });
    assert.match(ids["reunioes-links-aviso"].textContent, /salvo/i);
    botaoTexto(achar(ids["reunioes-links"], "reunioes-link")[1], "Tirar").click(); await espera();
    assert.deepEqual(pedidos.filter(x => x.rota === "api/reunioes/link").pop().corpo, { sala: "reuniao", url: "" });
  }

  // "Entrar na reunião" fora da agenda: o link criado pelo mapa (lista de salas, painel) e a pílula ao chegar na sala
  {
    const { ids, R, evento } = carregar();
    const lateral = R.entrar("reuniao", "Reunião"), outra = R.entrar("cozinha", "Cozinha");
    R.configurar(CONFIG); await espera();
    assert.equal(lateral.hidden, false);
    assert.equal(lateral.href, "https://meet.google.com/abc-defg-hij");
    assert.equal(lateral.target, "_blank");
    assert.equal(lateral.rel, "noopener noreferrer");
    assert.equal(lateral.attrs["aria-label"], "Entrar na reunião da Sala de reunião (abre em outra aba)");
    assert.equal(outra.hidden, true, "sala sem link, sem botão");
    outra.dataset.sala = "reuniao"; outra.dataset.nome = "Sala de reunião"; R.pintar();   // o painel trocou de sala
    assert.equal(outra.hidden, false);
    assert.equal(outra.href, "https://meet.google.com/abc-defg-hij");
    evento("minha-sala", { sala: "reuniao", nome: "Sala de reunião", andar: ID }); await espera();
    assert.equal(ids["reuniao-entrar"].hidden, false);
    assert.equal(ids["reuniao-entrar"].href, "https://meet.google.com/abc-defg-hij");
    assert.equal(ids["reuniao-entrar"].rel, "noopener noreferrer");
    evento("minha-sala", { sala: "cozinha", nome: "Cozinha", andar: ID }); await espera();
    assert.equal(ids["reuniao-entrar"].hidden, true);
  }

  // modo apresentação: todo "Entrar" visível (lateral, painel, pílula e o cartão da agenda) fica sem href, para a barra de
  // status não mostrar o link (o do Zoom pode ter ?pwd=); clique e Enter abrem pelo window.open. Fora do modo, o href volta
  {
    const { ids, R, evento, window, corpo } = carregar();
    const abertos = [];
    let liga = false;
    window.Apresentacao = { ligado: () => liga };
    window.open = (...a) => { abertos.push(a); return null; };
    const lateral = R.entrar("reuniao", "Reunião"); corpo.append(lateral);
    R.configurar(CONFIG); await R.abrir(); await espera();
    evento("minha-sala", { sala: "reuniao", nome: "Sala de reunião", andar: ID }); await espera();
    const cartao = achar(ids["reunioes-dias"], "reuniao-entrar-bt")[0];
    const todosEntrar = [lateral, ids["reuniao-entrar"], cartao];
    for (const a of todosEntrar) assert.equal(a.href, "https://meet.google.com/abc-defg-hij");
    liga = true; evento("apresentacao", { ligado: true });
    for (const a of todosEntrar) {
      assert.equal(a.hidden, false, "continua visível");
      assert.equal(a.hasAttribute("href"), false, "sem href no modo");
      assert.ok(!/meet\.google|https:/.test(JSON.stringify(a.attrs) + JSON.stringify(a.dataset) + a.textContent), "o link em nenhum atributo");
      assert.equal(a.attrs.role, "button"); assert.equal(a.attrs.tabindex, "0");
    }
    const clique = disparar(lateral, "click");
    assert.equal(clique.evitou, true);
    assert.deepEqual(abertos.pop(), ["https://meet.google.com/abc-defg-hij", "_blank", "noopener,noreferrer"]);
    disparar(cartao, "keydown", { key: "Enter" });
    assert.equal(abertos.length, 1, "o Enter também abre");
    disparar(cartao, "keydown", { key: "Tab" });
    assert.equal(abertos.length, 1, "outra tecla não abre");
    R.pintar();   // repintar no modo (links novos, troca de sala) não devolve o href
    assert.equal(lateral.hasAttribute("href"), false);
    liga = false; evento("apresentacao", { ligado: false });
    for (const a of todosEntrar) {
      assert.equal(a.href, "https://meet.google.com/abc-defg-hij", "fora do modo, o href volta");
      assert.equal(a.hasAttribute("role") || a.hasAttribute("tabindex"), false);
    }
    assert.equal(disparar(lateral, "click").evitou, undefined, "fora do modo, o clique é o do link");
    assert.equal(abertos.length, 1);
  }

  // aviso de 5 min na tela: a minha ou a que me convidou; uma vez só; com o link da sala
  {
    const agora = R1.inicio * 1000 - 4 * 60000;
    const { ids, pedidos, R, evento, timers } = carregar({ agora });
    R.configurar(CONFIG); await espera();
    evento("aovivo", { reunioes_v: 4 }); await espera();
    assert.ok(pedidos.some(p => p.rota === "api/reunioes" && p.q.get("dias") === "1"), "as próximas");
    timers.forEach(f => f()); await espera();
    assert.equal(ids["reuniao-aviso"].hidden, false);
    assert.equal(ids["reuniao-aviso-txt"].textContent, "Planejamento começa em 4 min, na Sala de reunião.");
    assert.ok("data-sensivel" in ids["reuniao-aviso-txt"].attrs);
    // no modo apresentação, só o texto genérico (sem data-sensivel) e o X: a ordem do aviso é texto, genérico, Entrar, X
    const generico = ids["reuniao-aviso"].children[1];
    assert.equal(generico.textContent, "Uma reunião começa em breve");
    assert.ok(generico.classes.has("reuniao-aviso-generico") && !("data-sensivel" in generico.attrs));
    assert.deepEqual(ids["reuniao-aviso"].children.map(c => c.id || c.className), ["reuniao-aviso-txt", "reuniao-aviso-generico", "reuniao-aviso-entrar", "reuniao-aviso-fechar"]);
    assert.equal(ids["reuniao-aviso-entrar"].href, "https://meet.google.com/abc-defg-hij");
    assert.equal(ids["reuniao-aviso-entrar"].rel, "noopener noreferrer");
    ids["reuniao-aviso-fechar"].click();
    assert.equal(ids["reuniao-aviso"].hidden, true);
    timers.forEach(f => f()); await espera();
    assert.equal(ids["reuniao-aviso"].hidden, true, "uma vez só");
    // mesma versão: não relê
    const n = pedidos.filter(p => p.rota === "api/reunioes").length;
    evento("aovivo", { reunioes_v: 4 }); await espera();
    assert.equal(pedidos.filter(p => p.rota === "api/reunioes").length, n);
  }
  {
    const agora = R1.inicio * 1000 - 4 * 60000;   // a reunião é de outras pessoas: sem aviso
    const respostas = { ...RESP, "GET api/reunioes": { status: 200, corpo: { reunioes: [{ ...R1, convidados: [{ usuario: "bia", nome: "Bia" }] }], v: 4 } } };
    const { ids, R, evento, timers } = carregar({ agora, respostas });
    R.configurar(CONFIG); await espera();
    evento("aovivo", { reunioes_v: 4 }); await espera();
    timers.forEach(f => f()); await espera();
    assert.equal(ids["reuniao-aviso"].hidden, true);
  }
  // sem nenhum reunioes_v (o /api/ao-vivo parado): as próximas são lidas ao configurar o andar, e o aviso sai igual
  {
    const agora = R1.inicio * 1000 - 3 * 60000;
    const { ids, pedidos, R, timers } = carregar({ agora });
    R.configurar(CONFIG); await espera();
    assert.ok(pedidos.some(p => p.rota === "api/reunioes" && p.q.get("dias") === "1"));
    timers.forEach(f => f()); await espera();
    assert.equal(ids["reuniao-aviso"].hidden, false);
  }
  console.log("test_reunioes_tela.js ok");
})().catch(e => { console.error(e); process.exit(1); });
