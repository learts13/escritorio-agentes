// Planta do escritório (modo construção): o formato salvo e a lógica do editor, sem DOM.
// A planta é uma sobreposição ao prédio automático: guarda só o que mudou. Vazia, o prédio é o de sempre.
//
// Formato (config.planta no /api/config; o dados/planta.json tem também "v": 1):
//   { rev: 3,
//     salas:  { "lounge": { parede: 2, piso: 5 }, "time:Dev": { piso: 3 } },          // parede 0..6, piso 0..9
//     moveis: { "lounge|sofa_cinza|0": { x: 120, y: 70, e: true },                      // movida e/ou espelhada
//               "time:Dev|planta_alta|1": { fora: true } },                             // tirada
//     novos:  [ { nome: "planta_g1", sala: "cozinha", x: 40, y: 30, e: false } ] }      // peça nova; no prédio, "novo:<i>"
//   chave da sala: recepcao, reuniao, lounge, cozinha ou "time:<nome do time>" (inclusive "time:Novos")
//   id da peça automática: "<chave da sala>|<sprite>|<k>", k = ocorrência daquele sprite naquela sala (0..99)
//   x = centro da peça − s.px; y = pé da peça − s.chao (inteiros de 0 a 4095)
//
// API (window.Planta):
//   Planta.LIMITES               { salas: 64, moveis: 400, novos: 200, parede: 6, piso: 9, coord: 4095, bytes: 65536 }
//   Planta.vazia(rev = 0)        planta sem ajustes
//   Planta.grupos(config, agentes)   grupos para o Mapa.montarPredio (cópia exata do montar do app.js)
//   Planta.semPassagem(predio)   vagas (assentos e pontos) sem caminho a partir da porta da própria sala; [] no automático.
//                                São os próprios objetos de predio.vagas: {sala, x, y, tipo, ...}, x e y em px do prédio
//   Planta.rascunho(planta)      estado do editor (abaixo)
//   Planta.salvar(planta)        POST /api/planta → { rev } ou { status, erro, mensagem, rev? } (status 0: sem conexão)
//
// Rascunho r = Planta.rascunho(config.planta):
//   r.planta                     a planta atual (troque por cópia; não mexa nela por fora)
//   r.pintar(sala, "parede"|"piso", n)   n = null tira a pintura daquele campo
//   r.mover(id, x, y, auto)      auto = {x, y} do lugar automático: voltar a ele apaga a posição salva
//   r.espelhar(id)  r.tirar(id)  r.por(nome, sala, x, y, e = false)  r.automatico()
//   r.limpar(ids)                apaga numa ação só (um passo de desfazer) os ajustes desses ids: "sala|sprite|k", "novo:<i>"
//                                ou a chave de uma sala (a pintura de um time que não existe mais), como no predio.planta.ignorados
//   Cada ação devolve true (mudou), false (nada a mudar) ou um texto pronto para o aviso quando passaria de um limite.
//   r.desfazer() r.refazer()     true se andou; até 100 passos. r.podeDesfazer() r.podeRefazer()
//   r.mudou()                    difere do que está salvo no servidor
//   r.salvo(rev, enviada)        depois do salvar com sucesso: a planta enviada vira a salva e todas ganham o rev novo;
//                                o que mudou durante o envio continua pendente (mudou() verdadeiro)
"use strict";

