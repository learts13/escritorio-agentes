// Tela "Personalizar": nome, cor e logo da empresa (salvos no servidor), com prévia ao vivo
// e checagem de contraste da cor escolhida (WCAG). A prévia mostra a placa da recepção e o painel
// da sala comunal desenhados como no mapa. Tudo (nome, cor, logo, expediente e modo sério) só vale ao clicar em "Salvar".
"use strict";
const Personalizar = (() => {
  const $ = id => document.getElementById(id);
  const PALETA = [["#f5b83d", "Âmbar"], ["#f97316", "Laranja"], ["#e8587a", "Rosa"], ["#a855f7", "Roxo"], ["#3b82f6", "Azul"], ["#14b8a6", "Turquesa"], ["#22c55e", "Verde"], ["#e5e7eb", "Gelo"]];
  const FUNDO = "#0f0f11", LOGO_PADRAO = "logo.png", ESCALA = 3;
  let salvo = null;          // { empresa, cor, logo, abre, fecha, serio } como estão no servidor
  let logoNovo = null;       // arquivo escolhido, enviado só no "Salvar"
  let tirarLogo = false;     // "voltar ao logo padrão", também só no "Salvar"
  let urlLocal = null;       // endereço temporário do arquivo escolhido, para a prévia
  let configApp = null;      // a config da página (app.js), para o logo salvo valer ao reabrir sem recarregar
  let placa = null, painel = null;

  // a marca e o logo são do andar atual (expediente.js: Andar); no principal o pedido sai como sempre
  async function enviar(url, corpo, tipo) {
    if (window.Brincar && Brincar.demo) throw new Error("na demonstração nada é salvo");   // segunda trava: nenhum POST na demo
    const r = await fetch(Andar.com(url), { method: "POST", credentials: "same-origin", headers: { "Content-Type": tipo }, body: corpo });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
    return d;
  }
  function aviso(t, tipo) { const a = $("m-aviso"); a.textContent = t; a.className = "aviso-form" + (tipo ? ` ${tipo}` : ""); }

  // paleta pronta: rádios de verdade (teclado e leitor de tela); a mesma no Personalizar e no assistente
  function montarPaleta(p, grupo, aoEscolher) {
    if (p.childElementCount) return;
    p.setAttribute("role", "radiogroup"); p.setAttribute("aria-label", "Cores sugeridas");
    for (const [cor, nome] of PALETA) {
      const l = document.createElement("label"), i = document.createElement("input");
      l.style.background = cor; l.title = nome;
      i.type = "radio"; i.name = grupo; i.value = cor; i.setAttribute("aria-label", nome);
      i.addEventListener("change", () => aoEscolher(cor));
      l.append(i); p.append(l);
    }
  }

  // miniaturas: onde a marca aparece de verdade no mapa (mesmas medidas e cores do efeitos.js)
  function montarMiniaturas() {
    if (placa) return;
    const caixa = document.createElement("div"), cria = (rotulo, w, h) => {
      const fig = document.createElement("figure"), cv = document.createElement("canvas"), leg = document.createElement("figcaption");
      cv.width = w * ESCALA; cv.height = h * ESCALA; cv.setAttribute("role", "img"); cv.setAttribute("aria-label", rotulo);
      Object.assign(cv.style, { width: "100%", maxWidth: `${w * ESCALA}px`, height: "auto", imageRendering: "pixelated", borderRadius: "8px", display: "block" });
      Object.assign(fig.style, { margin: "0", display: "flex", flexDirection: "column", gap: "6px" });
      Object.assign(leg.style, { fontSize: "12px", color: "var(--suave)" });
      leg.textContent = rotulo; fig.append(cv, leg); caixa.append(fig);
      return cv;
    };
    Object.assign(caixa.style, { display: "grid", gap: "12px", width: "100%" });
    placa = cria("Placa da recepção", 60, 40);
    painel = cria("Painel da sala comunal", 100, 50);
    $("p-logo").closest(".previa-marca").querySelector(".previa-corpo").prepend(caixa);
    $("p-logo").addEventListener("load", desenharMiniaturas);
    if (document.fonts) document.fonts.load("5px Silkscreen").then(desenharMiniaturas, () => {});
  }

  function logoPixel(img) { // como no mapa: 26 px de altura, até 64 de largura, sem suavizar
    if (!img.complete || !img.naturalWidth) return null;
    const h = 26, w = Math.min(64, Math.round(img.naturalWidth * h / img.naturalHeight));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(img, 0, 0, w, h);
    return cv;
  }

  function desenharMiniaturas() {
    if (!placa) return;
    const cor = $("m-cor").value, nome = ($("m-empresa").value.trim() || "Nome da empresa").toUpperCase(), logo = logoPixel($("p-logo"));
    const desenhar = (cv, w, h, fazer, texto) => { // desenha em 1x e amplia sem suavizar; o texto vai já na escala, nítido
      const base = document.createElement("canvas"); base.width = w; base.height = h;
      const b = base.getContext("2d"); b.imageSmoothingEnabled = false; fazer(b);
      const c = cv.getContext("2d"); c.imageSmoothingEnabled = false; c.clearRect(0, 0, cv.width, cv.height); c.drawImage(base, 0, 0, cv.width, cv.height);
      if (texto) { c.save(); c.scale(ESCALA, ESCALA); texto(c); c.restore(); }
    };
    desenhar(placa, 60, 40, c => { // parede da recepção com a placa do logo
      c.fillStyle = "#2c2a3e"; c.fillRect(0, 0, 60, 40); c.fillStyle = "#24223a"; c.fillRect(0, 34, 60, 6);
      c.fillStyle = "#1b1a26"; c.fillRect(12, 5, 36, 30); c.fillStyle = "#0d1020"; c.fillRect(14, 7, 32, 26);
      if (logo) { const k = Math.min(28 / logo.width, 22 / logo.height), w = Math.round(logo.width * k), h = Math.round(logo.height * k); c.drawImage(logo, 14 + Math.round((32 - w) / 2), 7 + Math.round((26 - h) / 2), w, h); }
    });
    desenhar(painel, 100, 50, c => { // parede de tijolo da sala comunal com o painel em neon
      c.fillStyle = "#7d4a3e"; c.fillRect(0, 0, 100, 50);
      c.fillStyle = "#6a3c32"; for (let y = 3; y < 50; y += 5) { c.fillRect(0, y, 100, 1); for (let x = (y % 10 ? 0 : 6); x < 100; x += 12) c.fillRect(x, y - 4, 1, 4); }
      const L = { x: 6, y: 7, w: 88, h: 38 };
      const n = parseInt(cor.slice(1), 16), rgb = `${n >> 16},${(n >> 8) & 255},${n & 255}`;
      const g = c.createRadialGradient(50, 26, 0, 50, 26, 62); g.addColorStop(0, `rgba(${rgb},.35)`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.fillRect(0, 0, 100, 50);
      c.fillStyle = "#1b1a26"; c.fillRect(L.x - 2, L.y - 2, L.w + 4, L.h + 4);
      c.fillStyle = "#0d1020"; c.fillRect(L.x, L.y, L.w, L.h);
      c.fillStyle = cor; c.fillRect(L.x, L.y, L.w, 1); c.fillRect(L.x, L.y + L.h - 1, L.w, 1);
      c.fillStyle = "#3a3f58"; c.fillRect(L.x + 3, L.y - 4, 1, 3); c.fillRect(L.x + L.w - 4, L.y - 4, 1, 3);   // suportes
      if (logo) c.drawImage(logo, Math.round(L.x + (L.w - logo.width) / 2), L.y + 3);
    }, c => {
      c.font = "5px Silkscreen, monospace"; c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillStyle = "#ffffff";
      c.fillText(nome, 50, 42, 84);   // nome da empresa embaixo do logo, como no mapa
    });
  }

  const temSocial = () => !!configApp && typeof configApp.serio === "boolean" && !(window.Brincar && Brincar.demo);   // o /api/config manda "serio" quando há vida social
  function mostrarLogo(src) { $("m-previa").src = $("p-logo").src = src; }
  function alterado() {
    return !!salvo && ($("m-empresa").value.trim() !== salvo.empresa || $("m-cor").value.toLowerCase() !== salvo.cor.toLowerCase() || !!logoNovo || tirarLogo ||
      $("m-abre").value !== salvo.abre || $("m-fecha").value !== salvo.fecha || (temSocial() && $("m-serio").checked !== salvo.serio));
  }

  // expediente: abre == fecha não vale (o servidor recusa também); abre > fecha é o turno que vira a meia-noite
  function conferirExpediente() {
    const abre = $("m-abre").value, fecha = $("m-fecha").value, igual = !!abre && abre === fecha;
    for (const id of ["m-abre", "m-fecha"]) $(id).setAttribute("aria-invalid", String(igual));
    const ajuda = $("m-expediente-ajuda"), min = Math.round(Expediente.duracao(abre, fecha) * 60);
    ajuda.classList.toggle("ruim", igual);
    ajuda.textContent = !abre || !fecha ? "Escolha a hora de abrir e a de fechar."
      : igual ? "Abre e fecha no mesmo horário: escolha horários diferentes."
      : `Das ${abre} às ${fecha}${abre > fecha ? " do dia seguinte" : ""} (${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}). Fora desse horário, quem está sem tarefa vai para casa e o mapa avisa que o escritório está fechado.`;
    return !igual;
  }

  function mudou() {
    const cor = $("m-cor").value, nome = $("m-empresa").value.trim();
    for (const i of document.querySelectorAll("#m-paleta input")) i.checked = i.value.toLowerCase() === cor.toLowerCase();
    aplicarCor(cor);   // a página inteira vira a prévia (volta se sair sem salvar)
    $("p-nome").textContent = nome || "Nome da empresa";
    const noFundo = contraste(cor, FUNDO), noBotao = contraste(cor, textoSobre(cor));
    const ok = noFundo >= 3;
    $("m-contraste").textContent = `Contraste com o fundo: ${noFundo.toFixed(1).replace(".", ",")}:1${ok ? "" : " (baixo: links e destaques ficam apagados; escolha uma cor mais clara)"} · texto do botão: ${noBotao.toFixed(1).replace(".", ",")}:1.`;
    $("m-contraste").classList.toggle("ruim", !ok);
    $("m-desfazer").hidden = !alterado();
    conferirExpediente();
    const pendente = "Alterações ainda não salvas. Tudo vale junto ao clicar em Salvar.";
    if (alterado()) aviso(pendente);
    else if ($("m-aviso").textContent === pendente) aviso("");   // desfez à mão até o valor salvo
    desenharMiniaturas();
  }

  // Entrada do modo construção (construir.html, editor à parte com o próprio Salvar): editar só no computador; no celular, o aviso
  const NO_COMPUTADOR = "(min-width: 700px) and (any-pointer: fine)";   // o avesso do SO_VER do construir.js e do construir.css
  function montarConstrucao() {
    if ($("m-construcao")) return;
    const f = document.createElement("fieldset"), leg = document.createElement("legend"), txt = document.createElement("p"), link = document.createElement("a");
    f.id = "m-construcao";
    leg.textContent = "Modo construção";
    txt.id = "m-construcao-ajuda"; txt.className = "ajuda";
    link.className = "botao secundario"; link.textContent = "Abrir o modo construção"; link.setAttribute("aria-describedby", "m-construcao-ajuda");
    link.style.alignSelf = "flex-start";
    link.addEventListener("click", ev => {   // sair daqui descarta o que não foi salvo: avisa em vez de perder
      if (!alterado()) return;
      ev.preventDefault(); aviso("Salve ou desfaça as mudanças desta tela antes de abrir o modo construção.", "ruim");
    });
    f.append(leg, txt, link);
    $("m-aviso").before(f);
    const tela = matchMedia(NO_COMPUTADOR), ajustar = () => {
      link.hidden = !tela.matches;
      txt.textContent = tela.matches ? "Mover, tirar e pôr móveis e pintar as salas, num editor à parte com o próprio Salvar. Vale para todo mundo ao recarregar a página."
        : "Para arrumar o escritório (mover, tirar e pôr móveis e pintar as salas), abra num computador. Aqui no celular dá para ver o resultado no mapa.";
    };
    tela.addEventListener("change", ajustar); ajustar();
  }

  function esquecerLogo() { logoNovo = null; tirarLogo = false; if (urlLocal) { URL.revokeObjectURL(urlLocal); urlLocal = null; } }

  function abrir(cfg) {
    if (!cfg) return;
    montarPaleta($("m-paleta"), "paleta", cor => { $("m-cor").value = cor; mudou(); }); montarMiniaturas();
    $("m-salvar").textContent = "Salvar";
    $("m-logo-ajuda").textContent = "PNG, JPEG ou WEBP, até 600 KB. Também dá para arrastar a imagem para cá. O logo novo aparece na prévia e só vale ao clicar em Salvar, junto com o nome e a cor.";
    esquecerLogo(); configApp = cfg;
    salvo = { empresa: cfg.empresa || "", cor: cfg.cor || "#f5b83d", logo: cfg.logo || LOGO_PADRAO, abre: Expediente.abre, fecha: Expediente.fecha, serio: cfg.serio === true };
    $("m-social").hidden = !temSocial();   // servidor sem a vida social (ou a demonstração): a caixa nem aparece
    montarConstrucao(); $("m-construcao").querySelector("a").href = window.Brincar && Brincar.demo ? "construir.html?demo=1" : "construir.html" + (Andar.atual === Andar.PRINCIPAL ? "" : `#andar=${Andar.atual}`);   // o editor abre no andar de agora
    $("m-empresa").value = salvo.empresa; $("m-cor").value = salvo.cor; $("m-abre").value = salvo.abre; $("m-fecha").value = salvo.fecha; $("m-serio").checked = salvo.serio;
    mostrarLogo(salvo.logo);
    aviso(""); mudou();
    mostrarRetencao(cfg);
    lerPerfil();
  }
  window.addEventListener("hashchange", () => { // saiu sem salvar: volta a cor e descarta o logo escolhido
    if (salvo && location.hash !== "#personalizar") { aplicarCor(salvo.cor); if (logoNovo || tirarLogo) { esquecerLogo(); mostrarLogo(salvo.logo); } }
  });

  $("m-empresa").addEventListener("input", mudou);
  $("m-cor").addEventListener("input", mudou);
  $("m-abre").addEventListener("input", mudou);
  $("m-fecha").addEventListener("input", mudou);
  $("m-serio").addEventListener("change", mudou);
  $("m-desfazer").addEventListener("click", () => {
    $("m-empresa").value = salvo.empresa; $("m-cor").value = salvo.cor; $("m-abre").value = salvo.abre; $("m-fecha").value = salvo.fecha; $("m-serio").checked = salvo.serio;
    esquecerLogo(); mostrarLogo(salvo.logo);
    mudou(); aviso("Voltou ao que estava salvo.");
  });
  $("form-marca").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (window.Brincar && Brincar.demo) { aviso("Na demonstração nada é salvo.", "ruim"); return; }   // dados fictícios: nenhum POST
    if (!$("m-empresa").reportValidity()) return;
    if (!conferirExpediente()) { aviso("Não salvou: o expediente precisa abrir e fechar em horários diferentes.", "ruim"); $("m-fecha").focus(); return; }
    const bt = $("m-salvar"); bt.disabled = true; bt.textContent = "Salvando…";
    let logoFoi = false;
    try {
      if (logoNovo || tirarLogo) {
        const d = logoNovo ? await enviar("/api/logo", logoNovo, logoNovo.type) : await enviar("/api/logo/remover", "{}", "application/json");
        logoFoi = true; salvo.logo = configApp.logo = d.logo || LOGO_PADRAO;   // endereço do servidor, não o blob local
      }
      await enviar("/api/marca", JSON.stringify({ empresa: $("m-empresa").value.trim(), cor: $("m-cor").value,
        expediente: { abre: $("m-abre").value, fecha: $("m-fecha").value }, ...(temSocial() ? { serio: $("m-serio").checked } : {}) }), "application/json");
      esquecerLogo();
      Expediente.definir({ abre: $("m-abre").value, fecha: $("m-fecha").value }); pintarAvisos();   // o "Só no expediente (…)" já com o novo
      aviso("Salvo. Recarregando para aplicar no mapa…", "ok"); setTimeout(() => location.reload(), 700);
    } catch (e) {
      if (logoFoi) { esquecerLogo(); mostrarLogo(salvo.logo); }   // o logo já foi; só o nome e a cor ficaram para trás
      bt.disabled = false; bt.textContent = "Salvar"; mudou();
      aviso(`Não salvou${logoFoi ? " o resto (o logo já foi salvo)" : ""}: ${e.message}`, "ruim");   // depois do mudou(), que reescreve o aviso
    }
  });

  function erroDoLogo(f) { // o mesmo limite do servidor, para avisar antes de enviar
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return "Use uma imagem PNG, JPEG ou WEBP.";
    if (f.size > 600000) return `A imagem tem ${Math.round(f.size / 1000)} KB; o limite é 600 KB.`;
    return "";
  }
  function escolherLogo(f) {
    if (!f) return;
    const erro = erroDoLogo(f); if (erro) { aviso(erro, "ruim"); return; }
    esquecerLogo(); logoNovo = f; urlLocal = URL.createObjectURL(f);
    mostrarLogo(urlLocal); mudou();
  }
  $("m-logo").addEventListener("change", () => { escolherLogo($("m-logo").files[0]); $("m-logo").value = ""; });
  const zona = $("m-soltar");
  zona.addEventListener("dragover", ev => { ev.preventDefault(); zona.classList.add("sobre"); });
  zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
  zona.addEventListener("drop", ev => { ev.preventDefault(); zona.classList.remove("sobre"); escolherLogo(ev.dataTransfer.files[0]); });
  $("m-remover").addEventListener("click", () => { esquecerLogo(); tirarLogo = true; mostrarLogo(LOGO_PADRAO); mudou(); });

  // ---------- Prazo das conversas da equipe (D3): só o admin do andar e só com config.equipe ------------------------
  // Um cartão próprio, criado aqui (sem mexer no index.html), com o salvar dele: POST /api/canal/retencao?andar= {dias}.
  // A empresa só baixa de 1 ano; diminuir apaga já o que passou do prazo, então pede confirmação antes.
  const PRAZOS = [[365, "1 ano (padrão)"], [90, "90 dias"], [30, "30 dias"]];
  let ret = null;   // {form, opcoes, confirmar, aviso, cfg}
  function montarRetencao() {
    const criar = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; };
    const form = criar("form", "cartao form-marca"), campo = criar("fieldset"), aviso = criar("p", "aviso-form");
    form.id = "form-retencao"; form.noValidate = true;
    const titulo = criar("legend", null, "Conversas da equipe: por quanto tempo guardar"), ajuda = criar("p", "ajuda",
      "Mensagens, anexos e mensagens diretas mais antigas que o prazo são apagadas de vez, todo dia. O prazo vale para todo o andar.");
    ajuda.id = "ret-ajuda"; campo.setAttribute("aria-describedby", ajuda.id);
    campo.append(titulo, ajuda);
    const opcoes = PRAZOS.map(([dias, rotulo]) => {
      const l = criar("label", "marcar"), r = criar("input");
      r.type = "radio"; r.name = "ret-dias"; r.value = String(dias);
      r.addEventListener("change", () => { confirmar.hidden = true; mostrar(""); });
      l.append(r, criar("span", null, rotulo)); campo.append(l);
      return r;
    });
    const confirmar = criar("div", "confirmar-retencao"), texto = criar("p", "aviso-form ruim"), acoes = criar("div", "acoes");
    confirmar.dataset.papel = "confirmar"; confirmar.hidden = true; confirmar.setAttribute("role", "alert");
    const sim = criar("button", "botao", "Diminuir e apagar"), nao = criar("button", "botao fantasma", "Cancelar");
    sim.type = nao.type = "button";
    acoes.append(sim, nao); confirmar.append(texto, acoes);
    aviso.setAttribute("role", "status");
    const salvar = criar("button", "botao", "Salvar o prazo"), rodape = criar("div", "acoes");
    salvar.type = "submit"; rodape.append(salvar);
    const cota = criar("p", "ajuda");   // a cota de 5 GB de anexos da empresa (D6 b), com o aviso a partir de 90%
    cota.dataset.papel = "cota";
    form.append(campo, cota, confirmar, aviso, rodape);
    const mostrar = (t, tipo) => { aviso.textContent = t; aviso.className = "aviso-form" + (tipo ? ` ${tipo}` : ""); };
    const atual = () => (ret.cfg.equipe && Number.isInteger(ret.cfg.equipe.retencao) ? ret.cfg.equipe.retencao : 365);
    const escolhido = () => Number((opcoes.find(r => r.checked) || {}).value || atual());
    async function enviarPrazo(dias) {
      salvar.disabled = sim.disabled = true; mostrar("Salvando…");
      try {
        const r = await fetch(Andar.com("api/canal/retencao"), { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dias }) });
        if (r.status === 401) { location.href = "/entrar"; return; }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { mostrar(`Não salvou: ${typeof d.mensagem === "string" && d.mensagem ? d.mensagem : `o servidor respondeu ${r.status}.`}`, "ruim"); return; }
        if (ret.cfg.equipe && Number.isInteger(d.retencao)) ret.cfg.equipe.retencao = d.retencao;
        confirmar.hidden = true; mostrar("Prazo salvo.", "ok");
      } catch (e) { mostrar("Não salvou: sem conexão.", "ruim"); }
      finally { salvar.disabled = sim.disabled = false; }
    }
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const dias = escolhido();
      if (dias === atual()) { confirmar.hidden = true; mostrar("Esse já é o prazo."); return; }
      if (dias > atual()) return enviarPrazo(dias);   // aumentar não apaga nada
      texto.textContent = `Diminuir para ${dias} dias apaga agora, sem volta, as mensagens e os anexos com mais de ${dias} dias.`;
      confirmar.hidden = false; nao.focus();
    });
    sim.addEventListener("click", () => enviarPrazo(escolhido()));
    nao.addEventListener("click", () => { confirmar.hidden = true; marcar(); mostrar(""); salvar.focus(); });
    function marcar() {
      for (const r of opcoes) r.checked = Number(r.value) === atual();
      const c = ret.cfg.equipe.cota, ok = c && Number.isFinite(c.usado) && Number.isFinite(c.total) && c.total > 0;
      cota.hidden = !ok;
      if (!ok) return;
      const num = n => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), cheia = c.usado >= 0.9 * c.total;
      const tam = n => (n < 1024 ** 3 ? `${num(n / 1024 ** 2)} MB` : `${num(n / 1024 ** 3)} GB`);
      cota.textContent = `Anexos: ${tam(c.usado)} de ${tam(c.total)} usados.` +
        (cheia ? " A cota está quase cheia: apague arquivos antigos ou diminua o prazo, senão os novos anexos serão recusados." : "");
      cota.className = cheia ? "aviso-form ruim" : "ajuda";
      if (cheia) cota.setAttribute("role", "alert"); else cota.removeAttribute("role");
    }
    $("form-marca").after(form);
    return { form, marcar };
  }
  function mostrarRetencao(cfg) {
    // o mesmo critério do servidor (pode_moderar): o admin do prédio lê o andar de uma empresa, mas não muda o prazo dele
    const pode = !!cfg && !!cfg.equipe && Andar.perfil(cfg).admin && cfg.equipe.pode_moderar === true;
    if (!pode) { if (ret) ret.form.hidden = true; return; }
    if (!ret) ret = { cfg };
    ret.cfg = cfg;
    if (!ret.form) Object.assign(ret, montarRetencao());
    ret.form.hidden = false; ret.marcar();
  }

  // ---------- Meu perfil (qualquer papel): GET e POST /api/perfil, só da própria conta ---------------
  // Lido uma vez por página aberta; um servidor sem a rota (404/403) deixa a seção escondida. Mensagens do servidor, só por textContent.
  let perfilLido = false, perfilBoneco = null;
  const avisoPerfil = (t, tipo) => { const a = $("pf-aviso"); a.textContent = t; a.className = "aviso-form" + (tipo ? ` ${tipo}` : ""); };
  async function pedirPerfil(corpo) {
    const r = await fetch("api/perfil", corpo === undefined ? { credentials: "same-origin", cache: "no-store" }
      : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (r.status === 401) { location.href = "/entrar"; throw new Error("A sessão venceu."); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(typeof d.mensagem === "string" && d.mensagem ? d.mensagem : `O servidor respondeu ${r.status}.`); e.status = r.status; throw e; }
    return d;
  }
  function mostrarPerfil(d) {
    $("pf-nome").value = typeof d.nome === "string" ? d.nome : "";
    if (typeof d.usuario === "string") $("pf-conta").textContent = `Conta: ${d.usuario}${d.papel === "membro" ? " (membro)" : d.papel === "admin" ? " (admin)" : ""}`;
    // "aparencia": o boneco efetivo, decidido pelo servidor (o salvo ou o padrão da conta), o mesmo que os outros veem no mapa
    const ap = d.aparencia && typeof d.aparencia === "object" ? d.aparencia : d.avatar && typeof d.avatar === "object" ? d.avatar : Avatar.padrao(d.usuario || "");
    perfilBoneco = Avatar.seletor($("pf-boneco"), ap, null, "pf");
    mostrarAvisos(d.avisos);
    $("a-perfil").hidden = false;
  }
  // "Não perturbe" do aviso no celular: {modo: sempre | expediente | silencio, de, ate}; quem decide é o servidor (avisos.py)
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const modoAvisos = () => (document.querySelector('input[name="av-modo"]:checked') || {}).value || "sempre";
  const avisoAvisos = (t, tipo) => { const a = $("av-aviso"); a.textContent = t; a.className = "aviso-form" + (tipo ? ` ${tipo}` : ""); };
  function pintarAvisos() {
    $("av-janela").hidden = modoAvisos() !== "silencio";
    const ex = window.Expediente;
    $("av-expediente").textContent = ex ? `Só no expediente (${ex.abre} às ${ex.fecha})` : "Só no expediente";
  }
  // "Mostrar o começo da mensagem no aviso" (E.4; padrão ligado): só com as conversas da equipe (config.equipe), criado
  // aqui para não mexer no index.html; vai no POST como avisos.comeco
  let comeco = null;
  function caixaComeco() {
    if (comeco || !configApp || !configApp.equipe) return comeco;
    const rot = document.createElement("label"), span = document.createElement("span"), ajuda = document.createElement("p");
    comeco = document.createElement("input");
    comeco.type = "checkbox"; comeco.id = "av-comeco"; comeco.checked = true;
    rot.className = "marcar"; span.textContent = "Mostrar o começo da mensagem no aviso";
    ajuda.id = "av-comeco-ajuda"; ajuda.className = "ajuda";
    ajuda.textContent = "Desligado, o aviso de menção e de mensagem direta diz só quem escreveu. Na tela bloqueada, o que aparece também depende do ajuste do celular.";
    comeco.setAttribute("aria-describedby", ajuda.id);
    comeco.addEventListener("change", () => avisoAvisos(""));
    rot.append(comeco, span);
    $("av-aviso").before(rot, ajuda);
    return comeco;
  }
  function mostrarAvisos(p) {
    const modo = p && ["sempre", "expediente", "silencio"].includes(p.modo) ? p.modo : "sempre";
    const c = caixaComeco();
    if (c) c.checked = !(p && p.comeco === false);
    for (const r of document.querySelectorAll('input[name="av-modo"]')) r.checked = r.value === modo;
    if (modo === "silencio" && HHMM.test(p.de) && HHMM.test(p.ate)) { $("av-de").value = p.de; $("av-ate").value = p.ate; }
    pintarAvisos();
  }
  for (const r of document.querySelectorAll('input[name="av-modo"]')) r.addEventListener("change", () => { pintarAvisos(); avisoAvisos(""); });
  $("form-avisos").addEventListener("submit", async ev => {
    ev.preventDefault();
    const modo = modoAvisos(), de = $("av-de").value, ate = $("av-ate").value, bt = $("av-salvar");
    for (const c of ["av-de", "av-ate"]) $(c).removeAttribute("aria-invalid");
    if (modo === "silencio") {
      const ruim = !HHMM.test(de) ? "av-de" : !HHMM.test(ate) ? "av-ate" : de === ate ? "av-ate" : "";
      if (ruim) {
        $(ruim).setAttribute("aria-invalid", "true");
        avisoAvisos(de === ate && HHMM.test(de) ? "O silêncio precisa começar e acabar em horários diferentes." : "Preencha os dois horários (HH:MM).", "ruim");
        $(ruim).focus(); return;
      }
    }
    bt.disabled = true; avisoAvisos("Salvando…");
    try {
      const d = await pedirPerfil({ avisos: { ...(modo === "silencio" ? { modo, de, ate } : { modo }), ...(comeco ? { comeco: comeco.checked } : {}) } });
      mostrarAvisos(d.avisos); avisoAvisos("Avisos salvos.", "ok");
    } catch (e) { avisoAvisos(`Não salvou: ${e.message}`, "ruim"); }
    finally { bt.disabled = false; }
  });
  async function lerPerfil() {
    if (perfilLido || (window.Brincar && Brincar.demo)) return;
    try { mostrarPerfil(await pedirPerfil()); perfilLido = true; } catch (e) { if (e.status !== 401) $("a-perfil").hidden = true; }
  }
  $("form-perfil").addEventListener("submit", async ev => {
    ev.preventDefault();
    const nome = $("pf-nome").value.trim(), bt = $("pf-salvar");
    if (nome.length < 1 || nome.length > 40 || /[\u0000-\u001f\u007f]/.test(nome)) { avisoPerfil("Dê um nome de 1 a 40 caracteres.", "ruim"); $("pf-nome").focus(); return; }
    bt.disabled = true; avisoPerfil("Salvando…");
    try {
      const d = await pedirPerfil({ nome, avatar: perfilBoneco.valor() });
      mostrarPerfil(d); avisoPerfil("Perfil salvo.", "ok");
    } catch (e) { avisoPerfil(`Não salvou: ${e.message}`, "ruim"); }
    finally { bt.disabled = false; }
  });

  // o assistente de instalação (assistente.js) usa a mesma paleta, a mesma conferência do logo e o mesmo envio
  return { abrir, montarPaleta, erroDoLogo, enviar, PALETA };
})();
window.Personalizar = Personalizar;
