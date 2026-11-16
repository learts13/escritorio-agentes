// Service worker do PWA: o app vai para a tela de início e recebe o aviso no celular.
// Não guarda nada: sem handler de fetch, sem Cache Storage e sem carregar outros scripts (condição do gate). Páginas, /entrar,
// /oauth/* e /api/* vão sempre direto à rede, e os estáticos seguem o cache HTTP de sempre (com o ?v= de cada página).
// O push chega VAZIO: quem diz o que aconteceu é o GET /api/avisos, com o cookie da sessão (nunca com o rótulo da tarefa).
// Os avisos pessoais (menção, DM, aceno, porta) já vêm com título e corpo limpos do servidor; corpo vazio = a pessoa
// desligou "mostrar o começo da mensagem". Os de reunião (1.6 Onda 3: "Reunião em 5 min" e a convocação para a reunião
// geral) também; o toque na reunião abre a agenda do andar nela (?reuniao=<id>).
"use strict";

self.addEventListener("install", () => self.skipWaiting());   // versão nova entra sem esperar fechar as abas
self.addEventListener("activate", ev => ev.waitUntil(self.clients.claim()));

const TIPOS = { pediu_aprovacao: "pede a sua aprovação", pediu_resposta: "tem uma pergunta para você" };
const PESSOAIS = new Set(["mencao", "dm", "aceno", "porta", "reuniao", "convocacao"]), GENERICO = "Toque para abrir o escritório.";
const texto = (t, max) => (typeof t === "string" && t.length <= max ? t : null);
const andarOk = a => (typeof a === "string" && /^([0-9a-f]{8}|principal)$/.test(a) ? a : null);   // o principal: a instalação de uma empresa só
const reuniaoOk = n => (Number.isSafeInteger(n) && n > 0 ? n : null);
const canalOk = c => (typeof c === "string" && /^(geral|sala:[^\u0000-\u001f]{1,80}|dm:[1-9][0-9]{0,17})$/.test(c) ? c : null);   // o formato do contrato

async function lerAviso() { // sem sessão (401), servidor fora ou resposta estranha: o aviso genérico
  try {
    const r = await fetch(new URL("api/avisos", self.registration.scope), { credentials: "same-origin", cache: "no-store" });
    const a = r.ok ? (await r.json()).aviso : null;
    if (a && typeof a.nome === "string" && a.nome && a.nome.length <= 80 && Object.hasOwn(TIPOS, a.tipo))
      return { titulo: `${a.nome} ${TIPOS[a.tipo]}`, corpo: GENERICO, agente: typeof a.agente === "string" && a.agente.length <= 100 ? a.agente : null, andar: null, canal: null, reuniao: null };
    if (a && PESSOAIS.has(a.tipo) && texto(a.titulo, 120))
      return { titulo: a.titulo, corpo: texto(a.corpo, 120) || GENERICO, agente: null, andar: andarOk(a.andar), canal: canalOk(a.canal),
        reuniao: a.tipo === "reuniao" ? reuniaoOk(a.reuniao) : null };
  } catch (e) { /* sem rede ou JSON inválido */ }
  return { titulo: "Um agente precisa de você", corpo: GENERICO, agente: null, andar: null, canal: null, reuniao: null };
}

self.addEventListener("push", ev => ev.waitUntil(lerAviso().then(({ titulo, corpo, agente, andar, canal, reuniao }) =>
  self.registration.showNotification(titulo, {
    body: corpo, icon: "icone-192.png", lang: "pt-BR",
    tag: "escritorio-aviso", renotify: true, data: { agente, andar, canal, reuniao },   // um aviso por vez na bandeja; o novo substitui e toca de novo
  }))));

// toque: foca a aba do escritório que já estiver aberta (e manda ir ao agente, ou ao andar e canal do aviso pessoal) ou abre
// uma nova já no agente ou no andar
self.addEventListener("notificationclick", ev => {
  ev.notification.close();
  const data = ev.notification.data || {}, agente = data.agente, andar = andarOk(data.andar), canal = canalOk(data.canal), reuniao = reuniaoOk(data.reuniao),
    url = new URL(self.registration.scope);
  if (agente) url.searchParams.set("agente", agente);
  if (reuniao && andar) url.searchParams.set("reuniao", String(reuniao));
  if (andar) url.hash = `andar=${andar}`;
  ev.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(abas => {
    const aba = abas.find(c => { const u = new URL(c.url); return u.origin === url.origin && u.pathname === url.pathname; });
    if (!aba) return self.clients.openWindow(url.href);
    if (agente) aba.postMessage({ tipo: "agente", agente });
    else if (reuniao && andar) aba.postMessage({ tipo: "reuniao", andar, reuniao });   // o app.js troca de andar e abre a agenda na reunião
    else if (andar) aba.postMessage({ tipo: "aviso", andar, canal });   // aviso pessoal: o app.js troca de andar e abre o canal
    return aba.focus();
  }));
});
