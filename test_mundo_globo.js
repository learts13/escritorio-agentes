"use strict";
// Globo de abertura: a projeção ortográfica (centro, lado oculto e o caminho de volta do clique), o ponto subsolar, que
// decide onde é noite, e o nível desenhado numa VM sem navegador: o campo de nuvens montado uma vez só, as luzes das
// cidades só do lado da noite, o movimento reduzido sem cintilação nem estrela cadente, o Brasil marcado de dia e de
// noite, a lua nova discreta, o brilho do sol pequeno e quente, as nuvens sem pixel solto e a passada que não trepida.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const MUNDO = JSON.parse(fs.readFileSync("static/mundo/mundo.json", "utf8"));
const TERRA = [90, 138, 60];   // a textura de teste: terra verde no mundo todo (G > B: terra, não água)

// a VM: canvas falsos (createImageData de verdade; putImageData guarda a última imagem do globo e conta as passadas;
// getImageData devolve a textura de teste; fillRect grava o estilo em cada canvas), imagens que carregam quando o teste
// pede, um relógio de performance que anda `passoPerf` ms a cada leitura e o contexto principal, que grava o que se desenha
function abrir(busca, reduzido, terra = TERRA) {
  const ctx2d = el => new Proxy({}, { get: (o, k) => k === "createImageData"
    ? (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
    : k === "putImageData" ? img => { contexto.imagem = img; contexto.passadas = (contexto.passadas || 0) + 1; }
    : k === "fillRect" ? () => el.estilos.push(String(o.fillStyle))
    : k === "getImageData" ? (x, y, w, h) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) d.set([...terra, 255], i * 4);
      return { data: d };
    }
    : k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  let agoraPerf = 0;
  const contexto = {
    window: {}, location: { search: busca }, Math, Date, URLSearchParams, passoPerf: 0, canvas: [],
    performance: { now: () => (agoraPerf += contexto.passoPerf) },
    document: { createElement: () => { const el = { estilos: [] }; el.getContext = () => ctx2d(el); contexto.canvas.push(el); return el; },
      getElementById: () => null },
    Image: class { constructor() { (contexto.imagens ||= []).push(this); this.ouvintes = {}; }
      addEventListener(t, f) { (this.ouvintes[t] ||= []).push(f); } carregar() { for (const f of this.ouvintes.load || []) f(); } },
  };
  vm.createContext(contexto);
  for (const f of ["static/mundo_globo.js", "static/mundo.js"]) vm.runInContext(fs.readFileSync(f, "utf8"), contexto, { filename: f });
  const { Globo, Mundo } = contexto.window;
  const nivel = () => {
    const n = Globo.criar({ dados: JSON.parse(JSON.stringify(MUNDO)), Camera: Mundo.Camera, reduzido });
    n.camera.tamanho(940, 800, 1); n.entrar({});
    return n;
  };
  // o contexto principal: cada quadro vira uma lista de operações (estilo, alfa, transformação e argumentos)
  const gravado = [], principal = new Proxy({}, { get: (o, k) => typeof k === "string" && /^(fillRect|drawImage|setTransform)$/.test(k)
    ? (...a) => gravado.push([k, o.fillStyle, o.globalAlpha, ...a.filter(x => typeof x === "number")].join())
    : k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  let relogio = 0;
  const rodar = (n, quadros = 1) => {
    const lista = [];
    for (let i = 0; i < quadros; i++) { gravado.length = 0; relogio += 16; n.quadro(principal, 0.016, relogio); lista.push(gravado.join(";")); }
    return lista;
  };
  return { contexto, Globo, nivel, rodar };
}

const { Globo } = abrir("", false), C = Globo.B / 2, R = Globo.R;
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} (esperado ${b} ± ${tol})`);

// o centro da vista cai no meio do buffer e é visível
const c = Globo.projetar(-15, -50, -50, -15, R);
perto(c.x, C, 1e-9, "x do centro"); perto(c.y, C, 1e-9, "y do centro");
assert.equal(c.visivel, true);
// o antípoda e um ponto bem atrás ficam do lado oculto; um ponto ao norte sobe na tela, um a leste vai para a direita
assert.equal(Globo.projetar(15, 130, -50, -15, R).visivel, false, "antípoda");
assert.equal(Globo.projetar(10, 120, -50, -15, R).visivel, false, "lado oposto");
assert.ok(Globo.projetar(0, -50, -50, -15, R).y < C, "o norte fica em cima");
assert.ok(Globo.projetar(-15, -40, -50, -15, R).x > C, "o leste fica à direita");
// na borda: 90° do centro sobre o equador da vista dá o raio inteiro
perto(Globo.projetar(0, 40, -50, 0, R).x, C + R, 1e-9, "borda leste");

// o clique volta ao lugar: ponto(x, y) desfaz projetar(lat, lon) dentro do disco, e fora dele dá null
for (const [lat, lon] of [[-15, -50], [-23.5, -46.6], [-3.1, -60], [10, -20], [-40, -70]]) {
  const p = Globo.projetar(lat, lon, -50, -15, R), q = Globo.ponto(p.x, p.y, -50, -15, R);
  perto(q.lat, lat, 1e-6, "lat de volta"); perto(q.lon, lon, 1e-6, "lon de volta");
}
assert.equal(Globo.ponto(2, 2, -50, -15, R), null, "o canto do buffer é espaço");

// o sol: no solstício de junho ao meio-dia UTC fica sobre Greenwich no trópico de Câncer; no de dezembro às 18h, a 90° O
const jun = Globo.terminador(new Date(Date.UTC(2026, 5, 21, 12, 0)));
perto(jun.latSol, 23.4, 0.5, "latSol em 21/06"); perto(jun.lonSol, 0, 2, "lonSol em 21/06 12:00 UTC");
const dez = Globo.terminador(new Date(Date.UTC(2026, 11, 21, 18, 0)));
perto(dez.latSol, -23.4, 0.5, "latSol em 21/12"); perto(dez.lonSol, -90, 2, "lonSol em 21/12 18:00 UTC");
// equinócio: o sol no equador; a longitude fica sempre entre -180 e 180
const mar = Globo.terminador(new Date(Date.UTC(2026, 2, 20, 6, 0)));
perto(mar.latSol, 0, 0.6, "latSol no equinócio"); perto(mar.lonSol, 90, 4, "lonSol no equinócio às 06:00 UTC");
const meia = Globo.terminador(new Date(Date.UTC(2026, 0, 3, 0, 5)));
assert.ok(meia.lonSol >= -180 && meia.lonSol <= 180, "lonSol normalizada: " + meia.lonSol);

// o campo de nuvens sai só quando o globo desenha, e uma vez só: a segunda abertura (e a volta ao globo) usa o mesmo
const v = abrir("", false), g1 = v.nivel();
assert.equal(v.Globo.montagens, 0, "criar o globo não monta as nuvens");
v.rodar(g1, 2);
const campo = v.Globo.nuvens();
const g2 = v.nivel();
v.rodar(g2, 2); g1.sair(); g1.entrar({ nivel: "brasil" }); v.rodar(g1, 2);
assert.equal(v.Globo.montagens, 1, "uma montagem só");
assert.equal(v.Globo.nuvens(), campo, "o mesmo campo nas duas aberturas");
assert.ok(campo.A.length === 720 * 360 && campo.B.length === 720 * 360, "duas camadas de 0,5°");

// as luzes das cidades: às 22h de Brasília, com a textura de terra carregada, várias acesas e todas do lado da noite;
// ao meio-dia, com o Brasil de frente, nenhuma luz no lado do dia
// o miolo da luz (não o ouro do contorno)
const quente = (d, q) => d[q] >= 235 && d[q + 1] >= 195 && d[q + 2] >= 100 && d[q + 2] <= 150 && d[q + 3] === 255;
function luzes(hora) {
  const m = abrir("?hora=" + hora, true), n = m.nivel();
  for (const img of m.contexto.imagens) img.carregar();
  m.rodar(n, 2);
  const hoje = new Date(Date.now() - 3 * 3600000);
  const sol = m.Globo.terminador(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()) + (hora + 3) * 3600000));
  const { lon, lat } = n.rotacao, d = m.contexto.imagem.data, B = m.Globo.B, RAD = Math.PI / 180, acesas = [];
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const p = m.Globo.ponto(x + 0.5, y + 0.5, lon, lat, m.Globo.R);
    if (!p || !quente(d, (y * B + x) * 4)) continue;
    const f = p.lat * RAD, fs = sol.latSol * RAD;
    acesas.push(Math.sin(f) * Math.sin(fs) + Math.cos(f) * Math.cos(fs) * Math.cos((p.lon - sol.lonSol) * RAD));
  }
  return acesas;
}
const noite = luzes(22);
assert.ok(noite.length >= 40, "luzes acesas às 22h: " + noite.length);
assert.ok(noite.every(s => s < 0.08), "uma luz no lado do dia: " + Math.max(...noite));
const dia = luzes(12);
assert.ok(dia.every(s => s < 0.08), "ao meio-dia, luz no lado do dia: " + Math.max(...dia));
assert.ok(dia.length < noite.length / 3, `ao meio-dia quase nada aceso: ${dia.length}`);

// movimento reduzido: depois do primeiro quadro, todos iguais (nada cintila, nada passa); sem ele, as estrelas cintilam
// e uma estrela cadente cruza o céu em menos de um minuto
const r = abrir("", true), nr = r.nivel(), qr = r.rodar(nr, 3000);
assert.ok(qr.slice(1).every(q => q === qr[1]), "reduzido: um quadro diferente do outro");
assert.ok(!qr.some(q => q.includes(Globo.CADENTE)), "reduzido: estrela cadente");
const s = abrir("", false), ns = s.nivel(), qs = s.rodar(ns, 200);
assert.ok(new Set(qs.slice(1).map(q => q.split(";").filter(o => o.startsWith("fillRect")).join(";"))).size > 50, "as estrelas cintilam");
let cadente = qs.some(q => q.includes(Globo.CADENTE));
for (let i = 200; i < 3600 && !cadente; i++) cadente = s.rodar(ns)[0].includes(Globo.CADENTE);
assert.ok(cadente, "nenhuma estrela cadente em 58 s");
// o Brasil se acha sem hover, de dia e de noite, sobre qualquer bioma: contorno de dois tons (ouro por dentro, escuro por
// fora) e os vizinhos da América do Sul mais apagados que ele (a textura de teste é toda da cor do cerrado)
const CERRADO = [205, 191, 107], RAD = Math.PI / 180;
const celulas = MUNDO.niveis.brasil.celulas, doBrasil = (lat, lon) => {
  const j = Math.floor((6 - lat) * 2), i = Math.floor((lon + 74) * 2);
  return j >= 0 && j < 80 && i >= 0 && i < 80 && celulas[j][i] === "1";
};
function pintado(hora, terra) {
  const m = abrir(`?hora=${hora}&data=2026-11-18`, true, terra), n = m.nivel();
  for (const img of m.contexto.imagens) img.carregar();
  m.rodar(n, 2);
  return { m, n, d: m.contexto.imagem.data, B: m.Globo.B };
}
const eOuro = (d, q) => d[q] >= 232 && d[q + 1] >= 175 && d[q + 1] <= 215 && d[q + 2] <= 88;   // nem o cerrado nem o ouro a 50%
for (const hora of [12, 22]) {
  const { m, n, d, B } = pintado(hora, CERRADO), { lon, lat } = n.rotacao;
  let ouro = 0, escuro = 0;
  for (let y = 1; y < B - 1; y++) for (let x = 1; x < B - 1; x++) {
    const q = (y * B + x) * 4, p = m.Globo.ponto(x + 0.5, y + 0.5, lon, lat, m.Globo.R);
    if (!p || d[q + 3] !== 255) continue;
    if (eOuro(d, q) && doBrasil(p.lat, p.lon)) ouro++;
    if (d[q] + d[q + 1] + d[q + 2] < 150 && [1, -1, B, -B].some(o => eOuro(d, (y * B + x + o) * 4))) escuro++;
  }
  assert.ok(ouro >= 150, `${hora}h: contorno de ouro do Brasil: ${ouro} px`);
  assert.ok(escuro >= 150, `${hora}h: contorno escuro por fora: ${escuro} px`);
}
{
  const { m, n, d, B } = pintado(12, CERRADO), { lon, lat } = n.rotacao;
  const cor = (la, lo) => {
    const p = m.Globo.projetar(la, lo, lon, lat, m.Globo.R), q = (Math.floor(p.y) * B + Math.floor(p.x)) * 4;
    return [d[q], d[q + 1], d[q + 2]];
  };
  const sat = c => Math.max(...c) - Math.min(...c), br = cor(-12, -50), py = cor(-22.5, -59), bo = cor(-17, -64);
  assert.ok(sat(py) < sat(br) * 0.8 && sat(bo) < sat(br) * 0.8, `vizinhos apagados: Brasil ${br}, Paraguai ${py}, Bolívia ${bo}`);
}

// o brilho do sol no mar: pequeno e quente, sem xadrez frio (a textura de teste é toda mar)
{
  const { m, n, d, B } = pintado(12, [29, 59, 92]), { lon, lat } = n.rotacao;
  const sol = m.Globo.terminador(new Date(Date.UTC(2026, 10, 18, 15))), N = m.Globo.nuvens();
  const nublado = p => {   // nuvem, fiapo ou a sombra deles (até 4 células) no ponto, com as nuvens paradas
    for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) {
      const k = (Math.floor((90 - p.lat) * 2) + b) * 720 + ((Math.floor((p.lon + 180) * 2) + a + 720) % 720);
      if (N.A[k] > N.la || N.B[k] > N.lb) return true;
    }
    return false;
  };
  let quentes = 0;
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const p = m.Globo.ponto(x + 0.5, y + 0.5, lon, lat, m.Globo.R), q = (y * B + x) * 4;
    if (!p || p.lat > 12 || p.lat < -33 || p.lon < -74 || p.lon > -35) continue;   // no céu limpo da vista inicial
    const f = p.lat * RAD, fs = sol.latSol * RAD;
    if (Math.sin(f) * Math.sin(fs) + Math.cos(f) * Math.cos(fs) * Math.cos((p.lon - sol.lonSol) * RAD) < 0.5) continue;
    if (d[q] >= 120 && d[q] >= d[q + 2] + 30) quentes++;
    const mar = d[q] === 29 && d[q + 1] === 59 && d[q + 2] === 92;
    assert.ok(mar || nublado(p) || d[q] >= d[q + 2], `brilho frio no mar em ${x},${y}: ${d[q]},${d[q + 1]},${d[q + 2]}`);
  }
  assert.ok(quentes <= 30, "o brilho do sol no mar é pequeno: " + quentes);
}

// a lua: na fase nova, só a luz cinérea quase transparente (nada opaco, sem mares); crescente e cheia acesas
const lua = data => {
  const m = abrir(`?hora=12&data=${data}`, true), n = m.nivel();
  m.rodar(n, 1);
  return m.contexto.canvas.find(c => c.width === 29).estilos;
};
const nova = lua("2026-11-09"), alfa = e => Number((/rgba\([^)]*,([\d.]+)\)/.exec(e) || [0, 1])[1]);
assert.ok(nova.length > 0 && nova.every(e => e.startsWith("rgba") && alfa(e) <= 0.14), "lua nova discreta: " + [...new Set(nova)]);
assert.ok(lua("2026-11-14").filter(e => e === "#e4dfd1").length > 20, "lua crescente acesa");
assert.ok(lua("2026-11-24").filter(e => e === "#e4dfd1").length > 150, "lua cheia acesa");

// as nuvens: massa limpa (nenhum pixel de nuvem sem vizinho de nuvem, nenhum buraco de um pixel), menos de um quarto do
// céu e o Brasil (com o céu ao norte dele, onde fica a seta) livre na vista inicial
{
  const N = Globo.nuvens(), TW = 720, TH = 360, nuvem = (i, j) => N.A[j * TW + ((i + TW) % TW)] > N.la;
  let soltos = 0, buracos = 0, total = 0;
  for (let j = 1; j < TH - 1; j++) for (let i = 0; i < TW; i++) {
    const viz = nuvem(i - 1, j) + nuvem(i + 1, j) + nuvem(i, j - 1) + nuvem(i, j + 1);
    if (nuvem(i, j)) { total++; if (viz === 0) soltos++; } else if (viz === 4) buracos++;
  }
  assert.equal(soltos, 0, "pixels de nuvem soltos"); assert.equal(buracos, 0, "buracos de um pixel nas nuvens");
  assert.ok(total / (TW * TH) > 0.12 && total / (TW * TH) < 0.22, "cobertura das nuvens: " + total / (TW * TH));
  let sobre = 0, fios = 0, n = 0;
  for (let lat = 12; lat > -33; lat -= 0.5) for (let lon = -74; lon < -35; lon += 0.5) {
    const k = Math.floor((90 - lat) * 2) * TW + Math.floor((lon + 180) * 2);
    n++; if (N.A[k] > N.la) sobre++; if (N.B[k] > N.lb) fios++;
  }
  assert.ok(sobre / n < 0.04 && fios / n < 0.04, `nuvens sobre o Brasil na vista inicial: ${sobre / n}, fios ${fios / n}`);
}

// a passada a 30 Hz cai para 15 Hz quando passa de 12 ms e só volta depois de várias passadas rápidas (sem trepidar)
{
  const p = abrir("", false), np = p.nivel();
  const passadas = q => { const a = p.contexto.passadas || 0; p.rodar(np, q); return (p.contexto.passadas || 0) - a; };
  p.rodar(np, 4);
  p.contexto.passoPerf = 13;   // cada leitura do relógio anda 13 ms: a passada "leva" 13 ms
  passadas(8);
  const lenta = passadas(120);
  assert.ok(lenta >= 20 && lenta <= 26, "a 15 Hz (uma passada a cada 5 quadros de 16 ms): " + lenta);
  p.contexto.passoPerf = 10;   // entre os dois limites: fica em 15 Hz
  assert.ok(passadas(120) <= 26, "10 ms não volta a 30 Hz");
  p.contexto.passoPerf = 4;
  passadas(60);
  const rapida = passadas(120);
  assert.ok(rapida >= 36, "de volta a 30 Hz (uma a cada 3 quadros): " + rapida);
}
// a primeira passada monta as nuvens (e a tabela da projeção) e leva centenas de ms: ela não conta para a taxa. Um
// aparelho com passadas estáveis de 10 ms segue a 30 Hz depois dela
{
  const p = abrir("", false), np = p.nivel();
  const passadas = q => { const a = p.contexto.passadas || 0; p.rodar(np, q); return (p.contexto.passadas || 0) - a; };
  p.contexto.passoPerf = 300;   // a passada da montagem "leva" 300 ms
  p.rodar(np, 1);
  assert.equal(p.Globo.montagens, 1, "a primeira passada montou as nuvens");
  p.contexto.passoPerf = 10;
  passadas(8);
  const n = passadas(120);
  assert.ok(n >= 36, "depois da montagem, passadas de 10 ms ficam a 30 Hz: " + n);
}

// as nuvens na imagem: nenhum pixel claro de nuvem (ou de fiapo) sem vizinho claro, nem na beira do disco, onde a
// projeção achata o campo (terra preta, meio-dia, lado do dia; o ouro do contorno do Brasil fica de fora)
{
  const { m, n, d, B } = pintado(12, [0, 8, 0]), { lon, lat } = n.rotacao;
  const sol = m.Globo.terminador(new Date(Date.UTC(2026, 10, 18, 15)));
  const claro = q => d[q + 3] === 255 && d[q] + d[q + 1] + d[q + 2] > 330 && !(d[q] > 200 && d[q + 2] < 100);
  const soltos = [];
  for (let y = 1; y < B - 1; y++) for (let x = 1; x < B - 1; x++) {
    const q = (y * B + x) * 4, p = m.Globo.ponto(x + 0.5, y + 0.5, lon, lat, m.Globo.R);
    if (!p || !claro(q)) continue;
    const f = p.lat * RAD, fs = sol.latSol * RAD;
    if (Math.sin(f) * Math.sin(fs) + Math.cos(f) * Math.cos(fs) * Math.cos((p.lon - sol.lonSol) * RAD) < 0.2) continue;
    if (![4, -4, 4 * B, -4 * B].some(o => claro(q + o))) soltos.push(`${x},${y}`);
  }
  assert.equal(soltos.length, 0, "pixels de nuvem soltos na imagem: " + soltos.join(" "));
}

// ?data= sozinho (sem ?hora=) também vale para o sol e a lua, com a hora de agora
const luaSo = data => {
  const m = abrir(`?data=${data}`, true), n = m.nivel();
  m.rodar(n, 1);
  return m.contexto.canvas.find(c => c.width === 29).estilos;
};
assert.ok(luaSo("2026-11-24").filter(e => e === "#e4dfd1").length > 150, "?data= sozinho: lua cheia (hoje não é)");
console.log("test_mundo_globo: ok");
