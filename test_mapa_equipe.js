"use strict";
// A equipe no mapa (static/vida.js, 1.6 Onda 2): o status no boneco, a lista de quem está no andar, o "ir até a pessoa",
// o aceno e o "bater na porta" (a animação e o balão) e o modo econômico, que volta à taxa cheia enquanto alguém acena.
// Relógio, fetch e prédio falsos, no molde do test_mundo_presenca.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ANDAR = fs.readFileSync("static/expediente.js", "utf8");
const VIDA = fs.readFileSync("static/vida.js", "utf8");

// a recepção (em cima, porta embaixo), o corredor e a reunião (embaixo, porta em cima)
function predio() {
  const recepcao = { tipo: "recepcao", chave: "recepcao", nome: "Recepção", px: 100, py: 40, pw: 120, ph: 100, chao: 60, porta: { x: 160 } };
  const reuniao = { tipo: "reuniao", chave: "reuniao", nome: "Reunião", px: 100, py: 200, pw: 120, ph: 100, chao: 220, portas: [160] };
  return { salas: [recepcao], baixo: [reuniao], vagas: [], objetos: [], livre: () => true, corredorY: 170, corredorTopo: 150,
    corredorAlt: 40, predioRet: { x: 60, y: 30, w: 400, h: 300 }, entrada: { x: 62, calcadaY: 350 } };
}

