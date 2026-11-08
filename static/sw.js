// Service worker do PWA: o app vai para a tela de início e recebe o aviso no celular.
// Não guarda nada: sem handler de fetch, sem Cache Storage e sem carregar outros scripts (condição do gate). Páginas, /entrar,
// /oauth/* e /api/* vão sempre direto à rede, e os estáticos seguem o cache HTTP de sempre (com o ?v= de cada página).
// O push chega VAZIO: quem diz o que aconteceu é o GET /api/avisos, com o cookie da sessão (nunca com o rótulo da tarefa).
"use strict";

self.addEventListener("install", () => self.skipWaiting());   // versão nova entra sem esperar fechar as abas
self.addEventListener("activate", ev => ev.waitUntil(self.clients.claim()));

const TIPOS = { pediu_aprovacao: "pede a sua aprovação", pediu_resposta: "tem uma pergunta para você" };

async function lerAviso() { // sem sessão (401), servidor fora ou resposta estranha: o aviso genérico
  try {
    const r = await fetch(new URL("api/avisos", self.registration.scope), { credentials: "same-origin", cache: "no-store" });
    const a = r.ok ? (await r.json()).aviso : null;
    if (a && typeof a.nome === "string" && a.nome && a.nome.length <= 80 && Object.hasOwn(TIPOS, a.tipo))
      return { titulo: `${a.nome} ${TIPOS[a.tipo]}`, agente: typeof a.agente === "string" && a.agente.length <= 100 ? a.agente : null };
  } catch (e) { /* sem rede ou JSON inválido */ }
  return { titulo: "Um agente precisa de você", agente: null };
}

self.addEventListener("push", ev => ev.waitUntil(lerAviso().then(({ titulo, agente }) =>
  self.registration.showNotification(titulo, {
    body: "Toque para abrir o escritório.", icon: "icone-192.png", lang: "pt-BR",
    tag: "escritorio-aviso", renotify: true, data: { agente },   // um aviso por vez na bandeja; o novo substitui e toca de novo
  }))));

// toque: foca a aba do escritório que já estiver aberta (e manda ir ao agente) ou abre uma nova já no agente
self.addEventListener("notificationclick", ev => {
  ev.notification.close();
  const agente = ev.notification.data && ev.notification.data.agente, url = new URL(self.registration.scope);
  if (agente) url.searchParams.set("agente", agente);
  ev.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(abas => {
    const aba = abas.find(c => { const u = new URL(c.url); return u.origin === url.origin && u.pathname === url.pathname; });
    if (!aba) return self.clients.openWindow(url.href);
    if (agente) aba.postMessage({ tipo: "agente", agente });
    return aba.focus();
  }));
});
