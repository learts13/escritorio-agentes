// "Avisar no celular": assina o push deste aparelho (Web Push com VAPID, mensagem vazia) e mostra em que pé está.
// A permissão de aviso só é pedida no clique. O servidor guarda até 10 aparelhos; o sw.js mostra o aviso.
// Contrato: GET /api/push/chave, POST /api/push/assinar (PushSubscription.toJSON()), POST /api/push/sair ({endpoint}).
// Sem push no servidor (404 push_desligado, inclusive com a chave VAPID ilegível), a caixa nem aparece; sem https, 409 precisa_https.
"use strict";

const Avisar = (() => {
  const $ = id => document.getElementById(id);
  const TEXTOS = {
    desligado: ["Receba um aviso neste aparelho quando um agente pedir a sua aprovação ou fizer uma pergunta.", "Avisar no celular"],
    ligado: ["Ligado neste aparelho: quando um agente pedir a sua aprovação ou fizer uma pergunta, chega um aviso.", "Desligar os avisos"],
    ligando: ["Ligando os avisos…", null],
    desligando: ["Desligando os avisos…", null],
    negado: ["Os avisos estão bloqueados para este site neste navegador. Libere nas configurações do site e tente de novo.", "Tentar de novo"],
    iphone: ["No iPhone e no iPad, os avisos só funcionam com o escritório na tela de início (iOS 16.4 ou mais novo): toque em Compartilhar, depois em Adicionar à Tela de Início, e abra o escritório por lá.", null],
    sem_suporte: ["Este navegador não recebe avisos. No celular, use o Chrome, o Edge, o Firefox ou, no iPhone, o escritório adicionado à tela de início.", null],
    cheio: ["Já há 10 aparelhos recebendo avisos deste escritório. Desligue os avisos em algum deles para ligar aqui.", "Tentar de novo"],
    invalido: ["O serviço de avisos deste navegador não é aceito pelo escritório. Tente o Chrome, o Edge ou o Firefox.", null],
    falha: ["Não deu para falar com o escritório agora. Tente de novo daqui a pouco.", "Tentar de novo"],
    servico: ["O navegador não conseguiu falar com o serviço de avisos dele. Tente de novo daqui a pouco ou use outro navegador.", "Tentar de novo"],
    precisa_https: ["O aviso no celular precisa do escritório em https. Quem instala o escritório pode publicar o endereço com https.", null],
  };
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const naTelaDeInicio = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const suporta = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  let api = null, estado = "", ocupado = false;

  function iniciar(a) {
    api = a;
    $("avisar-bt").addEventListener("click", clicar);
    if (api.demo()) return;   // demonstração: nada vai ao servidor, a caixa fica escondida
    verificar();
  }

  // como está agora, sem pedir nada à pessoa (a assinatura que já existe é reenviada: o servidor não duplica)
  async function verificar() {
    // http fora do localhost: o navegador nem expõe o serviceWorker; a caixa explica o https (sem push no servidor, some)
    if (!window.isSecureContext) return mostrar(await lerChave() === null ? "sem_push" : "precisa_https");
    if (ios() && !naTelaDeInicio() && !suporta()) return mostrar("iphone");
    if (!suporta()) return mostrar("sem_suporte");
    const chave = await lerChave();
    if (chave === null) return mostrar("sem_push");
    if (typeof chave === "string" && chave) return mostrar(chave);   // precisa_https: ninguém liga daqui
    if (Notification.permission === "denied") return mostrar("negado");
    const sub = await assinaturaAtual();
    if (!sub || Notification.permission !== "granted") return mostrar("desligado");
    // o servidor trocou de chave: o serviço de push recusa (403) e o servidor não apaga sozinho; religar é um toque
    if (chave && chaveTrocada(sub, chave)) { await sair(sub); return mostrar("desligado"); }
    const r = await postar("api/push/assinar", sub.toJSON());
    mostrar(r.status === 200 ? "ligado" : erroDe(r));
  }

  // a chave em bytes; null: servidor sem push; "precisa_https": o motivo do 409; "": falhou agora
  async function lerChave() {
    try {
      const r = await fetch("api/push/chave", { cache: "no-store", credentials: "same-origin" });
      if (r.status === 401) { location.href = "/entrar"; return ""; }
      if (r.status === 404) return null;
      const d = await r.json().catch(() => null);
      if (r.status === 409) return d && d.erro === "precisa_https" ? d.erro : "";
      return r.ok && d && typeof d.chave === "string" && /^[A-Za-z0-9_-]{87}$/.test(d.chave) ? bytes(d.chave) : "";   // 65 bytes em base64url sem padding
    } catch (e) { return ""; }
  }
  function bytes(b64url) {
    const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  async function assinaturaAtual() {
    try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (e) { return null; }
  }
  async function postar(url, corpo) { // POST same-origin com JSON (o navegador manda o Origin); status 0: sem conexão
    try {
      const r = await fetch(url, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (r.status === 401) location.href = "/entrar";
      return { status: r.status, d: await r.json().catch(() => null) };
    } catch (e) { return { status: 0, d: null }; }
  }
  function erroDe(r) {
    const e = r.d && r.d.erro;
    if (r.status === 409 && (e === "cheio" || e === "precisa_https")) return e;
    if (r.status === 400 && e === "endpoint_invalido") return "invalido";
    if (r.status === 404 && e === "push_desligado") return "sem_push";
    return "falha";
  }

  // ---------- clique: ligar ou desligar --------------------------------------------------
  async function clicar() {
    if (ocupado) return;
    ocupado = true;
    try { await (estado === "ligado" ? desligar() : ligar()); } finally { ocupado = false; }
  }
  async function ligar() {
    if (Notification.permission === "denied") return mostrar("negado");   // só as configurações do navegador desbloqueiam
    mostrar("ligando");
    const permissao = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permissao !== "granted") return mostrar(permissao === "denied" ? "negado" : "desligado");
    const chave = await lerChave();
    if (chave === null) return mostrar("sem_push");
    if (typeof chave === "string") return mostrar(chave || "falha");
    let sub;
    try {
      const reg = await navigator.serviceWorker.ready;
      sub = await reg.pushManager.getSubscription();
      if (sub && chaveTrocada(sub, chave)) { await sub.unsubscribe(); sub = null; }   // o servidor trocou de chave
      // sem serviço de push (navegador embutido, headless) o subscribe pode nunca responder: 20 s e desiste
      if (!sub) sub = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave }),
        new Promise((_, nao) => setTimeout(() => nao(new Error("sem resposta")), 20000))]);
    } catch (e) { return mostrar(e && e.name === "NotAllowedError" ? "negado" : "servico"); }   // AbortError ou sem resposta: o serviço de push do navegador
    const r = await postar("api/push/assinar", sub.toJSON());
    if (r.status === 200) return mostrar("ligado");
    if (r.status === 409 || r.status === 400 || r.status === 404) await sub.unsubscribe().catch(() => {});   // o servidor não guardou: não deixa assinatura órfã aqui
    mostrar(erroDe(r));
  }
  async function desligar() {
    mostrar("desligando");
    const sub = await assinaturaAtual();
    if (sub) await sair(sub);   // mesmo que o POST falhe: o serviço de push dá 410 e o servidor apaga sozinho
    mostrar("desligado");
  }
  async function sair(sub) {   // apaga a assinatura aqui e no servidor
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await postar("api/push/sair", { endpoint });
  }
  function chaveTrocada(sub, chave) {   // a assinatura foi feita com outra chave VAPID (sem options, não dá para saber)
    const antiga = sub.options && sub.options.applicationServerKey;
    return !!antiga && !igual(new Uint8Array(antiga), chave);
  }
  const igual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  // ---------- tela ------------------------------------------------------------------------
  function mostrar(qual) {
    estado = qual;
    $("avisar").hidden = qual === "sem_push";   // servidor sem push (desligado ou versão antiga): a caixa nem aparece
    if (qual === "sem_push") return;
    const [texto, botao] = TEXTOS[qual], bt = $("avisar-bt"), espera = qual === "ligando" || qual === "desligando";
    $("avisar").dataset.estado = qual;
    $("avisar-estado").textContent = texto;
    bt.hidden = !botao && !espera;
    if (botao) bt.textContent = botao;
    bt.setAttribute("aria-disabled", String(espera));
    bt.classList.toggle("secundario", qual === "ligado");
  }

  return { iniciar, verificar };
})();

window.Avisar = Avisar;