function carregar(globais = {}) {
  let agora = 0, prox = 1;
  const timers = new Map(), pedidos = [], eventos = [], respostas = [];
  const doc = { hidden: false, addEventListener() {} };
  const contexto = {
    location: { hash: "" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: doc, console,
    performance: { now: () => agora },
    setTimeout: (f, ms) => { const id = prox++; timers.set(id, { f, em: agora + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    CustomEvent: class { constructor(tipo, o) { this.type = tipo; this.detail = o.detail; } },
    Ceu: { agora: () => ({ h: 10, escuro: 0 }) },
    Avatar: { padrao: u => ({ color: "padrao:" + u, eyes: "round", accessory: "" }) },
    matchMedia: () => ({ matches: false }), URLSearchParams, Date, Math,
    fetch: (url, opcoes = {}) => new Promise(ok => { const p = { url, opcoes, ok }; pedidos.push(p); respostas.push(p); }),
  };
  Object.assign(contexto, globais);
  contexto.window = contexto;
  contexto.dispatchEvent = ev => eventos.push(ev);
  vm.runInNewContext(ANDAR + "\n" + VIDA, contexto);
  const json = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  const t = {
    Vida: contexto.Vida, contexto, pedidos, eventos,
    async responder(trecho, status, corpo) {
      const i = respostas.findIndex(p => p.url.includes(trecho));
      assert.ok(i >= 0, `sem pedido pendente para ${trecho}`);
      respostas.splice(i, 1)[0].ok(json(status, corpo));
      for (let k = 0; k < 5; k++) await null;
    },
    async okPosts() { while (respostas.some(p => p.url.startsWith("api/presenca"))) await t.responder("api/presenca", 200, { seq: 1 }); },
    // passos de 50 ms no relógio e no mundo
    async passos(m, n, ate = () => false) { for (let i = 0; i < n && !ate(); i++) { agora += 50; t.Vida.passo(m, 0.05); await t.timers(); await t.okPosts(); } },
    // roda os timers vencidos (o próximo /api/ao-vivo, a presença que esperou)
    async timers() {
      for (const [id, tm] of [...timers].sort((x, y) => x[1].em - y[1].em)) if (tm.em <= agora) { timers.delete(id); tm.f(); for (let k = 0; k < 5; k++) await null; }
    },
    async proximoAoVivo() { agora += 1600; await t.timers(); },
    get agora() { return agora; },
    set agora(v) { agora = v; },
  };
  return t;
}
const pessoa = (usuario, nome, x, y, sala, extra = {}) => ({ usuario, nome, aparencia: null, x, y, destino: null, sala, olha: "baixo", ...extra });

// o mundo com o meu boneco já parado na recepção e as pessoas da lista
async function montar(lista, eu = "eu", globais = {}) {
  const t = carregar(globais);
  t.Vida.aoVivo({ invisivel: () => false });
  await t.responder("api/perfil", 200, { usuario: "eu", nome: "Eu Mesmo", avatar: null });
  await t.responder("api/ao-vivo", 200, { seq: 1, eu, pessoas: lista, mensagens: [] });
  const m = t.Vida.criarMundo(predio());
  await t.passos(m, 600, () => { const e = t.Vida.pessoas().find(p => p.eu); return e && e.sala === "recepcao" && !e.rota.length; });
  return { t, m, eu: t.Vida.pessoas().find(p => p.eu) };
}

(async () => {
  // status no boneco: só os 4 da lista; o resto (ou nada) fica sem status
  {
    const { t } = await montar([pessoa("ana", "Ana", 160, 100, "recepcao", { status: "ocupado" }),
      pessoa("bia", "Bia", 150, 100, "recepcao", { status: "reuniao" }), pessoa("caio", "Caio", 140, 100, "recepcao", { status: "<b>x</b>" }),
      pessoa("davi", "Davi", 170, 100, "recepcao")]);
    const st = Object.fromEntries(t.Vida.pessoas().filter(p => !p.eu).map(p => [p.nome, p.status]));
    assert.deepEqual(st, { Ana: "ocupado", Bia: "reuniao", Caio: null, Davi: null });
    assert.deepEqual([...t.Vida.STATUS], ["disponivel", "ocupado", "reuniao", "ausente"]);
  }

  // a lista do andar: eu primeiro, depois por nome; a sala pelo nome; nunca o "usuario" (no saguão, o id opaco)
  {
    const { t, m } = await montar([pessoa("p_00000000000000bb", "Bia", 160, 250, "reuniao", { status: "reuniao" }),
      pessoa("p_00000000000000aa", "Ana", 150, 100, "recepcao"), pessoa("p_00000000000000cc", "", 170, 170, "")], "p_00000000000000ee");
    const lista = t.Vida.equipe(m);
    assert.deepEqual(JSON.parse(JSON.stringify(lista.map(p => [p.nome, p.sala, p.status, p.eu]))), [   // cópia: vem de outro realm (vm)
      ["Eu Mesmo", "Recepção", null, true], ["Alguém", "Corredor", null, false], ["Ana", "Recepção", null, false],
      ["Bia", "Reunião", "reuniao", false]]);
    assert.ok(!JSON.stringify(lista).includes("p_0"), "o id opaco não vai para a lista");
    assert.ok(lista.every(p => typeof p.chave === "string"), "a chave: para o ir até e o aceno, opaca");
  }

  // ir até a pessoa: o meu boneco anda até perto dela (outra sala: pela porta e o corredor) e manda só o destino
  {
    const { t, m, eu } = await montar([pessoa("bia", "Bia", 160, 260, "reuniao")]);
    const bia = t.Vida.equipe(m).find(p => p.nome === "Bia");
    // a chegada ao ponto sorteado da recepção pode ter deixado o envio da presença adiado (ENVIO_MIN): sai antes de contar
    t.agora += 1000; await t.timers(); await t.okPosts(); t.agora += 1000;
    const antes = t.pedidos.filter(p => p.url.startsWith("api/presenca")).length;
    assert.equal(t.Vida.irAtePessoa(m, bia.chave), true);
    const fim = eu.rota.at(-1);
    assert.ok(Math.hypot(fim[0] - 160, fim[1] - 260) <= 24 && Math.hypot(fim[0] - 160, fim[1] - 260) >= 8, `perto, sem pisar nela: ${fim}`);
    assert.ok(eu.rota.some(([, y]) => y === 170), "passa pelo corredor");
    const posts = t.pedidos.filter(p => p.url.startsWith("api/presenca"));
    assert.equal(posts.length, antes + 1);
    assert.deepEqual(JSON.parse(posts.at(-1).opcoes.body).destino, [...fim.map(Math.round)]);
    assert.equal(t.Vida.irAtePessoa(m, "ninguem"), false);
    assert.equal(t.Vida.irAtePessoa(m, t.Vida.equipe(m).find(p => p.eu).chave), false, "até mim mesmo, não");
  }

  // acenar: o meu boneco acena com o balão; o laço volta à taxa cheia enquanto dura e para depois
  {
    const { t, m, eu } = await montar([pessoa("ana", "Ana", 150, 100, "recepcao")]);
    await t.passos(m, 10);
    assert.equal(t.Vida.mexendo(m), false, "todo mundo parado: modo econômico");
    const ana = t.Vida.equipe(m).find(p => p.nome === "Ana");
    assert.ok(t.Vida.acenar(m, ana.chave, "aceno"));
    await t.passos(m, 1);
    assert.equal(eu.pose, "acenando");
    assert.equal(eu.fala, "Oi, Ana!");
    assert.equal(t.Vida.mexendo(m), true);
    await t.passos(m, 80);
    assert.equal(eu.pose, "parado");
    assert.equal(eu.fala, null);
    assert.equal(t.Vida.mexendo(m), false);
    assert.equal(t.Vida.acenar(m, "ninguem", "aceno"), false);
  }

  // bater na porta: a pessoa está em outra sala; o meu boneco vai até a porta dela e bate ("Toc, toc!")
  {
    const { t, m, eu } = await montar([pessoa("bia", "Bia", 160, 260, "reuniao")]);
    const bia = t.Vida.equipe(m).find(p => p.nome === "Bia");
    assert.ok(t.Vida.acenar(m, bia.chave, "porta"));
    const fim = eu.rota.at(-1);
    assert.ok(fim[1] > 150 && fim[1] < 210, `para no corredor, na frente da porta da reunião: ${fim}`);
    assert.ok(Math.abs(fim[0] - 160) <= 20, `na porta: ${fim}`);
    assert.notEqual(eu.fala, "Toc, toc!", "só bate ao chegar");
    await t.passos(m, 400, () => !eu.rota.length);
    await t.passos(m, 1);
    assert.equal(eu.fala, "Toc, toc!");
    assert.equal(eu.pose, "acenando");
    assert.equal(eu.olha, "baixo", "virado para a porta da reunião, que fica embaixo do corredor");
    assert.equal(t.Vida.mexendo(m), true);
    await t.passos(m, 80);
    assert.equal(eu.pose, "parado");
    assert.equal(t.Vida.mexendo(m), false);
  }

  // bater na porta de quem está na minha sala (ou no corredor) vira um aceno, sem andar
  {
    const { t, m, eu } = await montar([pessoa("ana", "Ana", 150, 100, "recepcao")]);
    const ana = t.Vida.equipe(m).find(p => p.nome === "Ana");
    assert.ok(t.Vida.acenar(m, ana.chave, "porta"));
    assert.equal(eu.rota.length, 0);
    await t.passos(m, 1);
    assert.equal(eu.pose, "acenando");
  }

  // o gancho do painel (chat_sala.js): ChatSala.paraAoVivo() vai no fim da url do /api/ao-vivo; sem o painel, nada muda
  {
    const t = carregar();
    t.Vida.aoVivo({ invisivel: () => false });
    assert.ok(t.pedidos.some(p => p.url === "api/ao-vivo?desde=0"));
    const t2 = carregar({ ChatSala: { paraAoVivo: () => "&canal=geral&depois=5" } });
    t2.Vida.aoVivo({ invisivel: () => false });
    assert.ok(t2.pedidos.some(p => p.url === "api/ao-vivo?desde=0&canal=geral&depois=5"), t2.pedidos.map(p => p.url).join());
  }

  // contrato da Onda 2 no /api/ao-vivo: meu_status, status_texto, mural_v e no_predio (só no saguão); sem eles (store
  // desligado), nada muda: sem status, sem mural e sem total
  {
    const { t, m } = await montar([pessoa("ana", "Ana", 150, 100, "recepcao", { status: "ausente", status_texto: "almoço" })]);
    assert.equal(t.Vida.muralV("geral"), null);
    assert.equal(t.Vida.noPredio(), null);
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 2, eu: "eu", mensagens: [], meu_status: { status: "ocupado", texto: "foco" },
      mural_v: { geral: 7, "sala:reuniao": 3, x: "y" }, no_predio: 12,
      pessoas: [pessoa("ana", "Ana", 150, 100, "recepcao", { status: "ausente", status_texto: "almoço" })] });
    const [eu, ana] = t.Vida.equipe(m);
    assert.deepEqual([eu.status, eu.texto, ana.status, ana.texto], ["ocupado", "foco", "ausente", "almoço"]);
    assert.equal(t.Vida.muralV("geral"), 7);
    assert.equal(t.Vida.muralV("sala:cozinha"), null);
    assert.equal(t.Vida.muralV("x"), null, "versão que não é número: ignorada");
    assert.equal(t.Vida.noPredio(), 12);
  }

  // aceno recebido: quem acenou acena no mapa com o balão, e o evento "aceno" leva o nome e o tipo (a tela avisa)
  {
    const { t, m } = await montar([pessoa("ana", "Ana", 150, 100, "recepcao")]);
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 9, eu: "eu", mensagens: [], pessoas: [pessoa("ana", "Ana", 150, 100, "recepcao")],
      acenos: [{ de: "ana", nome: "Ana", tipo: "porta", seq: 9 }, { de: "fantasma", nome: "<b>Zé</b>", tipo: "aceno", seq: 8 }, { de: "ana", tipo: "x", seq: 7 }] });
    const ev = t.eventos.filter(e => e.type === "aceno").map(e => ({ ...e.detail }));
    assert.deepEqual(ev, [{ nome: "Ana", tipo: "porta" }, { nome: "<b>Zé</b>", tipo: "aceno" }], "tipo fora da lista: ignorado; quem não está no mapa também avisa");
    await t.passos(m, 1);
    const ana = t.Vida.pessoas().find(p => p.nome === "Ana");
    assert.equal(ana.pose, "acenando"); assert.equal(ana.fala, "Toc, toc!");
    assert.equal(t.Vida.mexendo(m), true);
  }

  // acenar manda POST /api/aceno {para, tipo} com o usuario da pessoa (no saguão, o id opaco); a resposta diz se chegou
  {
    const { t, m } = await montar([pessoa("p_00000000000000aa", "Ana", 150, 100, "recepcao"), pessoa("p_00000000000000bb", "Bia", 160, 260, "reuniao")], "p_00000000000000ee");
    const [, ana, bia] = t.Vida.equipe(m);
    const r1 = t.Vida.acenar(m, ana.chave, "aceno");
    const post = t.pedidos.find(p => p.url.startsWith("api/aceno"));
    assert.equal(post.opcoes.method, "POST");
    assert.deepEqual(JSON.parse(post.opcoes.body), { para: "p_00000000000000aa", tipo: "aceno" });
    await t.responder("api/aceno", 200, { ok: true });
    assert.deepEqual({ ...(await r1) }, { ok: true, mensagem: "" });
    const r2 = t.Vida.acenar(m, bia.chave, "porta");
    assert.deepEqual(JSON.parse(t.pedidos.filter(p => p.url.startsWith("api/aceno")).at(-1).opcoes.body), { para: "p_00000000000000bb", tipo: "porta" });
    await t.responder("api/aceno", 409, { erro: "ocupado", mensagem: "Bia está ocupada." });
    assert.deepEqual({ ...(await r2) }, { ok: false, mensagem: "Bia está ocupada." });
  }

  // mudar o meu status: POST /api/status; aceito, o meu boneco mostra na hora
  {
    const { t, m } = await montar([]);
    const r = t.Vida.mudarStatus("reuniao", "daily");
    const post = t.pedidos.find(p => p.url.startsWith("api/status"));
    assert.deepEqual(JSON.parse(post.opcoes.body), { status: "reuniao", texto: "daily" });
    await t.responder("api/status", 200, { status: "reuniao", texto: "daily" });
    assert.equal((await r).ok, true);
    assert.deepEqual([t.Vida.equipe(m)[0].status, t.Vida.pessoas().find(p => p.eu).status], ["reuniao", "reuniao"]);
    assert.equal(await t.Vida.mudarStatus("<b>", ""), null, "fora da lista nem sai");
  }

  // "Mensagem direta" na lista: o usuario da pessoa para ChatSala.abrirDM, só no andar da empresa com o store e a DM
  // ligados e com o painel carregado; nunca no saguão, nunca para mim, nunca para quem não está no mapa
  {
    const com = { equipe: { dm: true }, noSaguao: false };
    const { t, m } = await montar([pessoa("ana", "Ana", 150, 100, "recepcao")]);
    const [eu, ana] = t.Vida.equipe(m);
    assert.equal(t.Vida.dmCom(ana.chave, com), null, "sem o ChatSala, sem o botão");
    const ctx = t.contexto;   // o window do vm: o painel entra depois, como no navegador
    ctx.ChatSala = { abrir() {} };
    assert.equal(t.Vida.dmCom(ana.chave, com), null, "ChatSala sem abrirDM");
    ctx.ChatSala = { abrirDM() {} };
    assert.equal(t.Vida.dmCom(ana.chave, com), "ana");
    assert.equal(t.Vida.dmCom(eu.chave, com), null, "para mim, não");
    assert.equal(t.Vida.dmCom("r999", com), null);
    assert.equal(t.Vida.dmCom(ana.chave, { equipe: { dm: true }, noSaguao: true }), null, "no saguão, não");
    assert.equal(t.Vida.dmCom(ana.chave, { equipe: { dm: false }, noSaguao: false }), null);
    assert.equal(t.Vida.dmCom(ana.chave, { equipe: null, noSaguao: false }), null, "store desligado");
    assert.equal(t.Vida.dmCom(ana.chave, { equipe: { dm: true, pode_escrever: false }, noSaguao: false }), null, "quem só lê não manda DM");
    assert.equal(t.Vida.dmCom(ana.chave, { equipe: { dm: true, pode_escrever: true }, noSaguao: false }), "ana");
  }

  // modo apresentação (1.6 Onda 3): com o window.Apresentacao ligado, o nome mostrado de agentes, pessoas e o meu sai dele
  // ("Agente 1", "Pessoa 1", "Você") desde a chegada (sincronizar, /api/ao-vivo, perfil); desligar e Vida.renomear() devolve
  // os nomes reais. O nome mascarado vale para tudo o que lê b.nome (etiqueta, lista do andar, placar e faixa do ringue)
  {
    const { t, m } = await montar([pessoa("ana", "Ana Lima", 160, 100, "recepcao")]);
    let ligado = true;
    t.contexto.Apresentacao = { ligado: () => ligado, nome: b => (b.eu ? "Você" : b.handle ? "Agente 1" : "Pessoa 1") };
    t.Vida.renomear();
    const nomes = () => [...t.Vida.pessoas().map(p => p.nome)].sort();
    assert.deepEqual(nomes(), ["Pessoa 1", "Você"]);
    t.Vida.sincronizar(m, [{ id: "a1", handle: "bot", nome: "Robô do Financeiro", funcao: "" }], [], new Map(), () => ({ color: "graphite" }), true);
    assert.equal(m.bonecos.get("a1").nome, "Agente 1", "agente novo já chega mascarado");
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 2, eu: "eu", pessoas: [pessoa("ana", "Ana Lima", 160, 100, "recepcao")] });
    assert.deepEqual(nomes(), ["Pessoa 1", "Você"], "a leitura seguinte não devolve o nome real");
    assert.ok(t.Vida.equipe(m).every(p => !/Ana|Eu Mesmo/.test(p.nome)), "a lista do andar também");
    ligado = false;
    t.Vida.renomear();
    assert.deepEqual(nomes(), ["Ana Lima", "Eu Mesmo (você)"]);
    assert.equal(m.bonecos.get("a1").nome, "Robô do Financeiro");
    t.Vida.sincronizar(m, [{ id: "a1", handle: "bot", nome: "Robô Novo", funcao: "" }], [], new Map(), () => ({ color: "graphite" }), false);
    assert.equal(m.bonecos.get("a1").nome, "Robô Novo");
    delete t.contexto.Apresentacao;   // sem o apresentacao.js (TV, prévia): os nomes de sempre
    t.Vida.renomear();
    assert.equal(m.bonecos.get("a1").nome, "Robô Novo");
  }

  // reunião geral (1.6 Onda 3): a "convocacao" do /api/ao-vivo leva o meu boneco até a sala, com o balão "Reunião geral"
  // em mim e em quem está no andar; a mesma convocação (seq) não repete. Enquanto anda, o modo econômico fica na taxa cheia
  {
    const { t, m, eu } = await montar([pessoa("ana", "Ana", 150, 100, "recepcao")]);
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 3, eu: "eu", pessoas: [pessoa("ana", "Ana", 150, 100, "recepcao")],
      convocacao: { sala: "reuniao", de: "beto", nome: "Beto", seq: 3 } });
    await t.passos(m, 1);
    assert.ok(eu.rota.length > 0, "o meu boneco parte para a sala");
    const fim = eu.rota.at(-1);
    assert.ok(fim[0] > 100 && fim[0] < 220 && fim[1] > 220 && fim[1] < 300, `o destino é dentro da sala de reunião: ${fim}`);
    assert.equal(eu.fala, "Reunião geral");
    assert.equal(t.Vida.pessoas().find(p => !p.eu).fala, "Reunião geral", "quem está no andar também mostra o balão");
    assert.equal(t.Vida.mexendo(m), true, "andando: taxa cheia");
    const ev = t.eventos.find(e => e.type === "convocacao");
    assert.ok(ev && ev.detail.nome === "Beto" && ev.detail.sala === "Reunião", "a tela pode avisar quem chamou e onde");
    await t.passos(m, 600, () => !eu.rota.length);
    assert.equal(eu.sala, "reuniao", "chegou na sala");
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 4, eu: "eu", pessoas: [], convocacao: { sala: "recepcao", de: "beto", nome: "Beto", seq: 3 } });
    await t.passos(m, 1);
    assert.equal(eu.rota.length, 0, "a mesma convocação não repete");
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 5, eu: "eu", pessoas: [], convocacao: { sala: "sala:nada", de: "x", nome: "X", seq: 5 } });
    await t.passos(m, 1);
    assert.equal(eu.rota.length, 0, "sala que não existe no mapa: nada");
  }

  // com "reduzir movimento", o boneco aparece direto na sala (sem caminhar) e avisa o servidor
  {
    const { t, m, eu } = await montar([], "eu", { matchMedia: () => ({ matches: true }) });
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 3, eu: "eu", pessoas: [], convocacao: { sala: "reuniao", de: "beto", nome: "Beto", seq: 3 } });
    await t.passos(m, 1);
    assert.equal(eu.rota.length, 0);
    assert.ok(eu.y > 220 && eu.y < 300, "já na sala");
    assert.equal(eu.sala, "reuniao");
  }

  // a placa "Em reunião": o reunioes_v do /api/ao-vivo faz ler a agenda (GET /api/reunioes); a sala fica "em reunião"
  // enquanto inicio <= agora < fim. O mesmo v não relê; sem o campo (saguão, store desligado), não pede nada
  {
    const { t } = await montar([]);
    assert.equal(t.pedidos.some(p => p.url.includes("api/reunioes")), false, "sem reunioes_v, sem pedido");
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 3, eu: "eu", pessoas: [], reunioes_v: 7 });
    const agora = Math.floor(Date.now() / 1000);
    await t.responder("api/reunioes", 200, { v: 7, reunioes: [
      { id: 1, titulo: "Planejamento", sala: "reuniao", inicio: agora - 60, duracao: 30, fim: agora + 1740 },
      { id: 2, titulo: "Depois", sala: "cozinha", inicio: agora + 3600, duracao: 30, fim: agora + 5400 },
      { id: 3, titulo: "Lixo", sala: 5, inicio: "x", fim: null }] });
    assert.equal(t.Vida.emReuniao("reuniao"), true);
    assert.equal(t.Vida.emReuniao("cozinha"), false, "marcada para depois");
    assert.equal(t.Vida.emReuniao("recepcao"), false);
    const pedidos = () => t.pedidos.filter(p => p.url.includes("api/reunioes")).length;
    assert.equal(pedidos(), 1);
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 4, eu: "eu", pessoas: [], reunioes_v: 7 });
    assert.equal(pedidos(), 1, "o mesmo v não relê");
    await t.proximoAoVivo();
    await t.responder("api/ao-vivo", 200, { seq: 5, eu: "eu", pessoas: [], reunioes_v: 8 });
    await t.responder("api/reunioes", 200, { v: 8, reunioes: [] });
    assert.equal(t.Vida.emReuniao("reuniao"), false, "cancelada");
  }

  // a placa na porta (mapa.js): perto da porta, do lado do corredor, sem sair da parede da sala
  {
    const c = { window: {}, console }; c.window = c;
    vm.runInNewContext(fs.readFileSync("static/mapa.js", "utf8"), c);
    const cima = { px: 100, py: 40, pw: 200, ph: 100, porta: { x: 160 } }, baixo = { px: 100, py: 200, pw: 200, ph: 100, chao: 236, portas: [160] };
    const canto = { px: 100, py: 200, pw: 200, ph: 100, chao: 236, portas: [274] };   // porta na ponta (a cozinha): a placa vai para a esquerda
    const k = c.Mapa.placaReuniao(canto);
    assert.ok(k.x + k.w < 274 - 8 && k.x >= canto.px, `à esquerda da porta: ${JSON.stringify(k)}`);
    const a = c.Mapa.placaReuniao(cima), b = c.Mapa.placaReuniao(baixo);
    assert.ok(a.x >= cima.px && a.x + a.w <= cima.px + cima.pw && Math.abs(a.y - (cima.py + cima.ph)) < 14, `em cima: junto da porta de baixo ${JSON.stringify(a)}`);
    assert.ok(a.x > 160 + 14 || a.x + a.w < 160 - 14, "sem cobrir a porta");
    assert.ok(b.x >= baixo.px && b.x + b.w <= baixo.px + baixo.pw && b.y >= baixo.py && b.y + b.h <= baixo.chao, `embaixo: na parede ${JSON.stringify(b)}`);
    assert.ok(b.x > 160 + 8 || b.x + b.w < 160 - 8, "sem cobrir a porta");
  }

  // o ícone do status (mapa.js): pixel art 9x9 desenhado em código, um desenho diferente por status (não só a cor), o
  // detalhe branco com contraste de pelo menos 3:1 sobre o fundo (WCAG 1.4.11) e nada para status fora da lista
  {
    const c = { window: {}, console }; c.window = c;
    vm.runInNewContext(fs.readFileSync("static/mapa.js", "utf8"), c);
    const Mapa = c.Mapa, vistos = new Set();
    const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    for (const st of ["disponivel", "ocupado", "reuniao", "ausente"]) {
      const ic = Mapa.iconeStatus(st);
      assert.equal(ic.linhas.length, 9); assert.ok(ic.linhas.every(l => /^[.o#+]{9}$/.test(l)), st);
      const detalhe = ic.linhas.join("").replace(/[^+]/g, "-");
      assert.ok(detalhe.includes("+") && !vistos.has(detalhe), `o desenho de ${st} é só dele`); vistos.add(detalhe);
      assert.ok((lum("#ffffff") + 0.05) / (lum(ic.cor) + 0.05) >= 3, `contraste de ${st}`);
      assert.equal(typeof ic.rotulo, "string");
      const feitos = []; const ctx = { set fillStyle(v) { feitos.push(v); }, fillRect() { feitos.push("r"); } };
      Mapa.desenharStatus(ctx, st, 10, 20, 2);
      assert.ok(feitos.filter(f => f === "r").length > 40);
    }
    assert.equal(Mapa.iconeStatus("<b>"), null);
    const nada = []; Mapa.desenharStatus({ set fillStyle(v) { nada.push(v); }, fillRect() { nada.push("r"); } }, null, 0, 0, 1);
    assert.equal(nada.length, 0);
  }

  // o mural na parede (mapa.js): só com config.equipe.mural; num trecho de parede que sobrou livre (sem porta, janela,
  // placa, logo, quadro, móvel alto), sem mudar mais nada do prédio. A recepção mostra o "geral"; cada sala, o dela
  {
    const ctx = new Proxy({}, { get: (o, k) => (k === "measureText" ? t => ({ width: String(t).length * 4 }) : k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
    const c = { console, getComputedStyle: () => ({ getPropertyValue: () => "" }), document: { documentElement: {}, createElement: () => ({ getContext: () => ctx }) } };
    c.window = c;
    vm.runInNewContext(fs.readFileSync("static/mapa.js", "utf8"), c);
    const atlas = { json: JSON.parse(fs.readFileSync("static/tema/atlas.json", "utf8")), img: {} };
    const times = [{ nome: "Dev", tipo: "mesas", parede: 2, piso: 3, handles: ["a", "b", "c"] }, { nome: "Arte", tipo: "mesas", parede: 1, piso: 2, handles: ["d"] }];
    const resumo = p => JSON.stringify({ o: p.objetos.map(o => [o.nome || o.tipo, o.x, o.y]), q: p.quadros, v: p.vagas.map(v => [v.x, v.y, v.tipo]), j: p.janelas,
      s: [...p.salas, ...p.baixo].map(s => [s.chave, s.px, s.py, s.pw, s.ph, s.placa]) });
    for (const grupos of [[], times]) {
      const sem = c.Mapa.montarPredio(atlas, { empresa: "X" }, grupos, null);
      const nulo = c.Mapa.montarPredio(atlas, { empresa: "X", equipe: null }, grupos, null);
      const com = c.Mapa.montarPredio(atlas, { empresa: "X", equipe: { mural: true } }, grupos, null);
      const salas = p => [...p.salas, ...p.baixo];
      assert.ok(salas(sem).every(s => !s.mural) && salas(nulo).every(s => !s.mural), "sem store, sem mural");
      assert.equal(resumo(nulo), resumo(sem));
      assert.equal(resumo(com), resumo(sem), "o mural não mexe em mais nada do prédio");
      assert.ok(salas(com).filter(s => s.mural).length >= salas(com).length - 1, "no máximo uma sala sem lugar na parede");
      for (const s of salas(com)) {
        const q = s.mural;
        if (!q) { assert.notEqual(s.tipo, "recepcao", "a recepção sempre tem o mural"); continue; }   // parede cheia (a cozinha): sem quadro
        assert.equal(q.canal, s.tipo === "recepcao" ? "geral" : "sala:" + s.chave);
        assert.ok(q.x >= s.px + 4 && q.x + q.w <= s.px + s.pw - 4 && q.y >= s.py + 2 && q.y + q.h <= s.chao - 2, `${s.chave}: na parede da sala`);
        const bate = r => r && q.x < r.x + r.w && q.x + q.w > r.x && q.y < r.y + r.h && q.y + q.h > r.y;
        assert.ok(!com.quadros.some(bate) && !com.janelas.some(bate), `${s.chave}: sem cobrir quadro nem janela`);
        assert.ok(!bate(s.placaLogo) && !bate(s.logo) && !(s.placa && bate({ x: s.placa.x, y: s.placa.y, w: s.placa.total, h: 12 })), `${s.chave}: sem cobrir placa nem logo`);
        assert.ok((s.portas || []).every(px => q.x > px + 18 || q.x + q.w < px - 18), `${s.chave}: longe da porta`);
      }
    }
  }

  console.log("test_mapa_equipe: ok");
})().catch(e => { console.error(e); process.exit(1); });
