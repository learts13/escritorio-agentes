// Zeladoria (Firmópolis): o banheiro suja, a cafeteira e a luminária quebram, e a equipe do prédio resolve. A faxineira
// limpa o banheiro e as migalhas da cozinha, o zelador conserta o que quebrou e o porteiro fica na entrada (à noite, o
// vigia com a lanterna). Como a vida dos terminais, é só desta tela: nada vai ao servidor. Os NPCs são gente
// (sprites.js: Sprites.gente) de uniforme, figurantes como as pessoas: fora das vagas e da vida social.
// O vida.js chama passo() a cada quadro (com o caminho dele: rotaAte, andar, pontoDeVisita) e pergunta bloqueado(),
// suja() e quebrado(); o app.js desenha (chao, npc, ar) e abre o cartão. Teste pelo console: Zeladoria.sujar(95),
// Zeladoria.quebrar("cafe"), Zeladoria.quebrar("luz"), Zeladoria.chamar("limpeza"), Zeladoria.estado().
"use strict";

const Zeladoria = (() => {
  const SUJA = 60, INTERDITA = 90;                              // sujeira de 0 a 100: moscas e "eca" na saída; placa e ninguém entra
  const USO = { uso: 6, apertado: 10, furou: 14, demo: 6 };     // cada uso do banheiro; o apertado e quem furou a fila sujam mais
  const MAX_MIGALHAS = 6, LIMPAR_T = 7, VARRER_T = 2.5, CONSERTAR_T = 6;
  const UNIFORME = { limpeza: "#3fa7d6", manutencao: "#f08a24", portaria: "#2c3e7a", vigia: "#3b3b47" };
  const FUNCAO = { limpeza: "Limpeza", manutencao: "Manutenção", portaria: "Portaria", vigia: "Vigia" };
  const NOMES = { limpeza: ["Dona Cida", "Seu Bené", "Dona Rosa"], manutencao: ["Seu Zé", "Dona Neide", "Seu Tião"], portaria: ["Seu Lima"], vigia: ["Seu Josué"] };
  const FRASES = {
    limpo: ["Brilhando!", "Agora sim, cheirosinho", "Prontinho, pode usar"], consertado: ["Prontinho!", "Era só um parafuso", "Funcionando de novo"],
    chegou: { limpeza: "Licença, limpeza!", manutencao: "Manutenção chegando" },
    oi: { manha: ["Bom dia!", "Bom dia, tudo certo?"], tarde: ["Boa tarde!", "Boa tarde, chefia"], noite: ["Boa noite!", "Boa noite, bom descanso"] } };
  const z = { m: null, sujeira: 0, limpando: false, migalhas: [], quebrado: { cafe: false, luz: null }, npcs: new Map(),
    chamada: { limpeza: 0, manutencao: 0 }, proxRonda: 0, proxQuebra: 0, proxDemo: 0, saudados: new Map(), proxOi: 0, turno: null };
  const entre = (a, b) => a + Math.random() * (b - a);
  const sorteia = l => l[Math.floor(Math.random() * l.length)];
  const demo = () => !!(window.Brincar && Brincar.demo);
  const calmo = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const agoraS = () => performance.now() / 1000;

  // ---------- a lógica pura: sujeira, interdição e quebras ----------
  function sujar(motivo = "uso") {
    const n = typeof motivo === "number" ? motivo : USO[motivo] || USO.uso;
    z.sujeira = Math.max(0, Math.min(100, z.sujeira + n));
    return z.sujeira;
  }
  const suja = () => z.sujeira >= SUJA;
  const interditado = () => z.sujeira >= INTERDITA;
  const bloqueado = () => interditado() || z.limpando;          // interditado ou a faxineira lá dentro: a fila espera
  function limpar() { z.sujeira = 0; z.limpando = false; }
  // migalhas e copos na cozinha ou na sala comunal (o vida.js chama no fim do café e do lanche); metade das vezes
  function migalha(x, y, tipo = "migalha", sempre = false) {
    if (z.migalhas.length >= MAX_MIGALHAS || (!sempre && Math.random() < 0.5)) return false;
    z.migalhas.push({ x: Math.round(x + entre(-4, 4)), y: Math.round(y + entre(1, 3)), tipo });
    return true;
  }
  // "cafe": a máquina de café do prédio (as vagas de café fecham para todos); "luz": uma luminária do corredor que pisca
  function quebrar(qual = Math.random() < 0.6 ? "cafe" : "luz") {
    const m = z.m;
    if (qual === "cafe") { if (z.quebrado.cafe) return false; z.quebrado.cafe = true; if (m) fecharCafe(m, true); }
    else if (qual === "luz") {
      const n = m && m.predio.luzesTeto ? m.predio.luzesTeto.length : 0;
      if (z.quebrado.luz !== null || !n) return false;
      z.quebrado.luz = Math.floor(Math.random() * n);
    } else return false;
    z.chamada.manutencao = agoraS() + (demo() ? entre(8, 12) : entre(10, 20));   // dá tempo de ver quebrado antes de o zelador vir
    return true;
  }
  function consertar(qual) {
    if (qual === "cafe") { z.quebrado.cafe = false; if (z.m) fecharCafe(z.m, false); }
    else if (qual === "luz") z.quebrado.luz = null;
  }
  const quebrado = qual => (qual === "luz" ? z.quebrado.luz !== null : !!z.quebrado[qual]);
  // fecha (ou devolve) as vagas de café: agentes, roda e terminais deixam de ir; guarda o "fechada" de antes (vaga sem caminho)
  function fecharCafe(m, fechar) {
    for (const v of m.vagas || []) {
      if (v.tipo !== "cafe") continue;
      if (fechar && !Object.hasOwn(v, "fechadaAntes")) { v.fechadaAntes = !!v.fechada; v.fechada = true; }
      else if (!fechar && Object.hasOwn(v, "fechadaAntes")) { v.fechada = v.fechadaAntes; delete v.fechadaAntes; }
    }
  }
  // as máquinas de café do mapa: a do balcão da cozinha (animado) e a cafeteira da copa
  function maquinas(m) {
    const p = m.predio, r = [];
    for (const a of p.animados || []) if (a.tipo === "cafe") r.push({ x: a.x + (a.w || 10) / 2, y: a.y });
    for (const o of p.objetos || []) if (o.nome === "cafeteira") r.push({ x: o.x + (o.w || 10) / 2, y: o.y });
    return r;
  }

  // ---------- a equipe ----------
  let seq = 0;
  function novoNpc(papel, x, y) {
    const nome = sorteia(NOMES[papel]), s = 101 + 37 * ++seq;
    const n = { id: `npc:${papel}:${seq}`, npc: true, papel, funcao: FUNCAO[papel], nomeReal: `${nome} · ${FUNCAO[papel]}`, nome: "", x, y, rota: [], pose: "parado",
      olha: "baixo", parado: "baixo", lado: -1, passos: 0, pausa: 0, aceno: 0, fala: null, ate: 0, semente: s,
      visual: { blusa: UNIFORME[papel], cabelo: s % 7, pele: (s >> 2) % 4 }, passos_: [], acao: null, fazendo: "Chegando", fimAcao: 0 };
    nomear(n);
    z.npcs.set(n.id, n);
    return n;
  }
  const nomear = n => { n.nome = window.Apresentacao && Apresentacao.ligado() ? n.funcao : n.nomeReal; };   // apresentação: só a função
  const deServico = papel => [...z.npcs.values()].find(n => n.papel === papel && !n.saindo) || null;
  const rua = m => [m.predio.entrada.x - 22, m.predio.entrada.calcadaY];
  const posto = m => [m.predio.entrada.x + 16, m.predio.corredorTopo + 14];   // o posto do porteiro: no corredor, logo depois da entrada
  // a fila de passos de cada um: ir até um ponto, fazer algo parado por um tempo, sair do prédio
  const ir = (p, fazendo) => ({ tipo: "ir", p, fazendo });
  const fazer = (acao, dur, fazendo, fim) => ({ tipo: "fazer", acao, dur, fazendo, fim });
  const sair = fazendo => ({ tipo: "sair", fazendo });
  function chamar(papel) {
    const m = z.m;
    if (!m || !m.predio.entrada) return null;
    if (papel === "limpeza") return chamarLimpeza(m);
    if (papel === "manutencao") return chamarZelador(m);
    return null;
  }
  // a faxineira: o banheiro (se sujou: entra e passa o rodo lá dentro), cada migalha, e vai embora
  function chamarLimpeza(m) {
    if (deServico("limpeza")) return null;
    const b = m.predio.banheiro, passos = [];
    if (b && z.sujeira > 0) {
      passos.push(ir(pontoFaxina(m), "Indo ao banheiro"));
      passos.push(fazer("limpar", LIMPAR_T, "Limpando o banheiro", n => { limpar(); falar(n, sorteia(FRASES.limpo), 2.5); }));
    }
    for (const g of z.migalhas) {
      passos.push(ir([g.x - 4, g.y], g.tipo === "copo" ? "Recolhendo os copos" : "Varrendo as migalhas"));
      passos.push(fazer("varrer", VARRER_T, g.tipo === "copo" ? "Recolhendo os copos" : "Varrendo as migalhas", () => { const i = z.migalhas.indexOf(g); if (i >= 0) z.migalhas.splice(i, 1); }));
    }
    if (!passos.length) return null;
    const n = novoNpc("limpeza", ...rua(m));
    falar(n, FRASES.chegou.limpeza, 2.5);
    n.passos_ = [...passos, sair("Indo embora")];
    return n;
  }
  // o zelador: até a máquina de café ou embaixo da luminária, conserta com faísca e vai embora
  function chamarZelador(m) {
    if (deServico("manutencao")) return null;
    const passos = [];
    if (z.quebrado.cafe) {
      const maq = maquinas(m)[0], vs = (m.vagas || []).filter(v => v.tipo === "cafe");
      const v = maq && vs.sort((a, c) => Math.hypot(a.x - maq.x, a.y - maq.y) - Math.hypot(c.x - maq.x, c.y - maq.y))[0];
      if (v) { passos.push(ir([v.x, v.y], "Indo à cafeteira")); passos.push(fazer("consertar", CONSERTAR_T, "Consertando a cafeteira", n => { consertar("cafe"); falar(n, sorteia(FRASES.consertado), 2.5); })); }
      else consertar("cafe");
    }
    if (z.quebrado.luz !== null) {
      const l = m.predio.luzesTeto[z.quebrado.luz];
      if (l) { passos.push(ir([l.x + 4, m.predio.corredorTopo + 12], "Indo à luminária")); passos.push(fazer("consertar", CONSERTAR_T, "Trocando a lâmpada", n => { consertar("luz"); falar(n, sorteia(FRASES.consertado), 2.5); })); }
      else consertar("luz");
    }
    if (!passos.length) return null;
    const n = novoNpc("manutencao", ...rua(m));
    falar(n, FRASES.chegou.manutencao, 2.5);
    n.passos_ = [...passos, sair("Indo embora")];
    return n;
  }
  function falar(n, txt, s) { n.fala = txt; n.ate = agoraS() + s; }
  // onde a faxineira passa o rodo: no meio do banheiro, entre as cabines e a bancada (sem a sala, na porta)
  function pontoFaxina(m) {
    const b = m.predio.banheiro, s = b.sala;
    return s ? [s.px + Math.round(s.pw * 0.45), s.chao + 64] : [b.x + 3, m.predio.corredorTopo + 9];
  }
  const corredorBaixo = p => p.corredorTopo + (p.corredorAlt || 48);   // a parede de baixo do corredor, onde fica a porta do banheiro

  // ---------- a cada quadro (vida.js: Vida.passo) ----------
  // h: o caminho do vida.js { rotaAte(m, a, b), andar(m, p, dt, agora) }
  function passo(m, dt, agora, h) {
    if (!m || !m.predio || !m.predio.entrada) return;
    if (z.m !== m) { // prédio remontado: a equipe sai de cena e volta conforme o que estiver sujo ou quebrado
      z.m = m; z.npcs.clear(); z.limpando = false; z.turno = null;
      if (z.quebrado.cafe) fecharCafe(m, true);
      if (z.quebrado.luz !== null && !(m.predio.luzesTeto || [])[z.quebrado.luz]) z.quebrado.luz = null;
      z.chamada.limpeza = suja() ? agora + 2 : 0; z.chamada.manutencao = quebrado("cafe") || quebrado("luz") ? agora + 2 : 0;
      if (!z.proxQuebra) z.proxQuebra = agora + (demo() ? entre(40, 60) : entre(600, 1500));
      if (!z.proxRonda) z.proxRonda = agora + entre(120, 300);
      if (!z.proxDemo) z.proxDemo = agora + entre(6, 10);
    }
    // o ritmo: o uso do prédio na demonstração (sem terminais), as quebras e a ronda da faxina (mais à noite)
    if (demo() && agora >= z.proxDemo) {
      z.proxDemo = agora + entre(8, 14); sujar("demo");
      const vs = (m.vagas || []).filter(v => v.tipo === "lanche" || v.tipo === "cafe");
      if (vs.length && Math.random() < 0.3) { const v = sorteia(vs); migalha(v.x, v.y, v.tipo === "cafe" ? "copo" : "migalha", true); }
    }
    if (agora >= z.proxQuebra) { z.proxQuebra = agora + (demo() ? entre(90, 180) : entre(600, 1500)); quebrar(); }
    if (suja() && !z.chamada.limpeza && !deServico("limpeza")) z.chamada.limpeza = agora + entre(4, 8);
    if (agora >= z.proxRonda) {
      z.proxRonda = agora + (m.fora ? entre(120, 240) : entre(400, 800));
      if ((z.sujeira >= 15 || z.migalhas.length) && !z.chamada.limpeza) z.chamada.limpeza = agora;
    }
    if (z.chamada.limpeza && agora >= z.chamada.limpeza) { z.chamada.limpeza = 0; chamarLimpeza(m); }
    if (z.chamada.manutencao && agora >= z.chamada.manutencao) { z.chamada.manutencao = 0; chamarZelador(m); }
    turno(m, agora);
    for (const n of [...z.npcs.values()]) viver(m, n, dt, agora, h);
    if (z.limpando && !deServico("limpeza")) z.limpando = false;   // saiu de cena no meio (prédio remontado)
  }
  // o porteiro no expediente; fora dele, o vigia. Na troca, quem sai vai embora e o outro chega pela rua
  function turno(m, agora) {
    const quer = m.fora ? "vigia" : "portaria";
    if (z.turno === quer && deServico(quer)) return;
    const primeiro = z.turno === null;
    z.turno = quer;
    for (const n of z.npcs.values()) if ((n.papel === "portaria" || n.papel === "vigia") && n.papel !== quer && !n.saindo) { n.passos_ = [sair("Trocando de turno")]; n.acao = null; }
    if (deServico(quer)) return;
    const p = posto(m), n = novoNpc(quer, ...(primeiro ? p : rua(m)));
    n.posto = p; n.proxPosto = agora + entre(15, 30);
    if (!primeiro) n.passos_ = [ir(p, "Chegando para o turno")];
  }
  function viver(m, n, dt, agora, h) {
    nomear(n);
    h.andar(m, n, dt, agora);   // anda (com rota) e acerta a pose e a fala (vida.js: andarPessoa)
    if (n.rota.length) return;
    const s = n.passos_[0];
    if (!s) return noPosto(m, n, agora);
    n.fazendo = s.fazendo;
    if (s.tipo === "ir") {
      n.passos_.shift(); n.acao = null;
      n.rota = h.rotaAte(m, [n.x, n.y], s.p) || [s.p];
    } else if (s.tipo === "fazer") {
      if (n.acao !== s.acao) { n.acao = s.acao; n.fimAcao = agora + s.dur; if (s.acao === "limpar") z.limpando = true; }
      if (agora < n.fimAcao) return;
      n.passos_.shift(); n.acao = null;
      if (s.fim) s.fim(n);
    } else if (s.tipo === "sair") {
      n.passos_ = [{ tipo: "sumir", fazendo: s.fazendo }]; n.saindo = true; n.acao = null;
      const e = m.predio.entrada, cy = m.predio.corredorY;
      n.rota = [...(h.rotaAte(m, [n.x, n.y], [e.x - 22, cy]) || []), rua(m)];
    } else if (s.tipo === "sumir") z.npcs.delete(n.id);
  }
  // no posto: o porteiro lê o jornal ou toma um café de vez em quando e cumprimenta quem passa; o vigia faz a ronda
  function noPosto(m, n, agora) {
    if (!n.posto) { n.passos_ = [sair("Indo embora")]; return; }
    n.parado = "baixo";
    if (n.acao && agora < n.fimAcao) { cumprimentar(m, n, agora); return; }
    n.acao = null;
    n.fazendo = n.papel === "vigia" ? "De vigia na entrada" : "Na portaria";
    if (agora >= n.proxPosto) {
      n.proxPosto = agora + entre(25, 50);
      if (n.papel === "vigia") {
        const b = m.predio.banheiro, x = b ? b.x - 30 : m.predio.predioRet.x + 40;
        n.passos_ = [ir([x, m.predio.corredorY], "Fazendo a ronda"), fazer("lanterna", 3, "Fazendo a ronda"), ir(n.posto, "Voltando ao posto")];
        return;
      }
      n.acao = Math.random() < 0.55 ? "jornal" : "cafe"; n.fimAcao = agora + entre(8, 12);
      n.fazendo = n.acao === "jornal" ? "Lendo o jornal" : "Tomando um café";
    }
    cumprimentar(m, n, agora);
  }
  // quem passa perto do posto andando (agentes, terminais e as pessoas da equipe) ganha um aceno e um "bom dia"
  function cumprimentar(m, n, agora) {
    if (agora < z.proxOi) return;
    const gente = [...(m.lista || []), ...(window.Vida && Vida.terminais ? Vida.terminais() : []), ...(window.Vida && Vida.pessoas ? Vida.pessoas() : [])];
    for (const g of gente) {
      if (!g.rota || !g.rota.length || Math.hypot(g.x - n.x, g.y - n.y) > 28 || (z.saudados.get(g.id) || -1e9) > agora - 90) continue;
      z.saudados.set(g.id, agora); z.proxOi = agora + 4;
      if (z.saudados.size > 200) z.saudados.delete(z.saudados.keys().next().value);
      const hr = window.Ceu ? window.Ceu.agora().h : 12;
      n.aceno = agora + 1.5; n.olha = g.x < n.x ? "esq" : "dir"; n.lado = g.x < n.x ? -1 : 1;
      falar(n, sorteia(FRASES.oi[hr < 12 ? "manha" : hr < 18 ? "tarde" : "noite"]), 2.5);
      return;
    }
  }

  // ---------- desenho (app.js; tudo em px do mundo, já na escala do mapa) ----------
  // a sujeira no chão do banheiro, que aumenta com o uso: papel amassado, poças, o papel higiênico saindo da cabine
  function sujeiraNoChao(b) {
    const s = b && b.sala, k = (b && b.cabines) || [];
    if (!s || k.length < 3) return [];
    return [[15, "papel", k[0].x + 4, s.chao + 52], [30, "poca", s.px + s.pw - 66, s.chao + 27], [45, "papel", k[2].x - 3, s.chao + 56],
      [60, "rolo", k[1].x - 2, k[1].y - 7], [60, "poca", k[1].x + 6, s.chao + 63], [75, "papel", s.px + s.pw - 40, s.chao + 44],
      [90, "pocao", s.px + Math.round(s.pw * 0.42), s.chao + 84]].filter(p => z.sujeira >= p[0]);
  }
  function poca(c, x, y, grande) {
    const meias = grande ? [6, 10, 12, 12, 10, 6] : [3, 6, 7, 6, 3];
    meias.forEach((w, j) => {
      const borda = j === 0 || j === meias.length - 1;
      c.fillStyle = "#4f86c6"; c.fillRect(x - w, y + j, 2 * w + 1, 1);                             // a borda mais escura
      if (!borda) { c.fillStyle = "#8cc2ea"; c.fillRect(x - w + 1, y + j, 2 * w - 1, 1); }
    });
    c.fillStyle = "#e6f6ff"; c.fillRect(x - 2, y + 1, 3, 1); c.fillRect(x + 2, y + 2, 1, 1);
  }
  function papel(c, x, y) {
    c.fillStyle = "#5f6b78"; c.fillRect(x - 2, y - 2, 6, 5);                                       // o contorno
    c.fillStyle = "#f7f7f2"; c.fillRect(x - 1, y - 1, 4, 3); c.fillStyle = "#c4ccd4"; c.fillRect(x + 1, y, 2, 1); c.fillRect(x, y + 1, 1, 1);
  }
  // no chão, antes da cena: as migalhas e os copos, e a sujeira do banheiro
  function chao(c) {
    for (const [, tipo, x, y] of sujeiraNoChao(z.m && z.m.predio.banheiro)) {
      if (tipo === "poca" || tipo === "pocao") poca(c, x, y, tipo === "pocao");
      else if (tipo === "papel") papel(c, x, y);
      else { c.fillStyle = "#d5d9de"; for (let k = 0; k < 9; k++) c.fillRect(x + (k % 4 < 2 ? 0 : 1), y + k, 2, 1); c.fillStyle = "#f7f7f2"; for (let k = 0; k < 9; k++) c.fillRect(x + (k % 4 < 2 ? 0 : 1), y + k, 1, 1); }   // o papel saindo pela fresta
    }
    for (const g of z.migalhas) {
      if (g.tipo === "copo") { c.fillStyle = "#14131f"; c.fillRect(g.x - 1, g.y - 4, 4, 5); c.fillStyle = "#f4efe4"; c.fillRect(g.x, g.y - 3, 2, 3); c.fillStyle = "#7a4a2a"; c.fillRect(g.x, g.y - 3, 2, 1); }
      else { c.fillStyle = "#c9a26a"; c.fillRect(g.x, g.y, 1, 1); c.fillRect(g.x + 2, g.y - 1, 1, 1); c.fillRect(g.x - 2, g.y + 1, 1, 1); c.fillStyle = "#8a6a3e"; c.fillRect(g.x + 1, g.y + 1, 1, 1); }
    }
  }
  // por cima da cena: fedor e moscas nas cabines do banheiro, o cone e a placa de interditado na porta, a cafeteira quebrada,
  // a lâmpada que pisca, o brilho da faxina e as faíscas do conserto. t: o relógio dos objetos (0 com menos movimento)
  function ar(c, t) {
    const m = z.m;
    if (!m) return;
    const p = m.predio, b = p.banheiro, parado = calmo() || !t;
    if (b && suja()) {
      const ks = b.cabines && b.cabines.length ? b.cabines : [{ x: b.x, y: p.corredorTopo + 6 }];
      ks.forEach((k, i) => { // linhas de fedor verdes subindo de cada cabine
        const sobe = parado ? 0 : Math.floor(t / 180 + i * 2) % 6, y0 = k.y - 34;
        c.fillStyle = "rgba(110,190,40,.85)";
        for (let j = 0; j < 4; j++) c.fillRect(k.x - 1 + ((j + sobe) % 2) * 2, y0 - j * 3 - sobe, 2, 3);
      });
      const meio = ks[Math.floor(ks.length / 2)], n = interditado() ? 5 : 3;
      for (let i = 0; i < n; i++) { // moscas: um ponto preto e a asa clara, rodando em volta das cabines
        const a = parado ? i * 2.1 : t / (260 + i * 70) + i * 2.1;
        const x = Math.round(meio.x + Math.cos(a) * (16 + i * 5)), y = Math.round(meio.y - 50 + Math.sin(a * 1.7) * 6 + i * 2);
        c.fillStyle = "#14131f"; c.fillRect(x, y, 2, 2);
        c.fillStyle = "rgba(220,235,255,.9)"; c.fillRect(x + ((parado ? 0 : Math.floor(t / 60)) % 2 ? 2 : -1), y - 1, 1, 1);
      }
    }
    if (b && interditado() && !z.limpando) { const y = corredorBaixo(p) - 3; placa(c, b.x - 10, y); cone(c, b.x + 11, y); }
    if (b && z.limpando) for (const n of z.npcs.values()) if (n.acao === "limpar") brilho(c, n.x, n.y - 12, t, parado);
    if (z.quebrado.cafe) for (const q of maquinas(m)) quebradaIcone(c, q.x - 4, q.y - 2, t, parado);
    if (z.quebrado.luz !== null) {
      const l = (p.luzesTeto || [])[z.quebrado.luz];
      if (l && !parado && Math.floor(t / 90) % 7 === 0) { c.fillStyle = "#fff4a8"; c.fillRect(l.x - 1, l.y + 7, 3, 1); c.fillRect(l.x, l.y + 8, 1, 2); }   // faísca
      if (l) { c.fillStyle = "#3a3a46"; c.fillRect(l.x - 2, l.y + 3, 5, 1); }   // a lâmpada escura
    }
    for (const n of z.npcs.values()) if (n.acao === "consertar" && !n.rota.length) faiscas(c, n, t, parado);
  }
  // a placa de "interditado": cavalete amarelo com listras e um círculo vermelho de proibido
  function placa(c, x, y) {
    c.fillStyle = "#14131f"; c.fillRect(x - 5, y - 11, 11, 9); c.fillRect(x - 4, y - 2, 1, 3); c.fillRect(x + 4, y - 2, 1, 3);
    c.fillStyle = "#f5c518"; c.fillRect(x - 4, y - 10, 9, 7);
    c.fillStyle = "#14131f"; for (let k = 0; k < 3; k++) c.fillRect(x - 4 + k * 3, y - 4, 2, 1);
    c.fillStyle = "#e8574a"; c.fillRect(x - 1, y - 9, 3, 1); c.fillRect(x - 2, y - 8, 1, 3); c.fillRect(x + 2, y - 8, 1, 3); c.fillRect(x - 1, y - 6, 3, 1);
    c.fillRect(x - 1, y - 7, 1, 1); c.fillRect(x + 1, y - 8, 1, 1);   // a barra do proibido
  }
  // o cone de piso molhado: laranja, com a faixa branca e a base preta
  function cone(c, x, y) {
    c.fillStyle = "#14131f"; c.fillRect(x - 5, y - 1, 11, 2); c.fillRect(x - 1, y - 12, 3, 1);
    for (let k = 0; k < 10; k++) { const w = 1 + Math.floor(k / 2); c.fillStyle = "#14131f"; c.fillRect(x - w, y - 11 + k, 2 * w + 1, 1); }
    for (let k = 0; k < 10; k++) { const w = Math.floor(k / 2); c.fillStyle = k >= 4 && k <= 5 ? "#f4f4f0" : "#f08a24"; c.fillRect(x - w, y - 11 + k, 2 * w + 1, 1); }
    c.fillStyle = "#ffb15c"; c.fillRect(x - 1, y - 6, 1, 3);
  }
  function brilho(c, x, y, t, parado) { // estrelinhas da faxina piscando na porta
    const pts = [[-6, -2], [5, -6], [0, 4], [7, 3], [-4, 7]];
    pts.forEach(([dx, dy], i) => {
      if (!parado && Math.floor(t / 160 + i) % 3 === 0) return;
      c.fillStyle = "#ffffff"; c.fillRect(x + dx, y + dy - 1, 1, 3); c.fillRect(x + dx - 1, y + dy, 3, 1);
      c.fillStyle = "#9fe3ff"; c.fillRect(x + dx, y + dy, 1, 1);
    });
  }
  function quebradaIcone(c, x, y, t, parado) {
    const sobe = parado ? 0 : Math.floor(t / 500) % 2;
    if (window.Sprites && Sprites.balao) Sprites.balao(c, "quebrada", x, y - sobe);
  }
  function faiscas(c, n, t, parado) {
    const alvoX = n.x + (n.lado < 0 ? -7 : 7), alvoY = n.y - 9;
    if (parado) { c.fillStyle = "#ffd166"; c.fillRect(alvoX, alvoY, 1, 1); return; }
    const f = Math.floor(t / 80);
    for (let i = 0; i < 4; i++) {
      if ((f + i) % 3) continue;
      const a = (f * 1.7 + i * 2.4) % 6.28, r = 2 + (f + i) % 3;
      c.fillStyle = i % 2 ? "#fff4a8" : "#f5b83d"; c.fillRect(Math.round(alvoX + Math.cos(a) * r), Math.round(alvoY + Math.sin(a) * r), 1, 1);
    }
  }
  // um NPC: a gente de uniforme e o acessório (balde e rodo, caixa de ferramentas, quepe, jornal, lanterna)
  function npc(c, n, t) {
    if (!window.Sprites) return;
    const parado = calmo() || !t, acao = n.pose === "andando" ? "andar" : n.pose === "acenando" ? "acenar" : n.acao === "jornal" ? "celular" : "parar";
    const x0 = Math.round(n.x), y = Math.round(n.y), esq = n.lado < 0;
    const X = (dx, w = 1) => (esq ? x0 - dx - w + 1 : x0 + dx);   // espelha a coluna para quem olha à esquerda
    Sprites.gente(c, x0 - 6, y, Math.floor(n.passos / 3) % 4, esq, n.semente, acao, parado ? 0 : t, n.visual);
    const balança = parado ? 0 : Math.floor(t / 220) % 2;
    if (n.papel === "limpeza") {
      if (n.acao === "limpar" || n.acao === "varrer") { // o rodo indo e vindo
        const v = parado ? 0 : Math.round(Math.sin(t / 160) * 2);
        c.fillStyle = "#14131f"; for (let k = 0; k < 9; k++) c.fillRect(X(6 + Math.round((k * (3 + v)) / 9)) - 1, y - 10 + k, 3, 1);
        c.fillStyle = "#c08850"; for (let k = 0; k < 9; k++) c.fillRect(X(6 + Math.round((k * (3 + v)) / 9)), y - 10 + k, 1, 1);
        c.fillStyle = "#14131f"; c.fillRect(X(5 + v, 9), y - 2, 9, 3); c.fillStyle = "#f5c518"; c.fillRect(X(6 + v, 7), y - 1, 7, 1);
      }
      // o balde azul com a alça
      const bx = X(n.acao ? -9 : 5, 5);
      c.fillStyle = "#14131f"; c.fillRect(bx - 1, y - 5, 7, 6);
      c.fillStyle = "#e8574a"; c.fillRect(bx, y - 4, 5, 4); c.fillStyle = "#ff8a7a"; c.fillRect(bx, y - 4, 5, 1);
      c.fillStyle = "#9fd3ff"; if (n.acao) c.fillRect(bx + 1, y - 4, 3, 1);
      c.fillStyle = "#14131f"; c.fillRect(bx + 1, y - 6, 3, 1);
    } else if (n.papel === "manutencao") {
      if (n.acao === "consertar") { // a chave inglesa levantada, batendo
        c.fillStyle = "#14131f"; c.fillRect(X(5), y - 12 - balança, 3, 6);
        c.fillStyle = "#b5bccc"; c.fillRect(X(6), y - 11 - balança, 1, 4); c.fillRect(X(5, 3), y - 12 - balança, 3, 1);
      }
      const cx = X(n.acao ? -10 : 5, 6); // a caixa de ferramentas vermelha
      c.fillStyle = "#14131f"; c.fillRect(cx - 1, y - 5, 8, 6); c.fillRect(cx + 1, y - 7, 4, 2);
      c.fillStyle = "#d8402f"; c.fillRect(cx, y - 4, 6, 4); c.fillStyle = "#f07a5a"; c.fillRect(cx, y - 4, 6, 1);
      c.fillStyle = "#f5c518"; c.fillRect(cx + 2, y - 2, 2, 1);
      // o capacete amarelo
      c.fillStyle = "#14131f"; c.fillRect(x0 - 5, y - 20, 11, 4); c.fillStyle = "#f5c518"; c.fillRect(x0 - 4, y - 19, 9, 2); c.fillStyle = "#ffe27a"; c.fillRect(x0 - 2, y - 19, 3, 1);
    } else if (n.papel === "portaria" || n.papel === "vigia") {
      const cor = n.papel === "vigia" ? "#22222c" : "#1f2a55";
      c.fillStyle = "#14131f"; c.fillRect(x0 - 5, y - 20, 11, 4); c.fillRect(X(4, 4), y - 17, 4, 2);
      c.fillStyle = cor; c.fillRect(x0 - 4, y - 19, 9, 2); c.fillRect(X(5, 3), y - 17, 3, 1);   // o quepe e a aba
      c.fillStyle = "#f5c518"; c.fillRect(x0, y - 19, 1, 1);   // o distintivo
      if (n.acao === "jornal") { // o jornal aberto na frente do peito
        c.fillStyle = "#14131f"; c.fillRect(x0 - 5, y - 9, 10, 6);
        c.fillStyle = "#f4efe4"; c.fillRect(x0 - 4, y - 8, 8, 4); c.fillStyle = "#8a8a96"; c.fillRect(x0 - 3, y - 7, 3, 1); c.fillRect(x0 + 1, y - 7, 2, 1); c.fillRect(x0 - 3, y - 5, 6, 1);
      }
      if (n.acao === "cafe" && Sprites.balao) Sprites.balao(c, "cafe", x0 + (esq ? 7 : -16), y - 19);
      if (n.papel === "vigia") { // a lanterna na mão e o facho no chão
        c.fillStyle = "#14131f"; c.fillRect(X(5, 3), y - 6, 3, 3); c.fillStyle = "#b5bccc"; c.fillRect(X(6), y - 5, 1, 1);
        const noite = window.Ceu ? window.Ceu.agora().escuro : 1;
        if (noite > 0.2) { c.fillStyle = `rgba(255,240,170,${0.18 + 0.12 * noite})`; for (let k = 0; k < 4; k++) c.fillRect(X(8 + k * 2, 2), y - 5 + k, 2, 1 + k); }
      }
    }
  }
  // o balão de texto do mapa (app.js: desenharBalao): "Quebrada!" na cafeteira e "Interditado" no banheiro
  function falas() {
    const m = z.m, r = [];
    if (!m) return r;
    const p = m.predio, mq = z.quebrado.cafe && maquinas(m)[0];
    if (mq) r.push({ x: mq.x - 4, y: mq.y + 22, fala: "Quebrada!" });
    if (p.banheiro && interditado() && !z.limpando) r.push({ x: p.banheiro.x, y: corredorBaixo(p) - 12, fala: "Interditado" });
    return r;
  }
  // a luminária quebrada pisca (app.js: as luzes de teto à noite); com menos movimento, fica apagada
  function lampadaApagada(l, t) {
    const m = z.m;
    if (!m || z.quebrado.luz === null || (m.predio.luzesTeto || [])[z.quebrado.luz] !== l) return false;
    return calmo() || !t || Math.floor(t / 110) % 5 !== 0;
  }
  // o NPC sob o ponto (o clique e o cartão do app.js): corpo de uns 12×20 px acima dos pés
  function npcEm(p) {
    let melhor = null, dm = Infinity;
    for (const n of z.npcs.values()) { const d = Math.hypot(n.x - p.x, n.y - 9 - p.y); if (Math.abs(p.x - n.x) <= 7 && p.y >= n.y - 21 && p.y <= n.y + 1 && d < dm) { dm = d; melhor = n; } }
    return melhor;
  }
  const npcs = () => [...z.npcs.values()].filter(n => n.x > -20);
  const mexendo = () => [...z.npcs.values()].some(n => n.rota.length || n.acao === "limpar" || n.acao === "consertar");
  // o estado (testes e console)
  const estado = () => ({ sujeira: z.sujeira, suja: suja(), interditado: interditado(), limpando: z.limpando, migalhas: z.migalhas.length,
    quebrado: { cafe: z.quebrado.cafe, luz: z.quebrado.luz }, npcs: npcs().map(n => ({ nome: n.nomeReal, papel: n.papel, fazendo: n.fazendo, x: Math.round(n.x), y: Math.round(n.y) })) });
  // atalho de teste: limpa e conserta tudo e adia por 10 min a quebra e a sujeira sorteadas (para forçar com sujar e quebrar)
  function zerar() {
    z.sujeira = 0; z.limpando = false; z.migalhas = []; consertar("cafe"); consertar("luz"); z.chamada.limpeza = z.chamada.manutencao = 0;
    z.proxQuebra = z.proxDemo = z.proxRonda = agoraS() + 600;
  }

  return { SUJA, INTERDITA, USO, sujeiraNoChao, sujar, suja, interditado, bloqueado, limpar, migalha, quebrar, consertar, quebrado, chamar, passo,
    chao, ar, npc, falas, lampadaApagada, npcEm, npcs, mexendo, estado, zerar, sujeira: () => z.sujeira };
})();

window.Zeladoria = Zeladoria;