const Planta = (() => {
  const LIMITES = { salas: 64, moveis: 400, novos: 200, parede: 6, piso: 9, coord: 4095, bytes: 65536 };
  const PASSOS = 100;
  const GRADE = 4;   // a mesma grade de caminhos do vida.js
  const VIZ = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const SALAS_FIXAS = new Set(["recepcao", "reuniao", "lounge", "cozinha"]);
  const ROTULO = /^[\p{L}\p{N}_ .'&À-ÿ-]{1,40}$/u;   // o ROTULO_OK do servidor
  const PECA = /^[a-z][a-z0-9_]{0,39}$/;
  const tem = (o, k) => Object.hasOwn(o, k);

  const vazia = (rev = 0) => ({ rev, salas: {}, moveis: {}, novos: [] });
  const salaOk = s => typeof s === "string" && (SALAS_FIXAS.has(s) || (s.startsWith("time:") && ROTULO.test(s.slice(5))));
  const idOk = id => { const p = typeof id === "string" ? id.split("|") : []; return p.length === 3 && salaOk(p[0]) && PECA.test(p[1]) && /^[0-9]{1,2}$/.test(p[2]); };
  const coordOk = n => Number.isInteger(n) && n >= 0 && n <= LIMITES.coord;
  const novoIdx = id => (typeof id === "string" && /^novo:[0-9]{1,3}$/.test(id) ? Number(id.slice(5)) : -1);
  const copia = p => ({ rev: p.rev, salas: structuredClone(p.salas), moveis: structuredClone(p.moveis), novos: structuredClone(p.novos) });
  const canonica = v => (Array.isArray(v) ? `[${v.map(canonica).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonica(v[k])).join(",")}}` : JSON.stringify(v));
  const conteudo = p => canonica({ salas: p.salas, moveis: p.moveis, novos: p.novos });
  const corpo = p => JSON.stringify({ rev: p.rev, salas: p.salas, moveis: p.moveis, novos: p.novos });

  function excede(p) { // texto do limite que a planta passou, ou ""
    if (Object.keys(p.salas).length > LIMITES.salas) return `Dá para pintar até ${LIMITES.salas} salas.`;
    if (Object.keys(p.moveis).length > LIMITES.moveis) return `Dá para ajustar até ${LIMITES.moveis} móveis.`;
    if (p.novos.length > LIMITES.novos) return `Dá para pôr até ${LIMITES.novos} peças novas.`;
    if (new TextEncoder().encode('{"v":1,' + corpo(p).slice(1)).length > LIMITES.bytes) return "A planta ficou grande demais para salvar.";
    return "";
  }

  // Cópia exata do montar do app.js: times do config com os agentes conhecidos, e quem sobra em "Novos".
  function grupos(config, agentes) {
    const conhecidos = new Set(agentes.map(a => a.handle));
    const usados = new Set();
    const grupos = config.times.map(t => {
      const hs = t.agentes.filter(h => conhecidos.has(h));
      hs.forEach(h => usados.add(h));
      return { ...t, handles: hs };
    });
    const novos = agentes.map(a => a.handle).filter(h => !usados.has(h));
    if (novos.length) grupos.push({ nome: "Novos", tipo: "mesas", parede: 2, piso: 3, handles: novos });
    return grupos;
  }

  // --- passagem: a mesma busca em largura do vida.js (grade de 4 px, célula livre pelos 5 pontos,
  // diagonal sem cortar quina e folga de 4 células na saída e na chegada, onde se senta) -----------------
  function grade(predio, s) {
    const y0 = s.chao, cols = Math.ceil(s.pw / GRADE), lins = Math.ceil((s.py + s.ph - y0) / GRADE), n = cols * lins;
    const livre = new Uint8Array(n), ok = predio.livre || (() => true);
    for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) {
      const x = s.px + i * GRADE, y = y0 + j * GRADE;
      livre[j * cols + i] = ok(x + 2, y + 2) && ok(x, y) && ok(x + GRADE, y) && ok(x, y + GRADE) && ok(x + GRADE, y + GRADE) ? 1 : 0;
    }
    return { x0: s.px, y0, cols, lins, livre, de: new Int32Array(n), fila: new Int32Array(n) };
  }

  function chega(g, a, b) {
    const { cols, lins } = g;
    const ci = x => Math.max(0, Math.min(cols - 1, Math.floor((x - g.x0) / GRADE))), cj = y => Math.max(0, Math.min(lins - 1, Math.floor((y - g.y0) / GRADE)));
    const ai = ci(a[0]), aj = cj(a[1]), bi = ci(b[0]), bj = cj(b[1]);
    const passa = (i, j) => i >= 0 && j >= 0 && i < cols && j < lins && (g.livre[j * cols + i] === 1 || (i - ai) ** 2 + (j - aj) ** 2 <= 16 || (i - bi) ** 2 + (j - bj) ** 2 <= 16);
    g.de.fill(-1);
    const ini = aj * cols + ai, fim = bj * cols + bi;
    let cab = 0, cauda = 0;
    g.fila[cauda++] = ini; g.de[ini] = ini;
    while (cab < cauda && g.de[fim] < 0) {
      const c = g.fila[cab++], i = c % cols, j = (c - i) / cols;
      for (const [di, dj] of VIZ) {
        const ni = i + di, nj = j + dj;
        if (!passa(ni, nj) || (di && dj && (!passa(i + di, j) || !passa(i, j + dj)))) continue;
        const k = nj * cols + ni;
        if (g.de[k] < 0) { g.de[k] = c; g.fila[cauda++] = k; }
      }
    }
    return g.de[fim] >= 0;
  }

  function portaPerto(s, x) { // o ponto logo dentro da porta mais perto, como o vida.js
    const dentro = s.portas ? s.portas.map(px => [px, s.chao + 8]) : [[s.porta.x, s.py + s.ph - 8]];
    return dentro.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a));
  }

  function semPassagem(predio) {
    const grades = new Map(), fechadas = [];
    for (const v of predio.vagas) {
      const s = v.sala;
      if (!s || v.mesa || !(s.portas ? s.portas.length : s.porta)) continue;   // a mesa usa as rotas fixas dos corredores reservados
      if (!grades.has(s)) grades.set(s, grade(predio, s));
      if (!chega(grades.get(s), portaPerto(s, v.x), [v.x, v.y])) fechadas.push(v);
    }
    return fechadas;
  }

  // --- rascunho do editor --------------------------------------------------------------------------
  function rascunho(inicial) {
    let atual = copia(inicial || vazia()), salva = conteudo(atual);
    const antes = [], depois = [];

    function aplicar(muda) { // muda numa cópia; só vale se mudou e cabe nos limites
      const nova = copia(atual);
      if (muda(nova) === false || conteudo(nova) === conteudo(atual)) return false;
      const limite = excede(nova);
      if (limite) return limite;
      antes.push(atual); if (antes.length > PASSOS) antes.shift();
      depois.length = 0;
      atual = nova;
      return true;
    }
    const peca = (p, id) => { // o ajuste da peça automática (criado vazio) ou a peça nova; null se o id não vale
      const i = novoIdx(id);
      if (i >= 0) return i < p.novos.length ? p.novos[i] : null;
      if (!idOk(id)) return null;
      if (!tem(p.moveis, id)) p.moveis[id] = {};
      return p.moveis[id];
    };
    const limpa = (p, id) => { if (tem(p.moveis, id) && !Object.keys(p.moveis[id]).length) delete p.moveis[id]; };

    const r = {
      get planta() { return atual; },
      pintar(sala, campo, n) {
        if (!salaOk(sala) || (campo !== "parede" && campo !== "piso")) return false;
        if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= LIMITES[campo])) return false;
        return aplicar(p => {
          const s = tem(p.salas, sala) ? p.salas[sala] : (p.salas[sala] = {});
          if (n === null) delete s[campo]; else s[campo] = n;
          if (!Object.keys(s).length) delete p.salas[sala];
        });
      },
      mover(id, x, y, auto) {
        if (!coordOk(x) || !coordOk(y)) return false;
        return aplicar(p => {
          const o = peca(p, id);
          if (!o || o.fora) return false;
          if (novoIdx(id) < 0 && auto && auto.x === x && auto.y === y) { delete o.x; delete o.y; }
          else { o.x = x; o.y = y; }
          if (tem(p.moveis, id)) { delete p.moveis[id]; p.moveis[id] = o; }   // a última movida vai para o fim: o mapa aplica na ordem
          limpa(p, id);
        });
      },
      espelhar(id) {
        return aplicar(p => {
          const o = peca(p, id);
          if (!o || o.fora) return false;
          if (novoIdx(id) >= 0) o.e = !o.e;
          else if (o.e) delete o.e; else o.e = true;   // a peça automática nasce sem espelho
          limpa(p, id);
        });
      },
      tirar(id) {
        return aplicar(p => {
          const i = novoIdx(id);
          if (i >= 0) { if (i >= p.novos.length) return false; p.novos.splice(i, 1); return; }
          if (!idOk(id)) return false;
          p.moveis[id] = { fora: true };
        });
      },
      por(nome, sala, x, y, e = false) {
        if (!PECA.test(nome) || !salaOk(sala) || !coordOk(x) || !coordOk(y) || typeof e !== "boolean") return false;
        return aplicar(p => { p.novos.push({ nome, sala, x, y, e }); });
      },
      limpar(ids) { // apaga de uma vez os ajustes que não aparecem nesta montagem (predio.planta.ignorados)
        if (!Array.isArray(ids)) return false;
        return aplicar(p => {
          const fora = new Set(ids.map(novoIdx).filter(i => i >= 0));
          for (const id of ids) {
            if (novoIdx(id) >= 0 || typeof id !== "string") continue;
            if (tem(p.moveis, id)) delete p.moveis[id];
            else if (salaOk(id) && tem(p.salas, id)) delete p.salas[id];   // pintura de sala que não existe (time renomeado ou removido)
          }
          p.novos = p.novos.filter((_, i) => !fora.has(i));
        });
      },
      automatico() { return aplicar(p => { p.salas = {}; p.moveis = {}; p.novos = []; }); },
      desfazer() { if (!antes.length) return false; depois.push(atual); atual = antes.pop(); return true; },
      refazer() { if (!depois.length) return false; antes.push(atual); atual = depois.pop(); return true; },
      podeDesfazer: () => antes.length > 0,
      podeRefazer: () => depois.length > 0,
      mudou: () => conteudo(atual) !== salva,
      salvo(rev, enviada = atual) {
        const ajusta = p => { p.rev = rev; };
        ajusta(atual); antes.forEach(ajusta); depois.forEach(ajusta);   // o rev é do servidor: desfazer depois de salvar continua salvável
        salva = conteudo(enviada);   // o que foi enviado, e não o atual: uma edição feita durante o envio continua pendente
      },
    };
    return r;
  }

  async function salvar(planta) {
    let r, d = null;
    try {
      r = await fetch(typeof Andar === "object" ? Andar.com("/api/planta") : "/api/planta", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: corpo(planta) });
      d = await r.json().catch(() => null);
    } catch (e) {
      return { status: 0, erro: "rede", mensagem: "Sem conexão com o servidor. O rascunho continua aqui." };
    }
    if (r.ok && d && Number.isInteger(d.rev)) return { rev: d.rev };
    const res = { status: r.status, erro: (d && typeof d.erro === "string" && d.erro) || "erro",
      mensagem: (d && typeof d.mensagem === "string" && d.mensagem) || (r.status === 401 ? "Entre de novo." : "Não deu para salvar a planta agora.") };
    if (d && Number.isInteger(d.rev)) res.rev = d.rev;
    return res;
  }

  return { LIMITES, vazia, grupos, semPassagem, rascunho, salvar };
})();
