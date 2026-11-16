"use strict";
// Reuniões (1.6 Onda 3, contrato 2026-11-16-onda3-contrato.md): o link fixo de cada sala (o botão "Entrar na reunião"),
// a agenda da semana do andar (marcar, editar, cancelar, convidar, baixar o .ics) e o aviso de "começa em 5 min" na tela.
// Horários do servidor em epoch s (UTC); a tela mostra a hora local. Nada disso existe no saguão nem com o store
// desligado: config.equipe.reunioes null. Títulos e nomes só por textContent e com data-sensivel (o modo apresentação
// do mapa esconde).
const Reunioes = (() => {
  const LINK_MAX = 500;
  const ERRO_LINK = "Use um link https de Meet, Zoom, Jitsi, Teams ou Whereby, sem senha no endereço.";
  // ASCII visível, sem espaço nem \ " < > ` { } | ^ (o mesmo que o servidor aceita)
  const ASCII_OK = /^[\x21-\x7e]+$/, PROIBIDOS = /[\\"<>`{}|^]/;
  function hostNaLista(host, hosts) {
    return (Array.isArray(hosts) ? hosts : []).some(h => typeof h === "string" &&
      (h.startsWith("*.") ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h));
  }
  // {ok: true, url} ou {ok: false, mensagem}; quem decide de fato é o servidor
  function linkValido(texto, hosts) {
    const ruim = { ok: false, mensagem: ERRO_LINK };
    if (typeof texto !== "string") return ruim;
    const url = texto.trim();
    if (!url || url.length > LINK_MAX || !ASCII_OK.test(url) || PROIBIDOS.test(url) || !/^https:\/\//i.test(url)) return ruim;
    const autoridade = url.slice(8).split(/[/?#]/)[0];
    if (!autoridade || autoridade.includes("@") || autoridade.includes(":")) return ruim;   // sem usuário, senha nem porta
    return hostNaLista(autoridade.toLowerCase(), hosts) ? { ok: true, url } : ruim;
  }

  const SALAS = { recepcao: "Recepção", reuniao: "Sala de reunião", cozinha: "Cozinha", lounge: "Lounge" };
  const nomeSala = s => (typeof s !== "string" ? "" : Object.hasOwn(SALAS, s) ? SALAS[s] : s.startsWith("time:") ? s.slice(5) : "");
  const salaOk = s => typeof s === "string" && (Object.hasOwn(SALAS, s) || (s.startsWith("time:") && s.length > 5));
  // as salas do mapa (predio.salas e predio.baixo do mapa.js) que aceitam reunião: o corredor não
  const salasDoMapa = lista => (Array.isArray(lista) ? lista : []).filter(s => s && salaOk(s.chave))
    .map(s => ({ chave: s.chave, nome: nomeSala(s.chave) || s.nome }));

  // ---- tempo: o servidor fala em epoch s; a semana é de segunda a domingo, na hora local
  const epoch = d => Math.floor(d.getTime() / 1000);
  const data = s => new Date(s * 1000);
  const numero = n => Number.isInteger(n);
  function semana(d, desloc = 0) {
    const seg = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 7 * desloc);
    return Array.from({ length: 7 }, (_, i) => new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + i));
  }
  const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const doDia = (rs, dia) => (Array.isArray(rs) ? rs : []).filter(r => r && numero(r.inicio) && mesmoDia(data(r.inicio), dia))
    .sort((a, b) => a.inicio - b.inicio);
  const dd = n => String(n).padStart(2, "0");
  const horaDe = s => { const d = data(s); return `${dd(d.getHours())}:${dd(d.getMinutes())}`; };
  const faixa = r => (r && numero(r.inicio) && numero(r.fim) ? `${horaDe(r.inicio)} – ${horaDe(r.fim)}` : "");
  function duracaoTexto(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  }

  // ---- "começa em 5 min": quem começa de agora até aviso_min, uma vez por (reunião, horário)
  const chaveAviso = r => `${r.id}:${r.inicio}`;
  const emBreve = (rs, agora, avisadas, min) => (Array.isArray(rs) ? rs : [])
    .filter(r => r && numero(r.inicio) && r.inicio >= agora && r.inicio - agora <= min * 60 && !avisadas.has(chaveAviso(r)))
    .sort((a, b) => a.inicio - b.inicio);
  function textoEmBreve(r, agora) {
    const falta = Math.round((r.inicio - agora) / 60), sala = nomeSala(r.sala);
    return `${r.titulo} começa ${falta > 0 ? `em ${falta} min` : "agora"}${sala ? `, na ${sala}` : ""}.`;
  }

  // ---- o formulário: {problema} ou {problema: null, corpo} já no formato do POST /api/reunioes/marcar
  const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/, DIA = /^(\d{4})-(\d{2})-(\d{2})$/, ANO = 366 * 86400;
  function validarReuniao(c, agoraMs, lim) {
    const l = lim || {}, max = l.titulo_max || 80, dmin = l.duracao_min || 5, dmax = l.duracao_max || 480, cmax = l.convidados_max || 50;
    const titulo = String(c.titulo || "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
    const p = problema => ({ problema });
    if (!titulo) return p("Escreva o título da reunião.");
    if ([...titulo].length > max) return p(`O título passa de ${max} caracteres.`);
    if (!salaOk(c.sala)) return p("Escolha a sala.");
    const d = DIA.exec(c.dia || ""), h = HHMM.exec(c.hora || "");
    if (!d) return p("Escolha o dia.");
    if (!h) return p("Escolha a hora.");
    const inicio = epoch(new Date(+d[1], +d[2] - 1, +d[3], +h[1], +h[2])), agora = Math.floor(agoraMs / 1000);
    if (inicio < agora - 60) return p("Esse horário já passou.");
    if (inicio > agora + ANO) return p("Marque com até 1 ano de antecedência.");
    const duracao = /^\d+$/.test(String(c.duracao)) ? Number(c.duracao) : NaN;
    if (!(duracao >= dmin && duracao <= dmax)) return p(`A duração vai de ${dmin} a ${dmax} minutos.`);
    const convidados = Array.isArray(c.convidados) ? [...new Set(c.convidados)] : [];
    if (convidados.length > cmax) return p(`Convide até ${cmax} pessoas.`);
    return { problema: null, corpo: { titulo, sala: c.sala, inicio, duracao, convidados } };
  }
  const urlIcs = id => `api/reunioes/ics?id=${id}`;

  const puro = { linkValido, nomeSala, salaOk, salasDoMapa, semana, epoch, data, mesmoDia, doDia, faixa, duracaoTexto, chaveAviso, emBreve,
    textoEmBreve, validarReuniao, urlIcs, ERRO_LINK };
  if (typeof document === "undefined") return puro;

  // ---- na página. O index.html traz o item do menu, a tela #reunioes, os dois diálogos, o cartão do Personalizar, a
  // pílula do mapa e o aviso; o app.js chama configurar(config) a cada /api/config, abrir() na rota e ajustes() no
  // Personalizar, e o mapa pede os links com entrar(chave, nome) (lista de salas, painel da conversa)
  const $ = id => document.getElementById(id);
  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };
  const sensivel = e => { e.setAttribute("data-sensivel", ""); return e; };   // o modo apresentação (apresentacao.js) esconde
  const cfg = () => (typeof config !== "undefined" ? config : null);   // app.js
  const login = () => (typeof estado !== "undefined" && estado && typeof estado.usuario === "string" ? estado.usuario : null);   // app.js
  const reu = c => (c && c.equipe && c.equipe.reunioes) || null;
  const ligado = c => !!reu(c);
  const lim = () => reu(cfg()) || {};
  let opcoes = { salas: () => [] };
  const s = { andar: null, links: {}, semana: 0, rs: [], v: null, proximas: [], avisadas: new Set(), pessoas: null, editando: null, fim: null,
    onde: { sala: "", nome: "" }, aviso: null, gatilho: null, voltas: 0 };
  const vinculados = new Set();   // os "Entrar" que o mapa pediu: repintados quando os links mudam

  async function pedir(rota, corpo) {
    let r = null, d = null;
    try {
      r = await fetch(Andar.com(rota), { method: corpo === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin",
        headers: corpo === undefined ? {} : { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      d = await r.json().catch(() => null);
    } catch (e) { r = null; }
    if (r && r.status === 401) { location.href = "/entrar"; return { ok: false, status: 401, d: null }; }
    return { ok: !!r && r.ok, status: r ? r.status : 0, d };
  }
  const mensagem = (r, padrao) => (r.d && typeof r.d.mensagem === "string" ? r.d.mensagem : r.status ? `${padrao} (HTTP ${r.status}).` : "Sem conexão. Tente de novo.");
  const avisar = (el, texto, ruim = false) => { el.textContent = texto; el.classList.toggle("ruim", ruim); el.classList.toggle("ok", !!texto && !ruim); };

  // ---- "Entrar na reunião": sempre em aba nova, sem opener nem referrer; só link que passa na lista de hosts.
  // No modo apresentação o link sai do href (a barra de status mostraria o ?pwd= do Zoom) e o clique abre pelo JS
  const urls = new WeakMap();
  const apresentando = () => !!(window.Apresentacao && window.Apresentacao.ligado());
  function abrirPorClique(ev) {
    const a = ev.currentTarget || ev.target, url = urls.get(a);
    if (!url || a.hasAttribute("href") || (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ")) return;
    ev.preventDefault();
    window.open(url, "_blank", "noopener,noreferrer");
  }
  function aplicarHref(a) {
    const url = urls.get(a), oculto = !!url && apresentando();
    if (url && !oculto) a.setAttribute("href", url); else a.removeAttribute("href");
    if (oculto) { a.setAttribute("role", "button"); a.setAttribute("tabindex", "0"); }   // sem href, o <a> sairia do Tab
    else { a.removeAttribute("role"); a.removeAttribute("tabindex"); }
  }
  function pintarLink(a, url, nome) {
    const ok = !!url && linkValido(url, lim().hosts).ok;
    a.target = "_blank"; a.rel = "noopener noreferrer";
    a.hidden = !ok;
    if (ok) urls.set(a, url); else urls.delete(a);
    if (!a.hasAttribute("data-entrar")) {
      a.setAttribute("data-entrar", "");
      a.addEventListener("click", abrirPorClique); a.addEventListener("keydown", abrirPorClique);
    }
    aplicarHref(a);
    a.setAttribute("aria-label", `Entrar na reunião${nome ? ` da ${nome}` : ""} (abre em outra aba)`);
    return a;
  }
  const linkDa = chave => (ligado(cfg()) && typeof s.links[chave] === "string" ? s.links[chave] : null);
  function entrar(chave, nome, classe = "sala-entrar") {
    const a = criar("a", classe, "Entrar");
    a.dataset.sala = chave; a.dataset.nome = nome || "";
    vinculados.add(a);
    return pintarLink(a, linkDa(chave), nomeSala(chave) || a.dataset.nome);   // o nome da sala como o servidor escreve (o mapa diz "Reunião")
  }
  function pintarTodos() {
    for (const a of [...vinculados]) {
      if (a.isConnected === false && a.dataset.ligado) vinculados.delete(a);   // já esteve na página e saiu: a lista de salas foi remontada
      else { if (a.isConnected) a.dataset.ligado = "1"; pintarLink(a, linkDa(a.dataset.sala), nomeSala(a.dataset.sala) || a.dataset.nome); }
    }
    const pilula = $("reuniao-entrar");
    if (pilula) pintarLink(pilula, linkDa(s.onde.sala), nomeSala(s.onde.sala) || s.onde.nome);
  }
  async function carregarLinks() {
    const r = await pedir("api/reunioes/links");
    if (r.ok && r.d && r.d.links && typeof r.d.links === "object") { s.links = { ...r.d.links }; pintarTodos(); }
  }

  // ---- a agenda da semana
  const MES = { month: "short" };
  const diaMes = d => `${d.getDate()} de ${d.toLocaleDateString("pt-BR", MES)}`;
  const tituloSemana = dias => (dias[0].getMonth() === dias[6].getMonth() ? `${dias[0].getDate()} a ${diaMes(dias[6])}` : `${diaMes(dias[0])} a ${diaMes(dias[6])}`);
  const rotuloDia = d => { const t = d.toLocaleDateString("pt-BR", { weekday: "long" }); return `${t.charAt(0).toUpperCase()}${t.slice(1)}, ${diaMes(d)}`; };
  async function carregarSemana() {
    const dias = semana(new Date(), s.semana), andar = Andar.atual;
    $("reunioes-titulo").textContent = `Semana de ${tituloSemana(dias)}`;
    $("reunioes-hoje").disabled = s.semana === 0;
    const r = await pedir(`api/reunioes?de=${epoch(dias[0])}&dias=7`);
    if (andar !== Andar.atual) return;
    if (!r.ok || !r.d || !Array.isArray(r.d.reunioes)) { avisar($("reunioes-aviso"), mensagem(r, "Não deu para ler a agenda"), true); return; }
    s.rs = r.d.reunioes.filter(x => x && numero(x.id) && numero(x.inicio) && numero(x.fim));
    desenharSemana(dias);
  }
  function desenharSemana(dias) {
    const hoje = new Date();
    $("reunioes-dias").replaceChildren(...dias.map((d, i) => {
      const caixa = criar("section", "reunioes-dia"), h = criar("h3", null, rotuloDia(d)), lista = doDia(s.rs, d);
      h.id = `reunioes-dia-${i}`; caixa.setAttribute("aria-labelledby", h.id);
      if (mesmoDia(d, hoje)) { caixa.classList.add("hoje"); caixa.setAttribute("aria-current", "date"); h.append(criar("span", "reunioes-hoje-selo", "Hoje")); }
      caixa.append(h);
      if (!lista.length) caixa.append(criar("p", "reunioes-nada", "Nada marcado."));
      else { const ol = criar("ol", "reunioes-lista"); ol.append(...lista.map(elReuniao)); caixa.append(ol); }
      return caixa;
    }));
    const alvo = s.destaque && [...$("reunioes-dias").querySelectorAll(".reuniao")].find(c => c.dataset.id === String(s.destaque));
    s.destaque = null;   // uma vez só
    if (alvo) { alvo.classList.add("destaque"); alvo.tabIndex = -1; alvo.focus(); if (alvo.scrollIntoView) alvo.scrollIntoView({ block: "center" }); }
  }
  function elReuniao(r) {
    const li = criar("li", "reuniao" + (r.agora ? " agora" : "")), quando = criar("p", "reuniao-hora", faixa(r));
    li.dataset.id = String(r.id);
    if (r.agora) quando.append(criar("span", "reuniao-agora", "Agora"));
    const nomes = (Array.isArray(r.convidados) ? r.convidados : []).map(c => (c && (c.nome || c.usuario)) || "").filter(Boolean);
    const quem = `Marcada por ${r.meu ? "você" : r.nome || "ex-membro"}${nomes.length ? ` · com ${nomes.join(", ")}` : ""}`;
    li.append(quando, sensivel(criar("p", "reuniao-nome", typeof r.titulo === "string" ? r.titulo : "")),
      criar("p", "reuniao-sala", `${nomeSala(r.sala)} · ${duracaoTexto(r.duracao)}`), sensivel(criar("p", "reuniao-gente", quem)));
    const acoes = criar("div", "acoes reuniao-acoes");
    if (r.link) { const a = pintarLink(criar("a", "botao reuniao-entrar-bt", "Entrar na reunião"), r.link, nomeSala(r.sala)); if (!a.hidden) acoes.append(a); }
    const ics = criar("a", "botao secundario", "Baixar .ics");
    ics.setAttribute("href", Andar.com(urlIcs(r.id))); ics.setAttribute("download", "");
    // os rótulos dizem a hora e a sala, nunca o título: o modo apresentação esconde o texto, não o aria-label
    const qual = `das ${faixa(r)} na ${nomeSala(r.sala)}`;
    ics.setAttribute("aria-label", `Baixar o convite da reunião ${qual} para a sua agenda (.ics)`);
    acoes.append(ics);
    if (r.pode_mudar) {
      const editar = criar("button", "botao fantasma", "Editar"), cancelar = criar("button", "botao fantasma", "Cancelar");
      editar.type = cancelar.type = "button";
      editar.setAttribute("aria-label", `Editar a reunião ${qual}`); cancelar.setAttribute("aria-label", `Cancelar a reunião ${qual}`);
      editar.addEventListener("click", () => abrirForm(r, editar));
      cancelar.addEventListener("click", () => cancelarReuniao(r, cancelar));
      acoes.append(editar, cancelar);
    }
    li.append(acoes);
    return li;
  }

  // ---- marcar e editar
  const DURACOES = [15, 30, 45, 60, 90, 120, 180, 240];
  const opcao = (valor, texto) => { const o = criar("option", null, texto); o.value = String(valor); return o; };
  const salas = () => salasDoMapa(opcoes.salas());
  const dataLocal = d => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
  async function carregarPessoas() {
    if (s.pessoas) return s.pessoas;
    const r = await pedir("api/pessoas");
    s.pessoas = r.ok && r.d && Array.isArray(r.d.pessoas) ? r.d.pessoas.filter(p => p && typeof p.usuario === "string") : [];
    return s.pessoas;
  }
  // o foco volta a quem abriu o diálogo; se o botão sumiu (a agenda foi redesenhada), ao título da semana
  function devolverFoco() {
    const g = s.gatilho; s.gatilho = null;
    (g && g.isConnected !== false ? g : $("reunioes-titulo")).focus();
  }
  async function abrirForm(r = null, gatilho = null) {
    s.editando = r; s.gatilho = gatilho;
    $("reuniao-titulo").textContent = r ? "Editar reunião" : "Marcar reunião";
    $("r-salvar").textContent = r ? "Salvar" : "Marcar";
    $("r-titulo").maxLength = lim().titulo_max || 80;
    $("r-sala").replaceChildren(...salas().map(x => opcao(x.chave, x.nome)));
    const dur = r && !DURACOES.includes(r.duracao) ? [...DURACOES, r.duracao].sort((a, b) => a - b) : DURACOES;
    $("r-duracao").replaceChildren(...dur.map(m => opcao(m, duracaoTexto(m))));
    const proxima = new Date(Math.ceil(Date.now() / 1800000) * 1800000), ini = r ? data(r.inicio) : proxima;
    $("r-titulo").value = r ? r.titulo : ""; $("r-sala").value = r ? r.sala : salas().some(x => x.chave === "reuniao") ? "reuniao" : (salas()[0] || {}).chave || "";
    $("r-dia").value = dataLocal(ini); $("r-hora").value = horaDe(epoch(ini)); $("r-duracao").value = String(r ? r.duracao : 30);
    avisar($("r-aviso"), "");
    $("dlg-reuniao").showModal(); $("r-titulo").focus();
    const pessoas = await carregarPessoas(), marcados = new Set(r && Array.isArray(r.convidados) ? r.convidados.map(c => c.usuario) : []);
    $("r-convidados").replaceChildren(...pessoas.map((p, i) => {
      const li = criar("li"), rot = criar("label"), caixa = criar("input");
      caixa.type = "checkbox"; caixa.value = p.usuario; caixa.id = `r-conv-${i}`; caixa.checked = marcados.has(p.usuario);
      rot.htmlFor = caixa.id; rot.append(caixa, criar("span", null, p.nome || p.usuario));
      li.append(rot);
      return li;
    }));
    sensivel($("r-convidados"));
    $("r-sem-pessoas").hidden = pessoas.length > 0;
  }
  async function salvarForm() {
    const convidados = [...$("r-convidados").querySelectorAll("input")].filter(c => c.checked).map(c => c.value);
    const v = validarReuniao({ titulo: $("r-titulo").value, sala: $("r-sala").value, dia: $("r-dia").value, hora: $("r-hora").value,
      duracao: $("r-duracao").value, convidados }, Date.now(), lim());
    if (v.problema) { avisar($("r-aviso"), v.problema, true); return; }
    const editando = s.editando, bt = $("r-salvar");
    bt.disabled = true;
    const r = await pedir(editando ? "api/reunioes/editar" : "api/reunioes/marcar", editando ? { id: editando.id, ...v.corpo } : v.corpo);
    bt.disabled = false;
    if (!r.ok) { avisar($("r-aviso"), mensagem(r, "Não deu para salvar"), true); return; }
    $("dlg-reuniao").close();
    avisar($("reunioes-aviso"), editando ? "Reunião salva." : "Reunião marcada.");
    recarregar();
  }

  // ---- confirmar (cancelar e reunião geral): resolve com a sala escolhida, true, ou false se voltou
  function confirmar({ titulo, texto, sim, sala = false, oculto = false, gatilho = null }) {
    if (s.fim) s.fim(false);
    s.gatilho = gatilho;
    $("rc-titulo").textContent = titulo; $("rc-texto").textContent = texto; $("rc-sim").textContent = sim;
    $("rc-texto").toggleAttribute("data-sensivel", oculto);
    $("rc-sala-caixa").hidden = !sala; avisar($("rc-aviso"), "");
    if (sala) {
      $("rc-sala").replaceChildren(...salas().map(x => opcao(x.chave, x.nome)));
      $("rc-sala").value = salas().some(x => x.chave === "reuniao") ? "reuniao" : (salas()[0] || {}).chave || "";
    }
    $("dlg-reuniao-confirmar").showModal(); (sala ? $("rc-sala") : $("rc-nao")).focus();
    return new Promise(resolve => { s.fim = v => { s.fim = null; resolve(v); }; });
  }
  async function cancelarReuniao(r, gatilho) {
    if (!(await confirmar({ titulo: "Cancelar a reunião?", texto: `“${r.titulo}” sai da agenda de quem marcou e dos convidados.`, sim: "Cancelar a reunião",
      oculto: true, gatilho }))) return;
    const res = await pedir("api/reunioes/cancelar", { id: r.id });
    if (!res.ok) { avisar($("rc-aviso"), mensagem(res, "Não deu para cancelar"), true); return; }
    s.gatilho = null;   // o cartão sai da agenda
    $("dlg-reuniao-confirmar").close();
    avisar($("reunioes-aviso"), "Reunião cancelada.");
    recarregar();
  }
  async function convocar() {
    const sala = await confirmar({ titulo: "Chamar a reunião geral?", texto: "Vai um aviso para todo mundo do andar, e os bonecos vão até a sala escolhida.",
      sim: "Chamar agora", sala: true, gatilho: $("reunioes-geral") });
    if (!sala) return;
    const res = await pedir("api/reunioes/convocar", { sala });
    if (!res.ok) { avisar($("rc-aviso"), mensagem(res, "Não deu para chamar"), true); return; }
    $("dlg-reuniao-confirmar").close();
    avisar($("reunioes-aviso"), `Pronto: você chamou a equipe para a ${nomeSala(sala)}.`);
  }

  // ---- o link de cada sala, no Personalizar (só o admin do andar)
  async function ajustes(c) {
    const caixa = $("a-reunioes"), pode = ligado(c) && reu(c).pode_link === true;
    caixa.hidden = !pode;
    if (!pode) return;
    await carregarLinks();
    desenharLinks();
  }
  function desenharLinks(focar) {
    $("reunioes-links").replaceChildren(...salas().map((x, i) => {
      const li = criar("li", "reunioes-link"), rot = criar("label", null, x.nome), campo = criar("input"), acoes = criar("div", "acoes");
      li.dataset.sala = x.chave;
      campo.type = "url"; campo.id = `rl-${i}`; campo.value = s.links[x.chave] || ""; campo.maxLength = LINK_MAX; campo.autocomplete = "off";
      campo.placeholder = "https://meet.google.com/…"; campo.setAttribute("inputmode", "url");
      rot.htmlFor = campo.id;
      const erro = criar("p", "aviso-form ruim reunioes-link-erro");   // o erro na linha da sala: no celular, o fim da lista sai da tela
      erro.id = `rl-erro-${i}`; erro.setAttribute("role", "status"); campo.setAttribute("aria-describedby", erro.id);
      const salvar = criar("button", "botao secundario", "Salvar"), tirar = criar("button", "botao fantasma", "Tirar");
      salvar.type = tirar.type = "button";
      salvar.setAttribute("aria-label", `Salvar o link da ${x.nome}`); tirar.setAttribute("aria-label", `Tirar o link da ${x.nome}`);
      tirar.hidden = !s.links[x.chave];
      salvar.addEventListener("click", () => gravarLink(x, campo, erro));
      tirar.addEventListener("click", () => gravarLink(x, null, erro));
      campo.addEventListener("input", () => campo.removeAttribute("aria-invalid"));
      acoes.append(salvar, tirar);
      li.append(rot, campo, acoes, erro);
      if (focar === x.chave) setTimeout(() => campo.focus());
      return li;
    }));
  }
  async function gravarLink(sala, campo, erro) {
    const aviso = $("reunioes-links-aviso");
    let url = "";
    avisar(aviso, ""); erro.textContent = "";
    if (campo) {
      const v = linkValido(campo.value, lim().hosts);
      if (!v.ok) { erro.textContent = v.mensagem; campo.setAttribute("aria-invalid", "true"); campo.focus(); return; }
      url = v.url;
    }
    const r = await pedir("api/reunioes/link", { sala: sala.chave, url });
    if (!r.ok || !r.d || !r.d.links) { erro.textContent = mensagem(r, "Não deu para salvar o link"); return; }
    s.links = { ...r.d.links }; pintarTodos(); desenharLinks(sala.chave);
    avisar(aviso, url ? `Link da ${sala.nome} salvo.` : `Link da ${sala.nome} tirado.`);
  }

  // ---- o aviso de "começa em 5 min" (a minha reunião ou a que me convidou), uma vez por reunião
  const paraMim = r => !!r.meu || (login() && (r.usuario === login() || (Array.isArray(r.convidados) && r.convidados.some(c => c && c.usuario === login()))));
  async function carregarProximas() {
    const andar = Andar.atual, r = await pedir(`api/reunioes?de=${Math.floor(Date.now() / 1000)}&dias=1`);
    if (andar === Andar.atual && r.ok && r.d && Array.isArray(r.d.reunioes)) { s.proximas = r.d.reunioes.filter(x => x && numero(x.id) && numero(x.inicio)); verificar(); }
  }
  function verificar() {
    if (!ligado(cfg())) return;
    const agora = Math.floor(Date.now() / 1000), caixa = $("reuniao-aviso");
    if (s.aviso && !caixa.hidden && agora >= s.aviso.fim) caixa.hidden = true;   // a reunião acabou
    const lista = emBreve(s.proximas.filter(paraMim), agora, s.avisadas, lim().aviso_min || 5);
    if (!lista.length) return;
    for (const r of lista) s.avisadas.add(chaveAviso(r));
    s.aviso = lista[0];
    $("reuniao-aviso-txt").textContent = textoEmBreve(lista[0], agora);
    sensivel($("reuniao-aviso-txt"));
    pintarLink($("reuniao-aviso-entrar"), lista[0].link, nomeSala(lista[0].sala));
    caixa.hidden = false;
  }

  function recarregar() {
    carregarProximas();
    if (!$("v-reunioes").hidden) carregarSemana();
  }
  async function abrir() {
    if (!ligado(cfg())) return;
    const l = lim();
    $("reunioes-marcar").hidden = l.pode_marcar !== true;
    $("reunioes-geral").hidden = l.pode_convocar !== true;
    avisar($("reunioes-aviso"), "");
    s.semana = 0;
    await carregarSemana();
  }
  // a cada /api/config: o menu, e o andar novo começa do zero (os links, as reuniões e os avisos são do andar)
  function configurar(c) {
    const liga = ligado(c), andar = c && typeof c.andar === "string" ? c.andar : Andar.atual;
    $("nav-reunioes").hidden = !liga;
    if (andar !== s.andar) {
      Object.assign(s, { andar, links: {}, rs: [], v: null, proximas: [], pessoas: null, aviso: null });
      $("reuniao-aviso").hidden = true;
      if (liga) { carregarLinks(); carregarProximas(); }
    }
    if (!liga) $("reuniao-aviso").hidden = true;
    pintarTodos();
  }
  function iniciar(op) {
    opcoes = { ...opcoes, ...op };
    // o aviso no modo apresentação: o texto de sempre some (data-sensivel) e fica este, sem dado; o Entrar some (estilo.css)
    $("reuniao-aviso").replaceChildren($("reuniao-aviso-txt"), criar("p", "reuniao-aviso-generico", "Uma reunião começa em breve"),
      $("reuniao-aviso-entrar"), $("reuniao-aviso-fechar"));
    $("reunioes-marcar").addEventListener("click", () => abrirForm(null, $("reunioes-marcar")));
    $("reunioes-geral").addEventListener("click", convocar);
    $("reunioes-antes").addEventListener("click", () => { s.semana--; carregarSemana(); });
    $("reunioes-depois").addEventListener("click", () => { s.semana++; carregarSemana(); });
    $("reunioes-hoje").addEventListener("click", () => { s.semana = 0; carregarSemana(); });
    $("form-reuniao").addEventListener("submit", e => { e.preventDefault(); salvarForm(); });
    $("r-fechar").addEventListener("click", () => $("dlg-reuniao").close());
    $("dlg-reuniao").addEventListener("close", devolverFoco);
    $("form-rc").addEventListener("submit", e => {
      e.preventDefault();
      if (s.fim) s.fim($("rc-sala-caixa").hidden ? true : $("rc-sala").value);   // quem fecha o diálogo é quem pediu, depois do POST
    });
    $("rc-nao").addEventListener("click", () => $("dlg-reuniao-confirmar").close());
    $("dlg-reuniao-confirmar").addEventListener("close", () => { if (s.fim) s.fim(false); devolverFoco(); });
    $("reuniao-aviso-fechar").addEventListener("click", () => { $("reuniao-aviso").hidden = true; });
    window.addEventListener("apresentacao", () => { for (const a of document.querySelectorAll("[data-entrar]")) aplicarHref(a); });
    window.addEventListener("minha-sala", e => { const d = e.detail || {}; s.onde = { sala: typeof d.sala === "string" ? d.sala : "", nome: typeof d.nome === "string" ? d.nome : "" }; pintarTodos(); });
    window.addEventListener("aovivo", e => {
      const v = (e.detail || {}).reunioes_v;
      if (!ligado(cfg()) || !numero(v) || v === s.v) return;
      s.v = v; recarregar();
    });
    setInterval(() => { if (++s.voltas % 15 === 0 && ligado(cfg())) carregarProximas(); else verificar(); }, 20000);   // relê as próximas a cada 5 min
  }
  // o toque no aviso de reunião (app.js): a próxima agenda que abrir põe o foco nesse cartão
  const destacar = id => { s.destaque = id; };
  return { ...puro, iniciar, configurar, ligado, abrir, ajustes, entrar, pintar: pintarTodos, recarregar, destacar };
})();
if (typeof window !== "undefined") window.Reunioes = Reunioes;
