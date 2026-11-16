"use strict";
// Painel de conversa da equipe (static/chat_sala.js, 1.6 Onda 2) num DOM falso: pílula, abas por perfil, o saguão só com o
// Geral, a DM com o "Entendi" (E.3) e o aviso fixo, a auditoria com o lembrete e a menção escolhida pelo teclado.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let foco = null;
function elemento(tag) {
  const e = {
    tagName: tag.toUpperCase(), filhos: [], pai: null, attrs: {}, dataset: {}, style: {}, hidden: false, disabled: false, ouvintes: {},
    _texto: "", classes: new Set(), value: "", id: "", selectionStart: null,
    get className() { return [...e.classes].join(" "); }, set className(v) { e.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get classList() { return { add: (...c) => c.forEach(x => e.classes.add(x)), remove: (...c) => c.forEach(x => e.classes.delete(x)),
      toggle: (c, f) => ((f ?? !e.classes.has(c)) ? e.classes.add(c) : e.classes.delete(c)), contains: c => e.classes.has(c) }; },
    get textContent() { return e._texto + e.filhos.map(f => (typeof f === "string" ? f : f.textContent)).join(""); },
    set textContent(v) { e._texto = String(v); e.filhos = []; },
    get children() { return e.filhos.filter(f => typeof f !== "string"); },
    get firstElementChild() { return e.children[0] || null; },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: k => e.attrs[k] ?? null, removeAttribute(k) { delete e.attrs[k]; },
    append(...f) { for (const x of f) { if (typeof x !== "string") x.pai = e; e.filhos.push(x); } },
    prepend(...f) { for (const x of f) if (typeof x !== "string") x.pai = e; e.filhos.unshift(...f); },
    replaceChildren(...f) { e.filhos = []; e._texto = ""; e.append(...f); },
    remove() { if (e.pai) e.pai.filhos = e.pai.filhos.filter(x => x !== e); },
    addEventListener(t, f) { (e.ouvintes[t] ||= []).push(f); },
    focus() { foco = e; }, click() { disparar(e, "click"); }, setSelectionRange(a) { e.selectionStart = a; },
    closest(sel) { for (let x = e; x; x = x.pai) if (casa(x, sel)) return x; return null; },
    querySelector(sel) { return todos(e).find(x => casa(x, sel)) || null; },
    querySelectorAll(sel) { return todos(e).filter(x => sel.split(",").some(s => casa(x, s.trim()))); },
  };
  return e;
}
const casa = (x, sel) => (sel.startsWith(".") ? x.classes.has(sel.slice(1)) : x.tagName === sel.toUpperCase());
const todos = (e, saida = []) => { for (const f of e.children) { saida.push(f); todos(f, saida); } return saida; };
const visivel = e => { for (let x = e; x; x = x.pai) if (x.hidden) return false; return true; };
// o evento sobe pela árvore, como no navegador
function disparar(alvo, tipo, extra = {}) {
  const ev = { target: alvo, key: extra.key, shiftKey: !!extra.shiftKey, preventDefault() { ev.evitou = true; }, stopPropagation() { ev.parou = true; } };
  for (let x = alvo; x && !ev.parou; x = x.pai) for (const f of x.ouvintes[tipo] || []) f(ev);
  return ev;
}
const espera = () => new Promise(r => setImmediate(r));
const achar = (raiz, classe) => todos(raiz).filter(x => x.classes.has(classe));
const porTexto = (raiz, texto) => todos(raiz).find(x => x.tagName === "BUTTON" && x.textContent.startsWith(texto));

function carregar({ config, respostas = {}, sala = null, reunioes = null }) {
  foco = null;
  const ids = {}, pedidos = [], timers = [];
  for (const id of ["chat-sala", "chat-sala-abrir", "chat-sala-painel", "chat-sala-n"]) ids[id] = elemento(id === "chat-sala-painel" ? "section" : "div");
  // o painel do chat da sala de sempre, como está no index.html
  for (const [id, tag] of [["chat-sala-titulo", "h2"], ["chat-sala-lista", "ol"], ["chat-sala-vazio", "p"], ["chat-sala-aviso", "p"],
    ["chat-sala-form", "form"], ["chat-sala-campo", "input"], ["chat-sala-enviar", "button"], ["chat-sala-fechar", "button"]]) {
    ids[id] = elemento(tag); ids[id].id = id; ids["chat-sala-painel"].append(ids[id]);
  }
  const rot = elemento("span"); rot.className = "chat-sala-rot"; rot.textContent = "Chat da sala";
  ids["chat-sala-abrir"].append(rot);
  ids["chat-sala"].append(ids["chat-sala-abrir"], ids["chat-sala-painel"]);
  ids["chat-sala"].hidden = true; ids["chat-sala-painel"].hidden = true;
  const document = { getElementById: id => ids[id] || null, createElement: elemento, createElementNS: (ns, t) => elemento(t),
    body: elemento("body"), get activeElement() { return foco; } };
  const fetch = async (url, op = {}) => {
    const [rota, q] = url.split("?");
    pedidos.push({ rota, q: new URLSearchParams(q || ""), metodo: op.method || "GET", corpo: op.body ? JSON.parse(op.body) : null,
      cabecalhos: op.headers || {} });
    const r = respostas[`${op.method || "GET"} ${rota}`] || { status: 404, corpo: {} };
    const corpo = typeof r.corpo === "function" ? r.corpo(new URLSearchParams(q || "")) : r.corpo;
    return { status: r.status, ok: r.status < 300, json: async () => corpo };
  };
  const ouvintes = {};
  const window = { addEventListener: (t, f) => (ouvintes[t] ||= []).push(f), Reunioes: reunioes || undefined };
  const contexto = { window, document, fetch, location: { hash: config.andar && config.andar !== "principal" ? `#andar=${config.andar}` : "", href: "" },
    localStorage: null, config, estado: { usuario: "joao" }, MutationObserver: class { observe() {} }, setTimeout: f => timers.push(f), clearTimeout() {},
    URLSearchParams, Intl, Date, JSON };
  vm.runInNewContext(fs.readFileSync("static/expediente.js", "utf8"), contexto);
  contexto.Andar = contexto.window.Andar;
  vm.runInNewContext(fs.readFileSync("static/chat_sala.js", "utf8"), contexto);
  const evento = (t, detail) => (ouvintes[t] || []).forEach(f => f({ detail }));
  evento("minha-sala", { sala, nome: sala ? "Cozinha" : null, andar: config.andar || "principal", seq: 1 });
  return { ids, painel: ids["chat-sala-painel"], pedidos, evento, timers, ChatSala: contexto.window.ChatSala };
}

const ID = "a1b2c3d4";
const EQUIPE = { retencao: 365, pode_moderar: false, dm: true, anexo: true, mencao: true, anexo_max: 26214400, auditoria: false, mural: true,
  aviso_dm: "As mensagens diretas da Acme podem ser lidas pela administração da empresa.", aviso_dm_entendido: false };
const ANDAR = { andar: ID, papel: "membro", admin_predio: false, terreo: "saguao", empresa: "Acme", equipe: EQUIPE };
const SAGUAO = { andar: "principal", papel: "pessoa", terreo: "saguao", equipe: { ...EQUIPE, dm: false, anexo: false, mencao: false, aviso_dm: "" } };
const MSG = (id, extra = {}) => ({ id, canal: "geral", usuario: "ana.lima", nome: "Ana", texto: `m${id}`, apagada: false, em: "2026-11-16T13:00:00Z", reacoes: [], anexo: null, ...extra });
const RESP = {
  "GET api/canal/historico": { status: 200, corpo: q => ({ mensagens: [MSG(1, { canal: q.get("canal") })], mais: false, v: 5,
    ...(q.get("canal").startsWith("dm:") ? { aviso: EQUIPE.aviso_dm, acessos: ["2026-11-12T10:00:00Z"] } : {}) }) },
  "GET api/pessoas": { status: 200, corpo: { pessoas: [{ usuario: "ana.lima", nome: "Ana Lima" }] } },
  "GET api/dm": { status: 200, corpo: { dms: [] } },
  "POST api/dm/entendi": { status: 200, corpo: { ok: true } },
  "POST api/dm/abrir": { status: 200, corpo: { canal: "dm:3" } },
  "POST api/canal/lida": { status: 200, corpo: { ok: true } },
  "GET api/dm/auditoria/pares": { status: 200, corpo: { pares: [{ canal: "dm:3", u1: "ana.lima", u2: "joao", mensagens: 4, ultima: "2026-11-15T10:00:00Z" }],
    lembrete: "O acesso a esta conversa fica registrado e as duas pessoas veem a data." } },
  "GET api/dm/auditoria/registro": { status: 200, corpo: { registro: [
    { canal: "dm:3", admin: "joao", u1: "ana.lima", u2: "bruno", quando: "2026-11-15T10:00:00Z", quantas: 4 },
    { canal: "dm:5", admin: "carla", u1: null, u2: "ana.lima", quando: "2026-11-14T10:00:00Z", quantas: 1 }] } },
  "GET api/dm/auditoria": { status: 200, corpo: { mensagens: [MSG(7, { canal: "dm:3" }),
    MSG(8, { canal: "dm:3", texto: "", anexo: { id: 31, nome: "foto.png", tipo: "image/png", tamanho: 2048 } }),
    MSG(9, { canal: "dm:3", texto: "", anexo: { id: 32, nome: "contrato.pdf", tipo: "application/pdf", tamanho: 4096 } })], mais: false,
    lembrete: "O acesso a esta conversa fica registrado e as duas pessoas veem a data." } },
};
const abas = p => achar(p, "chat-sala-aba").map(b => b.dataset.id);

(async () => {
  // membro de um andar, numa sala: a pílula diz "Conversas"; abrir vai para a sala, com o histórico e a retenção
  {
    const { ids, painel, pedidos } = carregar({ config: ANDAR, respostas: RESP, sala: "cozinha" });
    assert.equal(ids["chat-sala"].hidden, false);
    assert.equal(ids["chat-sala-abrir"].textContent, "Conversas");
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    assert.equal(painel.hidden, false);
    assert.deepEqual(abas(painel), ["geral", "sala:cozinha", "diretas"]);
    assert.equal(achar(painel, "chat-sala-aba").find(b => b.attrs["aria-current"] === "true").dataset.id, "sala:cozinha");
    const h = pedidos.find(p => p.rota === "api/canal/historico");
    assert.equal(h.q.get("canal"), "sala:cozinha");
    assert.equal(h.q.get("andar"), ID);
    assert.equal(achar(painel, "chat-sala-msg").length, 1);
    // a sala fica guardada e o andar todo lê, inclusive quem chega depois: o aviso fixo no lugar da linha da retenção
    assert.equal(achar(painel, "chat-sala-fixo")[0].textContent, "Esta conversa fica guardada por 1 ano e todo o andar pode ler.");
    assert.ok(visivel(achar(painel, "chat-sala-fixo")[0]));
    assert.equal(achar(painel, "chat-sala-retencao")[0].hidden, true);
    assert.ok(visivel(achar(painel, "chat-sala-anexar")[0]));
    // o Geral do andar: só a linha da retenção
    porTexto(achar(painel, "chat-sala-abas")[0], "Geral").click(); await espera();
    assert.equal(achar(painel, "chat-sala-fixo")[0].hidden, true);
    assert.equal(achar(painel, "chat-sala-retencao")[0].textContent, "As mensagens ficam guardadas por 1 ano.");
    assert.equal(achar(painel, "chat-sala-retencao")[0].hidden, false);
    porTexto(achar(painel, "chat-sala-abas")[0], "Cozinha").click(); await espera();
    // Escape fecha e devolve o foco à pílula
    disparar(achar(painel, "chat-sala-lista")[0], "keydown", { key: "Escape" });
    assert.equal(painel.hidden, true);
    assert.equal(foco, ids["chat-sala-abrir"]);
  }
  // saguão: só o Geral do prédio, sem anexo e sem pedir a lista de pessoas
  {
    const { ids, painel, pedidos } = carregar({ config: SAGUAO, respostas: RESP, sala: "recepcao" });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    assert.deepEqual(abas(painel), ["geral"]);
    assert.equal(achar(painel, "chat-sala-abas")[0].hidden, true, "uma aba só: a barra some");
    assert.equal(achar(painel, "chat-sala-anexar")[0].hidden, true);
    assert.equal(pedidos.some(p => p.rota === "api/pessoas"), false);
    assert.equal(achar(painel, "chat-sala-titulo").length + todos(painel).filter(x => x.id === "chat-sala-titulo").length > 0, true);
    assert.equal(todos(painel).find(x => x.id === "chat-sala-titulo").textContent, "Geral do prédio");
    assert.equal(pedidos.find(p => p.rota === "api/canal/historico").q.has("andar"), false, "o saguão é o principal");
    assert.equal(achar(painel, "chat-sala-fixo")[0].textContent, "Esta conversa fica guardada por 1 ano e todo o prédio pode ler.");
    assert.equal(achar(painel, "chat-sala-fixo")[0].hidden, false);
  }
  // DM: o "Entendi" antes da primeira; depois, o aviso fixo da empresa e a linha do registro de acesso (D10)
  {
    const { ids, painel, pedidos } = carregar({ config: ANDAR, respostas: RESP });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    porTexto(achar(painel, "chat-sala-abas")[0], "Diretas").click(); await espera(); await espera();
    porTexto(achar(painel, "chat-sala-itens")[0], "Ana Lima").click(); await espera();
    const dialogo = achar(painel, "chat-sala-entendi")[0];
    assert.equal(dialogo.hidden, false);
    assert.equal(dialogo.attrs.role, "alertdialog");
    assert.match(dialogo.textContent, /As mensagens diretas da Acme podem ser lidas pela administração da empresa\./);
    assert.equal(pedidos.some(p => p.rota === "api/dm/abrir"), false, "nada abre antes do Entendi");
    porTexto(dialogo, "Entendi").click(); await espera(); await espera(); await espera(); await espera();
    assert.equal(dialogo.hidden, true);
    assert.ok(pedidos.some(p => p.rota === "api/dm/entendi" && p.metodo === "POST"));
    assert.deepEqual(pedidos.find(p => p.rota === "api/dm/abrir").corpo, { com: "ana.lima" });
    assert.equal(achar(painel, "chat-sala-fixo")[0].textContent, "As mensagens diretas da Acme podem ser lidas pela administração da empresa.");
    assert.equal(achar(painel, "chat-sala-fixo")[0].hidden, false);
    assert.equal(achar(painel, "chat-sala-registro")[0].textContent, "A administração da empresa abriu esta conversa em 12/11/2026.");
    assert.equal(achar(painel, "chat-sala-anexar")[0].hidden, false);
    assert.equal(achar(painel, "chat-sala-auditar")[0].hidden, true, "membro não audita");
  }
  // admin da empresa: a auditoria (lista de pares, o lembrete do registro, a leitura sem caixa de escrever nem ações)
  {
    const { ids, painel, pedidos } = carregar({ config: { ...ANDAR, papel: "admin", equipe: { ...EQUIPE, auditoria: true } }, respostas: RESP });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    porTexto(achar(painel, "chat-sala-abas")[0], "Diretas").click(); await espera(); await espera();
    const auditar = achar(painel, "chat-sala-auditar")[0];
    assert.equal(auditar.hidden, false);
    auditar.click(); await espera(); await espera();
    assert.match(achar(painel, "chat-sala-fixo")[0].textContent, /fica registrado/);
    assert.equal(achar(painel, "chat-sala-fixo")[0].hidden, false);
    // o registro de acessos (quem abriu qual conversa, quando e quantas mensagens), sem texto e sem botão
    assert.ok(pedidos.some(p => p.rota === "api/dm/auditoria/registro"));
    assert.equal(achar(painel, "chat-sala-secao")[0].textContent, "Registro de acessos");
    const linhas = achar(painel, "chat-sala-registro-item");
    assert.equal(linhas.length, 2);
    assert.match(linhas[0].textContent, /^Você abriu a conversa de Ana Lima e bruno/);
    assert.match(linhas[0].textContent, /15\/11\/2026.*4 mensagens/);
    assert.match(linhas[1].textContent, /^carla abriu a conversa de ex-membro e Ana Lima.*1 mensagem$/);
    assert.equal(todos(linhas[0]).some(x => x.tagName === "BUTTON"), false);
    porTexto(achar(painel, "chat-sala-itens")[0], "Ana Lima e Você").click(); await espera(); await espera();
    assert.equal(pedidos.find(p => p.rota === "api/dm/auditoria").q.get("canal"), "dm:3");
    assert.equal(achar(painel, "chat-sala-form")[0].hidden, true);
    assert.equal(achar(painel, "chat-sala-msg").length, 3);
    assert.equal(achar(painel, "chat-sala-acoes").length + achar(painel, "chat-sala-reagir").length, 0, "na auditoria só se lê");
    // o anexo da DM pela auditoria: só o "Baixar", com auditoria=1 (o admin não é ponta); nenhum <img> automático, que
    // gravaria uma linha no registro a cada carga
    assert.equal(achar(painel, "chat-sala-previa").length, 0);
    assert.deepEqual(achar(painel, "chat-sala-baixar").map(a => a.href),
      [`api/anexo?id=31&baixar=1&auditoria=1&andar=${ID}`, `api/anexo?id=32&baixar=1&auditoria=1&andar=${ID}`]);
    assert.match(achar(painel, "chat-sala-fixo")[0].textContent, /fica registrado/);
    // o cabeçalho próprio só nas rotas da auditoria
    const aud = pedidos.filter(p => p.rota.startsWith("api/dm/auditoria"));
    assert.deepEqual([...new Set(aud.map(p => p.rota))].sort(), ["api/dm/auditoria", "api/dm/auditoria/pares", "api/dm/auditoria/registro"]);
    for (const p of aud) assert.equal(p.cabecalhos["X-Escritorio"], "1", p.rota);
    for (const p of pedidos.filter(p => !p.rota.startsWith("api/dm/auditoria"))) assert.equal(p.cabecalhos["X-Escritorio"], undefined, p.rota);
  }
  // a prévia da imagem no canal: <img> sem auditoria; no erro (o 429 do teto, a rede) tenta de novo uma vez só
  {
    const resp = { ...RESP, "GET api/canal/historico": { status: 200, corpo: { mensagens: [MSG(4, { anexo: { id: 40, nome: "a.png", tipo: "image/png", tamanho: 10 } })], mais: false, v: 1 } } };
    const { ids, painel, timers } = carregar({ config: ANDAR, respostas: resp });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    const img = achar(painel, "chat-sala-previa")[0];
    assert.equal(img.src, `api/anexo?id=40&andar=${ID}`);
    img.src = "quebrada"; const n = timers.length;
    disparar(img, "error");
    assert.equal(timers.length, n + 1, "agenda uma nova tentativa");
    timers.at(-1)();
    assert.equal(img.src, `api/anexo?id=40&andar=${ID}`);
    disparar(img, "error");
    assert.equal(timers.length, n + 1, "só uma vez");
  }
  // corrida entre o histórico e o /api/ao-vivo: a versão vem do histórico; enquanto ele não chega, o poll não leva o canal
  // e uma resposta com o "aberto" fica de fora (ela traria as mais antigas, coladas nas mais novas)
  {
    let solta;
    const pendente = new Promise(r => (solta = r));
    const resp = { ...RESP, "GET api/canal/historico": { status: 200, corpo: () => pendente } };
    const { ids, painel, pedidos, evento, ChatSala } = carregar({ config: ANDAR, respostas: resp, sala: "cozinha" });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    assert.equal(ChatSala.paraAoVivo(), "", "histórico pendente: o poll não leva o canal");
    evento("aovivo", { eu: "joao", nao_lidas: {}, aberto: { canal: "sala:cozinha", novas: [MSG(1), MSG(2)], v: 7 } });
    assert.equal(achar(painel, "chat-sala-msg").length, 0);
    solta({ mensagens: [MSG(60), MSG(61)], mais: true, v: 7 }); await espera(); await espera(); await espera();
    assert.deepEqual(achar(painel, "chat-sala-msg").map(li => li.dataset.id), ["60", "61"]);
    assert.equal(ChatSala.paraAoVivo(), "&canal=sala%3Acozinha&depois=61");
    // a reação entre o histórico e o 1º poll: a versão do poll difere da do histórico e o painel relê
    const antes = pedidos.filter(p => p.rota === "api/canal/historico").length;
    evento("aovivo", { eu: "joao", nao_lidas: {}, aberto: { canal: "sala:cozinha", novas: [], v: 8 } }); await espera();
    assert.equal(pedidos.filter(p => p.rota === "api/canal/historico").length, antes + 1);
  }
  // o admin do prédio no andar de uma empresa só lê: sem caixa de escrever, sem reagir nem apagar, sem Diretas
  {
    const config = { ...ANDAR, papel: "admin", admin_predio: true, equipe: { ...EQUIPE, pode_escrever: false } };
    const { ids, painel } = carregar({ config, respostas: RESP, sala: "cozinha" });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    assert.deepEqual(abas(painel), ["geral", "sala:cozinha"]);
    assert.equal(achar(painel, "chat-sala-form")[0].hidden, true);
    assert.equal(achar(painel, "chat-sala-msg").length, 1);
    assert.equal(achar(painel, "chat-sala-reagir").length + achar(painel, "chat-sala-apagar").length, 0);
    porTexto(achar(painel, "chat-sala-abas")[0], "Geral").click(); await espera();
    assert.equal(achar(painel, "chat-sala-form")[0].hidden, true);
  }
  // menção: "@an" sugere só gente do andar; seta e Enter completam
  {
    const { ids, painel } = carregar({ config: ANDAR, respostas: RESP });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    const campo = todos(painel).find(x => x.id === "chat-sala-campo");
    assert.equal(campo.attrs.role, "combobox");
    campo.value = "oi @an"; campo.selectionStart = 6; disparar(campo, "input");
    const lista = achar(painel, "chat-sala-sugestoes")[0];
    assert.equal(lista.hidden, false);
    assert.equal(campo.attrs["aria-expanded"], "true");
    assert.deepEqual(lista.children.map(li => li.dataset.usuario), ["ana.lima"]);
    assert.equal(campo.attrs["aria-activedescendant"], lista.children[0].id);
    disparar(campo, "keydown", { key: "Enter" });
    assert.equal(campo.value, "oi @ana.lima ");
    assert.equal(lista.hidden, true);
  }
  // aviso_dm_entendido: a DM abre direto, sem o diálogo
  {
    const { ids, painel, pedidos } = carregar({ config: { ...ANDAR, equipe: { ...EQUIPE, aviso_dm_entendido: true } }, respostas: RESP });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    porTexto(achar(painel, "chat-sala-abas")[0], "Diretas").click(); await espera(); await espera();
    porTexto(achar(painel, "chat-sala-itens")[0], "Ana Lima").click(); await espera(); await espera(); await espera();
    assert.equal(achar(painel, "chat-sala-entendi")[0].hidden, true);
    assert.equal(pedidos.some(p => p.rota === "api/dm/entendi"), false);
    assert.ok(pedidos.some(p => p.rota === "api/dm/abrir"));
  }
  // /api/ao-vivo: as não lidas e as menções na pílula; com o painel aberto, as novas do canal entram e o pedido leva canal e depois
  {
    const { ids, painel, evento, ChatSala } = carregar({ config: ANDAR, respostas: RESP });
    assert.equal(ChatSala.paraAoVivo(), "", "painel fechado: o pedido não muda");
    evento("aovivo", { eu: "joao", nao_lidas: { geral: 2, "dm:4": 1 }, mencoes: { geral: 1 } });
    assert.equal(ids["chat-sala-n"].textContent, "3");
    assert.equal(ids["chat-sala-n"].hidden, false);
    assert.match(ids["chat-sala-abrir"].attrs["aria-label"], /3 mensagens novas, 1 menção a você/);
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    assert.equal(ChatSala.paraAoVivo(), "&canal=geral&depois=1");
    evento("aovivo", { eu: "joao", nao_lidas: { geral: 1 }, aberto: { canal: "geral", novas: [MSG(1), MSG(2, { texto: "chegou" })], v: 5 } });
    await espera();
    assert.deepEqual(achar(painel, "chat-sala-msg").map(li => li.dataset.id), ["1", "2"]);
    assert.match(achar(painel, "oculto").find(x => x.attrs.role === "status").textContent, /Ana: chegou/);
    assert.equal(ChatSala.paraAoVivo(), "&canal=geral&depois=2");
  }
  // ChatSala.abrirCanal e abrirDM (o mapa e o toque no aviso chamam): abrem o painel no lugar pedido
  {
    const ENT = { ...ANDAR, equipe: { ...EQUIPE, aviso_dm_entendido: true } };
    const resp = { ...RESP, "GET api/dm": { status: 200, corpo: { dms: [{ canal: "dm:4", outro: { usuario: "ana.lima", nome: "Ana Lima" }, ultima: null, nao_lidas: 0 }] } } };
    {
      const { painel, pedidos, ChatSala } = carregar({ config: ENT, respostas: resp, sala: "cozinha" });
      assert.equal(await ChatSala.abrirCanal("sala:reuniao"), true); await espera();
      assert.equal(painel.hidden, false);
      assert.equal(pedidos.filter(p => p.rota === "api/canal/historico").at(-1).q.get("canal"), "sala:reuniao");
      assert.equal(achar(painel, "chat-sala-fixo")[0].textContent, "Esta conversa fica guardada por 1 ano e todo o andar pode ler.", "vindo do mapa também");
      assert.equal(await ChatSala.abrirCanal("dm:4"), true); await espera(); await espera();
      assert.equal(todos(painel).find(x => x.id === "chat-sala-titulo").textContent, "Ana Lima", "o nome sai do GET /api/dm");
      assert.equal(achar(painel, "chat-sala-fixo")[0].hidden, false);
      for (const ruim of ["x", "dm:0", "sala:", 3, null]) assert.equal(await ChatSala.abrirCanal(ruim), false, String(ruim));
    }
    {
      const { painel, pedidos, ChatSala } = carregar({ config: ENT, respostas: resp });
      assert.equal(await ChatSala.abrirDM("ana.lima"), true); await espera(); await espera();
      assert.deepEqual(pedidos.find(p => p.rota === "api/dm/abrir").corpo, { com: "ana.lima" });
      assert.equal(todos(painel).find(x => x.id === "chat-sala-titulo").textContent, "Ana Lima");
    }
    // a varredura apagou a DM vazia: o envio dá 404 nao_existe, o painel reabre com a mesma pessoa e reenvia uma vez
    for (const segunda of [200, 404]) {
      let abriu = 0, envio = 0;   // o mock lê o corpo antes do status: o 2º envio responde com "segunda"
      const NAO = { erro: "nao_existe", mensagem: "Isso não existe mais." };
      const r2 = { ...resp,
        "POST api/dm/abrir": { status: 200, corpo: () => ({ canal: abriu++ ? "dm:9" : "dm:3" }) },
        "POST api/canal/enviar": { get status() { return envio === 2 ? segunda : 404; },
          corpo: () => (++envio === 2 && segunda === 200 ? { mensagem: MSG(20, { canal: "dm:9", usuario: "joao", texto: "ainda está aí?" }) } : NAO) } };
      const { painel, pedidos, ChatSala } = carregar({ config: ENT, respostas: r2 });
      await ChatSala.abrirDM("ana.lima"); await espera(); await espera();
      const campo = todos(painel).find(x => x.attrs.role === "combobox");
      campo.value = "ainda está aí?";
      disparar(achar(painel, "chat-sala-form")[0], "submit"); for (let i = 0; i < 8; i++) await espera();
      const envios = pedidos.filter(p => p.rota === "api/canal/enviar");
      assert.deepEqual(envios.map(p => p.corpo), [{ canal: "dm:3", texto: "ainda está aí?" }, { canal: "dm:9", texto: "ainda está aí?" }],
        "reenvia uma vez só, na DM nova");
      assert.deepEqual(pedidos.filter(p => p.rota === "api/dm/abrir").at(-1).corpo, { com: "ana.lima" });
      assert.equal(todos(painel).find(x => x.id === "chat-sala-titulo").textContent, "Ana Lima");
      assert.equal(campo.value, segunda === 200 ? "" : "ainda está aí?", "o texto só sai do campo quando foi");
    }
    // o toque no aviso de DM com o "Entendi" pendente: o painel abre com o diálogo à vista; o Tab fica dentro dele
    {
      const { painel, ChatSala } = carregar({ config: { ...ANDAR, equipe: { ...EQUIPE, aviso_dm_entendido: false } }, respostas: resp });
      const abriu = ChatSala.abrirCanal("dm:4"); for (let i = 0; i < 5; i++) await espera();
      const dialogo = achar(painel, "chat-sala-entendi")[0], ok = porTexto(dialogo, "Entendi"), nao = porTexto(dialogo, "Agora não");
      assert.ok(visivel(dialogo), "o diálogo aparece");
      assert.equal(foco, ok);
      assert.ok(disparar(ok, "keydown", { key: "Tab" }).evitou); assert.equal(foco, nao);
      assert.ok(disparar(nao, "keydown", { key: "Tab", shiftKey: true }).evitou); assert.equal(foco, ok);
      disparar(ok, "keydown", { key: "Tab", shiftKey: true }); assert.equal(foco, nao);
      ok.click();
      assert.equal(await abriu, true);
      await espera(); await espera();
      assert.equal(todos(painel).find(x => x.id === "chat-sala-titulo").textContent, "Ana Lima");
    }
    // sem o "Entendi" ainda: o aviso aparece antes de abrir
    {
      const { painel, pedidos, ChatSala } = carregar({ config: { ...ANDAR, equipe: { ...EQUIPE, aviso_dm_entendido: false } }, respostas: resp });
      ChatSala.abrirDM("ana.lima"); for (let i = 0; i < 5; i++) await espera();
      assert.equal(achar(painel, "chat-sala-entendi")[0].hidden, false);
      assert.equal(pedidos.some(p => p.rota === "api/dm/abrir"), false);
    }
    // saguão (sem DM), store desligado e quem só lê (o admin do prédio no andar de uma empresa): abrirDM não faz nada
    for (const config of [SAGUAO, { andar: "principal", equipe: null }, { ...ANDAR, papel: "admin", admin_predio: true, equipe: { ...EQUIPE, pode_escrever: false } }]) {
      const { pedidos, ChatSala } = carregar({ config, respostas: resp, sala: "cozinha" });
      assert.equal(await ChatSala.abrirDM("ana.lima"), false);
      assert.equal(pedidos.length, 0);
    }
  }
  // store desligado (config.equipe null): o chat da sala de sempre, com o painel do index.html e sem rota nova
  {
    const { ids, painel, pedidos } = carregar({ config: { andar: "principal", equipe: null }, respostas: RESP, sala: "cozinha" });
    assert.equal(ids["chat-sala-abrir"].textContent, "Chat da sala");
    assert.equal(ids["chat-sala-titulo"].textContent, "Cozinha");
    assert.equal(achar(painel, "chat-sala-abas").length, 0);
    ids["chat-sala-abrir"].click(); await espera();
    assert.equal(painel.hidden, false);
    assert.equal(pedidos.length, 0);
  }
  // reuniões (Onda 3): na sala, o "Entrar na reunião" no topo do painel (quem decide se aparece é o reunioes.js, pelo link
  // da sala); fora da sala, sem sala. E o modo apresentação: o título, a lista, os itens e o campo com data-sensivel
  {
    let pintou = 0;
    const reunioes = { entrar: (chave, nome) => { const a = elemento("a"); a.className = "sala-entrar"; a.dataset.sala = chave; a.dataset.nome = nome; return a; },
      pintar: () => { pintou++; } };
    const { ids, painel } = carregar({ config: ANDAR, respostas: RESP, sala: "cozinha", reunioes });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    const a = achar(painel, "sala-entrar");
    assert.equal(a.length, 1, "um link só, no topo");
    assert.equal(a[0].pai.tagName, "HEADER");
    assert.equal(a[0].dataset.sala, "cozinha");
    assert.equal(a[0].dataset.nome, "Cozinha");
    const antes = pintou;
    porTexto(achar(painel, "chat-sala-abas")[0], "Geral").click(); await espera();
    assert.equal(a[0].dataset.sala, "", "no Geral, sem sala");
    assert.ok(pintou > antes, "pede para repintar");
    for (const classe of ["chat-sala-lista", "chat-sala-itens", "chat-sala-sugestoes"]) assert.ok("data-sensivel" in achar(painel, classe)[0].attrs, classe);
    assert.ok("data-sensivel" in ids["chat-sala-titulo"].attrs || "data-sensivel" in todos(painel).find(x => x.id === "chat-sala-titulo").attrs);
    assert.ok("data-sensivel" in todos(painel).find(x => x.id === "chat-sala-campo").attrs);
  }
  // sem o reunioes.js (a página da construção, servidor antigo): o painel segue sem o link
  {
    const { ids, painel } = carregar({ config: ANDAR, respostas: RESP, sala: "cozinha" });
    ids["chat-sala-abrir"].click(); await espera(); await espera();
    assert.equal(achar(painel, "sala-entrar").length, 0);
  }
  // o chat da sala de sempre (store desligado): nome e texto com data-sensivel
  {
    const { ids, evento } = carregar({ config: { andar: "principal", equipe: null }, respostas: RESP, sala: "cozinha" });
    evento("aovivo", { mensagens: [{ seq: 2, usuario: "ana", nome: "Ana", texto: "oi", em: "2026-11-16T13:00:00Z" }] }); await espera();
    const li = ids["chat-sala-lista"].children[0];
    assert.ok("data-sensivel" in achar(li, "chat-sala-texto")[0].attrs);
    assert.ok("data-sensivel" in todos(li).find(x => x.tagName === "STRONG").attrs);
  }
  console.log("test_painel_tela.js ok");
})().catch(e => { console.error(e); process.exit(1); });
