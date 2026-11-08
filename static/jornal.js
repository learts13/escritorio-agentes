// Jornal do escritório: a semana (segunda a domingo, horário de Brasília) contada como um jornal, a partir do
// GET /api/jornal (só ids e números; os nomes e as aparências vêm do /api/estado, pelo app.js). Sem IA: as frases
// saem de Vida.FRASES.jornal (troque ali no white-label), uma fixa por semana. O tempo trabalhando é aproximado
// (o servidor conta leituras de 30 s) e a página diz isso.
"use strict";

const Jornal = (() => {
  const $ = id => document.getElementById(id);
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const CHUVA = new Set(["garoa", "chuva", "tempestade"]);
  const NOME_CLIMA = { limpo: "céu limpo", nublado: "nublado", neblina: "neblina", garoa: "garoa", chuva: "chuva", neve: "neve", tempestade: "tempestade" };

  let api = null, dados = null, placar = null, qual = "semana", pedido = 0, lido = 0;
  let desenhado = "";   // o que está na tela: sem mudança, nada é recriado (a rolagem da tabela e o leitor de tela ficam onde estão)

  function iniciar(a) {
    api = a;
    for (const b of document.querySelectorAll("#jornal-semanas button")) b.addEventListener("click", () => { qual = b.dataset.semana; desenhar(); });
  }

  // ---------- leitura -----------------------------------------------------------------
  async function abrir() {
    if (api.demo()) return esconder("Na demonstração não há jornal: ele junta as tarefas da semana do escritório de verdade.");
    if (dados && performance.now() - lido < 60000) { desenhar(); return; }   // voltou para a página logo depois: sem pedir de novo
    const n = ++pedido;
    if (!dados) aviso("Carregando o jornal…");
    let r = null, d = null;
    try { r = await fetch("api/jornal", { cache: "no-store", credentials: "same-origin" }); d = await r.json().catch(() => null); } catch (e) { r = null; }
    if (n !== pedido) return;
    if (r && r.status === 401) { location.href = "/entrar"; return; }
    if (r && r.status === 404 && d && d.erro === "jornal_desligado") { dados = null; return esconder("O jornal está desligado neste escritório."); }
    if (!r || !r.ok || !valido(d)) { if (!dados) esconder("Não deu para ler o jornal agora. Tente de novo daqui a pouco."); return; }
    dados = d; lido = performance.now();
    placar = api.socialLigada() ? await lerPlacar() : null;   // o "Campeão do ringue" vem do placar da vida social
    if (n === pedido) desenhar();
  }
  async function lerPlacar() {
    try {
      const r = await fetch("api/social/placar", { cache: "no-store", credentials: "same-origin" });
      const d = r.ok ? await r.json() : null;
      return d && Array.isArray(d.ranking) ? d : null;
    } catch (e) { return null; }
  }
  const semanaOk = s => !!s && typeof s.inicio === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.inicio) && Array.isArray(s.agentes) && Array.isArray(s.dias);
  const valido = d => !!d && d.v === 1 && semanaOk(d.semana) && semanaOk(d.anterior);
  const num = v => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  function aviso(txt) { $("jornal-aviso").textContent = txt; $("jornal-aviso").hidden = !txt; }
  function esconder(txt) { // sem jornal para mostrar: some o artigo e as abas das semanas, fica o aviso
    $("jornal").hidden = true; $("jornal-semanas").hidden = true; desenhado = "";
    aviso(txt);
  }

  // ---------- texto -------------------------------------------------------------------
  const qtd = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const preencher = (modelo, v) => modelo.replace(/\{(nome|qtd|lista)\}/g, (_, k) => v[k] ?? "");
  const escolher = (lista, inicio) => (Array.isArray(lista) ? lista[[...inicio].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % lista.length] : lista);
  const juntar = itens => (itens.length < 2 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`);
  function horas(min) {
    if (min < 60) return qtd(min, "minuto", "minutos");
    const h = Math.floor(min / 60), m = Math.round((min % 60) / 10) * 10;
    return m && m < 60 ? `${h} h ${m}` : `${h + (m === 60 ? 1 : 0)} h`;
  }
  function periodo(inicio) {
    const [a, m, d] = inicio.split("-").map(Number), ini = new Date(Date.UTC(a, m - 1, d)), fim = new Date(Date.UTC(a, m - 1, d + 6));
    const dia = x => (x.getUTCDate() === 1 ? "1º" : String(x.getUTCDate()));
    return ini.getUTCMonth() === fim.getUTCMonth() ? `${dia(ini)} a ${dia(fim)} de ${MESES[fim.getUTCMonth()]}`
      : `${dia(ini)} de ${MESES[ini.getUTCMonth()]} a ${dia(fim)} de ${MESES[fim.getUTCMonth()]}`;
  }
  function edicao(inicio) { // número da semana no ano (ISO 8601): a segunda está sempre na semana dela
    const [a, m, d] = inicio.split("-").map(Number), t = new Date(Date.UTC(a, m - 1, d + 3));   // a quinta decide o ano
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  }

  // ---------- página ------------------------------------------------------------------
  function desenhar() {
    for (const b of document.querySelectorAll("#jornal-semanas button")) b.setAttribute("aria-pressed", String(b.dataset.semana === qual));
    if (!dados) return;
    const F = Vida.FRASES.jornal, s = dados[qual], ini = s.inicio;
    // só quem está no escritório agora (o servidor já filtra; o app confere com a leitura dele)
    const gente = s.agentes.map(a => ({ id: a.id, tarefas: num(a.tarefas), aprovacoes: num(a.aprovacoes), respostas: num(a.respostas), minutos: num(a.minutos), ag: api.agente(a.id) }))
      .filter(a => typeof a.id === "string" && a.ag);
    const j = $("jornal");
    // a leitura de 10 s chama aqui também: só recria quando mudaram os dados, a aba, o placar ou os nomes e aparências
    const chave = JSON.stringify([qual, s, placar, api.empresa(), gente.map(a => [a.id, a.ag.nome, a.ag.ap])]);
    if (chave === desenhado && !j.hidden) return;
    desenhado = chave;
    j.hidden = false; $("jornal-semanas").hidden = false; aviso("");
    if (!gente.length && !s.dias.length) {
      j.replaceChildren(topo(F, ini), el("p", "jn-vazio", qual === "anterior" ? "Sem edição da semana passada: o escritório ainda não anotava." : "A edição desta semana ainda está em branco. Volte mais tarde."));
      return;
    }
    const rank = [...gente].sort((a, b) => b.tarefas - a.tarefas || b.minutos - a.minutos);
    j.replaceChildren(topo(F, ini), manchete(F, ini, rank), notas(F, ini, gente, s.dias), tabela(rank));
  }

  function topo(F, ini) {
    const h = el("header", "jn-topo");
    const titulo = el("h2", "jn-titulo", F.nome); titulo.id = "t-jornal";
    h.append(el("p", "jn-ed", `Edição nº ${edicao(ini)} · ${periodo(ini)}`), titulo, el("p", "jn-casa", api.empresa()));
    return h;
  }

  function manchete(F, ini, rank) {
    const sec = el("section", "jn-manchete"), top = rank[0];
    if (!top || !top.tarefas) { sec.append(el("h3", null, escolher(F.calma, ini))); return sec; }
    const fig = document.createElement("canvas"); fig.width = fig.height = 88; fig.className = "jn-retrato"; fig.setAttribute("aria-hidden", "true");
    const c = fig.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(Avatar.desenhar(top.ag.ap), 0, 0, 88, 88);
    const txt = el("div");
    txt.append(el("p", "jn-chapeu", "Manchete"), el("h3", null, preencher(escolher(F.manchete, ini), { nome: top.ag.nome, qtd: qtd(top.tarefas, "tarefa", "tarefas") })));
    const atras = rank.slice(1, 3).filter(a => a.tarefas);
    if (atras.length) txt.append(el("p", "jn-fina", preencher(F.atras, { lista: juntar(atras.map(a => `${a.ag.nome} (${a.tarefas})`)) })));
    sec.append(fig, txt);
    return sec;
  }

  function notas(F, ini, gente, dias) {
    const ul = el("ul", "jn-notas"), nota = (par, v, extra) => {
      const li = el("li", "jn-nota"); li.append(el("h3", null, par[0]), el("p", null, preencher(par[1], v)));
      if (extra) li.append(el("p", "jn-obs", extra));
      ul.append(li);
    };
    const maior = k => gente.reduce((m, a) => (a[k] > (m ? m[k] : 0) ? a : m), null);   // empate: o primeiro da lista (ordem do servidor)
    const ap = maior("aprovacoes"), rs = maior("respostas"), mn = maior("minutos");
    if (ap) nota(F.aprovacoes, { nome: ap.ag.nome, qtd: qtd(ap.aprovacoes, "pedido", "pedidos") });
    if (rs) nota(F.respostas, { nome: rs.ag.nome, qtd: qtd(rs.respostas, "pergunta", "perguntas") });
    if (mn) nota(F.minutos, { nome: mn.ag.nome, qtd: horas(mn.minutos) }, "Aproximado: o escritório confere a cada 30 segundos.");
    const campeao = placar && (qual === "semana" ? placar.ranking[0] : placar.anterior);
    const quem = campeao && typeof campeao.id === "string" && num(campeao.v) > 0 && api.agente(campeao.id);
    if (quem) nota(F.ringue, { nome: quem.nome, qtd: qtd(num(campeao.v), "vitória", "vitórias") });
    // o tempo: o tipo de clima ao meio-dia de cada dia anotado
    const conta = {}; for (const d of dias) if (d && Object.hasOwn(NOME_CLIMA, d.clima)) conta[d.clima] = (conta[d.clima] || 0) + 1;
    const molhados = [...CHUVA].reduce((t, k) => t + (conta[k] || 0), 0), total = Object.values(conta).reduce((t, n) => t + n, 0);
    if (molhados >= 3) nota(F.chuva, { qtd: qtd(molhados, "dia", "dias") });
    else if ((conta.limpo || 0) >= 3) nota(F.sol, { qtd: qtd(conta.limpo, "dia", "dias") });
    else if (conta.neve) nota(F.neve, { qtd: qtd(conta.neve, "dia", "dias") });
    else if (total) nota(F.variado, { lista: juntar(Object.entries(conta).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${NOME_CLIMA[k]} (${qtd(n, "dia", "dias")})`)) });
    const greves = dias.reduce((t, d) => t + num(d && d.greves), 0), brigas = dias.reduce((t, d) => t + num(d && d.brigas), 0);
    if (greves || brigas) nota(F.agito, { lista: juntar([greves && qtd(greves, "greve", "greves"), brigas && qtd(brigas, "briga", "brigas")].filter(Boolean)).replace(/^./, c => c.toUpperCase()) });
    else if (dias.length) nota(F.paz, {});
    return ul;
  }

  function tabela(rank) {
    const caixa = el("div", "jn-tabela-caixa"), t = el("table", "jn-tabela"), cab = el("tr");
    t.append(el("caption", null, "Todo mundo na semana"));
    for (const [txt, cls] of [["Agente", null], ["Tarefas", "num"], ["Aprovações", "num"], ["Perguntas", "num"], ["Tempo (aprox.)", "num"]]) { const th = el("th", cls, txt); th.scope = "col"; cab.append(th); }
    const corpo = el("tbody");
    for (const a of rank) {
      const tr = el("tr"), nome = el("th", "jn-quem"); nome.scope = "row";
      const dentro = el("span", "jn-quem-in"); dentro.append(api.mini(a.ag.ap), el("span", null, a.ag.nome)); nome.append(dentro);
      tr.append(nome, el("td", "num", String(a.tarefas)), el("td", "num", String(a.aprovacoes)), el("td", "num", String(a.respostas)), el("td", "num", horas(a.minutos)));
      corpo.append(tr);
    }
    t.append(el("thead"), corpo); t.tHead.append(cab);
    caixa.append(t);
    return caixa;
  }

  function el(tag, classe, texto) { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; }

  return { iniciar, abrir };
})();

window.Jornal = Jornal;
