// Novidades: o histórico de mudanças da versão instalada, pelo GET /api/novidades (o servidor lê o CHANGELOG.pt-BR.md).
// Os itens chegam com markdown inline cru: aqui só **negrito**, `código` e [texto](url), tudo com textContent, e os
// links só para o repositório do projeto (o resto vira texto). O selo "Novo" no menu aparece quando a versão do
// servidor é outra que a última vista neste navegador; abrir a página marca como vista.
"use strict";

const Novidades = (() => {
  const $ = id => document.getElementById(id);
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const VISTA = "escritorio:novidades-vista";
  const REPO = "/HelbertMoura/escritorio-agentes";
  const MARCAS = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;   // código, negrito, link

  let dados = null, lido = 0, pedido = 0, aberta = false, vistaAqui = null;   // vistaAqui: sem localStorage, vale nesta visita

  function iniciar() {
    $("novidades-tentar").addEventListener("click", async () => {
      $("t-novidades").focus();   // o botão some durante a busca: o foco vai ao título, não ao body
      await abrir();
      if (!$("novidades-tentar").hidden) $("novidades-tentar").focus();   // falhou de novo: volta ao botão
    });
    ler().then(r => { if (r.ok) selo(); }).catch(() => {});   // só para o selo: sem sessão ou sem rede, o menu fica como está
  }

  // ---------- leitura -----------------------------------------------------------------
  async function ler() {
    let r = null, d = null;
    try { r = await fetch("api/novidades", { cache: "no-store", credentials: "same-origin" }); d = await r.json().catch(() => null); } catch (e) { r = null; }
    if (!r) return { ok: false };
    if (r.status === 401) return { ok: false, sair: true };
    if (!r.ok || !d || typeof d.versao !== "string" || !Array.isArray(d.entradas)) return { ok: false };
    dados = { versao: d.versao.slice(0, 40), entradas: d.entradas.map(limpar).filter(Boolean) }; lido = performance.now();
    return { ok: true };
  }
  function limpar(en) { // entrada fora do contrato some; seção sem itens também
    if (!en || typeof en.titulo !== "string" || !Array.isArray(en.secoes)) return null;
    const secoes = en.secoes.filter(s => s && typeof s.nome === "string" && Array.isArray(s.itens))
      .map(s => ({ nome: s.nome, itens: s.itens.filter(i => typeof i === "string" && i.trim()) })).filter(s => s.itens.length);
    return { titulo: en.titulo, versao: typeof en.versao === "string" ? en.versao : null, data: typeof en.data === "string" ? en.data : "", secoes };
  }

  async function abrir() {
    aberta = true;
    if (dados) desenhar();   // o que já veio fica na tela enquanto busca de novo
    if (dados && performance.now() - lido < 60000) return;   // voltou para a página logo depois: sem pedir de novo
    const n = ++pedido;
    if (!dados) estado("Carregando as novidades…");
    const r = await ler();
    if (n !== pedido || !aberta) return;
    if (r.sair) { location.href = "/entrar"; return; }
    if (!r.ok && !dados) { estado("Não deu para ler as novidades agora. Confira a conexão e tente de novo.", true); return; }
    desenhar();
  }
  function fechar() { aberta = false; }

  // ---------- selo "Novo" -------------------------------------------------------------
  function vista() {
    try { return localStorage.getItem(VISTA) ?? vistaAqui; } catch (e) { return vistaAqui; }
  }
  function marcarVista(v) {
    vistaAqui = v;
    try { localStorage.setItem(VISTA, v); } catch (e) { /* aba anônima: fica só nesta visita */ }
  }
  function selo() { $("nav-novidades").hidden = !dados || !dados.versao || dados.versao === vista(); }

  // ---------- página ------------------------------------------------------------------
  function estado(txt, erro) {
    $("novidades-aviso").textContent = txt; $("novidades-aviso").hidden = !txt;
    $("novidades-tentar").hidden = !erro;
    $("novidades").hidden = true;
  }
  function desenhar() {
    if (dados.versao) marcarVista(dados.versao);
    selo();
    const lista = $("novidades");
    if (!dados.entradas.length) {
      estado("Ainda não há novidades para mostrar nesta versão.");
      return;
    }
    estado("");
    lista.replaceChildren(...dados.entradas.map((en, i) => entrada(en, i)));
    lista.hidden = false;
  }

  function entrada(en, i) {
    const art = el("article", "cartao nv-entrada"), lado = el("header", "nv-lado"), corpo = el("div", "nv-corpo");
    const titulo = el("h2", "nv-titulo"); titulo.id = `nv-t-${i}`; titulo.append(...inline(en.titulo, false));
    art.setAttribute("aria-labelledby", titulo.id);
    // com versão: "v1.1.0" em pixel e a data por extenso; os marcos antigos, sem versão, só a data em pixel
    const dia = data(en.data);
    if (en.versao) lado.append(el("p", "nv-versao", `v${en.versao}`));
    if (dia) {
      const t = el("time", en.versao ? "nv-data" : "nv-versao", en.versao ? dia : en.data.split("-").reverse().join("/")); t.dateTime = en.data;
      if (!en.versao) t.setAttribute("aria-label", dia);
      lado.append(t);
    }
    if (en.versao && en.versao === dados.versao) lado.append(el("p", "nv-instalada", "Instalada"));
    corpo.append(titulo);
    for (const s of en.secoes) {
      const sec = el("section", "nv-secao"), h = el("h3", null, s.nome), ul = el("ul");
      for (const item of s.itens) { const li = el("li"); li.append(...inline(item, true)); ul.append(li); }
      sec.append(h, ul); corpo.append(sec);
    }
    art.append(lado, corpo);
    return art;
  }

  function data(iso) { // "2026-11-08" → "8 de novembro de 2026"
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); if (!m) return "";
    const mes = MESES[Number(m[2]) - 1], d = Number(m[3]);
    return mes && d >= 1 && d <= 31 ? `${d === 1 ? "1º" : d} de ${mes} de ${m[1]}` : "";
  }

  // ---------- markdown inline seguro --------------------------------------------------
  // devolve nós (texto, <strong>, <code>, <a>); nada passa por innerHTML. "links" falso: dentro de um link, outro vira texto
  function inline(txt, links) {
    const nos = []; let ultimo = 0;
    for (const m of txt.matchAll(MARCAS)) {
      if (m.index > ultimo) nos.push(document.createTextNode(txt.slice(ultimo, m.index)));
      ultimo = m.index + m[0].length;
      if (m[1] != null) nos.push(el("code", null, m[1]));
      else if (m[2] != null) { const b = el("strong"); b.append(...inline(m[2], links)); nos.push(b); }
      else {
        const href = links && endereco(m[4]);
        if (!href) { nos.push(...inline(m[3], false)); continue; }
        const a = el("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.append(...inline(m[3], false));
        nos.push(a);
      }
    }
    if (ultimo < txt.length) nos.push(document.createTextNode(txt.slice(ultimo)));
    return nos;
  }
  function endereco(url) { // só o repositório no GitHub; "./README..." vira /blob/main/README...
    const bruto = url.startsWith("./") ? `https://github.com${REPO}/blob/main/${url.slice(2)}` : url;
    let u; try { u = new URL(bruto); } catch (e) { return ""; }
    const dentro = u.pathname === REPO || u.pathname.startsWith(`${REPO}/`);   // depois da URL: "../" já resolvido
    return u.protocol === "https:" && u.host === "github.com" && !u.username && !u.password && dentro ? u.href : "";
  }

  function el(tag, classe, texto) { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; }

  return { iniciar, abrir, fechar };
})();

window.Novidades = Novidades;
