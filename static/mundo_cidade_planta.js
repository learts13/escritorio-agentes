// Planta do nível Cidade (o chão fica em mundo_cidade_chao.js; o desenho e a vida da rua, em mundo_cidade.js). Tudo sai de
// uma semente com o id da cidade e dos dados dela (porte, litoral e UF): o mesmo id dá sempre a mesma planta.
// - Ruas em grade reta, de dv em dv e de dh em dh. A câmera fica presa à caixa W×H, mas a grade segue até LONGE além
//   dela, para que a 1x, em qualquer formato de tela, não sobre chão vazio fora das quadras.
// - Quadra: calçada de C em volta e o miolo em duas filas. A quadra do meio é a do marco (o centro). Em volta dela, uma
//   quadra de parque (a praça com a fonte, ou o lago, e o coreto ou a feira, árvores e canteiros) e uma de esporte (o
//   campo e a quadra ou o parquinho). As outras filas são de prédios (o prédio no meio e, nos cantos, o mobiliário da
//   rua ou uma árvore) ou de lotes de casas e chalés, cada lote com a sua cerca ou sebe.
// - O porte (metrópole, grande, média, pequena) decide quantas filas são de prédios, quais prédios (torres ou prédios
//   baixos e serviços) e quantos carros e pedestres há. A região decide as árvores.
// - Litoral: a rua v1 vira a avenida da praia; depois dela, o calçadão, a areia (com quiosque, guarda-sóis, píer, farol e
//   coqueiros) e o mar. Lá não há quadra nem rua; os carros andam só nas ruas verticais.
// - Cada peça leva o pé (x, y), onde o desenho se apoia, e r = [x0, y0, x1, y1], a vaga que ocupa no chão: nenhuma
//   vaga cruza outra, e nenhuma fica na rua.
// - Os pedestres andam por uma rede: quatro cantos de calçada em volta de cada cruzamento, ligados pelas calçadas e
//   pelas faixas de pedestre (no litoral, também pelo calçadão).
"use strict";
const CidadePlanta = (() => {
  const W = 576, H = 400, E = 32, C = 8, LONGE = 600;   // E: largura da rua; C: da calçada
  const PE = E / 2 + C / 2;   // do eixo da rua ao meio da calçada, por onde andam os pedestres
  const CALCADAO = 12, AREIA = 70;   // a orla, da avenida para o mar
  // filas de prédios no anel em volta do marco e nos arredores, a parte de torres, carros e pedestres
  const PORTES = {
    metropole: { predios: 0.9, fora: 0.55, altos: 0.8, carros: 8, onibus: 2, bicis: 3, pedestres: [14, 18] },
    grande: { predios: 0.6, fora: 0.3, altos: 0.5, carros: 6, onibus: 1, bicis: 2, pedestres: [11, 14] },
    media: { predios: 0.3, fora: 0.12, altos: 0.2, carros: 5, onibus: 1, bicis: 2, pedestres: [8, 12] },
    pequena: { predios: 0.15, fora: 0.03, altos: 0, carros: 3, onibus: 0, bicis: 2, pedestres: [6, 9] },
  };
  const ALTOS = [1, 3, 5, 12], BAIXOS = [2, 4, 6, 7, 11];
  // os serviços (igreja 9, hospital 10, mercado 14, bombeiros 13, posto 8, padaria 7), na ordem em que entram
  const SERVICOS = { metropole: [10, 14, 13, 8, 9], grande: [14, 10, 9, 8, 13], media: [9, 14, 10, 8], pequena: [9, 7, 14, 8] };
  const REGIAO = { AC: "N", AP: "N", AM: "N", PA: "N", RO: "N", RR: "N", TO: "N", AL: "NE", BA: "NE", CE: "NE", MA: "NE",
    PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE", DF: "CO", GO: "CO", MT: "CO", MS: "CO", ES: "SE", MG: "SE", RJ: "SE",
    SP: "SE", PR: "S", RS: "S", SC: "S" };
  // as árvores de cada região, com repetição para pesar: palmeira (3) e coqueiro (7) no Norte e Nordeste, pinheiro (6) no
  // Sul, ipê amarelo (2) e roxo (4) no Centro-Oeste e Sudeste, a árvore redonda (1) e a laranjeira (5) em toda parte
  const ARVORES = { N: [1, 3, 7, 5, 1, 3], NE: [3, 7, 1, 5, 3, 7], CO: [2, 4, 1, 5, 2, 1], SE: [1, 1, 4, 2, 5, 1], S: [6, 1, 6, 4, 6, 5] };
  const CHALES = { N: 0.2, NE: 0.15, CO: 0.3, SE: 0.35, S: 0.65 };   // a parte de chalés entre as casas
  const CASAS = { metropole: [5, 3, 5, 6, 3], grande: [1, 2, 3, 5, 6], media: [1, 2, 3, 4, 6], pequena: [1, 2, 3, 4, 6, 1, 2] };
  // os marcos que já são igreja (a cidade não ganha a predios-9 além deles)
  const IGREJAS = new Set(["matriz-mateus-leme", "catedral-fortaleza", "igreja-rosario", "pampulha", "convento-penha", "pelourinho"]);
  // a altura do desenho da praça no atlas (a fonte e o lago), para o coreto atrás dela ficar a FOLGA_PRACA px
  const ALTURA_PRACA = { "praca-1": 68, "lazer-3": 80 }, FOLGA_PRACA = 4;
  const MOBILIA = ["banca-1", "ponto-onibus-1", "banco-poste-1", "carrinho-1", "rua-1", "rua-2", "rua-3"];
  // as construções que mostram o nome (clique, toque ou Tab); o marco usa o nome do ponto turístico
  const NOMES = { "predios-9": "Igreja", "predios-10": "Hospital", "predios-14": "Mercado Municipal", "predios-13": "Bombeiros",
    "lazer-1": "Campo de Futebol", "lazer-4": "Coreto", "lazer-3": "Lago da Praça", "praca-1": "Praça da Fonte",
    "lazer-5": "Feira Livre", "praia-3": "Farol" };
  // nomes de rua de mentira, para as placas das esquinas (a partir de 2x)
  const RUAS = ["R. das Flores", "R. do Sol", "Av. Central", "R. dos Ipês", "R. da Matriz", "R. Nova", "Av. das Palmeiras",
    "R. do Comércio", "R. da Paz", "R. das Acácias", "R. do Rosário", "Av. da Saudade", "R. do Mercado", "R. da Esperança",
    "R. das Mangueiras", "R. Boa Vista", "R. do Campo", "R. dos Pássaros", "R. da Aurora", "R. das Hortênsias"];

  // FNV-1a na semente, mulberry32 nos sorteios
  function sorteio(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    let a = h >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // os índices k das ruas a0 + k·d que cobrem de -LONGE a fim + LONGE (com uma quadra inteira de cada lado)
  function indices(a0, d, fim) {
    const l = [];
    for (let k = Math.floor((-LONGE - a0) / d); a0 + (k - 1) * d < fim + LONGE; k++) l.push(k);
    return l;
  }

  // cidade: { porte, litoral, uf, marco, regiao } (o que faltar vale cidade média, sem praia, no Sudeste; a regiao, das
  // cidades de fora do Brasil, escolhe as árvores no lugar da UF)
  function planta(id, cidade = {}) {
    const r = sorteio(String(id));
    const entre = (a, b) => a + Math.floor(r() * (b - a + 1));
    const um = l => l[Math.floor(r() * l.length)];
    const embaralhar = l => {
      for (let i = l.length - 1; i > 0; i--) { const m = Math.floor(r() * (i + 1)); [l[i], l[m]] = [l[m], l[i]]; }
      return l;
    };
    const porte = PORTES[cidade.porte] ? cidade.porte : "media", P = PORTES[porte], regiao = ARVORES[cidade.regiao] ? cidade.regiao : REGIAO[cidade.uf] || "SE";
    const igreja = IGREJAS.has(cidade.marco);
    const arvore = () => "arvore-" + um(ARVORES[regiao]);
    const v0 = 176 + 4 * entre(-4, 4), v1 = 400 + 4 * entre(-4, 4), h0 = 112 + 4 * entre(-2, 2), h1 = 304 + 4 * entre(-2, 2);
    const dv = v1 - v0, dh = h1 - h0, rv = k => v0 + k * dv, rh = k => h0 + k * dh;
    const orla = cidade.litoral ? { x: v1 + E / 2 } : null;   // calçadão de x a x + CALCADAO, areia até mar, depois o mar
    if (orla) { orla.areia = orla.x + CALCADAO; orla.mar = orla.areia + AREIA; }
    const kv = indices(v0, dv, W).filter(k => !orla || k <= 1), kh = indices(h0, dh, H);
    const ruas = { v: kv.map(rv), h: kh.map(rh) };

    // quadras e filas: anel 0 é o marco, 1 a cidade, 2 em diante os arredores
    const quadras = [], filas = [];
    for (const b of kh.slice(0, -1)) for (const a of kv.slice(0, -1)) {
      const q = { a, b, x0: rv(a) + E / 2, x1: rv(a + 1) - E / 2, y0: rh(b) + E / 2, y1: rh(b + 1) - E / 2,
                  anel: Math.max(Math.abs(a), Math.abs(b)), centro: a === 0 && b === 0, zona: null };
      quadras.push(q);
      if (q.centro) { q.zona = "centro"; continue; }
      const meio = Math.round((q.y0 + q.y1) / 2);
      for (const fila of [0, 1]) {
        filas.push({ q, fila, x0: q.x0 + C, x1: q.x1 - C, y0: fila ? meio : q.y0 + C, y1: fila ? q.y1 - C : meio });
      }
    }
    const vaga = l => [l.x0, l.y0, l.x1, l.y1];
    const parte = (l, x0, x1) => ({ ...l, x0, x1 });
    const lotes = f => { const m = Math.round((f.x0 + f.x1) / 2); return [parte(f, f.x0, m), parte(f, m, f.x1)]; };
    const noLote = (l, peca, recuo = 2, folga = 4) =>
      ({ x: Math.round((l.x0 + l.x1) / 2) + entre(-folga, folga), y: l.y1 - recuo, peca, r: vaga(l) });
    const quadra = (a, b) => quadras.find(q => q.a === a && q.b === b);
    const de = (q, fila) => filas.find(f => f.q === q && f.fila === fila);

    const pecas = [], pisos = [], cercas = [], notaveis = [];
    const por = (s, zona) => { s.zona = zona; if (NOMES[s.peca]) notaveis.push(s); pecas.push(s); return s; };
    const mobilia = embaralhar(MOBILIA.slice());
    // os cantos de uma fila com uma peça no meio: o mobiliário (enquanto houver, nos cantos que aparecem a 1x), uma
    // árvore ou um canteiro
    function cantos(f, lado, zona, so) {
      for (const l of [parte(f, f.x0, f.x0 + lado), parte(f, f.x1 - lado, f.x1)]) {
        const u = r(), aparece = l.x0 > 0 && l.x1 < W && l.y1 > 20 && l.y0 < H;
        if (mobilia.length && so !== "verde" && aparece) por(noLote(l, mobilia.pop(), 3, 1), zona);
        else if (u < 0.55) por(noLote(l, arvore(), 12, 2), zona);
        else if (u < 0.8) por(noLote(l, "canteiro-" + entre(1, 2), 4, 1), zona);
      }
    }
    const ladoDe = f => Math.max(14, Math.min(40, Math.round((f.x1 - f.x0 - 108) / 2)));
    function fileira(f, peca, zona, piso, so) {   // a peça no meio da fila inteira e os cantos
      const lado = ladoDe(f);
      if (piso) pisos.push({ r: vaga(f), piso });
      cantos(f, lado, zona, so);
      return por(noLote(parte(f, f.x0 + lado, f.x1 - lado), peca, 3, 2), zona);
    }
    function lote(l, zona) {   // um lote de casa: a casa (às vezes com uma árvore ao lado), uma árvore ou uma horta
      const u = r(), frente = l.fila === 1 && l.q.anel <= 2;
      cercas.push({ r: vaga(l), tipo: r() < 0.5 ? "sebe" : "cerca", porta: null });
      if (u < 0.1) return por(noLote(l, arvore(), 14, 6), zona);
      if (u < 0.15) return por(noLote(l, "canteiro-2", 10, 4), zona);
      const nome = r() < CHALES[regiao] ? "chale-" + entre(1, 8) : "casa-" + um(CASAS[porte]), w = l.x1 - l.x0;
      let casa = l;
      const extra = r();
      if (extra < 0.75 && w >= 80) {   // a casa num lado e, no outro, uma árvore recuada ou um canteiro de flores na frente
        const m = r() < 0.5 ? l.x0 + w - 28 : l.x0 + 28;
        const [a, b] = m > l.x0 + w / 2 ? [parte(l, l.x0, m), parte(l, m, l.x1)] : [parte(l, m, l.x1), parte(l, l.x0, m)];
        casa = a;
        por(extra < 0.55 ? noLote(b, arvore(), 16, 0) : noLote(b, "canteiro-1", 6, 0), zona);
      }
      const s = por(noLote(casa, nome, frente ? 8 : 3, 2), zona);
      if (frente) cercas[cercas.length - 1].porta = s.x;   // o caminho da calçada até a porta
      return s;
    }
    const predio = (lista, altos) => "predios-" + (lista.length ? lista.shift() : um(r() < altos ? ALTOS : BAIXOS));

    // as zonas em volta do marco, pela semente: o parque num lado ou em cima do marco (no litoral, do lado da terra; na
    // cidade pequena, sempre num lado, com o coreto à vista) e o esporte em outra quadra do anel (nunca na da casa; na
    // metrópole, fora dos lados, que ficam para as torres)
    const lado = orla ? -1 : r() < 0.5 ? -1 : 1, emCima = !orla && porte !== "pequena" && r() < 0.3;
    const qParque = emCima ? quadra(0, -1) : quadra(lado, 0);
    const livres = [[-lado, 0], [lado, -1], [-lado, -1], [lado, 1], [-lado, 1], [0, -1]].map(([a, b]) => quadra(a, b))
      .filter(q => q && q !== qParque && (porte !== "metropole" || q.b !== 0));
    const qEsporte = porte === "metropole" || r() < 0.45 ? um(livres) : livres[0];
    qParque.zona = "parque"; qEsporte.zona = "esporte";

    // o parque: na fila da frente a praça (a fonte, ou o lago numa fila larga); na de trás o coreto (ou a feira) com os
    // cantos, o pé recuado o bastante para o desenho da praça não encostar nele (FOLGA_PRACA px entre os dois)
    const frente = de(qParque, 1), fundo = de(qParque, 0), largo = frente.x1 - frente.x0 >= 176;
    pisos.push({ r: [qParque.x0 + C, qParque.y0 + C, qParque.x1 - C, qParque.y1 - C], piso: "parque" });
    const praca = por(noLote(frente, largo && r() < 0.4 ? "lazer-3" : "praca-1", 2, 0), "parque");
    const feiraNoParque = porte !== "pequena" && r() < 0.35;
    const ladoP = ladoDe(fundo), recuoP = Math.max(6, fundo.y1 - (praca.y - ALTURA_PRACA[praca.peca] - FOLGA_PRACA));
    por(noLote(parte(fundo, fundo.x0 + ladoP, fundo.x1 - ladoP), feiraNoParque ? "lazer-5" : "lazer-4", recuoP, 2), "parque");
    const cantoP = parte(fundo, fundo.x0, fundo.x0 + ladoP), vePraca = cantoP.x0 > 0 && cantoP.x1 < W;   // um banco ou banca na praça
    por(vePraca && mobilia.length ? noLote(cantoP, mobilia.pop(), 3, 1) : noLote(cantoP, arvore(), 12, 2), "parque");
    const sorvete = por(noLote(parte(fundo, fundo.x1 - ladoP, fundo.x1), "rua-4", 3, 0), "parque");   // parado junto ao parque

    // o esporte: o campo e a quadra ou o parquinho (o que sobra vai para os arredores)
    const [jogo, sobra] = r() < 0.5 ? ["lazer-6", "lazer-2"] : ["lazer-2", "lazer-6"];
    fileira(de(qEsporte, 0), "lazer-1", "esporte", null, "verde");
    fileira(de(qEsporte, 1), jogo, "esporte", null, "verde");

    // o anel do marco: a fila da casa, as de prédios (as que aparecem a 1x primeiro) e as de lotes
    const anel = filas.filter(f => f.q.anel === 1 && !f.q.zona);
    const filaCasa = de(quadra(0, 1), 0);
    const aparece = f => (f.q.b === -1 && f.fila === 1) || f.q.b === 0 || (f.q.b === 1 && f.fila === 0);
    const frenteCasa = de(quadra(0, 1), 1);   // na frente da casa, só lotes baixos: nada de prédio cobrindo o chalé
    const resto = anel.filter(f => f !== filaCasa && f !== frenteCasa);
    const ordem = [...embaralhar(resto.filter(aparece)), ...embaralhar(resto.filter(f => !aparece(f)))];
    const servicos = SERVICOS[porte].filter(n => !(igreja && n === 9));   // o marco que já é igreja não ganha outra
    const nPredios = Math.max(1, Math.min(ordem.length - (feiraNoParque ? 0 : 1), Math.round(P.predios * ordem.length)));
    for (const f of ordem.slice(0, nPredios)) {   // na metrópole, as torres nas filas que aparecem inteiras; os serviços nas outras
      f.q.zona = f.q.zona || "centro";
      fileira(f, porte === "metropole" && aparece(f) ? "predios-" + um(ALTOS) : predio(servicos, P.altos), "centro", "concreto");
    }
    const lotesAnel = ordem.slice(nPredios);
    if (!feiraNoParque && lotesAnel.length) fileira(lotesAnel.shift(), "lazer-5", "centro", "praca");
    for (const f of [...lotesAnel, frenteCasa]) { f.q.zona = f.q.zona || "casas"; for (const l of lotes(f)) lote(l, "casas"); }

    const meio = Math.round((v0 + v1) / 2);
    const [l1, l2] = lotes(filaCasa), loteCasa = Math.abs((l1.x0 + l1.x1) / 2 - meio) <= Math.abs((l2.x0 + l2.x1) / 2 - meio) ? l1 : l2;
    const casa = { ...noLote(loteCasa, "chale-2", 2, 0), arvore: arvore(), zona: "casas" };
    cercas.push({ r: vaga(loteCasa), tipo: "cerca", porta: null });
    lote(loteCasa === l1 ? l2 : l1, "casas");

    // os arredores: prédios (pelo porte), lotes, o lazer que sobrou e os serviços que não couberam perto do marco
    const fora = embaralhar(filas.filter(f => f.q.anel > 1));
    const perto = fora.filter(f => f.q.anel === 2).sort((a, b) => Math.hypot(a.q.a, a.q.b) - Math.hypot(b.q.a, b.q.b));
    const usadas = new Set();
    if (perto.length) { fileira(perto[0], sobra, "esporte", null, "verde"); usadas.add(perto[0]); }
    for (const f of perto.slice(1, 1 + servicos.length)) { fileira(f, predio(servicos, P.altos), "centro", "concreto"); usadas.add(f); }
    for (const f of fora) {
      if (usadas.has(f)) continue;
      if (r() < P.fora) fileira(f, predio([], P.altos), "centro", "concreto", "verde");
      else for (const l of lotes(f)) lote(l, "casas");
    }

    // a orla: em cada faixa de altura de uma fila, coqueiros, quiosque e guarda-sóis na areia, o píer na água e um farol
    if (orla) {
      const faixas = kh.slice(0, -1).flatMap(b => {
        const y0 = rh(b) + E / 2 + C, y1 = rh(b + 1) - E / 2 - C, m = Math.round((y0 + y1) / 2);
        return [[y0, m], [m, y1]];
      });
      const terra = [orla.areia + 2, orla.areia + 34], agua = [orla.areia + 36, orla.mar - 4];
      const naAreia = ([x0, x1], [y0, y1], peca, recuo) => por(noLote({ x0, x1, y0, y1 }, peca, recuo, 2), "orla");
      const vistas = faixas.filter(([y0, y1]) => y1 > 0 && y0 < H);
      const farol = vistas.length ? um([vistas[0], vistas[vistas.length - 1]]) : null;
      faixas.forEach((y, i) => {
        if (y === farol) { naAreia(agua, y, "praia-3", 4); naAreia(terra, y, "arvore-" + um([3, 7]), 14); return; }
        const u = r();
        naAreia(terra, y, u < 0.3 ? "praia-1" : u < 0.85 ? "arvore-" + um([3, 7]) : "praia-2", 10);
        if (i % 3 === 1) {   // o píer com o pé na linha d'água: o deque sai da areia molhada e entra no mar
          const [y0, y1] = y;
          por({ x: orla.mar + 8, y: y1 - 6, peca: "praia-4", r: [orla.mar - 14, y0, orla.mar + 30, y1] }, "orla");
        } else if (r() < 0.75) naAreia(agua, y, "praia-2", 12);
      });
    }

    // a quadra do marco: o marco no meio da praça de pedra e, nos cantos, um dos arranjos (pela semente): árvores atrás e
    // canteiros na frente, o contrário, um bosque (quatro árvores) ou um jardim (quatro canteiros)
    const qc = quadras.find(q => q.centro), cx0 = qc.x0 + C, cx1 = qc.x1 - C, cy0 = qc.y0 + C, cy1 = qc.y1 - C, canto = 26;
    const generico = igreja ? [2] : porte === "pequena" ? [2, 9] : ALTOS;
    const centro = { x: meio, y: cy1 - 4, peca: "predios-" + um(generico), zona: "centro", r: [cx0 + canto, cy0, cx1 - canto, cy1] };
    pisos.push({ r: [cx0, cy0, cx1, cy1], piso: "praca" });
    const arranjo = um(["fundo", "frente", "bosque", "jardim"]);
    const ARRANJOS = { fundo: ["a", "c"], frente: ["c", "a"], bosque: ["a", "a"], jardim: ["c", "c"] };
    for (const [x0, x1] of [[cx0, cx0 + canto], [cx1 - canto, cx1]]) {
      const m = Math.round((cy0 + cy1) / 2);
      ARRANJOS[arranjo].forEach((o, k) => {
        const l = { x0, x1, y0: k ? m : cy0, y1: k ? cy1 : m };
        por(o === "a" ? noLote(l, arvore(), 4, 0) : noLote(l, "canteiro-1", 3, 0), "centro");
      });
    }

    // carros nas ruas do meio (no litoral, só nas verticais: as horizontais acabam na avenida da praia). As faixas de
    // cada sentido levam os carros por igual, a uma volta dividida entre eles. Nenhum começa dentro de um cruzamento: lá
    // dentro só cabe um veículo por vez (mundo_cidade.js)
    const faixasCarro = [];
    for (const eixo of orla ? ["v"] : ["h", "v"]) {
      for (const rua of eixo === "h" ? [h0, h1] : [v0, v1]) for (const dir of [1, -1]) faixasCarro.push({ eixo, rua, dir });
    }
    embaralhar(faixasCarro);
    const carros = [], nF = faixasCarro.length, livre = (s, cruzes) => cruzes.every(k => Math.abs(s - k) >= E / 2 + 16);
    faixasCarro.forEach((f, j) => {
      const L = f.eixo === "h" ? W : H, cruzes = f.eixo === "h" ? [v0, v1] : [h0, h1], m = Math.floor((P.carros - 1 - j) / nF) + 1;
      const s0 = Math.round(r() * L), v = 16 + Math.round(r() * 14);
      for (let k = 0; k < m; k++) {
        let s = Math.round(s0 + k * L / m) % L;
        while (!livre(s, cruzes)) s = (s + 4) % L;
        carros.push({ eixo: f.eixo, rua: f.rua, dir: f.dir, s, v, peca: "carro-" + entre(1, 5) });
      }
    });
    // ônibus (mais devagar que os carros) e bicicletas (mais ainda), nas mesmas faixas: quem vem atrás espera. Cada um
    // começa fora dos cruzamentos e longe dos outros veículos da faixa
    const extras = [...Array(P.onibus).fill("onibus"), ...Array(P.bicis).fill("bici")];
    extras.forEach((tipo, j) => {
      const f = faixasCarro[(j * 3 + 1) % nF], L = f.eixo === "h" ? W : H, cruzes = f.eixo === "h" ? [v0, v1] : [h0, h1];
      const onibus = tipo === "onibus", folga = onibus ? 24 : 16;
      const longe = s => carros.every(o => o.eixo !== f.eixo || o.rua !== f.rua || o.dir !== f.dir || Math.abs(o.s - s) >= 36);
      const cabe = s => cruzes.every(c => Math.abs(s - c) >= E / 2 + folga) && longe(s);
      let s = Math.round(r() * L), k = 0;
      for (; k < L / 4 && !cabe(s); k++) s = (s + 4) % L;
      if (!cabe(s)) return;   // a faixa lotou: fica sem esse
      carros.push({ eixo: f.eixo, rua: f.rua, dir: f.dir, s, v: onibus ? 12 + Math.round(r() * 4) : 8 + Math.round(r() * 5),
        peca: onibus ? "onibus-cima-" + entre(1, 2) : "bici-" + entre(1, 3) });
    });
    const postes = [];   // nas quinas dos quatro cruzamentos do meio (os cordões das festas vão de um a outro)
    for (const x of [v0, v1]) for (const y of [h0, h1]) for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      postes.push([x + dx * (E / 2 + 1), y + dy * (E / 2 + 1)]);
    }

    // a rede dos pedestres: os cruzamentos das ruas -1 a 2 (em volta da cidade; no litoral, até a avenida da praia, com o
    // calçadão do outro lado); cantos 0 NO, 1 NE, 2 SO, 3 SE
    const ni = orla ? 3 : 4, nos = [], viz = [], no = (i, j, c) => (i * 4 + j) * 4 + c;
    for (let i = 0; i < ni; i++) for (let j = 0; j < 4; j++) for (let c = 0; c < 4; c++) {
      nos.push([rv(i - 1) + (c % 2 ? PE : -PE), rh(j - 1) + (c > 1 ? PE : -PE)]);
      viz.push([]);
    }
    const ligar = (a, b) => { viz[a].push(b); viz[b].push(a); };
    for (let i = 0; i < ni; i++) for (let j = 0; j < 4; j++) {
      ligar(no(i, j, 0), no(i, j, 1)); ligar(no(i, j, 2), no(i, j, 3));   // faixas sobre a rua vertical
      ligar(no(i, j, 0), no(i, j, 2)); ligar(no(i, j, 1), no(i, j, 3));   // faixas sobre a rua horizontal (ou o calçadão)
      if (i < ni - 1) { ligar(no(i, j, 1), no(i + 1, j, 0)); ligar(no(i, j, 3), no(i + 1, j, 2)); }   // calçadas para o leste
      if (j < 3) { ligar(no(i, j, 2), no(i, j + 1, 0)); ligar(no(i, j, 3), no(i, j + 1, 1)); }   // calçadas para o sul
    }
    // peso de cada canto: os de dentro da caixa valem mais, para os pedestres saírem da vista e logo voltarem; eles
    // nascem num canto de dentro
    const peso = nos.map(([x, y]) => x > 0 && x < W && y > 0 && y < H ? 1 : 0.15), dentro = nos.map((_, i) => i).filter(i => peso[i] === 1);
    const pedestres = [];
    for (let i = 0, n = entre(...P.pedestres); i < n; i++) {
      const de0 = dentro[Math.floor(r() * dentro.length)], para = viz[de0][Math.floor(r() * viz[de0].length)];
      const [x0, y0] = nos[de0], [x1, y1] = nos[para];
      pedestres.push({ de: de0, para, s: Math.round(r() * Math.hypot(x1 - x0, y1 - y0)), v: 8 + Math.round(r() * 5), semente: `${id}#${i}` });
    }

    const nomes = embaralhar(RUAS.slice()), nomeRua = { v: {}, h: {} };   // o nome de cada rua do meio, para as placas
    ruas.v.forEach((x, i) => { nomeRua.v[x] = orla && x === v1 ? "Av. Beira-Mar" : nomes[i % nomes.length]; });
    ruas.h.forEach((y, i) => { nomeRua.h[y] = nomes[(i + ruas.v.length) % nomes.length]; });

    const cruzamentos = [[v0, h0], [v1, h0], [v0, h1], [v1, h1]];   // os quatro do meio, os únicos com carros nas duas ruas
    return { W, H, ruas, quadras, centro, casa, praca, sorvete, pecas, arranjo, pisos, cercas, notaveis, orla, porte, regiao,
             zonas: { centro: qc, parque: qParque, esporte: qEsporte }, carros, postes, cruzamentos, nomeRua,
             rede: { nos, viz, peso }, pedestres };
  }

  return { planta, sorteio, W, H, E, C, NOMES, PORTES };
})();
window.CidadePlanta = CidadePlanta;
