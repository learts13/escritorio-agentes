// Assistente de instalação, no lugar das boas-vindas. Abre uma vez por sessão enquanto o nome é o de exemplo
// (marca_exemplo) ou o escritório não está conectado (conexao "sem_conexao"); reabre pelo Personalizar; não abre na
// demonstração. Passos: conectar, cidade, nome/cor/logo, times (só com conexão) e pronto. Cada passo salva na hora,
// pela própria rota (/oauth/conectar, /api/clima, /api/logo e /api/marca), e todos têm "Pular". O "Conectar" sai da
// página: grava escritorio:assistente=cidade no sessionStorage e, na volta do agentes.chat, o assistente reabre ali.
"use strict";
const Assistente = (() => {
  const $ = id => document.getElementById(id);
  const PASSOS = [["conectar", "Conecte ao agentes.chat"], ["cidade", "Onde fica o escritório?"], ["marca", "Como se chama a sua empresa?"],
    ["times", "Organizar em times?"], ["pronto", "Pronto!"]];
  const RETOMAR = "escritorio:assistente", VISTO = "escritorio:assistente-visto";
  let cfg = null, lerEstado = () => null, passo = "conectar", recarregar = false, montado = false, vigia = 0, corEscolhida = null;
  let irPara = "";   // para onde a página vai ao fechar ("Montar os times" ou "Ir para o escritório")

  const guardar = (k, v) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } };
  const ler = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const estadoAgora = () => lerEstado() || {};
  const conexao = () => (typeof estadoAgora().conexao === "string" ? estadoAgora().conexao : "carregando");
  const agentes = () => (Array.isArray(estadoAgora().agentes) ? estadoAgora().agentes.length : 0);
  const temTimes = () => conexao() === "conectado" && agentes() > 0;
  const passosValem = () => PASSOS.filter(([k]) => k !== "times" || temTimes());
  function aviso(id, t, tipo) { const a = $(id); a.textContent = t; a.className = "aviso-form" + (tipo ? ` ${tipo}` : ""); }
  // o botão de seguir de cada passo: "Pular" (fantasma) até salvar ou conectar, depois "Seguir" (principal)
  function seguir(sec, pronto) { const b = sec.querySelector("[data-seguir]"); if (b.dataset.rotulo == null) b.dataset.rotulo = b.textContent; b.textContent = pronto ? "Seguir" : b.dataset.rotulo; b.className = pronto ? "botao" : "botao fantasma"; return b; }
  const secao = k => document.querySelector(`#assistente .as-passo[data-passo="${k}"]`);

  // ---------- passos ----------------------------------------------------------------------
  function mostrarConexao() {
    const c = conexao(), erro = typeof estadoAgora().erro === "string" ? estadoAgora().erro : "";
    const textos = { conectado: "Conectado. Os agentes já aparecem no mapa.", sem_conexao: "Ainda não conectado.", carregando: "Conferindo a conexão…",
      recusada: erro ? erro.charAt(0).toUpperCase() + erro.slice(1).replace(/\.?$/, ".") : "O agentes.chat recusou a leitura.",
      pausa: "Conectado, mas o agentes.chat pediu uma pausa nas leituras.", falha: "Conectado, mas o agentes.chat não respondeu na última leitura." };
    const t = Object.hasOwn(textos, c) ? textos[c] : textos.carregando;
    if ($("as-conexao").textContent !== t) $("as-conexao").textContent = t;
    $("as-conectar").hidden = c === "conectado" || c === "pausa" || c === "falha";
    $("as-conectar").textContent = c === "recusada" ? "Reconectar" : "Conectar ao agentes.chat";
    seguir(secao("conectar"), $("as-conectar").hidden);
    const troca = typeof enderecoTrocado === "function" ? enderecoTrocado() : "";   // o mesmo aviso da faixa (app.js)
    $("as-base").hidden = !troca; $("as-base").textContent = troca;
  }
  const preparar = {
    conectar() { mostrarConexao(); vigia = setInterval(mostrarConexao, 2000); },   // o estado chega a cada 10 s
    cidade() {
      $("as-cidade").textContent = cfg.clima && cfg.clima.cidade ? `Agora: ${cfg.clima.cidade}.` : "Sem cidade ainda: o céu fica sempre limpo.";
      aviso("as-cidade-aviso", ""); seguir(secao("cidade"), false);
    },
    marca() {
      $("bv-empresa").value = cfg.marca_exemplo === true ? "" : cfg.empresa || "";
      corEscolhida = cfg.cor || Personalizar.PALETA[0][0];
      for (const i of document.querySelectorAll("#bv-paleta input")) i.checked = i.value.toLowerCase() === corEscolhida.toLowerCase();
      aviso("bv-aviso", "");
    },
    times() {
      const n = agentes();
      $("as-times-texto").textContent = `Hoje são ${n} ${n === 1 ? "agente" : "agentes"}. Sem times, todos sentam juntos na sala “Novos”; com times, cada um ganha uma sala com a própria cor e o ícone na placa. Os times se montam em Personalizar.`;
    },
    pronto() { $("as-construcao").hidden = !matchMedia("(min-width: 901px) and (pointer: fine)").matches; },   // o Modo construção é de computador
  };

  function ir(k) {
    clearInterval(vigia);
    if (k === "times" && !temTimes()) k = "pronto";
    passo = k;
    const lista = passosValem(), n = lista.findIndex(([p]) => p === k);
    for (const s of document.querySelectorAll("#assistente .as-passo")) s.hidden = s.dataset.passo !== k;
    $("as-progresso").textContent = `Passo ${n + 1} de ${lista.length}`;
    $("as-titulo").textContent = PASSOS.find(([p]) => p === k)[1];
    preparar[k]();
    $("as-titulo").focus();   // o leitor de tela lê o título do passo novo
  }
  const seguinte = () => { const ks = PASSOS.map(([p]) => p); ir(ks[ks.indexOf(passo) + 1] || "pronto"); };

  // ---------- liga uma vez ----------------------------------------------------------------
  function montar() {
    if (montado) return;
    montado = true;
    const d = $("assistente");
    for (const b of d.querySelectorAll("[data-seguir]")) b.addEventListener("click", seguinte);
    $("as-conectar").addEventListener("click", () => guardar(RETOMAR, "cidade"));   // sai da página; a volta retoma na cidade
    const limpar = Ajustes.ligarBusca($("as-q"), $("as-q-lista"), $("as-q-status"), async r => {
      aviso("as-cidade-aviso", "Salvando…");
      try {
        const c = await Ajustes.usarCidade(r, cfg);
        limpar();
        $("as-cidade").textContent = `Agora: ${c ? c.cidade : r.nome}.`;
        aviso("as-cidade-aviso", `Pronto: o tempo lá fora é o de ${c ? c.cidade : r.nome}.`, "ok");
        seguir(secao("cidade"), true).focus();
      } catch (e) { aviso("as-cidade-aviso", `Não salvou: ${e.message}`, "ruim"); }
    });
    Personalizar.montarPaleta($("bv-paleta"), "bv-paleta", c => { corEscolhida = c; aplicarCor(c); });   // a página mostra a cor na hora
    $("bv-logo").addEventListener("change", () => {
      const f = $("bv-logo").files[0], erro = f ? Personalizar.erroDoLogo(f) : "";
      if (erro) $("bv-logo").value = "";
      $("bv-logo-nome").textContent = f && !erro ? f.name : "Nenhuma imagem escolhida";
      aviso("bv-aviso", erro, erro ? "ruim" : "");
    });
    $("form-bv").addEventListener("submit", async ev => {
      ev.preventDefault();
      if (!$("bv-empresa").reportValidity()) return;
      const bt = $("bv-salvar"), f = $("bv-logo").files[0];
      bt.disabled = true; bt.textContent = "Salvando…";
      let logoFoi = false;
      try {
        if (f) { await Personalizar.enviar("/api/logo", f, f.type); logoFoi = true; }
        await Personalizar.enviar("/api/marca", JSON.stringify({ empresa: $("bv-empresa").value.trim(), cor: corEscolhida }), "application/json");
        cfg.empresa = $("bv-empresa").value.trim(); cfg.cor = corEscolhida; cfg.marca_exemplo = false;
        recarregar = true;   // o nome e o logo valem no mapa e no menu depois de recarregar (ao fechar o assistente)
        seguinte();
      } catch (e) {
        aviso("bv-aviso", `Não salvou${logoFoi ? " o nome e a cor (o logo já foi)" : ""}: ${e.message}. Tente de novo ou pule e faça depois em Personalizar.`, "ruim");
        if (logoFoi) recarregar = true;
      } finally { bt.disabled = false; bt.textContent = "Salvar e seguir"; }
    });
    $("as-montar").addEventListener("click", () => { irPara = "#personalizar"; d.close(); });
    $("as-fim").addEventListener("click", () => { irPara = "#escritorio"; d.close(); });
    d.addEventListener("close", () => {
      clearInterval(vigia);
      if (irPara) { if (location.hash !== irPara) location.hash = irPara; }
      if (recarregar) { location.reload(); return; }
      aplicarCor(cfg.cor || Personalizar.PALETA[0][0]);   // pulou a marca (ou Esc): volta a cor de antes
      if (irPara === "#personalizar") setTimeout(() => { const t = $("t-equipe"); t.tabIndex = -1; t.scrollIntoView({ block: "start" }); t.focus({ preventScroll: true }); }, 0);
      else $("principal").focus({ preventScroll: true });
      irPara = "";
    });
    $("abrir-assistente").addEventListener("click", () => abrir("conectar"));
  }

  function abrir(k) {
    const d = $("assistente");
    if (!cfg || !d.showModal || (window.Brincar && Brincar.demo)) return;
    montar();
    if (!d.open) d.showModal();
    ir(PASSOS.some(([p]) => p === k) ? k : "conectar");
  }

  // depois da primeira leitura (app.js): na volta do OAuth retoma o passo guardado; senão, uma vez por sessão,
  // se o nome ainda é o de exemplo ou se não há conexão
  function talvez(c, estadoFn) {
    if (!c || (window.Brincar && Brincar.demo)) return;
    cfg = c; lerEstado = estadoFn;
    montar();
    const volta = ler(RETOMAR);
    if (volta) {   // a volta do OAuth sem conexão (recusou, ou a autorização falhou) retoma no Conectar, que mostra o estado e o "Reconectar"
      guardar(RETOMAR, null);
      abrir(["sem_conexao", "recusada"].includes(conexao()) ? "conectar" : volta);
      return;
    }
    if (ler(VISTO)) return;
    if (c.marca_exemplo === true || conexao() === "sem_conexao") { guardar(VISTO, "1"); abrir("conectar"); }
  }
  return { talvez, abrir };
})();
window.Assistente = Assistente;
