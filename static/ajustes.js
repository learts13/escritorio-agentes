// Personalizar > Clima e Datas comemorativas. O clima salva na hora, a cada escolha (POST /api/clima), e o céu muda
// sem recarregar; a busca de cidade passa pelo servidor (GET /api/clima/busca), que fala com o Open-Meteo. As datas
// juntam as mudanças e salvam de uma vez (POST /api/festas) com a revisão (rev) que veio no /api/config: se outra aba
// salvou antes, o 409 pede para recarregar; deu certo, a página recarrega para o mapa usar as datas novas.
// Texto que vem do servidor ou da busca vai para a tela só por textContent.
"use strict";
const Ajustes = (() => {
  const $ = id => document.getElementById(id);
  const CHAPEUS = { noel: "gorro de Papai Noel", festa: "chapéu de festa", palha: "chapéu de palha", bruxa: "chapéu de bruxa", coelho: "orelhas de coelho" };
  const MAX_ANDARES = 6, MAX_DATAS = 24, PENDENTE = "Há mudanças que ainda não valem: clique em Salvar datas.";
  let cfg = null;
  let clima = null, origemClima = "nenhum";   // o que vale agora e de onde vem ("tela", "arquivo" ou "nenhum")
  let climaArquivo = true;                     // o times.json tem cidade? (ajustes.clima_arquivo; sem o campo, supõe que sim)
  let salvo = null, edicao = null;             // datas: { rev, proprias, desligadas } do servidor e a cópia em edição
  let editando = -1;                           // índice da data aberta no formulário (-1: nova)

  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const copia = d => JSON.parse(JSON.stringify(d));
  const demo = () => !!(window.Brincar && Brincar.demo);

  // o andar atual vai na query (expediente.js: Andar); as rotas do prédio (clima, datas, andares, sair) a ignoram
  async function pedir(url, corpo, doPredio) {
    if (demo()) throw new Error("Na demonstração nada é salvo.");   // segunda trava: nenhum pedido na demo
    const r = await fetch(doPredio ? url : Andar.com(url), corpo === undefined ? { credentials: "same-origin", cache: "no-store" }
      : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (r.status === 401) { location.href = "/entrar"; throw new Error("A sessão venceu."); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(typeof d.mensagem === "string" ? d.mensagem : typeof d.erro === "string" ? d.erro : `O servidor respondeu ${r.status}.`);
      e.status = r.status; e.codigo = typeof d.codigo === "string" ? d.codigo : typeof d.erro === "string" ? d.erro : ""; throw e;
    }
    return d;
  }
  function aviso(id, t, tipo) { const a = $(id); a.textContent = t; a.className = "aviso-form" + (tipo ? ` ${tipo}` : ""); }

  // ---------- clima -----------------------------------------------------------------------
  const climaOk = c => c && typeof c.cidade === "string" && Number.isFinite(c.lat) && Number.isFinite(c.lon);
  function mostrarClima() {
    $("clima-cidade").textContent = clima ? clima.cidade || "sem nome" : "Sem clima (céu sempre limpo)";
    // o tempo de agora é o do estado (clima.js); só vale se já for da cidade escolhida (o servidor zera ao trocar)
    const agora = clima && window.Clima ? Clima.texto() : "";
    $("clima-tempo").textContent = !clima ? "—" : agora.endsWith(` · ${clima.cidade}`) ? agora.slice(0, -(clima.cidade.length + 3)) : "Ainda sem resposta do Open-Meteo";
    const ORIGENS = { tela: "Escolhida nesta tela.", arquivo: "Vem do times.json do servidor." };
    $("clima-origem").textContent = Object.hasOwn(ORIGENS, origemClima) ? ORIGENS[origemClima] : "";
    $("clima-arquivo").hidden = origemClima !== "tela" || !climaArquivo;
    $("clima-sem").hidden = !clima;
  }
  async function salvarClima(corpo, feito) {
    const botoes = [...document.querySelectorAll("#a-clima button")];
    botoes.forEach(b => { b.disabled = true; });
    aviso("clima-aviso", "Salvando…");
    try {
      const d = await pedir("api/clima", corpo, true);
      clima = climaOk(d.clima) ? d.clima : null; origemClima = typeof d.origem === "string" ? d.origem : clima ? "tela" : "nenhum";
      cfg.clima = clima;
      mostrarClima(); aviso("clima-aviso", feito(clima), "ok");
    } catch (e) { aviso("clima-aviso", `Não salvou: ${e.message}`, "ruim"); }
    finally {
      botoes.forEach(b => { b.disabled = false; });
      // "Sem clima" e "Voltar ao times.json" somem depois de valer: o foco não pode cair no <body> (o aviso já anuncia o "Pronto")
      const f = document.activeElement;
      if (!f || f === document.body || f.closest("[hidden]")) $("clima-q").focus();
    }
  }

  // busca de cidade (aqui e no assistente): espera 400 ms de pausa na digitação e faz uma de cada vez (a última
  // digitada roda quando a anterior volta). "Usar esta" chama usar(resultado).
  function ligarBusca(q, lista, status, usar) {
    let pausa = 0, buscando = false, pendente = null;
    async function buscar(texto) {
      if (buscando) { pendente = texto; return; }
      if (texto.length < 2) { lista.replaceChildren(); status.textContent = texto ? "Digite pelo menos 2 letras." : ""; return; }
      buscando = true; status.textContent = "Buscando…";
      try {
        const d = await pedir(`api/clima/busca?q=${encodeURIComponent(texto)}`, undefined, true);
        if (pendente === null) mostrar(Array.isArray(d.resultados) ? d.resultados : []);
      } catch (e) { if (pendente === null) { lista.replaceChildren(); status.textContent = e.message; } }
      finally {
        buscando = false;
        if (pendente !== null) { const p = pendente; pendente = null; buscar(p); }
      }
    }
    function mostrar(rs) {
      const ok = rs.filter(r => r && typeof r.nome === "string" && r.nome && Number.isFinite(r.lat) && Number.isFinite(r.lon)).slice(0, 8);
      status.textContent = ok.length ? `${ok.length} ${ok.length === 1 ? "cidade encontrada" : "cidades encontradas"}.` : "Nenhuma cidade com esse nome.";
      lista.replaceChildren(...ok.map(r => {
        const onde = [r.regiao, r.pais].filter(t => typeof t === "string" && t).join(", ");
        const li = el("li"), txt = el("span", "clima-res"), bt = el("button", "botao secundario", "Usar esta");
        txt.append(el("strong", null, r.nome), el("span", "suave", onde));
        bt.type = "button"; bt.setAttribute("aria-label", `Usar ${r.nome}${onde ? `, ${onde}` : ""}`);
        bt.addEventListener("click", () => usar(r));
        li.append(txt, bt); return li;
      }));
    }
    q.addEventListener("input", () => { clearTimeout(pausa); const t = q.value.trim(); pausa = setTimeout(() => buscar(t), 400); });
    q.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); clearTimeout(pausa); buscar(q.value.trim()); } });
    return () => { clearTimeout(pausa); q.value = ""; lista.replaceChildren(); status.textContent = ""; };   // limpa a busca
  }
  // "Usar esta" do assistente: grava a cidade pelo /api/clima e devolve o clima que passou a valer
  async function usarCidade(r, c) {
    const d = await pedir("api/clima", { clima: { cidade: r.nome, lat: r.lat, lon: r.lon } }, true);
    clima = climaOk(d.clima) ? d.clima : null; origemClima = typeof d.origem === "string" ? d.origem : "tela";
    for (const x of new Set([c, cfg])) if (x) { x.clima = clima; x.ajustes = { ...(x.ajustes || {}), clima: origemClima }; }   // o Personalizar abre já com a cidade nova
    if (cfg) mostrarClima();
    return clima;
  }
  const limparBusca = ligarBusca($("clima-q"), $("clima-lista"), $("clima-status"), r => salvarClima({ clima: { cidade: r.nome, lat: r.lat, lon: r.lon } }, c => {
    limparBusca(); $("clima-q").focus();
    return `Pronto: o tempo agora é o de ${c ? c.cidade : r.nome}. O céu muda em até 1 minuto.`;
  }));
  $("clima-sem").addEventListener("click", () => salvarClima({ clima: null }, () => "Pronto: sem clima, o céu fica sempre limpo."));
  $("clima-arquivo").addEventListener("click", () => salvarClima({ limpar: true }, c => (c ? `Pronto: vale de novo a cidade do times.json (${c.cidade}).` : "Pronto: o times.json não tem cidade, então fica sem clima.")));
  setInterval(() => { if (cfg && !$("v-personalizar").hidden) mostrarClima(); }, 10000);   // o tempo chega com o /api/estado

  // ---------- datas comemorativas -----------------------------------------------------------
  const ANUAL = /^(\d{2})-(\d{2})$/, UNICA = /^(\d{4})-(\d{2})-(\d{2})$/;
  const doisDig = n => String(n).padStart(2, "0");
  const existe = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  const anoHoje = () => +new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date());
  // o dia em que a data acontece de novo (AAAA-MM-DD), para o "Ver no mapa"; a anual de 29/02 cai no próximo bissexto
  function proximoDia(p) {
    const u = UNICA.exec(p.data);
    if (u) return p.data;
    const [, m, d] = ANUAL.exec(p.data), y0 = anoHoje();
    for (let y = y0; y < y0 + 8; y++) if (existe(y, +m, +d)) return `${y}-${m}-${d}`;
    return null;
  }
  function quando(p) {
    const u = UNICA.exec(p.data), a = ANUAL.exec(p.data), dias = p.dias > 1 ? `, ${p.dias} dias` : "";
    return u ? `Em ${u[3]}/${u[2]}/${u[1]}${dias}` : `Todo ano em ${a[2]}/${a[1]}${dias}`;
  }
  const temaPorChave = k => Festas.temas().find(t => t.chave === k) || Festas.temas()[0];
  const mudou = () => JSON.stringify(edicao) !== JSON.stringify(salvo);
  function verNoMapa(iso, nome) {
    const a = el("a", "link-suave", "Ver no mapa");
    a.href = `/?data=${iso}#escritorio`; a.setAttribute("aria-label", `Ver ${nome} no mapa`);
    return a;
  }
  function cores(t) {
    const c = el("span", "d-cores"); c.setAttribute("aria-hidden", "true");
    for (const cor of t.cores) { const s = el("i"); s.style.background = cor; c.append(s); }
    return c;
  }

  function mostrarDatas(focoEm) {
    const sujo = mudou();
    // suas datas
    $("datas-vazio").hidden = edicao.proprias.length > 0;
    $("datas-proprias").replaceChildren(...edicao.proprias.map((p, i) => {
      const t = temaPorChave(p.tema), li = el("li"), txt = el("div", "datas-txt"), acoes = el("div", "datas-acoes");
      txt.append(el("strong", null, p.nome), el("span", "suave", `${quando(p)} · tema ${t.nome}`));
      const ed = el("button", "botao fantasma", "Editar"), rm = el("button", "botao fantasma", "Remover");
      ed.type = rm.type = "button"; ed.dataset.i = rm.dataset.i = i;
      ed.setAttribute("aria-label", `Editar ${p.nome}`); rm.setAttribute("aria-label", `Remover ${p.nome}`);
      ed.addEventListener("click", () => abrirForm(i));
      rm.addEventListener("click", () => { edicao.proprias.splice(i, 1); mostrarDatas("datas-nova"); aviso("datas-aviso", `${p.nome} saiu da lista. Clique em Salvar datas para valer.`); });
      acoes.append(ed, rm);
      const dia = proximoDia(p);
      if (dia && !sujo && i < salvo.proprias.length) acoes.append(verNoMapa(dia, p.nome));   // só a salva já vale no mapa
      li.append(cores(t), txt, acoes); return li;
    }));
    $("datas-nova").disabled = edicao.proprias.length >= MAX_DATAS;
    // do calendário: as 13, ligadas ou não, com o dia deste ano
    const y = anoHoje(), dias = new Map(Festas.embutidas(y).map(f => [f.chave, f.data]));
    const desl = new Set(edicao.desligadas);
    $("datas-embutidas").replaceChildren(...Festas.temas().filter(t => t.chave !== "generico").map(t => {
      const li = el("li"), rot = el("label", "marcar"), cx = el("input"), iso = dias.get(t.chave);
      cx.type = "checkbox"; cx.checked = !desl.has(t.chave); cx.id = `d-emb-${t.chave}`;
      cx.addEventListener("change", () => {
        edicao.desligadas = cx.checked ? edicao.desligadas.filter(k => k !== t.chave) : [...edicao.desligadas, t.chave];
        mostrarDatas(cx.id);
      });
      const nome = el("span", null, t.nome);
      rot.append(cx, nome, el("span", "suave", iso ? ` · ${iso.slice(8)}/${iso.slice(5, 7)}` : ` · sem data em ${y}`));
      li.append(cores(t), rot);
      if (iso && !sujo && !desl.has(t.chave)) li.append(verNoMapa(iso, t.nome));
      return li;
    }));
    $("datas-salvar").disabled = $("datas-desfazer").disabled = !sujo;
    const a = $("datas-aviso").textContent;
    if (sujo && !a) aviso("datas-aviso", PENDENTE);
    else if (!sujo && a === PENDENTE) aviso("datas-aviso", "");
    if (focoEm && $(focoEm)) $(focoEm).focus();
  }

  // formulário de uma data (nova ou editando)
  function mostrarTema() {
    const t = temaPorChave($("d-tema").value), c = $("d-chapeu"), g = c.getContext("2d");
    $("d-cores").replaceWith(Object.assign(cores(t), { id: "d-cores" }));
    $("d-tema-desc").textContent = `${t.chapeu ? `Chapéu: ${CHAPEUS[t.chapeu] || t.chapeu}` : "Sem chapéu"}. Fala do tema: “${t.falas[0] || ""}”`;
    $("d-fala-0").placeholder = t.falas[0] || ""; $("d-fala-1").placeholder = t.falas[1] || ""; $("d-fala-2").placeholder = t.falas[2] || "";
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false; g.setTransform(3, 0, 0, 3, 0, 0);
    if (window.Avatar) g.drawImage(Avatar.desenhar(Avatar.padrao("festa")), 0, 4);   // o mesmo boneco de sempre, com o chapéu do tema
    if (window.Efeitos) Efeitos.chapeu(g, null, 0, 4, t);
  }
  function abrirForm(i) {
    editando = i;
    const p = i >= 0 ? edicao.proprias[i] : { nome: "", data: "", dias: 1, tema: "generico", falas: [] }, u = UNICA.exec(p.data), a = ANUAL.exec(p.data);
    $("t-form-data").textContent = i >= 0 ? `Editar ${p.nome}` : "Nova data";
    $("d-pronto").textContent = i >= 0 ? "Atualizar na lista" : "Pôr na lista";
    $("d-nome").value = p.nome;
    document.querySelector(`input[name="d-repete"][value="${u ? "unica" : "anual"}"]`).checked = true;
    $("d-data").value = u ? p.data : a ? `${a[1] === "02" && a[2] === "29" ? 2028 : anoHoje()}-${a[1]}-${a[2]}` : "";
    $("d-dias").value = p.dias || 1;
    $("d-tema").value = temaPorChave(p.tema).chave;
    for (let k = 0; k < 3; k++) $(`d-fala-${k}`).value = p.falas[k] || "";
    aviso("d-erro", ""); $("d-erro").className = "aviso-form ruim";
    $("form-data").hidden = false; $("datas-nova").setAttribute("aria-expanded", "true");
    mostrarTema(); $("d-nome").focus();
  }
  function fecharForm(foco) {
    $("form-data").hidden = true; $("datas-nova").setAttribute("aria-expanded", "false");
    const bt = foco != null && document.querySelector(`#datas-proprias button[data-i="${foco}"]`);
    (bt || $("datas-nova")).focus();
  }
  function lerForm() {   // as mesmas regras do servidor (POST /api/festas), para o erro aparecer antes de salvar
    const erro = (msg, campo) => { $("d-erro").textContent = msg; $(campo).focus(); return null; };
    const nome = $("d-nome").value.trim();
    if (!nome || nome.length > 40) return erro("Dê um nome de até 40 caracteres.", "d-nome");
    const v = /^(\d{4})-(\d{2})-(\d{2})$/.exec($("d-data").value), unica = document.querySelector('input[name="d-repete"]:checked').value === "unica";
    if (!v || !existe(+v[1], +v[2], +v[3])) return erro("Escolha o dia em que a data começa.", "d-data");
    if (unica && (+v[1] < 2000 || +v[1] > 2100)) return erro("Para uma vez só, o ano vai de 2000 a 2100.", "d-data");
    const dias = Number($("d-dias").value);
    if (!Number.isInteger(dias) || dias < 1 || dias > 14) return erro("A data dura de 1 a 14 dias.", "d-dias");
    const falas = [0, 1, 2].map(k => $(`d-fala-${k}`).value.trim()).filter(Boolean);
    if (falas.some(f => f.length > 80)) return erro("Cada fala tem até 80 caracteres.", "d-fala-0");
    const repetido = edicao.proprias.some((p, i) => i !== editando && p.nome.toLowerCase() === nome.toLowerCase());
    if (repetido) return erro("Já existe uma data com esse nome.", "d-nome");
    return { nome, data: unica ? v[0] : `${v[2]}-${v[3]}`, dias, tema: $("d-tema").value, falas };
  }
  $("d-tema").addEventListener("change", mostrarTema);
  $("datas-nova").addEventListener("click", () => abrirForm(-1));
  $("d-cancelar").addEventListener("click", () => fecharForm(editando >= 0 ? editando : null));
  $("form-data").addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.preventDefault(); fecharForm(editando >= 0 ? editando : null); } });
  $("form-data").addEventListener("submit", ev => {
    ev.preventDefault();
    const p = lerForm(); if (!p) return;
    const i = editando >= 0 ? editando : edicao.proprias.length;
    if (editando >= 0) edicao.proprias[editando] = p; else edicao.proprias.push(p);
    aviso("datas-aviso", `${p.nome} está na lista. Clique em Salvar datas para valer.`);
    mostrarDatas(); fecharForm(i);
  });
  $("datas-desfazer").addEventListener("click", () => { edicao = copia(salvo); aviso("datas-aviso", "Mudanças desfeitas."); $("form-data").hidden = true; mostrarDatas("datas-nova"); });
  $("datas-salvar").addEventListener("click", async () => {
    const bt = $("datas-salvar"); bt.disabled = true; aviso("datas-aviso", "Salvando…");
    try {
      await pedir("api/festas", { rev: edicao.rev, proprias: edicao.proprias, desligadas: edicao.desligadas }, true);
      aviso("datas-aviso", "Salvo. Recarregando para o mapa usar as datas novas…", "ok");
      location.reload();
    } catch (e) {
      aviso("datas-aviso", e.status === 409 ? "Não salvou: as datas mudaram em outra aba. Recarregue a página para ver a versão nova (as mudanças daqui se perdem)." : `Não salvou: ${e.message}`, "ruim");
      bt.disabled = false;
    }
  });

  // ---------- times e aparência (POST /api/equipe) -------------------------------------------
  // os conjuntos fechados do servidor; o nome do time segue o ROTULO_OK (o servidor confere de novo)
  const TIPOS = [["mesas", "Mesas"], ["ops", "Ops (servidores)"], ["gabinete", "Gabinete"]];   // o que cada um tem: a ajuda do cartão
  const ICONES = [["pessoas", "Pessoas"], ["codigo", "Código"], ["megafone", "Megafone"], ["servidor", "Servidor"], ["coroa", "Coroa"], ["sino", "Sino"],
    ["controle", "Controle"], ["xicara", "Xícara"], ["grafico", "Gráfico"], ["pincel", "Pincel"], ["estrela", "Estrela"]];
  const CORES_AV = Avatar.OPCOES.cores, OLHOS = Avatar.OPCOES.olhos, ACESSORIOS = Avatar.OPCOES.acessorios;   // as mesmas listas do convite e do perfil
  const CORES_TIME = ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#e8587a", "#14b8a6", "#f5b83d", "#64748b"];
  const NOME_TIME = /^[\p{L}\p{N}_ .'&\-]{1,40}$/u, MAX_TIMES = 12, MAX_POR_TIME = 24;
  const PENDENTE_EQ = "Há mudanças que ainda não valem: clique em Salvar times.";
  // nome de time sem caixa, perto do casefold() do servidor: maiúscula e depois minúscula leva ß a ss, e o sigma final vira σ
  const semCaixa = n => n.toUpperCase().toLowerCase().replace(/ς/g, "σ");
  let eqSalvo = null, eq = null, renomeOk = false, agentesVistos = false;
  const mudouEq = () => JSON.stringify(eq) !== JSON.stringify(eqSalvo);
  // aparência por handle num objeto sem protótipo: gravar ou apagar eq.aparencia["__proto__"] mexe só na chave, nunca no protótipo
  const semProto = o => Object.assign(Object.create(null), o);
  const copiaEq = x => { const c = copia(x); c.aparencia = semProto(c.aparencia); return c; };
  // os agentes saem da última leitura (estado.agentes, do app.js); handle do arquivo que não veio fica "não visto agora"
  const lidos = () => (typeof estado !== "undefined" && estado && Array.isArray(estado.agentes) ? estado.agentes : null);
  function opcoes(sel, lista, valor) { sel.replaceChildren(...lista.map(([v, t]) => Object.assign(el("option", null, t), { value: v }))); sel.value = valor; }
  function boneco(ap) {
    const c = el("canvas", "boneco"); c.width = c.height = 44; c.setAttribute("aria-hidden", "true");
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(Avatar.desenhar(ap), 0, 0, 44, 44);
    return c;
  }
  function campo(rotulo, controle, id) { const d = el("div", "campo"), l = el("label", null, rotulo); l.htmlFor = controle.id = id; d.append(l, controle); return d; }

  function mostrarTimes(focoEm) {
    $("equipe-sem-times").hidden = eq.times.length > 0;
    $("equipe-times").replaceChildren(...eq.times.map((t, i) => {
      const li = el("li", "time-linha"), nome = el("input"), tipo = el("select"), cor = el("input"), icone = el("select"), rm = el("button", "botao fantasma", "Remover");
      nome.maxLength = 40; nome.autocomplete = "off"; nome.value = t.nome; nome.required = true;
      cor.type = "color"; cor.value = t.cor;
      opcoes(tipo, TIPOS, t.tipo); opcoes(icone, ICONES, t.icone);
      rm.type = "button"; rm.setAttribute("aria-label", `Remover o time ${t.nome || i + 1}`);
      nome.addEventListener("input", () => {   // a lista de agentes (opções de time) acompanha; esta linha não é refeita, para o foco ficar
        t.nome = nome.value.trim(); renomeOk = false; rm.setAttribute("aria-label", `Remover o time ${t.nome || i + 1}`); mostrarAgentes(); estadoEq();
      });
      tipo.addEventListener("change", () => { t.tipo = tipo.value; estadoEq(); });
      cor.addEventListener("input", () => { t.cor = cor.value; estadoEq(); });
      icone.addEventListener("change", () => { t.icone = icone.value; estadoEq(); });
      rm.addEventListener("click", () => {
        eq.times.splice(i, 1); renomeOk = false; mostrarTimes(); mostrarAgentes();
        estadoEq(`O time ${t.nome || i + 1} saiu da lista; os agentes dele vão para a sala “Novos”.`);
        $(eq.times.length ? `eq-t${Math.min(i, eq.times.length - 1)}-nome` : "equipe-novo").focus();
      });
      const n = t.agentes.length, num = el("span", "time-n", `${i + 1}`);
      num.setAttribute("aria-hidden", "true");
      li.append(num, campo("Nome", nome, `eq-t${i}-nome`), campo("Tipo de sala", tipo, `eq-t${i}-tipo`), campo("Cor", cor, `eq-t${i}-cor`),
        campo("Ícone da placa", icone, `eq-t${i}-icone`), el("span", "suave time-qtd", `${n} ${n === 1 ? "agente" : "agentes"}`), rm);
      return li;
    }));
    $("equipe-novo").disabled = eq.times.length >= MAX_TIMES;
    if (focoEm && $(focoEm)) $(focoEm).focus();
  }

  function mostrarAgentes() {
    const ag = lidos(), lista = $("equipe-agentes");
    if (!ag) { lista.replaceChildren(el("li", "suave", "Esperando a primeira leitura do agentes.chat para listar os agentes…")); return; }
    agentesVistos = true;
    const vistos = new Set(), linhas = [];
    for (const a of ag) if (typeof a.handle === "string" && a.handle && !vistos.has(a.handle)) {
      vistos.add(a.handle); linhas.push({ handle: a.handle, nome: typeof a.nome === "string" && a.nome ? a.nome : a.handle, visto: true });
    }
    for (const t of eq.times) for (const h of t.agentes) if (!vistos.has(h)) { vistos.add(h); linhas.push({ handle: h, nome: h, visto: false }); }
    if (!linhas.length) { lista.replaceChildren(el("li", "suave", "Nenhum agente na última leitura.")); return; }
    const opcTimes = [["", "Novos (sem time)"], ...eq.times.map((t, i) => [String(i), t.nome || `Time ${i + 1}`])];
    lista.replaceChildren(...linhas.map(a => {
      const li = el("li", "agente-linha"), txt = el("div", "agente-txt"), sel = el("select"), id = `eq-a-${a.handle}`;
      const i = eq.times.findIndex(t => t.agentes.includes(a.handle));
      const temAp = () => Object.hasOwn(eq.aparencia, a.handle);   // handle do servidor: "constructor" ou "__proto__" não podem achar o protótipo
      const atual = () => (temAp() ? eq.aparencia[a.handle] : Avatar.padrao(a.handle));
      let fig = boneco(atual());
      txt.append(el("strong", null, a.nome), el("span", "suave", `@${a.handle}`));
      if (!a.visto) txt.append(el("span", "selo-nao-visto", "não visto agora"));
      opcoes(sel, opcTimes, i < 0 ? "" : String(i));
      sel.addEventListener("change", () => {
        const novo = sel.value === "" ? -1 : +sel.value;
        if (novo >= 0 && eq.times[novo].agentes.length >= MAX_POR_TIME) {
          sel.value = i < 0 ? "" : String(i); estadoEq(`O time ${eq.times[novo].nome} já tem ${MAX_POR_TIME} agentes.`, "ruim"); return;
        }
        for (const t of eq.times) t.agentes = t.agentes.filter(h => h !== a.handle);
        if (novo >= 0) eq.times[novo].agentes.push(a.handle);
        mostrarTimes(); estadoEq();
      });
      // aparência: automática (sem entrada no arquivo) ou escolhida, com a prévia do boneco
      const det = el("details", "aparencia"), auto = el("input"), rotAuto = el("label", "marcar");
      const cor = el("select"), olhos = el("select"), acess = el("select"), escolhas = el("div", "aparencia-campos");
      auto.type = "checkbox"; auto.checked = !temAp(); auto.id = `${id}-auto`;
      rotAuto.htmlFor = auto.id; rotAuto.append(auto, el("span", null, "Automática"));
      // defesa: se a aparência não estiver nas listas, o select cai num valor que o servidor aceita
      const daLista = (lista, x, reserva) => (lista.some(([k]) => k === x) ? x : reserva);
      opcoes(cor, CORES_AV, atual().color); opcoes(olhos, OLHOS, daLista(OLHOS, atual().eyes, "happy")); opcoes(acess, ACESSORIOS, daLista(ACESSORIOS, atual().accessory, ""));
      const escolher = () => { auto.checked = false; eq.aparencia[a.handle] = { color: cor.value, eyes: olhos.value, accessory: acess.value }; };
      const redesenhar = () => { const n = boneco(atual()); fig.replaceWith(n); fig = n; escolhas.hidden = auto.checked; estadoEq(); };
      auto.addEventListener("change", () => { if (auto.checked) delete eq.aparencia[a.handle]; else escolher(); redesenhar(); });
      for (const s2 of [cor, olhos, acess]) s2.addEventListener("change", () => { escolher(); redesenhar(); });
      escolhas.append(campo("Cor", cor, `${id}-cor`), campo("Olhos", olhos, `${id}-olhos`), campo("Acessório", acess, `${id}-acess`));
      escolhas.hidden = auto.checked;
      det.append(Object.assign(el("summary", null, "Aparência"), { title: `Aparência de ${a.nome}` }), rotAuto, escolhas);
      li.append(fig, txt, campo("Time", sel, `${id}-time`), det);
      return li;
    }));
  }

  // o que impede salvar, com a posição (as mesmas regras do servidor, que confere de novo)
  function erroEq() {
    const nomes = new Set();
    for (const [i, t] of eq.times.entries()) {
      if (!NOME_TIME.test(t.nome)) return [`Time ${i + 1}: dê um nome de até 40 caracteres, só com letras, números, espaço e . ' & -`, `eq-t${i}-nome`];
      if (nomes.has(semCaixa(t.nome))) return [`Time ${i + 1}: já existe um time com esse nome.`, `eq-t${i}-nome`];
      nomes.add(semCaixa(t.nome));
    }
    return null;
  }
  // renomear um time tira da sala dele a pintura e os móveis ajustados (a planta guarda por "time:<nome>")
  const renomeados = () => eq.times.filter(t => t.de && t.de !== t.nome).map(t => `${t.de} → ${t.nome}`);
  function estadoEq(msg, tipo) {
    const sujo = mudouEq();
    $("equipe-salvar").disabled = $("equipe-desfazer").disabled = !sujo;
    $("equipe-salvar").textContent = renomeOk ? "Salvar mesmo assim" : "Salvar times";
    if (msg) aviso("equipe-aviso", msg, tipo);
    else if (sujo && !$("equipe-aviso").textContent) aviso("equipe-aviso", PENDENTE_EQ);
    else if (!sujo && $("equipe-aviso").textContent === PENDENTE_EQ) aviso("equipe-aviso", "");
  }
  function mostrarOrigemEq(origem) {
    $("equipe-origem").textContent = origem === "tela" ? "Valem os times desta tela; o times.json fica guardado, sem valer." : "Valem os times do times.json do servidor.";
    $("equipe-arquivo").hidden = origem !== "tela";
  }
  $("equipe-novo").addEventListener("click", () => {
    const usadas = new Set(eq.times.map(t => t.cor));
    eq.times.push({ nome: "", tipo: "mesas", cor: CORES_TIME.find(c => !usadas.has(c)) || CORES_TIME[0], icone: "pessoas", parede: 0, piso: 0, agentes: [] });
    mostrarTimes(`eq-t${eq.times.length - 1}-nome`); mostrarAgentes(); estadoEq();
  });
  $("equipe-desfazer").addEventListener("click", () => { eq = copiaEq(eqSalvo); renomeOk = false; mostrarTimes("equipe-novo"); mostrarAgentes(); estadoEq("Mudanças desfeitas."); });
  // ---------- puxar os setores do agentes.chat ----------------------------------------------
  // copia para esta tela os setores (nome, cor, ícone) e a aparência de cada agente, da última leitura; nada vale antes do Salvar
  const ICONE_SETOR = { shield: "coroa", code: "codigo", pullRequest: "codigo", wallet: "grafico", chart: "grafico", mail: "megafone",
    globe: "megafone", message: "pessoas", person: "pessoas", bolt: "servidor", plug: "servidor", eye: "servidor", flag: "estrela",
    bulb: "estrela", book: "pincel", calendar: "sino" };
  // o nome do setor no formato dos times (letras, números, espaço e . ' & -, até 40)
  const nomeDoSetor = n => n.replace(/[^\p{L}\p{N}_ .'&\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  function puxarSetores() {
    const ag = lidos();
    if (!ag) { aviso("equipe-aviso", "Esperando a primeira leitura do agentes.chat. Tente de novo em alguns segundos.", "ruim"); return; }
    if (!ag.some(a => Object.hasOwn(a, "setor"))) {
      aviso("equipe-aviso", "O seu agentes.chat ainda não manda os setores. Atualize-o para a versão em que o list_agents traz o setor de cada agente.", "ruim");
      return;
    }
    const setores = new Map();   // nome -> {setor, handles}, na ordem dos setores do agentes.chat
    for (const a of [...ag].filter(x => x.setor && typeof x.handle === "string").sort((x, y) => x.setor.ordem - y.setor.ordem)) {
      const nome = nomeDoSetor(a.setor.nome) || `Setor ${a.setor.ordem + 1}`, chave = semCaixa(nome);
      if (!setores.has(chave)) setores.set(chave, { nome, setor: a.setor, handles: [] });
      setores.get(chave).handles.push(a.handle);
    }
    if (!setores.size) { aviso("equipe-aviso", "Nenhum agente está em um setor no agentes.chat. Crie os setores lá e tente de novo.", "ruim"); return; }
    const antes = new Map(eq.times.map(t => [semCaixa(t.nome), t]));   // time de mesmo nome guarda o tipo, a cor sem setor, a parede e o piso
    const cabem = [...setores.values()].slice(0, MAX_TIMES);
    const semVaga = cabem.reduce((n, s) => n + Math.max(0, s.handles.length - MAX_POR_TIME), 0);
    eq.times = cabem.map(({ nome, setor, handles }, i) => {
      const t = antes.get(semCaixa(nome));
      return { nome, tipo: t ? t.tipo : "mesas", cor: setor.cor ? Avatar.CORES[setor.cor].base : t ? t.cor : CORES_TIME[i % CORES_TIME.length],
        icone: ICONE_SETOR[setor.icone] || "pessoas", parede: t ? t.parede : i % 6, piso: t ? t.piso : i % 10,
        agentes: handles.slice(0, MAX_POR_TIME), de: t ? t.de : undefined };
    });
    let looks = 0;
    for (const a of ag) if (a.aparencia && typeof a.handle === "string") { eq.aparencia[a.handle] = { ...a.aparencia }; looks++; }
    renomeOk = false; mostrarTimes(); mostrarAgentes();
    const fora = (setores.size > MAX_TIMES ? ` Só cabem ${MAX_TIMES} times: os setores depois do ${MAX_TIMES}º ficaram de fora.` : "") +
      (semVaga ? ` Cada time leva até ${MAX_POR_TIME} agentes: ${semVaga} ${semVaga === 1 ? "ficou" : "ficaram"} de fora, na sala “Novos”.` : "");
    estadoEq(`${eq.times.length} ${eq.times.length === 1 ? "time copiado" : "times copiados"} dos setores` +
      (looks ? `, com a aparência de ${looks} ${looks === 1 ? "agente" : "agentes"}` : "") + `. Confira e clique em Salvar times.${fora}`, "ok");
  }
  $("equipe-puxar").addEventListener("click", puxarSetores);
  async function salvarEq(corpo, botao) {
    botao.disabled = true; aviso("equipe-aviso", "Salvando…");
    try {
      await pedir("api/equipe", corpo);
      aviso("equipe-aviso", "Salvo. Recarregando para refazer o prédio…", "ok");
      location.reload();
    } catch (e) {
      aviso("equipe-aviso", e.status === 409 ? "Não salvou: os times mudaram em outra aba. Recarregue a página para ver a versão nova (as mudanças daqui se perdem)." : `Não salvou: ${e.message}`, "ruim");
      botao.disabled = false;
    }
  }
  $("equipe-salvar").addEventListener("click", () => {
    const erro = erroEq();
    if (erro) { aviso("equipe-aviso", erro[0], "ruim"); $(erro[1]).focus(); return; }
    const ren = renomeados();
    if (ren.length && !renomeOk) {
      renomeOk = true;
      estadoEq(`Renomear (${ren.join("; ")}) tira da sala a pintura e os móveis ajustados no Modo construção. Clique de novo para salvar mesmo assim.`, "ruim");
      return;
    }
    // parede e piso voltam como vieram (a pintura é do Modo construção); "de" (o nome salvo) é só desta tela
    const times = eq.times.map(({ nome, tipo, cor, icone, parede, piso, agentes }) => ({ nome, tipo, cor, icone, parede, piso, agentes }));
    salvarEq({ rev: eq.rev, times, aparencia: eq.aparencia }, $("equipe-salvar"));
  });
  $("equipe-arquivo").addEventListener("click", () => salvarEq({ rev: eq.rev, limpar: true }, $("equipe-arquivo")));

  // ---------- andares (GET e POST /api/andares; só admin) -----------------------------------
  // Cada andar é um workspace do agentes.chat. Criar e remover levam a senha da conta no corpo (o servidor confere no mesmo
  // balde do login); renomear não pede. O campo da senha é limpo logo depois de ler. Nome e rótulos só por textContent.
  const ORG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let andaresExtras = [];
  const nomeAndarOk = n => n.length >= 1 && n.length <= 40 && !/[\u0000-\u001f\u007f]/.test(n);
  async function pedirAndares(corpo) { return pedir("api/andares", corpo, true); }
  const erroAndar = e => (e.codigo === "senha_incorreta" || e.codigo === "tentativas_demais" || e.status === 400 ? e.message : `Não deu certo: ${e.message}`);
  async function depoisDosAndares() {   // o seletor do topo e a lista daqui acompanham o servidor
    await lerAndares();
    if (typeof recarregarAndares === "function") await recarregarAndares();
  }
  function linhaAndar(a) {
    const li = el("li", "andar-linha"), topo = el("div", "andar-topo"), info = el("div", "andar-info");
    info.append(el("strong", null, a.nome), el("span", "andar-org", a.org || ""),
      Object.assign(el("span", "andar-conexao", Andar.rotuloConexao(a.conexao)), { title: "Estado da conexão deste andar" }));
    const conectar = el("a", "botao secundario", a.conexao === "conectado" ? "Reconectar" : "Conectar");
    conectar.href = `/oauth/conectar?andar=${encodeURIComponent(a.id)}`;
    conectar.setAttribute("aria-label", `${conectar.textContent} o andar ${a.nome} ao agentes.chat`);
    const ren = el("button", "botao fantasma", "Renomear"), rm = el("button", "botao fantasma", "Remover");
    ren.type = rm.type = "button";
    ren.setAttribute("aria-label", `Renomear o andar ${a.nome}`); rm.setAttribute("aria-label", `Remover o andar ${a.nome}`);
    const acoes = el("div", "andar-acoes"); acoes.append(conectar, ren, rm);
    topo.append(info, acoes);
    const painel = el("div", "andar-painel"); painel.hidden = true;
    li.append(topo, painel);
    ren.addEventListener("click", () => formRenomear(a, painel, ren));
    rm.addEventListener("click", () => formRemover(a, painel, rm));
    return li;
  }
  function abrirPainel(painel, botao, montar) {   // um painel por vez na linha; clicar de novo fecha
    const abrir = painel.hidden || painel.dataset.de !== botao.textContent;
    painel.replaceChildren(); painel.hidden = !abrir; painel.dataset.de = botao.textContent;
    if (abrir) montar();
    return abrir;
  }
  function formRenomear(a, painel, botao) {
    abrirPainel(painel, botao, () => {
      const f = el("form", "andar-form"), campo = el("input"), ok = el("button", "botao", "Salvar nome"), nao = el("button", "botao fantasma", "Cancelar"), av = el("p", "aviso-form");
      campo.maxLength = 40; campo.value = a.nome; campo.autocomplete = "off"; campo.required = true; campo.setAttribute("aria-label", `Novo nome do andar ${a.nome}`);
      ok.type = "submit"; nao.type = "button"; av.setAttribute("role", "status");
      f.append(campo, el("div", "acoes"), av); f.querySelector(".acoes").append(ok, nao);
      nao.addEventListener("click", () => { painel.hidden = true; painel.replaceChildren(); botao.focus(); });
      f.addEventListener("submit", async ev => {
        ev.preventDefault();
        const nome = campo.value.trim();
        if (!nomeAndarOk(nome)) { av.textContent = "Dê um nome de 1 a 40 caracteres."; av.className = "aviso-form ruim"; campo.focus(); return; }
        ok.disabled = true; av.textContent = "Salvando…"; av.className = "aviso-form";
        try { await pedirAndares({ acao: "renomear", id: a.id, nome }); await depoisDosAndares(); aviso("andares-aviso-lista", `Andar renomeado para ${nome}.`, "ok"); }
        catch (e) { av.textContent = erroAndar(e); av.className = "aviso-form ruim"; ok.disabled = false; campo.focus(); }
      });
      painel.append(f); campo.focus(); campo.select();
    });
  }
  function formRemover(a, painel, botao) {
    abrirPainel(painel, botao, () => {
      const f = el("form", "andar-form"), senha = el("input"), ok = el("button", "botao perigo", "Remover o andar"), nao = el("button", "botao fantasma", "Cancelar"), av = el("p", "aviso-form");
      f.append(el("p", "ajuda", `Remover o andar “${a.nome}”? Ele é desconectado e sai da lista; a pasta de dados dele continua no servidor. Digite a sua senha para confirmar.`));
      senha.type = "password"; senha.autocomplete = "current-password"; senha.maxLength = 256; senha.required = true; senha.setAttribute("aria-label", "Sua senha");
      ok.type = "submit"; nao.type = "button"; av.setAttribute("role", "status");
      const acoes = el("div", "acoes"); acoes.append(ok, nao);
      f.append(senha, acoes, av);
      nao.addEventListener("click", () => { senha.value = ""; painel.hidden = true; painel.replaceChildren(); botao.focus(); });
      f.addEventListener("submit", async ev => {
        ev.preventDefault();
        const valor = senha.value; senha.value = "";
        if (!valor) { av.textContent = "Digite a sua senha."; av.className = "aviso-form ruim"; senha.focus(); return; }
        ok.disabled = true; av.textContent = "Removendo…"; av.className = "aviso-form";
        try {
          await pedirAndares({ acao: "remover", id: a.id, senha: valor });
          if (Andar.atual === a.id && typeof trocarAndar === "function") await trocarAndar(Andar.PRINCIPAL);   // estava neste andar: volta para o principal
          await depoisDosAndares();
          aviso("andares-aviso-lista", `Andar ${a.nome} removido.`, "ok");
        } catch (e) { av.textContent = erroAndar(e); av.className = "aviso-form ruim"; ok.disabled = false; senha.focus(); }
      });
      painel.append(f); senha.focus();
    });
  }
  function mostrarAndares() {
    $("andares-vazio").hidden = andaresExtras.length > 0;
    $("andares-lista").replaceChildren(...andaresExtras.map(linhaAndar));
    const cheio = andaresExtras.length >= MAX_ANDARES;
    $("form-andar").hidden = cheio;
    $("andares-cheio").hidden = !cheio;
  }
  async function lerAndares() {   // não admin (403/404) ou prévia: a seção continua escondida
    if (demo()) return;
    try {
      const d = await pedirAndares();
      andaresExtras = (Array.isArray(d.andares) ? d.andares : []).filter(a => a && Andar.valido(a.id) && a.id !== Andar.PRINCIPAL && typeof a.nome === "string")
        .map(a => ({ id: a.id, nome: a.nome, org: typeof a.org === "string" ? a.org : "", conexao: typeof a.conexao === "string" ? a.conexao : "" }));
      $("a-andares").hidden = false;
      mostrarAndares();
    } catch (e) { if (e.status === 401) return; $("a-andares").hidden = true; }
  }
  $("form-andar").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nome = $("an-nome").value.trim(), org = $("an-org").value.trim().toLowerCase(), senha = $("an-senha").value, bt = $("an-criar");
    $("an-senha").value = "";
    const erro = !nomeAndarOk(nome) ? ["Dê um nome de 1 a 40 caracteres.", "an-nome"] : !ORG_UUID.test(org) ? ["O código do workspace é um uuid, como 3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c.", "an-org"]
      : !senha ? ["Digite a sua senha.", "an-senha"] : null;
    if (erro) { aviso("an-aviso", erro[0], "ruim"); $(erro[1]).focus(); return; }
    bt.disabled = true; aviso("an-aviso", "Criando o andar…");
    try {
      const d = await pedirAndares({ acao: "criar", nome, org, senha });
      $("an-nome").value = $("an-org").value = "";
      await depoisDosAndares();
      const novo = d && d.andar && Andar.valido(d.andar.id) ? d.andar.id : "";
      aviso("an-aviso", `Andar ${nome} criado. Use “Conectar” na lista para ligar ele ao agentes.chat.`, "ok");
      if (novo) { const bt2 = document.querySelector(`#andares-lista a[href$="andar=${novo}"]`); if (bt2) bt2.focus(); }
    } catch (e) {
      aviso("an-aviso", erroAndar(e), "ruim");
      $(e.codigo === "senha_incorreta" || e.codigo === "tentativas_demais" ? "an-senha" : "an-nome").focus();
    } finally { bt.disabled = false; }
  });

  // ---------- membros (GET e POST /api/membros; só admin) -------------------------------------
  // Contas da equipe e convites pendentes. Convidar, mudar papel ou andares e remover levam a senha da conta no corpo (como criar e remover andar).
  // O link do convite só aparece uma vez, no #cv-link, e não é guardado em lugar nenhum. Mensagens do servidor, só por textContent.
  let contas = [], convites = [], euUsuario = "", lerCaixasConvite = () => [Andar.PRINCIPAL];
  const pedirMembros = corpo => pedir("api/membros", corpo, true);
  const erroMembro = e => ([400, 403, 409, 429].includes(e.status) ? e.message : `Não deu certo: ${e.message}`);
  const andaresDoPredio = () => {   // principal primeiro, depois os extras do /api/config
    const todos = cfg && Array.isArray(cfg.andares) ? cfg.andares.filter(a => a && Andar.valido(a.id) && typeof a.nome === "string") : [];
    const p = todos.find(a => a.id === Andar.PRINCIPAL);
    return [{ id: Andar.PRINCIPAL, nome: p ? p.nome : "Andar principal" }, ...todos.filter(a => a.id !== Andar.PRINCIPAL).map(a => ({ id: a.id, nome: a.nome }))];
  };
  const nomeDoAndar = id => (andaresDoPredio().find(a => a.id === id) || { nome: id }).nome;
  const dataConvite = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
  // caixas de marcar dos andares: o principal vai sempre (marcado e desabilitado); devolve a função que lê as marcadas
  function caixasAndares(raiz, marcados, prefixo) {
    raiz.replaceChildren();
    const caixas = andaresDoPredio().map(a => {
      const l = el("label", "marcar"), i = el("input"), principal = a.id === Andar.PRINCIPAL;
      i.type = "checkbox"; i.value = a.id; i.id = `${prefixo}-${a.id}`; i.checked = principal || marcados.includes(a.id); i.disabled = principal;
      l.htmlFor = i.id; l.append(i, el("span", null, principal ? `${a.nome} (sempre)` : a.nome)); raiz.append(l);
      return i;
    });
    return () => caixas.filter(i => i.checked).map(i => i.value);
  }
  // pede confirmação dentro da linha (com a senha, se o servidor a exige); `enviar(senha)` lança em caso de erro
  function painelConfirmar(painel, voltar, o) {
    const f = el("form", "andar-form"), ok = el("button", o.perigo === false ? "botao" : "botao perigo", o.rotulo), nao = el("button", "botao fantasma", "Cancelar"), av = el("p", "aviso-form"), acoes = el("div", "acoes");
    ok.type = "submit"; nao.type = "button"; av.setAttribute("role", "status");
    f.append(el("p", "ajuda", o.texto));
    let campo = null;
    if (o.senha) {
      campo = el("input"); campo.type = "password"; campo.autocomplete = "current-password"; campo.maxLength = 256; campo.required = true; campo.setAttribute("aria-label", "Sua senha");
      f.append(campo);
    }
    acoes.append(ok, nao); f.append(acoes, av);
    nao.addEventListener("click", () => { if (campo) campo.value = ""; painel.hidden = true; painel.replaceChildren(); voltar(); });
    f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const valor = campo ? campo.value : ""; if (campo) campo.value = "";
      if (campo && !valor) { av.textContent = "Digite a sua senha."; av.className = "aviso-form ruim"; campo.focus(); return; }
      ok.disabled = true; av.textContent = "Enviando…"; av.className = "aviso-form";
      try { await o.enviar(valor); }
      catch (e) { av.textContent = erroMembro(e); av.className = "aviso-form ruim"; ok.disabled = false; (campo || ok).focus(); }
    });
    painel.replaceChildren(f); painel.hidden = false; (campo || ok).focus();
  }
  function linhaMembro(c, i) {
    const eu = c.usuario === euUsuario, li = el("li", "andar-linha"), topo = el("div", "andar-topo"), info = el("div", "andar-info");
    const quem = c.nome || c.usuario;
    info.append(el("strong", null, quem), el("span", "membro-usuario", eu ? `${c.usuario} · você` : c.usuario),
      el("span", "andar-conexao", c.papel === "admin" ? "Vê todos os andares" : `Andares: ${c.andares.map(nomeDoAndar).join(", ")}`));
    const papel = el("div", "membro-papel"), rot = el("label", null, "Papel"), sel = el("select");
    sel.id = `mb-papel-${i}`; rot.htmlFor = sel.id;
    for (const [k, nome] of [["admin", "Admin"], ["membro", "Membro"]]) sel.append(Object.assign(el("option", null, nome), { value: k }));
    sel.value = c.papel; papel.append(rot, sel);
    const ed = el("button", "botao fantasma", "Andares"), rm = el("button", "botao fantasma", "Remover");
    ed.type = rm.type = "button"; ed.hidden = c.papel !== "membro";
    ed.setAttribute("aria-label", `Editar os andares de ${quem}`); rm.setAttribute("aria-label", `Remover a conta de ${quem}`);
    const acoes = el("div", "andar-acoes"); acoes.append(papel, ed, rm);
    topo.append(info, acoes);
    const painel = el("div", "andar-painel"); painel.hidden = true;
    li.append(topo, painel);
    // mudar o papel pede a senha da conta (o servidor confere); o erro aparece no painel, e Cancelar volta o seletor
    const trocarPapel = async (novo, senha) => {
      await pedirMembros({ acao: "papel", usuario: c.usuario, papel: novo, senha });
      if (eu) { location.reload(); return; }   // mudou o próprio papel: a tela refaz com o que ele pode ver agora
      await lerMembros(); aviso("membros-aviso-lista", `${quem} agora é ${novo === "admin" ? "admin" : "membro"}.`, "ok");
    };
    const fecharPapel = () => { if (painel.dataset.de === "papel") { painel.hidden = true; painel.replaceChildren(); } };
    sel.addEventListener("change", () => {
      const novo = sel.value;
      if (novo === c.papel) { fecharPapel(); return; }
      const rebaixarEu = eu && novo === "membro";   // rebaixar a si mesmo tira esta aba e o resto da administração
      painel.dataset.de = "papel";
      painelConfirmar(painel, () => { sel.value = c.papel; sel.focus(); }, {
        texto: rebaixarEu ? "Rebaixar a sua própria conta? Você deixa de ser admin e perde acesso a Membros, marca e andares. Outro admin precisa devolver o acesso. Digite a sua senha para confirmar."
          : `Mudar ${quem} para ${novo === "admin" ? "admin" : "membro"}? Digite a sua senha para confirmar.`,
        rotulo: rebaixarEu ? "Rebaixar para membro" : "Mudar o papel", senha: true, perigo: rebaixarEu,
        enviar: senha => trocarPapel(novo, senha) });
    });
    for (const b of [ed, rm]) b.addEventListener("click", () => { sel.value = c.papel; });   // outro painel desiste da troca não confirmada
    ed.addEventListener("click", () => abrirPainel(painel, ed, () => {
      const f = el("form", "andar-form"), caixas = el("div", "membro-andares"), ok = el("button", "botao", "Salvar andares"), nao = el("button", "botao fantasma", "Cancelar"), av = el("p", "aviso-form"), ac = el("div", "acoes");
      const ler = caixasAndares(caixas, c.andares, `mb-${i}`);
      ok.type = "submit"; nao.type = "button"; av.setAttribute("role", "status"); ac.append(ok, nao);
      f.append(el("p", "ajuda", `Andares que ${quem} vê. O principal vai sempre.`), caixas, ac, av);
      nao.addEventListener("click", () => { painel.hidden = true; painel.replaceChildren(); ed.focus(); });
      f.addEventListener("submit", ev => {   // a senha vem num segundo passo, no mesmo painel
        ev.preventDefault();
        const escolhidos = ler();
        painelConfirmar(painel, () => ed.focus(), {
          texto: `Salvar os andares de ${quem} (${escolhidos.map(nomeDoAndar).join(", ")})? Digite a sua senha para confirmar.`,
          rotulo: "Salvar andares", senha: true, perigo: false,
          enviar: async senha => {
            await pedirMembros({ acao: "andares", usuario: c.usuario, andares: escolhidos, senha });
            await lerMembros(); aviso("membros-aviso-lista", `Andares de ${quem} salvos.`, "ok");
          } });
      });
      painel.append(f); const primeira = f.querySelector("input:not(:disabled)"); (primeira || ok).focus();
    }));
    rm.addEventListener("click", () => abrirPainel(painel, rm, () => painelConfirmar(painel, () => rm.focus(), {
      texto: eu ? "Remover a sua própria conta? Você sai agora e não entra mais com ela. Digite a sua senha para confirmar."
        : `Remover a conta de ${quem} (${c.usuario})? Ela perde o acesso na hora. Digite a sua senha para confirmar.`,
      rotulo: "Remover a conta", senha: true,
      enviar: async senha => {
        await pedirMembros({ acao: "remover", usuario: c.usuario, senha });
        if (eu) { location.href = "/entrar"; return; }
        await lerMembros(); aviso("membros-aviso-lista", `Conta de ${quem} removida.`, "ok");
      } })));
    return li;
  }
  function linhaConvite(v) {
    const li = el("li", "andar-linha"), topo = el("div", "andar-topo"), info = el("div", "andar-info"), rv = el("button", "botao fantasma", "Revogar");
    const ate = dataConvite(v.expira);
    info.append(el("strong", null, v.nome), el("span", "andar-conexao", `Andares: ${v.andares.map(nomeDoAndar).join(", ")}${ate ? ` · vale até ${ate}` : ""}`));
    rv.type = "button"; rv.setAttribute("aria-label", `Revogar o convite de ${v.nome}`);
    const acoes = el("div", "andar-acoes"); acoes.append(rv); topo.append(info, acoes); li.append(topo);
    rv.addEventListener("click", async () => {
      rv.disabled = true;
      try { await pedirMembros({ acao: "revogar", id: v.id }); await lerMembros(); aviso("membros-aviso-lista", `Convite de ${v.nome} revogado.`, "ok"); const t = $("t-convites"); t.tabIndex = -1; t.focus(); }
      catch (e) { rv.disabled = false; aviso("membros-aviso-lista", erroMembro(e), "ruim"); }
    });
    return li;
  }
  function mostrarMembros() {
    $("membros-vazio").hidden = contas.length > 0;
    $("membros-lista").replaceChildren(...contas.map(linhaMembro));
    $("convites-vazio").hidden = convites.length > 0;
    $("convites-lista").replaceChildren(...convites.map(linhaConvite));
    lerCaixasConvite = caixasAndares($("cv-andares"), lerCaixasConvite(), "cv");   // refaz a lista sem perder o que já estava marcado
  }
  const listaAndares = l => (Array.isArray(l) ? l.filter(Andar.valido) : []);
  async function lerMembros() {   // não admin (403/404) ou prévia: a seção continua escondida
    if (demo()) return;
    try {
      if (!euUsuario) { const p = await pedir("api/perfil", undefined, true).catch(() => ({})); euUsuario = typeof p.usuario === "string" ? p.usuario : ""; }
      const d = await pedirMembros();
      contas = (Array.isArray(d.contas) ? d.contas : []).filter(c => c && typeof c.usuario === "string")
        .map(c => ({ usuario: c.usuario, nome: typeof c.nome === "string" ? c.nome : "", papel: c.papel === "membro" ? "membro" : "admin", andares: listaAndares(c.andares) }));
      convites = (Array.isArray(d.convites) ? d.convites : []).filter(v => v && typeof v.id === "string")
        .map(v => ({ id: v.id, nome: typeof v.nome === "string" ? v.nome : "", andares: listaAndares(v.andares), expira: typeof v.expira === "string" ? v.expira : "" }));
      $("a-membros").hidden = false;
      mostrarMembros();
    } catch (e) { if (e.status === 401) return; $("a-membros").hidden = true; }
  }
  $("form-convite").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nome = $("cv-nome").value.trim(), senha = $("cv-senha").value, bt = $("cv-criar");
    $("cv-senha").value = "";
    const erro = !nomeAndarOk(nome) ? ["Dê um nome de 1 a 40 caracteres.", "cv-nome"] : !senha ? ["Digite a sua senha.", "cv-senha"] : null;
    if (erro) { aviso("cv-aviso", erro[0], "ruim"); $(erro[1]).focus(); return; }
    bt.disabled = true; aviso("cv-aviso", "Gerando o convite…");
    try {
      const d = await pedirMembros({ acao: "convidar", nome, andares: lerCaixasConvite(), senha });
      if (typeof d.link !== "string" || !d.link) throw new Error("O servidor não devolveu o link.");
      $("cv-nome").value = ""; aviso("cv-aviso", "");
      $("cv-link-campo").value = d.link; aviso("cv-link-aviso", ""); $("cv-link").hidden = false;
      await lerMembros();
      $("cv-link-campo").focus(); $("cv-link-campo").select();
    } catch (e) {
      aviso("cv-aviso", erroMembro(e), "ruim");
      $(e.codigo === "senha_incorreta" || e.codigo === "tentativas_demais" ? "cv-senha" : "cv-nome").focus();
    } finally { bt.disabled = false; }
  });
  $("cv-copiar").addEventListener("click", async () => {
    const campo = $("cv-link-campo");
    try { await navigator.clipboard.writeText(campo.value); aviso("cv-link-aviso", "Link copiado.", "ok"); }
    catch (e) { campo.focus(); campo.select(); aviso("cv-link-aviso", "Não deu para copiar sozinho: o link está selecionado, copie com Ctrl+C.", "ruim"); }
  });
  $("cv-link-fechar").addEventListener("click", () => { $("cv-link-campo").value = ""; $("cv-link").hidden = true; $("cv-nome").focus(); });

  // ---------- sair de todos os aparelhos (POST /api/sair-todos) -------------------------------
  // confere a senha no mesmo balde do login (8 erros em 15 min dão 429), zera as sessões e apaga os cookies; a senha não fica no campo
  $("form-sair-todos").addEventListener("submit", async ev => {
    ev.preventDefault();
    const campo = $("st-senha"), bt = $("st-sair"), senha = campo.value;
    if (!senha) { aviso("st-aviso", "Digite a sua senha.", "ruim"); campo.focus(); return; }
    bt.disabled = true; aviso("st-aviso", "Encerrando as sessões…");
    try {
      await pedir("api/sair-todos", { senha }, true);
      campo.value = "";
      aviso("st-aviso", "Pronto: todas as sessões foram encerradas. Indo para a tela de entrar…", "ok");
      location.href = "/entrar";
    } catch (e) {
      campo.value = "";
      aviso("st-aviso", e.status === 403 || e.status === 429 ? e.message : `Não saiu: ${e.message}`, "ruim");   // senha errada, muitas tentativas ou a prévia
      bt.disabled = false; campo.focus();
    }
  });

  // ---------- abrir (a cada ida ao Personalizar) -------------------------------------------
  function abrir(c) {
    if (!c) return;
    const primeira = !cfg; cfg = c;
    const aj = c.ajustes && typeof c.ajustes === "object" ? c.ajustes : {};
    clima = climaOk(c.clima) ? c.clima : null;
    origemClima = ["tela", "arquivo", "nenhum"].includes(aj.clima) ? aj.clima : clima ? "arquivo" : "nenhum";
    climaArquivo = aj.clima_arquivo !== false;
    mostrarClima();
    if (c.papel !== "membro") { lerAndares(); lerMembros(); }   // membro não tem estas abas (o servidor também barra)
    if (primeira) {   // as datas em edição ficam enquanto a página estiver aberta, mesmo saindo e voltando
      const f = c.festas && typeof c.festas === "object" ? c.festas : {};
      const rev = aj.rev && Number.isInteger(aj.rev.festas) ? aj.rev.festas : 0;
      salvo = { rev, proprias: Array.isArray(f.proprias) ? copia(f.proprias) : [], desligadas: Array.isArray(f.desligadas) ? f.desligadas.filter(k => typeof k === "string") : [] };
      edicao = copia(salvo);
      $("d-tema").replaceChildren(...Festas.temas().map(t => Object.assign(el("option", null, t.chave === "generico" ? "Festa (nas cores da marca)" : t.nome), { value: t.chave })));
    }
    mostrarDatas();
    if (primeira) {   // os times em edição também ficam
      const rev = aj.rev && Number.isInteger(aj.rev.equipe) ? aj.rev.equipe : 0;
      const ap = c.aparencia && typeof c.aparencia === "object" ? c.aparencia : {};
      eqSalvo = { rev, aparencia: semProto(copia(ap)), times: (Array.isArray(c.times) ? c.times : []).map((t, i) => ({
        nome: t.nome, tipo: TIPOS.some(([k]) => k === t.tipo) ? t.tipo : "mesas",
        cor: /^#[0-9a-f]{6}$/i.test(t.cor || "") ? t.cor.toLowerCase() : CORES_TIME[i % CORES_TIME.length],
        icone: ICONES.some(([k]) => k === t.icone) ? t.icone : "pessoas",
        parede: Number.isInteger(t.parede) ? t.parede : 0, piso: Number.isInteger(t.piso) ? t.piso : 0,
        agentes: Array.isArray(t.agentes) ? t.agentes.slice() : [], de: t.nome })) };
      eq = copiaEq(eqSalvo);
      mostrarOrigemEq(aj.equipe === "tela" ? "tela" : "arquivo");
      mostrarTimes(); mostrarAgentes(); estadoEq();
    } else if (!agentesVistos) mostrarAgentes();
  }
  // a lista de agentes chega com a primeira leitura: monta quando ela vier, com o Personalizar aberto
  setInterval(() => { if (eq && !agentesVistos && !$("v-personalizar").hidden && lidos()) mostrarAgentes(); }, 2000);
  // trocou de andar: os times e a aparência em edição eram do outro; a próxima abertura refaz a partir do config novo
  function esquecerAndar() { eqSalvo = eq = null; agentesVistos = false; cfg = null; }
  return { abrir, ligarBusca, usarCidade, pedir, esquecerAndar };
})();
window.Ajustes = Ajustes;
