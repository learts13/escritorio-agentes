"use strict";
// Rádio da firma (Rádio Firmópolis): música feita na hora pelo navegador (Web Audio), sem arquivo de áudio e sem direito
// autoral. Três estações (lo-fi, chiptune e jazz) e, quando o admin configura no Personalizar, uma rádio da internet.
// Cada música sorteia tom, andamento, progressões e forma (introdução, partes A e B, final); a melodia nasce de um motivo
// que volta com variação, e a bateria troca de levada e faz virada no fim das partes. Nada toca sem um clique (autoplay);
// cada pessoa liga e desliga o próprio rádio (preferência local, como os volumes do som.js).
// A composição (novaMusica, compasso) é pura e determinística pela semente: o test_radio.js confere sem áudio.
const Radio = (() => {
  // ---------------------------------------------------------------- sorteio com semente
  function rng(semente) {   // mulberry32
    let a = semente >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mistura = (a, b) => { let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ (b >>> 0); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
  const sorteia = (r, l) => l[Math.floor(r() * l.length)];
  const entre = (r, a, b) => a + r() * (b - a);

  // ---------------------------------------------------------------- harmonia
  const QUALIDADE = { maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], six9: [0, 4, 7, 9, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
    d7: [0, 4, 7, 10], d9: [0, 4, 7, 10, 14], d13: [0, 4, 10, 14, 21], d7b9: [0, 4, 7, 10, 13], sus: [0, 5, 7, 10, 14], maj: [0, 4, 7], min: [0, 3, 7] };
  // "2m9 7d13 | 0maj9": compassos separados por "|" e acordes por espaço; o número é o grau, em semitons acima da tônica
  const progressao = txt => txt.split("|").map(c => c.trim().split(/\s+/).map(a => { const m = /^(\d+)([a-z]\w*)$/.exec(a); return { grau: +m[1], q: m[2] }; }));
  const ESCALA = [0, 2, 4, 5, 7, 9, 11];   // maior (as progressões menores usam a relativa)

  // ---------------------------------------------------------------- estações
  // forma: [parte, compassos]; camadas: o que toca em cada parte (vez: quantas vezes a parte já veio nesta música)
  const ESTACOES = {
    lofi: {
      nome: "Lo-fi da firma", descricao: "calma, para trabalhar", bpm: [70, 84], swing: 0.58, humano: 0.014,
      tons: [48, 50, 51, 53, 55, 56, 57],
      progA: ["2m9 | 7d13 | 0maj9 | 9m9", "5maj9 | 4m7 | 2m9 | 0maj9", "5maj9 | 7d13 | 4m7 | 9m9", "9m9 | 2m9 | 7sus | 0maj9", "0maj9 | 9m9 | 2m9 | 7d13"],
      progB: ["5maj9 | 7d13 | 4m7 9d9 | 2m9 7d13", "2m9 | 4m7 | 5maj9 | 7sus", "4m7 | 9m9 | 2m9 | 7d13", "5maj9 | 5maj9 | 4m7 | 9m9"],
      formas: [[["intro", 4], ["A", 8], ["A", 8], ["B", 8], ["A", 8], ["fim", 4]], [["intro", 4], ["A", 8], ["B", 8], ["A", 8], ["B", 8], ["fim", 4]],
        [["intro", 2], ["A", 8], ["A", 8], ["B", 8], ["B", 8], ["A", 8], ["fim", 2]]],
      camadas: (parte, vez) => parte === "intro" ? ["teclas"] : parte === "fim" ? ["teclas", "baixo"]
        : parte === "A" && vez === 0 ? ["teclas", "baixo", "bateria"] : ["teclas", "baixo", "bateria", "melodia"],
    },
    chip: {
      nome: "Chiptune do fliperama", descricao: "8 bits, animada", bpm: [112, 136], swing: 0.5, humano: 0,
      tons: [48, 50, 51, 53, 55],
      progA: ["0maj | 7maj | 9min | 5maj", "9min | 5maj | 0maj | 7maj", "0maj | 9min | 5maj | 7maj", "9min | 7maj | 5maj | 7maj", "0maj | 4min | 5maj | 7maj"],
      progB: ["5maj | 7maj | 4min | 9min", "5maj | 7maj | 0maj 9min | 2min 7maj", "2min | 7maj | 0maj | 9min", "5maj | 5maj | 0maj | 7maj"],
      formas: [[["intro", 4], ["A", 8], ["A", 8], ["B", 8], ["A", 8], ["B", 8], ["fim", 2]],
        [["intro", 2], ["A", 8], ["B", 8], ["ponte", 4], ["A", 8], ["B", 8], ["A", 8], ["fim", 2]]],
      camadas: (parte, vez) => parte === "intro" ? ["arpejo", "baixo"] : parte === "fim" ? ["arpejo", "baixo", "melodia"]
        : parte === "ponte" ? ["arpejo", "baixo", "bateria"] : vez === 0 && parte === "A" ? ["arpejo", "baixo", "bateria", "melodia"]
        : ["arpejo", "baixo", "bateria", "melodia", "eco"],
    },
    jazz: {
      nome: "Jazz da cafeteria", descricao: "piano, contrabaixo e vassourinha", bpm: [104, 132], swing: 0.64, humano: 0.012,
      tons: [53, 51, 48, 55, 50],
      progA: ["0maj7 | 9m7 | 2m7 | 7d7 | 4m7 | 9d7b9 | 2m7 | 7d13", "2m7 | 7d9 | 0maj7 | 9d7b9 | 2m7 | 7d13 | 0six9 | 7d7b9",
        "0maj7 9m7 | 2m7 7d7 | 4m7 9d7 | 2m7 7d7 | 0maj7 0d7 | 5maj7 10d9 | 4m7 9d7b9 | 2m7 7d13"],
      progB: ["5maj7 | 10d9 | 4m7 | 9d7b9 | 2m7 | 7d13 | 0maj7 | 7d7b9", "4m7 | 9d7 | 2m7 | 7d9 | 5maj7 | 5maj7 | 2m7 | 7d13",
        "9m7 | 2d9 | 2m7 | 7d9 | 4m7 | 9d7b9 | 2m7 | 7d13"],
      formas: [[["intro", 4], ["A", 8], ["A", 8], ["B", 8], ["A", 8], ["fim", 2]], [["intro", 2], ["A", 8], ["B", 8], ["B", 8], ["A", 8], ["fim", 2]]],
      camadas: (parte, vez) => parte === "intro" ? ["piano", "baixo", "bateria"] : parte === "fim" ? ["piano", "baixo"]
        : parte === "B" ? ["solo", "baixo", "bateria", "piano"] : ["melodia", "piano", "baixo", "bateria"],
    },
  };
  const IDS = Object.keys(ESTACOES);

  // ---------------------------------------------------------------- composição (pura)
  const faixaDe = { lofi: [53, 72], chip: [60, 76], jazz: [52, 68] };
  // o voicing do acorde mais perto do anterior (as vozes andam pouco): todas as inversões na faixa, a de menor salto
  function vozear(tom, acorde, anterior, [lo, hi], semFundamental) {
    let iv = QUALIDADE[acorde.q];
    if (semFundamental && iv.length >= 4) iv = iv.slice(1);   // o baixo já toca a fundamental
    if (iv.length > 4) iv = iv.filter(x => x !== 7);           // a quinta sai primeiro
    const pcs = iv.map(x => (tom + acorde.grau + x) % 12);
    let melhor = null, custo = Infinity;
    const alvo = anterior ? anterior.reduce((s, n) => s + n, 0) / anterior.length : (lo + hi) / 2;
    for (let i = 0; i < pcs.length; i++) {
      const v = [];
      let n = lo + ((pcs[i] - lo) % 12 + 12) % 12;
      v.push(n);
      for (let j = 1; j < pcs.length; j++) { const pc = pcs[(i + j) % pcs.length]; let m = n + ((pc - n) % 12 + 12) % 12 || 12; v.push(m); n = m; }
      if (v[v.length - 1] > hi + 4) continue;
      const media = v.reduce((s, x) => s + x, 0) / v.length;
      const c = Math.abs(media - alvo) + (anterior ? Math.abs(v[v.length - 1] - anterior[anterior.length - 1]) * 0.5 : 0);
      if (c < custo) { custo = c; melhor = v; }
    }
    return melhor || pcs.map(pc => lo + ((pc - lo) % 12 + 12) % 12).sort((a, b) => a - b);
  }

  // motivo de 2 compassos: ritmo e contorno (passos na escala); densidade e figuras de cada estação
  const RITMO = {
    lofi: { notas: [4, 6], figuras: [1, 1, 1.5, 0.5, 2, 0.5], comeco: [0, 0.5, 1] },
    chip: { notas: [8, 11], figuras: [0.5, 0.5, 0.5, 1, 0.25, 0.25, 1.5], comeco: [0] },
    jazz: { notas: [6, 9], figuras: [0.5, 0.5, 1, 1, 1.5, 0.5, 2], comeco: [0.5, 0, 1] },
  };
  function motivo(r, id) {
    const R = RITMO[id], total = Math.round(entre(r, R.notas[0], R.notas[1])), notas = [];
    let b = sorteia(r, R.comeco);
    while (notas.length < total && b < 7) {
      const d = sorteia(r, R.figuras);
      const passo = sorteia(r, [-2, -1, -1, 0, 1, 1, 2, 3, -3, 1]);
      notas.push({ b, d: Math.min(d, 7.5 - b), passo });
      b += d + (r() < 0.2 ? sorteia(r, [0.5, 1]) : 0);   // às vezes respira
    }
    return notas;
  }

  function novaMusica(id, semente) {
    const E = ESTACOES[id], r = rng(semente);
    const bpm = Math.round(entre(r, E.bpm[0], E.bpm[1])), tom = sorteia(r, E.tons);
    const pa = sorteia(r, E.progA);
    let pb = sorteia(r, E.progB);
    const A = progressao(pa), B = progressao(pb), forma = sorteia(r, E.formas);
    const motivos = { A: motivo(r, id), B: motivo(r, id) };
    const compassos = [], vezes = {};
    let voz = null;
    for (const [parte, n] of forma) {
      const vez = vezes[parte] = (vezes[parte] ?? -1) + 1;
      const prog = parte === "B" ? B : A;
      for (let i = 0; i < n; i++) {
        // a introdução usa o fim da progressão A; o final pousa na tônica
        const acordes = parte === "fim" ? (i === n - 1 ? [{ grau: 0, q: id === "chip" ? "maj" : id === "jazz" ? "six9" : "maj9" }] : prog[(prog.length - 2 + i) % prog.length])
          : parte === "intro" ? prog[(prog.length - n + i + prog.length * 4) % prog.length] : prog[i % prog.length];
        const vozes = acordes.map(a => (voz = vozear(tom, a, voz, faixaDe[id], id !== "chip")));
        compassos.push({ parte, vez, i, n, acordes, vozes });
      }
    }
    return { id, semente: semente >>> 0, bpm, tom, swing: E.swing, humano: E.humano, compassos, motivos, levada: Math.floor(r() * 3) };
  }

  // tempo em batidas com swing: a colcheia do contratempo atrasa (0.5 vira o swing)
  function tempoDaBatida(b, swing) {
    const i = Math.floor(b), f = b - i;
    return i + (f < 0.5 ? f * swing / 0.5 : swing + (f - 0.5) * (1 - swing) / 0.5);
  }

  // o acorde que soa na batida b do compasso c (dois acordes: um em cada metade)
  const acordeEm = (c, b) => c.acordes[c.acordes.length > 1 && b >= 2 ? 1 : 0];
  const vozEm = (c, b) => c.vozes[c.acordes.length > 1 && b >= 2 ? 1 : 0];
  const notasDoAcorde = (M, a) => QUALIDADE[a.q].map(x => (M.tom + a.grau + x) % 12);
  function maisPerto(alvo, pcs) {
    let melhor = alvo, d = 99;
    for (let n = alvo - 6; n <= alvo + 6; n++) if (pcs.includes(((n % 12) + 12) % 12) && Math.abs(n - alvo) < d) { d = Math.abs(n - alvo); melhor = n; }
    return melhor;
  }
  const naEscala = (M, grau) => M.tom + 12 * Math.floor(grau / 7) + ESCALA[((grau % 7) + 7) % 7];
  const grauDe = (M, nota) => { let g = 0; while (naEscala(M, g) < nota) g++; while (naEscala(M, g) > nota) g--; return g; };

  // a melodia de um compasso: o motivo da parte, na metade certa dos 2 compassos, encaixado nos acordes de agora
  function melodia(M, c, r, ev, inst, faixa) {
    const mot = M.motivos[c.parte === "B" ? "B" : "A"], metade = c.i % 2, frase = Math.floor(c.i / 2) % 4;
    const variar = c.vez > 0 || frase % 2 === 1, cadencia = frase === 3 && metade === 1;
    let g = grauDe(M, faixa[0] + 7 + (frase === 2 ? 2 : 0));
    for (const nota of mot) {
      g += nota.passo;
      if (nota.b < metade * 4 || nota.b >= metade * 4 + 4) continue;
      if (variar && r() < 0.18) continue;                        // na repetição, umas notas caem
      let n = naEscala(M, g + (variar && r() < 0.25 ? sorteia(r, [-1, 1]) : 0));
      const b = nota.b - metade * 4, forte = b % 2 === 0;
      if (forte) n = maisPerto(n, notasDoAcorde(M, acordeEm(c, b)));
      while (n > faixa[1]) n -= 12;
      while (n < faixa[0]) n += 12;
      ev.push({ b, d: nota.d * 0.95, i: inst, n, v: forte ? 0.9 : 0.75 });
    }
    if (cadencia) {   // fim da frase de 8: pousa numa nota do acorde, longa
      const a = acordeEm(c, 2);
      let n = maisPerto(faixa[0] + 9, notasDoAcorde(M, a));
      while (n < faixa[0]) n += 12;
      for (let k = ev.length - 1; k >= 0; k--) if (ev[k].i === inst && ev[k].b >= 2) ev.splice(k, 1);
      ev.push({ b: 2, d: 1.8, i: inst, n, v: 0.85 });
    }
  }

  const fimDaParte = c => c.i === c.n - 1;
  const LEVADAS = {
    lofi: [{ k: [0, 2.5], s: [1, 3] }, { k: [0, 1.5, 2.5], s: [1, 3] }, { k: [0, 2, 2.75], s: [1, 3] }],
    chip: [{ k: [0, 2], s: [1, 3] }, { k: [0, 1.5, 2], s: [1, 3] }, { k: [0, 0.75, 2, 2.5], s: [1, 3] }],
  };

  function lofi(M, c, r, cam, ev) {
    const prox = M.compassos[M.compassos.indexOf(c) + 1];
    if (cam.includes("teclas")) {
      const padrao = c.parte === "fim" && fimDaParte(c) ? [[0, 4]] : c.acordes.length > 1 ? [[0, 2], [2, 2]]
        : sorteia(r, [[[0, 4]], [[0, 4]], [[0, 2.5], [2.5, 1.5]], [[0, 1.5], [1.5, 2.5]], [[0, 3], [3.5, 0.5]]]);
      for (const [b, d] of padrao) vozEm(c, b).forEach((n, j) => ev.push({ b: b + j * 0.03, d: d - 0.05, i: "teclas", n, v: (b ? 0.45 : 0.6) * entre(r, 0.85, 1) }));
    }
    if (cam.includes("baixo")) {
      for (const [k, a] of c.acordes.entries()) {
        const raiz = 36 + ((M.tom + a.grau - 36) % 12 + 12) % 12, b0 = k * 2;
        ev.push({ b: b0, d: c.acordes.length > 1 ? 1.4 : 1.5, i: "baixo", n: raiz, v: 0.9 });
        if (c.acordes.length === 1) ev.push(sorteia(r, [{ b: 2.5, d: 1, i: "baixo", n: raiz, v: 0.7 }, { b: 2, d: 1.5, i: "baixo", n: raiz + 7, v: 0.7 }, { b: 3, d: 0.8, i: "baixo", n: raiz + 12, v: 0.6 }]));
      }
      if (prox && r() < 0.35 && c.acordes.length === 1) {   // nota de passagem para o próximo
        const alvo = 36 + ((M.tom + prox.acordes[0].grau - 36) % 12 + 12) % 12;
        ev.push({ b: 3.5, d: 0.4, i: "baixo", n: alvo + sorteia(r, [-1, 1, 2]), v: 0.55 });
      }
    }
    if (cam.includes("bateria")) {
      const L = LEVADAS.lofi[(M.levada + (c.parte === "B" ? 1 : 0)) % 3];
      const virada = fimDaParte(c) && c.n >= 8;
      for (const b of L.k) if (!(virada && b > 2)) ev.push({ b, d: 0.3, i: "bumbo", v: b ? 0.75 : 0.95 });
      for (const b of L.s) ev.push({ b, d: 0.2, i: c.parte === "A" && c.vez === 0 ? "aro" : "caixa", v: 0.8 });
      for (let b = 0; b < 4; b += 0.5) if (!(virada && b >= 3)) ev.push({ b, d: 0.1, i: b === 3.5 && r() < 0.3 ? "chimbal_aberto" : "chimbal", v: (b % 1 ? 0.45 : 0.75) * entre(r, 0.8, 1) });
      if (r() < 0.3) ev.push({ b: 3.75, d: 0.1, i: "caixa", v: 0.2 });   // nota fantasma
      if (virada) for (const b of [3, 3.25, 3.5, 3.75]) ev.push({ b, d: 0.15, i: "caixa", v: 0.3 + (b - 3) * 0.5 });
    }
    if (cam.includes("melodia")) melodia(M, c, r, ev, "melodia", [65, 81]);
  }

  function chip(M, c, r, cam, ev) {
    if (cam.includes("arpejo")) {
      const tipo = (M.levada + (c.parte === "B" ? 1 : 0)) % 3;
      for (let s = 0; s < 16; s++) {
        const b = s / 4, v = vozEm(c, b).slice(0, 3), sobe = [...v, v[0] + 12];
        const ordem = tipo === 0 ? sobe : tipo === 1 ? [...sobe, ...sobe.slice(1, -1).reverse()] : [v[0], v[1], v[2], v[1]];
        ev.push({ b, d: 0.22, i: "arpejo", n: ordem[s % ordem.length], v: s % 4 ? 0.7 : 0.95 });
      }
    }
    if (cam.includes("baixo")) {
      for (let s = 0; s < 8; s++) {
        const b = s / 2, a = acordeEm(c, b), raiz = 36 + ((M.tom + a.grau - 36) % 12 + 12) % 12;
        if (c.parte === "fim" && fimDaParte(c) && s > 0) break;
        ev.push({ b, d: c.parte === "fim" && fimDaParte(c) ? 3.5 : 0.42, i: "baixo", n: raiz + (s % 2 ? (c.parte === "B" ? 7 : 12) : 0), v: 0.9 });
      }
    }
    if (cam.includes("bateria")) {
      const L = LEVADAS.chip[(M.levada + (c.parte === "B" ? 2 : 0)) % 3], virada = fimDaParte(c);
      for (const b of L.k) if (!(virada && b >= 2)) ev.push({ b, d: 0.2, i: "bumbo", v: 0.9 });
      for (const b of L.s) if (!(virada && b >= 2)) ev.push({ b, d: 0.15, i: "caixa", v: 0.85 });
      for (let b = 0; b < 4; b += 0.5) if (!(virada && b >= 2)) ev.push({ b, d: 0.05, i: "chimbal", v: b % 1 ? 0.5 : 0.8 });
      if (virada) for (let b = 2; b < 4; b += 0.25) ev.push({ b, d: 0.1, i: "caixa", v: 0.45 + (b - 2) * 0.25 });
    }
    if (cam.includes("melodia")) {
      const antes = ev.length;
      melodia(M, c, r, ev, "melodia", [67, 84]);
      if (cam.includes("eco")) for (const e of ev.slice(antes)) if (e.b + 0.75 < 4) ev.push({ ...e, b: e.b + 0.75, i: "eco", v: e.v * 0.5 });
    }
  }

  // contrabaixo andando: fundamental no tempo forte, notas do acorde no meio e aproximação cromática para o próximo
  function andar(M, c, r, ev) {
    const prox = M.compassos[M.compassos.indexOf(c) + 1];
    const faixa = n => { while (n > 52) n -= 12; while (n < 36) n += 12; return n; };
    const partes = c.acordes.length > 1 ? [[0, 2], [2, 2]] : [[0, 4]];
    partes.forEach(([b0, dur], k) => {
      const a = c.acordes[k], raiz = faixa(M.tom + a.grau), pcs = notasDoAcorde(M, a);
      const seguinte = k + 1 < c.acordes.length ? c.acordes[k + 1] : prox ? prox.acordes[0] : null;
      const alvo = seguinte ? faixa(M.tom + seguinte.grau) : raiz;
      const notas = [raiz];
      if (dur === 4) { notas.push(maisPerto(raiz + sorteia(r, [3, 4, 7, -5]), pcs)); notas.push(maisPerto(raiz + sorteia(r, [7, 5, 9, -3]), pcs)); }
      notas.push(alvo + (r() < 0.6 ? sorteia(r, [-1, 1]) : sorteia(r, [-2, 2])));
      notas.forEach((n, j) => ev.push({ b: b0 + j, d: 0.9, i: "baixo", n: faixa(n), v: j ? 0.75 : 0.9 }));
    });
  }

  function jazz(M, c, r, cam, ev) {
    if (cam.includes("baixo")) {
      if (c.parte === "fim" && fimDaParte(c)) ev.push({ b: 0, d: 3.5, i: "baixo", n: 36 + ((M.tom - 36) % 12 + 12) % 12, v: 0.9 });
      else if (c.parte === "intro" && c.i < 2) c.acordes.forEach((a, k) => ev.push({ b: k * 2, d: 1.8, i: "baixo", n: 36 + ((M.tom + a.grau - 36) % 12 + 12) % 12, v: 0.85 }));   // em dois, para entrar
      else andar(M, c, r, ev);
    }
    if (cam.includes("piano")) {
      const fim = c.parte === "fim" && fimDaParte(c), solo = cam.includes("solo");
      const padrao = fim ? [[0, 3.8]] : c.acordes.length > 1 ? [[0, 0.6], [2, 0.6], ...(r() < 0.5 ? [[3.5, 0.4]] : [])]
        : sorteia(r, solo ? [[[0, 0.5], [2.5, 0.5]], [[1.5, 0.5]], [[0.5, 0.4], [3, 0.6]]]
          : [[[0, 0.6], [1.5, 0.5]], [[1.5, 0.5], [3, 0.8]], [[0.5, 0.4], [2.5, 0.4]], [[0, 2.5]], [[0, 0.6], [1.5, 0.5], [3.5, 0.4]]]);
      for (const [b, d] of padrao) vozEm(c, b).forEach((n, j) => ev.push({ b: b + j * 0.012, d, i: "piano", n, v: (solo ? 0.4 : 0.55) * entre(r, 0.85, 1) }));
    }
    if (cam.includes("bateria")) {
      const vir = fimDaParte(c) && c.n >= 8;
      for (const [b, v] of [[0, 0.75], [1, 0.9], [1.5, 0.55], [2, 0.75], [3, 0.9], [3.5, 0.55]]) ev.push({ b, d: 0.4, i: "ride", v: v * entre(r, 0.85, 1) });
      ev.push({ b: 1, d: 0.1, i: "pedal", v: 0.8 }, { b: 3, d: 0.1, i: "pedal", v: 0.8 });
      for (const b of [1, 3]) ev.push({ b, d: 0.3, i: "vassoura", v: 0.7 });
      if (r() < 0.5) ev.push({ b: sorteia(r, [2.5, 3.5, 1.5]), d: 0.2, i: "vassoura", v: 0.35 });   // comentário da caixa
      ev.push({ b: 0, d: 0.3, i: "bumbo", v: 0.5 });
      if (vir) ev.push({ b: 3.5, d: 0.2, i: "caixa", v: 0.6 }, { b: 2.5, d: 0.2, i: "caixa", v: 0.4 });
    }
    if (cam.includes("melodia")) melodia(M, c, r, ev, "vibra", [62, 79]);
    if (cam.includes("solo")) {   // o piano improvisa em colcheias: escala, notas do acorde nos tempos e pausas para respirar
      if (r() < 0.2) return;
      let n = maisPerto(68 + Math.floor(r() * 6), notasDoAcorde(M, acordeEm(c, 0))), dir = r() < 0.5 ? 1 : -1;
      const inicio = sorteia(r, [0, 0.5, 1]), fim = sorteia(r, [3, 3.5, 4]);
      for (let b = inicio; b < fim; b += 0.5) {
        if (r() < 0.12) continue;
        if (r() < 0.25 || n > 80 || n < 62) dir = n > 76 ? -1 : n < 64 ? 1 : -dir;
        let g = grauDe(M, n) + dir;
        n = b % 1 === 0 ? maisPerto(naEscala(M, g), notasDoAcorde(M, acordeEm(c, b))) : naEscala(M, g);
        if (r() < 0.1) n += dir > 0 ? -1 : 1;   // cromatismo
        ev.push({ b, d: 0.45, i: "solo", n, v: (b % 1 ? 0.65 : 0.8) * entre(r, 0.85, 1) });
      }
    }
  }

  const ARRANJO = { lofi, chip, jazz };
  // os eventos de um compasso: {b: batida (0 a 4), d: duração em batidas, i: instrumento, n: nota MIDI (percussão sem), v: 0 a 1, h: atraso humano em s}
  function compasso(M, k) {
    const c = M.compassos[k]; if (!c) return [];
    const r = rng(mistura(M.semente, k + 1)), ev = [];
    ARRANJO[M.id](M, c, r, ESTACOES[M.id].camadas(c.parte, c.vez), ev);
    for (const e of ev) e.h = M.humano ? (r() - 0.5) * M.humano : 0;
    return ev.sort((a, b) => a.b - b.b);
  }

  // ---------------------------------------------------------------- preferências (por pessoa, neste navegador)
  const CHAVE = "escritorio.radio", VOLUME_PADRAO = 0.35;
  // o ligado nunca vem do armazenamento: o rádio só toca depois de um clique (e cada visita começa em silêncio)
  function preferencias(bruto) {
    const p = bruto && typeof bruto === "object" ? bruto : {};
    const volume = Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : VOLUME_PADRAO;
    return { estacao: typeof p.estacao === "string" ? p.estacao : "lofi", volume };
  }
  const estacoesDisponiveis = internet => [...IDS.map(id => ({ id, nome: ESTACOES[id].nome, descricao: ESTACOES[id].descricao })),
    ...(internet ? [{ id: "internet", nome: "Rádio da internet", descricao: "configurada no Personalizar" }] : [])];
  const escolherEstacao = (pedida, internet) => estacoesDisponiveis(internet).some(e => e.id === pedida) ? pedida : "lofi";
  const curvaVolume = v => 0.9 * v * v;   // o ouvido é logarítmico: o meio do controle já é bem mais baixo

  // ---------------------------------------------------------------- síntese (Web Audio)
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  function Sintese(ctx) {
    const sr = ctx.sampleRate, ruido = ctx.createBuffer(1, sr * 2, sr), d = ruido.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // onda de pulso (o quadrado do 8 bits) por série de Fourier, com poucos harmônicos: menos áspera
    const pulso = duty => { const re = new Float32Array(24), im = new Float32Array(24); for (let n = 1; n < 24; n++) { re[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI); im[n] = 2 * Math.sin(Math.PI * n * duty) ** 2 / (n * Math.PI); } return ctx.createPeriodicWave(re, im); };
    const piano = (() => { const h = [0, 1, 0.45, 0.25, 0.14, 0.08, 0.05, 0.03], re = new Float32Array(h.length); return ctx.createPeriodicWave(re, Float32Array.from(h)); })();
    const ondas = { p12: pulso(0.125), p25: pulso(0.25) };
    // envelope: sobe em linha reta, cai exponencialmente até o sustento e solta depois do fim da nota (nunca salta: sem estalo)
    function env(t, dur, pico, ataque, queda, sustenta, solta) {
      const g = ctx.createGain(), fim = Math.max(t + ataque, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pico, t + ataque);
      if (queda) g.gain.setTargetAtTime(pico * sustenta, t + ataque, queda);
      g.gain.setTargetAtTime(0, fim, solta / 5);
      return { g, fim: fim + solta * 2 };
    }
    function osc(tipo, f, t, fim, destino, detune = 0) {
      const o = ctx.createOscillator();
      if (ondas[tipo]) o.setPeriodicWave(ondas[tipo]); else if (tipo === "piano") o.setPeriodicWave(piano); else o.type = tipo;
      o.frequency.setValueAtTime(f, t); o.detune.value = detune; o.connect(destino); o.start(t); o.stop(fim);
      return o;
    }
    function chiado(t, fim, destino, filtro, f, q = 1) {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter();
      s.buffer = ruido; fl.type = filtro; fl.frequency.value = f; fl.Q.value = q;
      s.connect(fl); fl.connect(destino); s.start(t, Math.random() * 1.5); s.stop(fim);
    }
    const passaBaixa = (f, destino) => { const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = f; fl.connect(destino); return fl; };
    const vibrato = (o, t, fim, f, taxa, prof) => { const l = ctx.createOscillator(), g = ctx.createGain(); l.frequency.value = taxa; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(f * prof, t + 0.25); l.connect(g); g.connect(o.frequency); l.start(t); l.stop(fim); };

    // cada instrumento: (t, dur em s, nota, vel, destino)
    const I = {
      teclas(t, dur, n, v, out) {   // piano elétrico: FM leve dá o "tine" do ataque
        const f = hz(n), e = env(t, dur, 0.11 * v, 0.006, 0.9, 0.35, 0.6), car = osc("sine", f, t, e.fim, e.g, (Math.random() - 0.5) * 10);
        const mod = ctx.createOscillator(), mg = ctx.createGain();
        mod.frequency.value = f; mg.gain.setValueAtTime(f * 1.1 * v, t); mg.gain.setTargetAtTime(f * 0.12, t, 0.12);
        mod.connect(mg); mg.connect(car.frequency); mod.start(t); mod.stop(e.fim);
        e.g.connect(out);
      },
      baixo_lofi(t, dur, n, v, out) { const e = env(t, dur, 0.07 * v, 0.012, 0.6, 0.55, 0.15), fl = passaBaixa(650, out); osc("sine", hz(n), t, e.fim, e.g); osc("triangle", hz(n), t, e.fim, e.g); e.g.connect(fl); },
      melodia_lofi(t, dur, n, v, out) { const e = env(t, dur, 0.11 * v, 0.02, 0.5, 0.55, 0.3), fl = passaBaixa(2400, out), o = osc("triangle", hz(n), t, e.fim, e.g); vibrato(o, t, e.fim, hz(n), 5, 0.004); e.g.connect(fl); },
      bumbo_lofi(t, dur, n, v, out) { const e = env(t, 0, 0.32 * v, 0.003, 0, 0, 0.22), o = osc("sine", 110, t, e.fim, e.g); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); e.g.connect(out); },
      caixa_lofi(t, dur, n, v, out) { const e = env(t, 0, 0.34 * v, 0.002, 0, 0, 0.32); chiado(t, e.fim, e.g, "bandpass", 1600, 0.7); const e2 = env(t, 0, 0.14 * v, 0.002, 0, 0, 0.12); osc("triangle", 185, t, e2.fim, e2.g); e.g.connect(out); e2.g.connect(out); },
      aro_lofi(t, dur, n, v, out) { const e = env(t, 0, 0.25 * v, 0.001, 0, 0, 0.06); chiado(t, e.fim, e.g, "bandpass", 2600, 3); osc("sine", 820, t, e.fim, e.g); e.g.connect(out); },
      chimbal_lofi(t, dur, n, v, out) { const e = env(t, 0, 0.3 * v, 0.001, 0, 0, 0.07); chiado(t, e.fim, e.g, "bandpass", 4800, 0.9); e.g.connect(out); },
      chimbal_aberto_lofi(t, dur, n, v, out) { const e = env(t, 0, 0.18 * v, 0.002, 0, 0, 0.5); chiado(t, e.fim, e.g, "bandpass", 4800, 0.9); e.g.connect(out); },

      arpejo(t, dur, n, v, out) { const e = env(t, dur, 0.13 * v, 0.002, 0.08, 0.35, 0.04); osc("p12", hz(n), t, e.fim, e.g); e.g.connect(out); },
      baixo_chip(t, dur, n, v, out) { const e = env(t, dur, 0.1 * v, 0.003, 0, 1, 0.03); osc("triangle", hz(n), t, e.fim, e.g); e.g.connect(out); },
      melodia_chip(t, dur, n, v, out) { const e = env(t, dur, 0.17 * v, 0.003, 0.25, 0.6, 0.05), o = osc("p25", hz(n), t, e.fim, e.g); vibrato(o, t, e.fim, hz(n), 6, 0.006); e.g.connect(out); },
      eco(t, dur, n, v, out) { const e = env(t, dur, 0.16 * v, 0.003, 0.2, 0.5, 0.05); osc("p12", hz(n), t, e.fim, e.g); e.g.connect(out); },
      bumbo_chip(t, dur, n, v, out) { const e = env(t, 0, 0.32 * v, 0.002, 0, 0, 0.14), o = osc("triangle", 170, t, e.fim, e.g); o.frequency.exponentialRampToValueAtTime(48, t + 0.08); e.g.connect(out); },
      caixa_chip(t, dur, n, v, out) { const e = env(t, 0, 0.26 * v, 0.001, 0, 0, 0.16); chiado(t, e.fim, e.g, "bandpass", 3200, 0.6); e.g.connect(out); },
      chimbal_chip(t, dur, n, v, out) { const e = env(t, 0, 0.14 * v, 0.001, 0, 0, 0.05); chiado(t, e.fim, e.g, "highpass", 5500); e.g.connect(out); },

      piano(t, dur, n, v, out) { const e = env(t, dur, 0.085 * v, 0.004, 0.7, 0.2, 0.25), f = hz(n), fl = passaBaixa(3200, out); osc("piano", f, t, e.fim, e.g, -3); osc("piano", f, t, e.fim, e.g, 3); e.g.connect(fl); },
      baixo_jazz(t, dur, n, v, out) { const e = env(t, dur, 0.1 * v, 0.006, 0.32, 0.3, 0.12), fl = passaBaixa(900, out); osc("sine", hz(n), t, e.fim, e.g); osc("triangle", hz(n) * 2, t, e.fim, e.g); e.g.connect(fl); },
      vibra(t, dur, n, v, out) {   // vibrafone: senoide com parcial alto que some rápido e o trêmolo do motor
        const f = hz(n), e = env(t, dur, 0.11 * v, 0.003, 1.1, 0.25, 0.5), tr = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
        osc("sine", f, t, e.fim, e.g);
        const p = env(t, 0, 0.02 * v, 0.002, 0, 0, 0.4); osc("sine", f * 4, t, p.fim, p.g); p.g.connect(e.g);
        l.frequency.value = 5.2; lg.gain.value = 0.25; tr.gain.value = 0.75; l.connect(lg); lg.connect(tr.gain); l.start(t); l.stop(e.fim);
        e.g.connect(tr); tr.connect(out);
      },
      solo(t, dur, n, v, out) { I.piano(t, dur, n, v * 1.3, out); },
      ride(t, dur, n, v, out) { const e = env(t, 0, 0.11 * v, 0.001, 0, 0, 0.9); chiado(t, e.fim, e.g, "bandpass", 6500, 1.2); const p = env(t, 0, 0.02 * v, 0.001, 0, 0, 0.5); osc("sine", 5100, t, p.fim, p.g); e.g.connect(out); p.g.connect(out); },
      pedal(t, dur, n, v, out) { const e = env(t, 0, 0.14 * v, 0.002, 0, 0, 0.05); chiado(t, e.fim, e.g, "bandpass", 4200, 2); e.g.connect(out); },
      vassoura(t, dur, n, v, out) { const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * v, t + 0.04); g.gain.setTargetAtTime(0, t + 0.06, 0.06); chiado(t, t + 0.5, g, "bandpass", 2600, 0.7); g.connect(out); },
      bumbo_jazz(t, dur, n, v, out) { const e = env(t, 0, 0.2 * v, 0.004, 0, 0, 0.25), o = osc("sine", 85, t, e.fim, e.g); o.frequency.exponentialRampToValueAtTime(48, t + 0.15); e.g.connect(out); },
      caixa_jazz(t, dur, n, v, out) { const e = env(t, 0, 0.07 * v, 0.002, 0, 0, 0.2); chiado(t, e.fim, e.g, "bandpass", 1900, 0.8); e.g.connect(out); },
    };
    const tocar = (estacao, e, t, dur, out) => (I[`${e.i}_${estacao}`] || I[e.i])(t, dur, e.n, e.v, out);

    // reverberação: resposta ao impulso gerada (ruído que decai), sem arquivo
    function sala(seg, decai) {
      const n = Math.floor(sr * seg), b = ctx.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) { const x = b.getChannelData(c); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decai); }
      const cv = ctx.createConvolver(); cv.buffer = b; return cv;
    }
    // chiado de vinil (lo-fi): estalos esparsos e um sopro baixinho, em laço de 5,3 s (o ruído não deixa ouvir a emenda)
    function vinil() {
      const n = Math.floor(sr * 5.3), b = ctx.createBuffer(1, n, sr), x = b.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.08; x[i] = lp * 0.25; }
      for (let k = 0; k < 5.3 * 5; k++) { const i = Math.floor(Math.random() * (n - 40)), a = (0.15 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1); for (let j = 0; j < 30; j++) x[i + j] += a * Math.exp(-j / 4) * (j % 2 ? -0.6 : 1); }
      const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; return s;
    }
    return { tocar, sala, vinil };
  }

  // uma estação tocando: agenda compasso por compasso; ao fim de cada música, sorteia a próxima (tom, andamento, forma)
  const MIX = { lofi: { filtro: 5500, reverb: 0.22, ganho: 1 }, chip: { filtro: 9000, reverb: 0.1, ganho: 0.9 }, jazz: { filtro: 9000, reverb: 0.18, ganho: 1 } };
  const ENVIO = { teclas: 0.3, melodia: 0.45, vibra: 0.45, piano: 0.3, solo: 0.3, eco: 0.5, caixa: 0.25, aro: 0.25, vassoura: 0.2, ride: 0.15 };
  function Estacao(ctx, S, id, semente, destino, apenas = null) {
    const X = MIX[id], bus = ctx.createGain(), filtro = ctx.createBiquadFilter(), seco = ctx.createGain(), envio = ctx.createGain(), rev = S.sala(2.4, 3);
    bus.gain.value = 0; filtro.type = "lowpass"; filtro.frequency.value = X.filtro; filtro.Q.value = 0.5;
    seco.gain.value = X.ganho; envio.gain.value = X.reverb;
    seco.connect(filtro); envio.connect(rev); rev.connect(filtro); filtro.connect(bus); bus.connect(destino);
    const canais = {};
    const canal = i => canais[i] || (canais[i] = (() => { const g = ctx.createGain(); g.connect(seco); if (ENVIO[i]) { const s = ctx.createGain(); s.gain.value = ENVIO[i]; g.connect(s); s.connect(envio); } return g; })());
    let musicas = 0, M = novaMusica(id, semente), k = 0, t = ctx.currentTime + 0.15, chiadoVinil = null;
    if (id === "lofi" && (!apenas || apenas.includes("vinil"))) { chiadoVinil = S.vinil(); const g = ctx.createGain(); g.gain.value = 0.14; chiadoVinil.connect(g); g.connect(bus); chiadoVinil.start(t); }
    function agendar(ate) {
      while (t < ate) {
        if (k >= M.compassos.length) { M = novaMusica(id, mistura(semente, ++musicas)); k = 0; t += 60 / M.bpm * 2; continue; }   // respiro entre as músicas
        const seg = 60 / M.bpm;
        for (const e of compasso(M, k)) {
          if (apenas && !apenas.includes(e.i)) continue;
          const quando = t + tempoDaBatida(e.b, M.swing) * seg + e.h;
          S.tocar(id, e, Math.max(quando, ctx.currentTime), e.d * seg, canal(e.i));
        }
        t += 4 * seg; k++;
      }
    }
    return {
      id, agendar,
      musica: () => M,
      entrar(seg) { const a = ctx.currentTime; bus.gain.setValueAtTime(0, a); bus.gain.linearRampToValueAtTime(1, a + seg); },
      sair(seg) {
        const a = ctx.currentTime; bus.gain.cancelScheduledValues(a); bus.gain.setValueAtTime(bus.gain.value, a); bus.gain.linearRampToValueAtTime(0, a + seg);
        setTimeout(() => { try { if (chiadoVinil) chiadoVinil.stop(); bus.disconnect(); } catch (e) { /* já parou */ } }, seg * 1000 + 200);
      },
    };
  }

  // grava um trecho de uma estação sem tocar (OfflineAudioContext): para conferir o som (níveis, estalos, repetição)
  // apenas: só esses instrumentos (para medir o volume de cada um)
  function renderizar(id, segundos, semente = 1, apenas = null, taxa = 44100) {
    const ctx = new OfflineAudioContext(2, Math.ceil(segundos * taxa), taxa), S = Sintese(ctx);
    const vol = ctx.createGain(), lim = limitador(ctx);
    vol.gain.value = curvaVolume(1); vol.connect(lim); lim.connect(ctx.destination);
    const est = Estacao(ctx, S, id, semente, vol, apenas);
    est.entrar(0.01); est.agendar(segundos);
    return ctx.startRendering();
  }
  function limitador(ctx) { const c = ctx.createDynamicsCompressor(); c.threshold.value = -10; c.knee.value = 6; c.ratio.value = 8; c.attack.value = 0.003; c.release.value = 0.25; return c; }


  // ---------------------------------------------------------------- o rádio da página (um por pessoa, neste navegador)
  let ctx = null, S = null, mestre = null, atual = null, relogio = null, audio = null, fadeAudio = null, ligado = false, internet = "", aviso = "";
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch (e) { return {}; } };
  let pref = preferencias(ler());
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(pref)); } catch (e) { /* sem armazenamento: vale só nesta visita */ } };
  // o modo TV e o modo apresentação não tocam nada
  const bloqueado = () => new URLSearchParams(location.search).get("tv") === "1" || !!(window.TV && TV.ligada) || !!(window.Apresentacao && Apresentacao.ligado());
  const avisar = () => { window.dispatchEvent(new CustomEvent("radio", { detail: estado() })); if (painel) atualizarPainel(); };
  const estado = () => ({ ligado, estacao: escolherEstacao(pref.estacao, !!internet), volume: pref.volume, aviso });

  function garantirContexto() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC(); S = Sintese(ctx); mestre = ctx.createGain(); mestre.gain.value = curvaVolume(pref.volume);
      const lim = limitador(ctx); mestre.connect(lim); lim.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function pararGerada(seg) { if (atual) { atual.sair(seg); atual = null; } clearInterval(relogio); relogio = null; }
  function pararInternet(seg) {
    if (!audio) return;
    const a = audio; audio = null; clearInterval(fadeAudio);
    const passo = a.volume / Math.max(1, seg * 20);
    fadeAudio = setInterval(() => { a.volume = Math.max(0, a.volume - passo); if (a.volume <= 0) { clearInterval(fadeAudio); a.pause(); a.removeAttribute("src"); a.load(); } }, 50);
  }
  function tocarInternet() {
    audio = new Audio(); audio.preload = "none"; audio.src = internet; audio.volume = 0;
    const alvo = Math.min(1, curvaVolume(pref.volume) / 0.9), a = audio;
    a.addEventListener("error", () => { if (audio !== a) return; aviso = "Não deu para tocar a rádio da internet agora."; desligar(); });
    a.play().then(() => { clearInterval(fadeAudio); fadeAudio = setInterval(() => { a.volume = Math.min(alvo, a.volume + alvo / 30); if (a.volume >= alvo) clearInterval(fadeAudio); }, 50); })
      .catch(() => { if (audio === a) { aviso = "Não deu para tocar a rádio da internet agora."; desligar(); } });
  }
  // troca de estação com transição suave (1,5 s): a velha sai enquanto a nova entra
  function tocar(id, seg) {
    const est = escolherEstacao(id, !!internet);
    if (est === "internet") { pararGerada(seg); if (!audio) tocarInternet(); return; }
    pararInternet(seg);
    if (!garantirContexto()) { aviso = "Este navegador não toca o rádio."; ligado = false; return; }
    const velha = atual;
    atual = Estacao(ctx, S, est, (Math.random() * 4294967296) >>> 0, mestre);
    atual.entrar(seg); if (velha) velha.sair(seg);
    atual.agendar(ctx.currentTime + 1.5);
    if (!relogio) relogio = setInterval(() => { if (atual) atual.agendar(ctx.currentTime + 1.5); }, 250);
  }
  function ligar() {
    aviso = "";
    if (bloqueado()) { aviso = "No modo TV e no modo apresentação o rádio fica desligado."; avisar(); return false; }
    ligado = true; tocar(pref.estacao, 1.5);
    avisar(); return ligado;
  }
  function desligar() {
    if (ligado || atual || audio) { ligado = false; pararGerada(0.8); pararInternet(0.8); setTimeout(() => { if (!ligado && ctx && ctx.state === "running") ctx.suspend(); }, 1200); }
    avisar();
  }
  function estacao(id) {
    pref.estacao = escolherEstacao(id, !!internet); salvar();
    if (ligado) tocar(pref.estacao, 1.5);
    avisar();
  }
  function volume(v) {
    pref = preferencias({ ...pref, volume: +v }); salvar();
    if (mestre) mestre.gain.setTargetAtTime(curvaVolume(pref.volume), ctx.currentTime, 0.05);   // sem degrau: sem estalo
    if (audio) { clearInterval(fadeAudio); fadeAudio = null; audio.volume = Math.min(1, curvaVolume(pref.volume) / 0.9); }
  }
  // a rádio da internet do andar (o /api/config manda "radio"); trocar de andar sem ela tira a estação da lista
  function configurar(url) {
    const nova = typeof url === "string" && /^https:\/\//.test(url) ? url : "";
    if (nova === internet) return;
    const tocavaInternet = ligado && escolherEstacao(pref.estacao, !!internet) === "internet";
    internet = nova;
    if (tocavaInternet) { pararInternet(0.8); if (internet) tocarInternet(); else tocar("lofi", 1.5); }
    avisar();
  }
  if (typeof addEventListener === "function") addEventListener("apresentacao", ev => { if (ev.detail && ev.detail.ligado) desligar(); });

  // ---------------------------------------------------------------- o controle (abre ao clicar no rádio do mapa)
  let painel = null, devolver = null;
  const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; };
  function abrir(origem) {
    fechar();
    devolver = origem || null;
    const palco = document.getElementById("palco") || document.body;
    painel = el("div", "radio-painel"); painel.setAttribute("role", "dialog"); painel.setAttribute("aria-labelledby", "radio-titulo");
    const titulo = el("strong", null, "Rádio Firmópolis"); titulo.id = "radio-titulo";
    const fecharBt = el("button", "fechar", "×"); fecharBt.type = "button"; fecharBt.setAttribute("aria-label", "Fechar o rádio");
    fecharBt.addEventListener("click", () => fechar(true));
    const liga = el("button", "botao radio-liga"); liga.type = "button"; liga.id = "radio-liga";
    liga.addEventListener("click", () => (ligado ? desligar() : ligar()));
    const grupo = el("fieldset", "radio-estacoes"); grupo.append(el("legend", null, "Estação"));
    for (const e of estacoesDisponiveis(!!internet)) {
      const l = el("label", "radio-estacao"), i = el("input"), txt = el("span");
      i.type = "radio"; i.name = "radio-estacao"; i.value = e.id;
      i.addEventListener("change", () => { if (i.checked) estacao(e.id); });
      txt.append(el("b", null, e.nome), el("small", null, e.descricao));
      l.append(i, txt); grupo.append(l);
    }
    const lv = el("label", "radio-volume"), vol = el("input");
    vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.05"; vol.id = "radio-vol";
    vol.addEventListener("input", () => volume(vol.value));
    lv.append(el("span", null, "Volume"), vol);
    const direitos = el("p", "ajuda radio-direitos", "Rádio da internet configurada por quem administra este andar; os direitos de tocar são de quem a configurou.");
    const status = el("p", "radio-status"); status.setAttribute("aria-live", "polite");
    painel.append(fecharBt, titulo, liga, grupo, lv, direitos, status);
    painel.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.stopPropagation(); fechar(true); } });
    palco.append(painel);
    atualizarPainel(); liga.focus();
  }
  function atualizarPainel() {
    if (!painel) return;
    const e = estado(), liga = painel.querySelector("#radio-liga");
    liga.textContent = e.ligado ? "Desligar o rádio" : "Ligar o rádio"; liga.setAttribute("aria-pressed", String(e.ligado));
    for (const i of painel.querySelectorAll("input[name=radio-estacao]")) i.checked = i.value === e.estacao;
    painel.querySelector("#radio-vol").value = String(e.volume);
    painel.querySelector(".radio-direitos").hidden = e.estacao !== "internet";
    const nome = (estacoesDisponiveis(!!internet).find(x => x.id === e.estacao) || {}).nome;
    painel.querySelector(".radio-status").textContent = e.aviso || (e.ligado ? `Tocando: ${nome}` : "Desligado. Só você ouve o seu rádio.");
  }
  function fechar(foco) {
    if (!painel) return false;
    painel.remove(); painel = null;
    if (foco && devolver && !devolver.hidden) devolver.focus();
    devolver = null;
    return true;
  }

  return { rng, mistura, novaMusica, compasso, tempoDaBatida, vozear, preferencias, estacoesDisponiveis, escolherEstacao, curvaVolume,
    ESTACOES, IDS, CHAVE, renderizar, ligar, desligar, estacao, volume, configurar, abrir, fechar, bloqueado,
    get tocando() { return ligado; }, get estado() { return estado(); } };
})();
if (typeof window !== "undefined") window.Radio = Radio;
// o botão da barra da câmera (index.html): o rádio também abre por ali, mesmo quando a parede da sala comunal não tem lugar
if (typeof document !== "undefined") {
  const ligarBotao = () => { const b = document.getElementById("abrir-radio"); if (b) b.addEventListener("click", () => Radio.abrir(b)); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarBotao); else ligarBotao();
}

