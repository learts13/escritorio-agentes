// Ponte local (Firmópolis, onda 2): os terminais deste computador no mapa. Quem lê é o navegador, direto da ponte em
// 127.0.0.1:47820 (ponte/ deste repositório), pelo WebSocket do contrato v1; nada passa pelo servidor do escritório.
// Liga só depois de a pessoa colar o token (Personalizar > Ponte local), que fica neste navegador (localStorage). A
// ponte confere o Origin (ponte setup --origem) e o token, que vai como subprotocolo "token.<hex>" (o navegador não
// manda Authorization no WebSocket). Desligada ou caída, tenta de novo espaçando até 1 minuto, sem aviso na tela.
// Os dados da ponte só vão para a tela por textContent e pelo canvas, sempre conferidos e cortados aqui.
// Espelho: sem a ponte local ligada, lê do servidor (GET /api/ponte, a ponte de outra máquina espelhada lá) a cada 3 s
// enquanto ele disser "ativo" e alimenta o mesmo estado, com a mesma conferência. A ponte local sempre tem prioridade.
"use strict";
const Ponte = (() => {
  const URL_PONTE = "ws://127.0.0.1:47820/ws", PROTOCOLO = "firmopolis.v1", CHAVE = "firmopolis.ponte";
  const MAX = 48, ESPERA_MIN = 3000, ESPERA_MAX = 60000, MAX_WS = 32, MAX_DIA = 200;
  const URL_SRV = "api/ponte", SRV_ATIVO = 3000, SRV_PARADO = 30000, SRV_ERRO = 60000;
  const ESTADOS = { ocupado: "ocupado", ocioso: "livre", esperando_permissao: "aprovacao", esperando_resposta: "pergunta", erro: "erro" };
  const PROVEDORES = { claude_code: "Claude Code", codex: "Codex", open_code: "OpenCode", antigravity_cli: "agy", minimax_code: "MiniMax" };
  const st = { ws: null, token: "", situacao: "desligada", falhas: 0, timer: 0, moradores: new Map(), workspaces: new Map(), dia: new Map(), v: 0,
    servidor: false, srvTimer: 0, srvLido: "", espelho: null };

  const tokenOk = t => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);
  function lerToken() { try { const t = localStorage.getItem(CHAVE); return tokenOk(t) ? t : ""; } catch (e) { return ""; } }
  function gravarToken(t) { try { if (t) localStorage.setItem(CHAVE, t); else localStorage.removeItem(CHAVE); } catch (e) { /* aba anônima: vale só nesta visita */ } }

  const texto = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");
  // um morador do contrato v1 vira o terminalzinho do mapa: só o que a tela usa, conferido
  function terminal(m) {
    if (!m || typeof m !== "object" || !texto(m.id, 200) || !Object.hasOwn(ESTADOS, m.estado)) return null;
    const provedor = Object.hasOwn(PROVEDORES, m.provedor) ? PROVEDORES[m.provedor] : "Terminal";
    const at = m.atividade && typeof m.atividade === "object" ? texto(m.atividade.ferramenta, 40) : "";
    return { id: texto(m.id, 200), nome: texto(m.nome, 40) || provedor, provedor, estado: ESTADOS[m.estado],
      projeto: texto(m.projeto, 60), atividade: at, gerente: m.gerente === true, papel: texto(m.papel, 40),
      workspace: texto(m.workspace_id, 200), band: texto(m.band_id, 200), solto: m.solto === true,
      ajudantes: Number.isInteger(m.ajudantes) ? Math.max(0, Math.min(99, m.ajudantes)) : 0,
      desde: typeof m.desde === "string" && m.desde.length < 64 && Number.isFinite(Date.parse(m.desde)) ? m.desde : "" };
  }
  // os workspaces do Maestri (o cartão mostra os nomes): id → { nome, bands: Map(id → nome) }, com teto
  function guardarWorkspaces(lista) {
    st.workspaces.clear();
    for (const w of Array.isArray(lista) ? lista.slice(0, MAX_WS) : []) {
      if (!w || typeof w !== "object" || !texto(w.id, 200)) continue;
      const bands = new Map();
      for (const b of Array.isArray(w.bands) ? w.bands.slice(0, MAX_WS) : []) if (b && typeof b === "object" && texto(b.id, 200)) bands.set(texto(b.id, 200), texto(b.nome, 60));
      st.workspaces.set(texto(w.id, 200), { nome: texto(w.nome, 60), bands });
    }
  }
  // a linha do dia de cada terminal (o histórico de hoje, sem o alvo): só hora, estado e ferramenta, os 200 mais novos
  function anotar(id, ts, estado, ferramenta) {
    let l = st.dia.get(id);
    if (!l) { if (st.dia.size >= MAX_DIA) return; st.dia.set(id, l = []); }
    l.push({ ts, estado, ferramenta });
    if (l.length > MAX_DIA) l.splice(0, l.length - MAX_DIA);
  }
  function guardarDia(eventos) {
    st.dia.clear();
    const ok = (Array.isArray(eventos) ? eventos : []).filter(e => e && typeof e === "object" && texto(e.morador_id, 200) && Object.hasOwn(ESTADOS, e.estado)
      && typeof e.ts === "string" && Number.isFinite(Date.parse(e.ts)));
    const ord = ok.map(e => ({ id: texto(e.morador_id, 200), ts: Date.parse(e.ts), estado: ESTADOS[e.estado], ferramenta: texto(e.ferramenta, 40) })).sort((a, b) => a.ts - b.ts);
    for (const e of ord) anotar(e.id, e.ts, e.estado, e.ferramenta);
  }
  function esquecer() { const tinha = st.moradores.size; st.moradores.clear(); st.workspaces.clear(); st.dia.clear(); return tinha; }
  function mudou() { st.v++; window.dispatchEvent(new CustomEvent("ponte")); }
  function guardarSnapshot(d) {
    st.moradores.clear(); guardarWorkspaces(d.workspaces);
    for (const m of d.moradores.slice(0, MAX)) { const t = terminal(m); if (t) st.moradores.set(t.id, t); }
  }
  function receber(d) {
    if (!d || typeof d !== "object" || d.v !== 1) return;
    if (d.tipo === "snapshot" && Array.isArray(d.moradores)) { guardarSnapshot(d); mudou(); }
    else if (d.tipo === "dia") { guardarDia(d.eventos); mudou(); }
    else if (d.tipo === "morador") {
      const t = terminal(d.morador), antes = t && st.moradores.get(t.id);
      if (t && (antes || st.moradores.size < MAX)) {
        if (!antes || antes.estado !== t.estado || antes.atividade !== t.atividade) anotar(t.id, Date.now(), t.estado, t.atividade);   // a linha do dia segue viva
        st.moradores.set(t.id, t); mudou();
      }
    } else if (d.tipo === "saiu" && st.moradores.delete(texto(d.id, 200))) mudou();
  }

  function situar(s) { if (st.situacao !== s) { st.situacao = s; mostrar(); } }
  function conectar() {
    clearTimeout(st.timer); st.timer = 0;
    if (!st.token || st.ws) return;
    let ws;
    try { ws = new WebSocket(URL_PONTE, [PROTOCOLO, "token." + st.token]); } catch (e) { return religar(); }
    st.ws = ws; situar(st.falhas ? st.situacao : "conectando");
    ws.onopen = () => { st.falhas = 0; st.servidor = false; st.srvLido = ""; situar("ligada"); };   // o snapshot local vem a seguir
    ws.onmessage = e => { if (typeof e.data === "string" && e.data.length < 4 << 20) { try { receber(JSON.parse(e.data)); } catch (x) { /* ignora */ } } };
    ws.onclose = () => {
      if (st.ws !== ws) return;
      st.ws = null;
      if (!st.servidor && esquecer()) mudou();   // ponte caiu: os terminais saem do mapa (os do espelho ficam)
      religar(); lerServidor();
    };
  }
  function religar() {
    if (!st.token) return;
    st.falhas++; situar("sem-ponte");
    const espera = Math.min(ESPERA_MAX, ESPERA_MIN * 2 ** Math.min(st.falhas - 1, 5));
    st.timer = setTimeout(conectar, document.hidden ? Math.max(espera, 30000) : espera);
  }
  function desligar() {
    clearTimeout(st.timer); st.timer = 0; st.falhas = 0;
    const ws = st.ws; st.ws = null; if (ws) ws.close();
    if (!st.servidor && esquecer()) mudou();
    situar("desligada"); lerServidor();
  }
  // ---------- espelho: a ponte de outra máquina, pelo servidor ------------------------------------------------
  function aplicarServidor(d) {
    if (d && typeof d === "object" && typeof d.espelho === "string" && d.espelho !== st.espelho) { st.espelho = d.espelho; mostrarEspelho(); }
    if (!d || d.ativo !== true || !Array.isArray(d.moradores) || st.situacao === "ligada") {
      if (st.servidor) { st.servidor = false; st.srvLido = ""; if (esquecer()) mudou(); mostrar(); }
      return false;
    }
    const lido = JSON.stringify([d.moradores, d.workspaces, d.dia]);   // sem a idade: só o que muda a tela
    if (lido !== st.srvLido || !st.servidor) {
      st.srvLido = lido; guardarSnapshot(d); guardarDia(d.dia);
      if (!st.servidor) { st.servidor = true; mostrar(); }
      mudou();
    }
    return true;
  }
  async function lerServidor() {
    clearTimeout(st.srvTimer); st.srvTimer = 0;
    let espera = SRV_PARADO;
    if (st.situacao !== "ligada" && !(window.Brincar && Brincar.demo)) {
      try {
        const r = await fetch(window.Andar ? Andar.com(URL_SRV) : URL_SRV, { cache: "no-store", credentials: "same-origin" });
        const texto = r.ok ? await r.text() : "";
        if (!r.ok || texto.length > 4 << 20) { espera = SRV_ERRO; aplicarServidor(null); }
        else if (aplicarServidor(JSON.parse(texto))) espera = SRV_ATIVO;
      } catch (e) { espera = SRV_ERRO; }
    }
    clearTimeout(st.srvTimer);
    st.srvTimer = setTimeout(lerServidor, document.hidden ? Math.max(espera, 30000) : espera);
  }

  function ligar(token) { desligar(); st.token = token; gravarToken(token); conectar(); }

  // ---------- Personalizar > Ponte local ----------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const SITUACOES = {
    desligada: ["Desligada. Cole o token para ver os terminais deste computador no mapa.", ""],
    conectando: ["Procurando a ponte em 127.0.0.1…", ""],
    ligada: ["Ligada: os terminais deste computador estão no mapa.", "ok"],
    "sem-ponte": ["A ponte não respondeu. Ela está rodando? Se o token ou o endereço mudou, rode o comando acima de novo. Tentando de novo sozinho.", "ruim"],
    servidor: ["Pelo servidor: os terminais da máquina com o espelho ligado estão no mapa.", "ok"] };
  const situacao = () => (st.situacao !== "ligada" && st.servidor ? "servidor" : st.situacao);
  function mostrar() {
    const a = $("pt-estado"); if (!a) return;
    const s = situacao(), [t, tipo] = SITUACOES[s] || SITUACOES.desligada;
    const n = st.moradores.size;
    a.textContent = (s === "ligada" || s === "servidor") && n ? `${t} Agora: ${n} ${n === 1 ? "terminal" : "terminais"}.` : t;
    a.className = "aviso-form" + (tipo ? ` ${tipo}` : "");
    $("pt-desligar").hidden = !st.token;
    $("pt-ligar").textContent = st.token ? "Trocar token" : "Ligar";
  }
  function montarCartao() {
    const form = $("form-ponte"); if (!form) return;
    $("pt-comando").textContent = `ponte setup --aplicar --origem ${location.origin}`;
    form.addEventListener("submit", e => {
      e.preventDefault();
      const t = $("pt-token").value.trim().toLowerCase();
      if (!tokenOk(t)) { const a = $("pt-estado"); a.textContent = "O token tem 64 letras e números (0 a 9, a a f). Copie de novo do terminal."; a.className = "aviso-form ruim"; $("pt-token").focus(); return; }
      $("pt-token").value = ""; ligar(t);
    });
    $("pt-desligar").addEventListener("click", () => { desligar(); st.token = ""; gravarToken(""); $("pt-token").focus(); });
    window.addEventListener("ponte", mostrar);
    mostrar();
    if (!$("pt-espelho")) return;
    $("pt-esp-gerar").addEventListener("click", () => {
      if (st.espelho === "tela" && !confirm("A chave atual para de valer na hora. Gerar outra?")) return;
      pedirChave("gerar");
    });
    $("pt-esp-desligar").addEventListener("click", () => { if (confirm("Desligar o espelho? A ponte da outra máquina para de aparecer.")) pedirChave("desligar"); });
  }
  // o admin do prédio gera a chave do espelho; o comando com a chave aparece só nesta resposta, nunca de novo
  const ESPELHOS = { variavel: "Ligado pela variável ESCRITORIO_PONTE_CHAVE do servidor: a chave fica com quem administra o servidor.",
    tela: "Ligado. Gerar outra chave faz a atual parar de valer na hora.", "": "Desligado. Gere a chave e rode o comando na máquina dos terminais." };
  function mostrarEspelho(aviso, tipo) {
    const caixa = $("pt-espelho"); if (!caixa) return;
    caixa.hidden = st.espelho === null;
    const a = $("pt-esp-estado");
    a.textContent = aviso || ESPELHOS[st.espelho] || ""; a.className = "aviso-form" + (tipo ? ` ${tipo}` : "");
    $("pt-esp-gerar").hidden = st.espelho === "variavel";
    $("pt-esp-gerar").textContent = st.espelho === "tela" ? "Gerar outra chave" : "Gerar chave";
    $("pt-esp-desligar").hidden = st.espelho !== "tela";
  }
  async function pedirChave(acao) {
    const cmd = $("pt-esp-comando");
    try {
      const r = await fetch("api/ponte/chave", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return mostrarEspelho(typeof d.mensagem === "string" ? d.mensagem.slice(0, 200) : "Não deu certo agora.", "ruim");
      st.espelho = typeof d.espelho === "string" ? d.espelho : st.espelho;
      cmd.textContent = typeof d.comando === "string" ? d.comando.slice(0, 400) : ""; cmd.hidden = !cmd.textContent;
      const ch = $("pt-esp-chave"), rot = $("pt-esp-chave-rot");   // a chave fica fora do comando: não vai ao histórico do shell
      ch.textContent = typeof d.chave === "string" && /^[0-9a-f]{64}$/.test(d.chave) ? d.chave : ""; ch.hidden = rot.hidden = !ch.textContent;
      mostrarEspelho(cmd.textContent ? "Rode isto na máquina dos terminais (a chave aparece só agora; não mande para ninguém):" : "", "ok");
      if (!cmd.textContent) mostrarEspelho();
    } catch (e) { mostrarEspelho("Sem conexão com o servidor.", "ruim"); }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (st.token && !st.ws && st.falhas) { st.falhas = 1; conectar(); }
    if (st.servidor) lerServidor();
  });
  function iniciar() {
    montarCartao();
    st.token = lerToken();   // também na demonstração: a ponte é deste computador, não o servidor
    if (st.token) conectar();
    lerServidor();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();

  const ws = id => st.workspaces.get(id);
  return { terminais: () => [...st.moradores.values()], versao: () => st.v, situacao,
    dia: id => (st.dia.get(id) || []).map(e => ({ ...e })),
    workspace: id => (ws(id) ? ws(id).nome : ""), band: (wsId, bandId) => (ws(wsId) && ws(wsId).bands.get(bandId)) || "",
    // as salas em uso: o nome do workspace de cada terminal vivo, sem repetir (as bands costumam ter nome genérico, "Banda #2")
    bands: () => [...new Set([...st.moradores.values()].map(m => (ws(m.workspace) ? ws(m.workspace).nome : "")).filter(Boolean))] };
})();
window.Ponte = Ponte;
