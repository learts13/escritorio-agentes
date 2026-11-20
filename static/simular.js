// Menu de simulação: ver o escritório em outra data (festas), hora e clima.
// Não guarda nada: a escolha vira parâmetros da URL que a página já entende (?data= do festas.js, ?hora= do
// ceu.js e ?clima= do clima.js) e a página recarrega, mantendo ?demo e os demais
// parâmetros e a rota (#...). Enquanto houver data, hora ou clima simulados, uma faixa "Simulação" fica
// sempre à vista, com "Voltar ao real". Simular.abrir() abre o painel (diálogo modal; Esc fecha e o foco
// volta para quem abriu).
"use strict";

const Simular = (() => {
  const PARAMS = ["data", "hora", "clima"];   // o que é simulação
  const HORAS = [["Manhã", 8], ["Almoço", 12.5], ["Pausa do café", 15.5], ["Fim de tarde", 18], ["Noite", 21.5]];
  const CLIMAS = [["limpo", "Sol"], ["nublado", "Nublado"], ["garoa", "Garoa"], ["chuva", "Chuva"], ["tempestade", "Tempestade"],
    ["neblina", "Neblina"], ["neve", "Neve"]];
  const NOME_CLIMA = Object.fromEntries(CLIMAS);

  const CSS = `
.sim-dialogo { width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); padding: 0; border: 1px solid var(--borda-forte, rgba(255,255,255,.15));
  border-radius: var(--r-cartao, 0); background: var(--cartao, #1c1c1b); color: var(--texto, #efefec); box-shadow: 6px 6px 0 rgba(0, 0, 0, .45); overflow: auto; }
.sim-dialogo::backdrop { background: rgba(0,0,0,.6); }
.sim-form { display: flex; flex-direction: column; gap: 16px; padding: 18px 18px 16px; }
.sim-cabeca { display: flex; align-items: flex-start; gap: 12px; }
.sim-cabeca h2 { margin: 0; font-size: 18px; }
.sim-cabeca p { margin: 4px 0 0; color: var(--suave, #a3a39e); font-size: 13px; line-height: 1.45; }
.sim-x { flex: none; margin-left: auto; min-width: 44px; min-height: 44px; border-radius: var(--r-botao, 0); border: 1px solid var(--borda, rgba(255,255,255,.10));
  background: var(--cartao2, #242423); color: var(--texto, #efefec); font-size: 20px; line-height: 1; }
.sim-grupo { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
/* a interface usa Figtree, como o .faq-grupo; a Silkscreen fica só no canvas do mapa */
.sim-grupo legend { padding: 0; margin-bottom: 8px; font: 650 12px Figtree, system-ui, sans-serif; text-transform: uppercase; letter-spacing: .5px;
  color: var(--suave, #a3a39e); }
.sim-linha { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sim-campo { display: flex; flex-direction: column; gap: 4px; flex: 1 1 200px; min-width: 0; font-size: 13px; color: var(--suave, #a3a39e); }
.sim-campo select, .sim-campo input { min-height: 44px; padding: 0 10px; border-radius: var(--r-botao, 0); border: 1px solid var(--borda-forte, rgba(255,255,255,.15));
  background: var(--cartao2, #242423); color: var(--texto, #efefec); font: inherit; font-size: 15px; color-scheme: dark; min-width: 0; width: 100%; box-sizing: border-box; }
.sim-grupo > .sim-campo { flex: none; }   /* na coluna do grupo, a base de 200px viraria altura */
.sim-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sim-chip { position: relative; display: inline-flex; }
.sim-chip input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.sim-chip span { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; border-radius: var(--r-botao, 0); border: 1px solid var(--borda, rgba(255,255,255,.10));
  background: var(--cartao2, #242423); color: var(--texto, #efefec); font-size: 14px; font-weight: 600; white-space: nowrap; }
/* escolhido = "pressionado", como os filtros .estados; a cor de destaque fica só no botão principal e no foco */
.sim-chip input:checked + span { background: var(--cartao3, #282827); color: var(--texto, #efefec); border-color: transparent;
  box-shadow: var(--afundado, inset 0 2px 5px rgba(0,0,0,.9)); }
.sim-chip input:focus-visible + span { outline: 2px solid var(--destaque, #f5b83d); outline-offset: 2px; }
.sim-chip input:disabled + span { opacity: .45; cursor: not-allowed; }
.sim-faixa-hora { display: flex; align-items: center; gap: 12px; }
.sim-faixa-hora input { flex: 1; min-width: 0; min-height: 44px; accent-color: var(--texto2, #d6d6d2); }
.sim-faixa-hora output { flex: none; min-width: 52px; font: 700 15px Figtree, system-ui, sans-serif; font-variant-numeric: tabular-nums; text-align: right; }
.sim-nota { margin: 0; font-size: 12px; color: var(--suave, #a3a39e); }
.sim-acoes { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding-top: 4px; border-top: 1px solid var(--borda, rgba(255,255,255,.10)); }
.sim-acoes .botao { margin-top: 12px; }
/* faixa neutra: o âmbar é só do "esperando você" */
.sim-aviso { position: fixed; z-index: 30; left: 50%; transform: translateX(-50%); bottom: 16px; max-width: calc(100vw - 24px); box-sizing: border-box;
  display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; border-radius: var(--r-botao, 0); border: 1px solid var(--borda-forte, rgba(255,255,255,.15));
  background: var(--cartao2, #242423); color: var(--texto, #efefec); box-shadow: 4px 4px 0 rgba(0, 0, 0, .45); font-size: 13px; font-weight: 600; }
.sim-aviso p { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sim-aviso button { flex: none; min-height: 44px; padding: 0 12px; border-radius: 0; border: 0; font-weight: 800; font-size: 13px; }
.sim-aviso .sim-real { background: var(--destaque, #f5b83d); color: var(--destaque-texto, #1a1408); }
.sim-aviso .sim-ajustar { background: transparent; color: var(--texto2, #d6d6d2); border: 1px solid var(--borda-forte, rgba(255,255,255,.15)); }
.sim-aviso .sim-curto { display: none; }
@media (max-width: 760px) {
  /* à esquerda e longe da borda direita: a pílula de controles do mapa (estilo.css, .controles no celular) rola por baixo dela */
  .sim-aviso { bottom: calc(72px + env(safe-area-inset-bottom)); left: 12px; right: 76px; transform: none; max-width: none; padding-left: 10px; gap: 6px; }
  .sim-aviso p { white-space: normal; line-height: 1.3; overflow-wrap: anywhere; }
  .sim-aviso .sim-ajustar, .sim-aviso .sim-real { padding: 0 10px; }
  .sim-aviso .sim-longo { display: none; }
  .sim-aviso .sim-curto { display: inline; }
}`;

  let dialogo = null, origem = null, campos = null;
  const el = (tag, props, ...filhos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "texto") n.textContent = v;
      else if (k === "classe") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (typeof v === "boolean") n[k] = v;
      else n.setAttribute(k, v);
    }
    for (const f of filhos) if (f) n.append(f);
    return n;
  };
  function estilos() {
    if (estilos.feito) return;
    estilos.feito = true;
    const folha = new CSSStyleSheet();   // construída: o CSP da página só aceita style-src 'self'
    folha.replaceSync(CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, folha];
  }

  // --- estado na URL --------------------------------------------------------------------------
  function lerUrl() {
    const q = new URLSearchParams(location.search), hora = parseFloat(q.get("hora")), data = q.get("data");
    return { data: /^\d{4}-\d{2}-\d{2}$/.test(data || "") ? data : "", hora: hora >= 0 && hora < 24 ? hora : null,
      clima: Object.hasOwn(NOME_CLIMA, q.get("clima") || "") ? q.get("clima") : "" };
  }
  function irPara(e) {   // recarrega com a URL nova; o resto da busca (?demo...) e o hash ficam como estão
    const q = new URLSearchParams(location.search);
    const por = { data: e.data || null, hora: e.hora == null ? null : String(Math.round(e.hora * 100) / 100), clima: e.clima || null,
      visao: null };   // ?visao= de um link antigo (era a visão 3D, que saiu) some da URL
    for (const [k, v] of Object.entries(por)) if (v === null) q.delete(k); else q.set(k, v);
    const busca = q.toString(), url = location.pathname + (busca ? "?" + busca : "") + location.hash;
    if (url === location.pathname + location.search + location.hash) { fechar(); return; }
    location.assign(url);
  }
  const simulando = () => { const q = new URLSearchParams(location.search); return PARAMS.some(k => q.has(k)); };

  const hhmm = h => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const anoReal = () => +new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date());
  const festas = ano => (window.Festas && typeof Festas.lista === "function" ? Festas.lista(ano) : []).slice().sort((a, b) => a.data.localeCompare(b.data));
  const diaMes = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  function nomeData(iso) {
    const f = festas(+iso.slice(0, 4)).find(f => f.data === iso);
    return f ? f.nome : `${diaMes(iso)}/${iso.slice(0, 4)}`;
  }

  // --- faixa "Simulação" -----------------------------------------------------------------------
  function faixa() {
    if (!simulando()) return;
    estilos();
    const e = lerUrl(), partes = [];
    if (e.data) partes.push(nomeData(e.data));
    if (e.hora != null) partes.push(hhmm(e.hora));
    if (e.clima) partes.push(NOME_CLIMA[e.clima].toLowerCase());
    const aviso = el("div", { classe: "sim-aviso", role: "region", "aria-label": "Simulação ativa" },
      el("p", { texto: ["Simulação", ...partes].join(" · ") }),
      el("button", { type: "button", classe: "sim-ajustar", texto: "Ajustar", onclick: () => abrir() }),
      el("button", { type: "button", classe: "sim-real", "aria-label": "Voltar ao real", onclick: () => irPara({}) },
        el("span", { classe: "sim-longo", texto: "Voltar ao real" }), el("span", { classe: "sim-curto", texto: "Real" })));
    document.body.append(aviso);
  }

  // --- painel ----------------------------------------------------------------------------------
  function chip(nome, valor, rotulo, marcado, desligado) {
    return el("label", { classe: "sim-chip" }, el("input", { type: "radio", name: nome, value: valor, checked: !!marcado, disabled: !!desligado }), el("span", { texto: rotulo }));
  }
  function montar() {
    estilos();
    const ano = anoReal(), lista = festas(ano);
    const festa = el("select", { id: "sim-festa" }, el("option", { value: "", texto: "Data real (hoje)" }),
      ...lista.map(f => el("option", { value: f.data, texto: `${f.nome} (${diaMes(f.data)})` })), el("option", { value: "outra", texto: "Outra data" }));
    const data = el("input", { id: "sim-data", type: "date" });
    const hora = el("input", { id: "sim-hora", type: "range", min: "0", max: "23.75", step: "0.25" });
    const saida = el("output", { for: "sim-hora", id: "sim-hora-valor" });

    // a festa preenche a data; uma data digitada mostra a festa dela (ou "Outra data")
    festa.addEventListener("change", () => { if (festa.value === "outra") data.focus(); else data.value = festa.value; });
    data.addEventListener("input", () => { festa.value = !data.value ? "" : lista.some(f => f.data === data.value) ? data.value : "outra"; });
    // a régua marca o horário pronto que bate e desmarca "Agora"
    const mostrarHora = () => { const h = +hora.value; saida.value = hhmm(h); hora.setAttribute("aria-valuetext", hhmm(h)); };
    hora.addEventListener("input", () => {
      mostrarHora();
      for (const r of campos.form.elements.hora) r.checked = r.value === String(+hora.value);
    });

    const form = el("form", { classe: "sim-form", novalidate: true },
      el("div", { classe: "sim-cabeca" },
        el("div", null, el("h2", { id: "sim-titulo", texto: "Simular o escritório" }),
          el("p", { id: "sim-desc", texto: "Veja o escritório em outra data, hora ou clima. Nada é salvo: muda só o endereço desta aba, e a faixa “Simulação” avisa enquanto estiver valendo." })),
        el("button", { type: "button", classe: "sim-x", "aria-label": "Fechar", texto: "×", onclick: () => fechar() })),
      el("fieldset", { classe: "sim-grupo" }, el("legend", { texto: "Data" }),
        el("div", { classe: "sim-linha" },
          el("label", { classe: "sim-campo", for: "sim-festa" }, "Data festiva", festa),
          el("label", { classe: "sim-campo", for: "sim-data" }, "Ou escolha o dia", data)),
        lista.length ? null : el("p", { classe: "sim-nota", texto: "A lista de festas não carregou; escolha o dia no calendário." })),
      el("fieldset", { classe: "sim-grupo" }, el("legend", { texto: "Hora" }),
        el("div", { classe: "sim-chips" }, chip("hora", "", "Agora"), ...HORAS.map(([n, h]) => chip("hora", String(h), `${n} · ${hhmm(h)}`))),
        el("label", { classe: "sim-campo", for: "sim-hora" }, "Horário exato", el("div", { classe: "sim-faixa-hora" }, hora, saida))),
      el("fieldset", { classe: "sim-grupo" }, el("legend", { texto: "Clima" }),
        el("div", { classe: "sim-chips" }, chip("clima", "", "Real"), ...CLIMAS.map(([v, n]) => chip("clima", v, n)))),
      el("div", { classe: "sim-acoes" },
        el("button", { type: "button", classe: "botao fantasma", texto: "Voltar ao real", onclick: () => irPara({}) }),
        el("button", { type: "submit", classe: "botao", texto: "Ver simulação" })));
    form.addEventListener("submit", ev => { ev.preventDefault(); irPara(escolha()); });
    form.addEventListener("change", ev => { if (ev.target.name === "hora" && ev.target.value) { hora.value = ev.target.value; mostrarHora(); } });

    dialogo = el("dialog", { classe: "sim-dialogo", "aria-labelledby": "sim-titulo", "aria-describedby": "sim-desc" }, form);
    dialogo.addEventListener("keydown", prenderFoco);
    dialogo.addEventListener("close", () => { const o = origem; origem = null; if (o && o.isConnected) o.focus(); });
    dialogo.addEventListener("click", ev => { if (ev.target === dialogo) fechar(); });   // clique no fundo escurecido
    document.body.append(dialogo);
    campos = { form, festa, data, hora, mostrarHora, lista };
  }
  function escolha() {
    const f = campos.form.elements, ritmo = f.hora.value, horaMarcada = [...f.hora].some(r => r.checked);
    return { data: campos.data.value || "", hora: horaMarcada && ritmo === "" ? null : +campos.hora.value,
      clima: f.clima.value };
  }
  function preencher() {   // o painel abre com o que está valendo agora
    const e = lerUrl(), f = campos.form.elements;
    campos.data.value = e.data;
    campos.festa.value = !e.data ? "" : campos.lista.some(x => x.data === e.data) ? e.data : "outra";
    const h = e.hora ?? (window.Ceu ? (() => { const [hh, mm] = Ceu.agora().hora.split(":").map(Number); return hh + Math.floor(mm / 15) / 4; })() : 12);
    campos.hora.value = String(h); campos.mostrarHora();
    for (const r of f.hora) r.checked = e.hora == null ? r.value === "" : r.value === String(e.hora);
    for (const r of f.clima) r.checked = r.value === e.clima;
  }

  // foco preso no diálogo: Tab e Shift+Tab dão a volta dentro dele
  function prenderFoco(ev) {
    if (ev.key !== "Tab") return;
    const focaveis = [...dialogo.querySelectorAll("button, select, input")].filter(n => !n.disabled && n.offsetParent !== null
      && !(n.type === "radio" && !n.checked && [...dialogo.querySelectorAll(`input[name="${n.name}"]`)].some(o => o.checked)));
    if (!focaveis.length) return;
    const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
    if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
  }

  function abrir() {
    if (!dialogo) montar();
    if (dialogo.open) return;
    origem = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    preencher();
    dialogo.showModal();   // Esc fecha (evento cancel do próprio <dialog>)
    campos.festa.focus();
  }
  function fechar() { if (dialogo && dialogo.open) dialogo.close(); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", faixa); else faixa();
  return { abrir, fechar };
})();

window.Simular = Simular;
