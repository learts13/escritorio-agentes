// Time-lapse do dia: um quadro do prédio inteiro a cada 2 minutos do expediente, guardado no IndexedDB SÓ deste
// navegador, e um vídeo de uns 30 s montado aqui mesmo (canvas fora da tela + MediaRecorder). Nada vai ao servidor
// nem ao agentes.chat. Uma aba grava por navegador (Web Locks); a TV toma a vez. Fica só o dia de hoje: a virada
// do dia e o "Apagar" limpam tudo. O canvas não desenha rótulo de tarefa nem texto de conversa (só nomes, placas
// e as falas fixas do FRASES, das festas e dos placares), e o diálogo avisa disso antes de baixar.
"use strict";

const Timelapse = (() => {
  const INTERVALO = 120000, LARGURA = 960, TETO_QUADROS = 400, TETO_BYTES = 30 * 1024 * 1024;
  const FPS = 14, MINIMO_MS = 8000;   // ~30 s com o dia cheio (uns 390 quadros); dia curto: pelo menos 8 s de vídeo
  const BANCO = "escritorio-timelapse", LOJA = "quadros", TRAVA = "escritorio-timelapse";
  const $ = id => document.getElementById(id);
  const hojeEm = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());   // AAAA-MM-DD em Brasília
  const suporta = "indexedDB" in window && "locks" in navigator && typeof MediaRecorder === "function" && !!HTMLCanvasElement.prototype.captureStream;

  let api = null, banco = null, gravando = false, proximo = 0, pedido = false, montando = false, origem = null;

  function iniciar(a) {
    api = a;
    $("abrir-timelapse").addEventListener("click", abrir);
    $("tl-fechar").addEventListener("click", () => $("dlg-timelapse").close());
    $("dlg-timelapse").addEventListener("close", () => { const o = origem; origem = null; if (o && o.isConnected) o.focus(); });
    $("tl-baixar").addEventListener("click", baixar);
    $("tl-apagar").addEventListener("click", async () => { await limpar(() => true); proximo = 0; mostrar("Quadros apagados."); });
    if (!suporta || api.demo()) return;   // navegador sem as peças, ou demonstração: só o diálogo explica
    limparVelhos();   // quem abre no dia seguinte fora do expediente também não fica com os quadros de ontem
    pegarVez(false);
    setInterval(() => { if (gravando && Date.now() >= proximo && api.podeGravar()) pedido = true; }, 15000);
  }

  // ---------- quem grava ----------------------------------------------------------------
  // a trava fica presa enquanto a aba vive; roubada (a TV ligou noutra aba), volta para a fila. Só um pedido por aba
  // na fila: o da TV cancela o que esperava aqui antes de roubar
  let naFila = null;
  function pegarVez(roubar) {
    if (naFila) { naFila.abort(); naFila = null; }
    const ctl = roubar ? null : new AbortController();
    naFila = ctl;
    let segurou = false;
    navigator.locks.request(TRAVA, roubar ? { steal: true } : { signal: ctl.signal }, () => {
      if (naFila === ctl) naFila = null;
      segurou = gravando = true;
      return new Promise(() => {});   // só solta quando a aba fecha (ou quando outra rouba)
    }).catch(() => {}).finally(() => {
      if (segurou) gravando = false;
      if (!(ctl && ctl.signal.aborted)) setTimeout(() => pegarVez(false), 1000);   // cancelado aqui mesmo: já há outro pedido
    });
  }
  function preferir() { if (suporta && !api.demo() && !gravando) pegarVez(true); }   // a TV: grava aqui, de preferência

  // ---------- banco -----------------------------------------------------------------------
  function abrirBanco() {
    if (banco) return banco;
    banco = new Promise((ok, erro) => {
      const r = indexedDB.open(BANCO, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(LOJA, { keyPath: "id", autoIncrement: true });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { banco = null; erro(r.error); };
    });
    return banco;
  }
  async function loja(modo) { return (await abrirBanco()).transaction(LOJA, modo).objectStore(LOJA); }
  const pronto = req => new Promise((ok, erro) => { req.onsuccess = () => ok(req.result); req.onerror = () => erro(req.error); });
  // percorre os quadros em ordem; apaga os que "sai(q)" disser (sem carregar as imagens na memória de uma vez)
  async function limpar(sai) {
    const st = await loja("readwrite"), fica = [];
    await new Promise((ok, erro) => {
      const c = st.openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return ok(); if (sai(cur.value)) cur.delete(); else fica.push({ id: cur.value.id, tam: cur.value.tam }); cur.continue(); };
      c.onerror = () => erro(c.error);
    });
    return fica;
  }
  async function quadros() { return pronto((await loja("readonly")).getAll()); }
  const limparVelhos = () => limpar(q => q.dia !== hojeEm()).catch(() => []);   // a virada do dia, mesmo sem gravar

  // ---------- captura (chamada pelo laço do app.js, logo depois de desenhar) --------------
  function quadro() {
    if (!pedido) return;
    pedido = false; proximo = Date.now() + INTERVALO;
    const out = document.createElement("canvas");
    if (!api.fotografar(out, LARGURA)) return;
    const salvar = blob => { if (blob) guardar(blob).catch(() => {}); };
    out.toBlob(b => (b && b.type === "image/webp" ? salvar(b) : out.toBlob(salvar, "image/jpeg", 0.75)), "image/webp", 0.6);   // ~90 KB; sem WebP (Safari antigo): JPEG
  }
  async function guardar(blob) {
    const dia = hojeEm();
    let fica = await limpar(q => q.dia !== dia);   // virou o dia: começa do zero
    await pronto((await loja("readwrite")).add({ dia, em: Date.now(), tam: blob.size, blob }));
    fica.push({ tam: blob.size });
    let bytes = fica.reduce((t, q) => t + q.tam, 0), sobra = fica.length - TETO_QUADROS;
    if (sobra > 0 || bytes > TETO_BYTES) { // no teto: saem os mais antigos
      const saem = new Set();
      for (const q of fica) { if (sobra <= 0 && bytes <= TETO_BYTES) break; if (q.id === undefined) break; saem.add(q.id); sobra--; bytes -= q.tam; }
      await limpar(q => saem.has(q.id));
    }
    if ($("dlg-timelapse").open) mostrar();
  }

  // ---------- diálogo -----------------------------------------------------------------------
  function abrir() {
    const d = $("dlg-timelapse"); if (!d.showModal || d.open) return;
    origem = document.activeElement;
    d.showModal(); $("tl-fechar").focus();
    mostrar();
  }
  async function mostrar(nota) {
    const est = $("tl-estado");
    if (!suporta) { est.textContent = "Este navegador não grava o time-lapse (falta IndexedDB, Web Locks ou MediaRecorder)."; $("tl-baixar").disabled = $("tl-apagar").disabled = true; return; }
    if (api.demo()) { est.textContent = "Na demonstração o time-lapse não grava: abra o escritório de verdade."; $("tl-baixar").disabled = $("tl-apagar").disabled = true; return; }
    let lista = [];
    try { await limparVelhos(); lista = (await quadros()).filter(q => q.dia === hojeEm()); } catch (e) { est.textContent = "Não deu para ler os quadros deste navegador."; return; }
    const n = lista.length, desde = n ? new Date(lista[0].em).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "";
    const quem = gravando ? "Esta aba grava o time-lapse" : "Outra aba deste navegador grava o time-lapse";
    const quando = api.podeGravar() ? "um quadro a cada 2 minutos do expediente" : "em pausa agora (fora do expediente ou numa simulação)";
    est.textContent = `${nota ? `${nota} ` : ""}${quem}: ${quando}. ${n ? `${n} ${n === 1 ? "quadro" : "quadros"} hoje, desde as ${desde}.` : "Nenhum quadro hoje ainda."}`;
    $("tl-baixar").disabled = n < 2 || montando; $("tl-apagar").disabled = !n || montando;
  }

  // ---------- vídeo -------------------------------------------------------------------------
  function formato() {
    for (const [tipo, ext] of [["video/mp4", "mp4"], ["video/webm;codecs=vp9", "webm"], ["video/webm", "webm"]]) if (MediaRecorder.isTypeSupported(tipo)) return { tipo, ext };
    return null;
  }
  async function baixar() {
    const f = formato();
    if (!f) { $("tl-progresso").textContent = "Este navegador não grava vídeo (nem MP4 nem WebM)."; return; }
    if (montando) return;
    const lista = (await quadros()).filter(q => q.dia === hojeEm());
    if (lista.length < 2) return mostrar();
    montando = true; $("tl-baixar").disabled = $("tl-apagar").disabled = true;
    const prog = $("tl-progresso");
    try {
      const primeiro = await createImageBitmap(lista[0].blob), cv = document.createElement("canvas");
      cv.width = primeiro.width; cv.height = primeiro.height; primeiro.close();
      const c = cv.getContext("2d"), fluxo = cv.captureStream(FPS), partes = [];
      const rec = new MediaRecorder(fluxo, { mimeType: f.tipo, videoBitsPerSecond: 4e6 });
      rec.ondataavailable = e => { if (e.data.size) partes.push(e.data); };
      const fim = new Promise(ok => { rec.onstop = ok; });
      rec.start(1000);
      const passo = Math.max(1000 / FPS, MINIMO_MS / lista.length);
      for (const [i, q] of lista.entries()) {
        const img = await createImageBitmap(q.blob);
        c.drawImage(img, 0, 0, cv.width, cv.height); img.close();
        prog.textContent = `Montando o vídeo… ${Math.round(((i + 1) / lista.length) * 100)}%`;
        await new Promise(ok => setTimeout(ok, passo));
      }
      rec.stop(); await fim;
      for (const t of fluxo.getTracks()) t.stop();
      const video = new Blob(partes, { type: f.tipo.split(";")[0] }), a = document.createElement("a");
      a.href = URL.createObjectURL(video); a.download = `escritorio-${hojeEm()}.${f.ext}`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      prog.textContent = "Vídeo pronto: o download começou.";
    } catch (e) {
      prog.textContent = "Não deu para montar o vídeo neste navegador.";
    } finally {
      montando = false; mostrar();
    }
  }

  return { iniciar, quadro, preferir };
})();

window.Timelapse = Timelapse;
