// Globo de abertura, o nível 1 do mundo: a Terra em pixel art num buffer de 288x288 (raio 136) que gira a 6°/s, com o
// sol na posição de agora (ou na hora de ?hora=, em Brasília). Cada pixel do disco volta a (lat, lon) pela projeção
// ortográfica e pega a cor de terra.png (0,5° por pixel, com os biomas do mundo; a água é a cor com B > G). Por cima:
// nuvens em duas camadas (as grandes, com borda iluminada e sombra no chão, e fiapos finos que andam mais rápido), o brilho
// do sol no mar, o halo da atmosfera, a noite em faixas com pontilhado e as luzes das cidades do mundo. No céu, estrelas em
// três brilhos que cintilam devagar, uma estrela cadente de vez em quando e a lua com crateras e a fase de hoje. O
// contorno do Brasil fica sempre marcado, e a seta aponta para ele de fora; no foco, o país inteiro acende.
// Arrastar gira o globo; um clique ou zoom sobre o Brasil desce ao nível Brasil (um zoom fora dele gira o globo até o
// Brasil e então desce). Com movimento reduzido o globo não gira sozinho (fica no centro inicial e só gira à mão), e
// nuvens, estrelas, luzes e seta ficam paradas, sem estrela cadente.
"use strict";
const Globo = (() => {
  const B = 288, C = B / 2, R = 136, VAO = 26, GIRO = 6, LAT0 = -15, LON0 = -50, TW = 720, TH = 360;
  const CAIXA = [C - R - VAO, C - R - VAO, C + R + VAO, C + R + VAO];   // a câmera: o disco, o halo e a lua
  const BRASIL = [-74, -34, -34, 6];    // a caixa do nível Brasil (lon, lat), a mesma do brasil.png
  const NUVEM_A = 1.2, NUVEM_B = 2.8;   // °/s para leste: as nuvens grandes e os fiapos de cima
  const RAD = Math.PI / 180, BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const MAR = [29, 59, 92], LUA = [C + 125, C - 125], CADENTE = "#fff4d6";
  // as faixas da luz, do dia à noite funda: [t mínimo, multiplica r, g, b, soma r, g, b]
  const FAIXAS = [[0.42, 1, 1, 1, 0, 0, 0], [0.2, 0.93, 0.92, 0.9, 4, 2, 0], [0.08, 0.9, 0.83, 0.76, 14, 6, 0],
    [0, 0.66, 0.52, 0.5, 26, 10, 10], [-0.08, 0.36, 0.3, 0.44, 12, 6, 24], [-0.16, 0.22, 0.22, 0.32, 4, 6, 20],
    [-Infinity, 0.14, 0.17, 0.27, 3, 6, 18]];
  // 80 grandes cidades do mundo [lat, lon, peso (2: as megacidades)]; as 28 do mundo.json entram junto
  const CIDADES = [
    [35.7, 139.7, 2], [37.6, 127, 2], [39.9, 116.4, 2], [31.2, 121.5, 2], [23.1, 113.3, 2], [22.3, 114.2, 1],
    [29.6, 106.5, 1], [14.6, 121, 2], [13.8, 100.5, 2], [10.8, 106.7, 1], [1.35, 103.8, 1], [-6.2, 106.8, 2],
    [3.1, 101.7, 1], [23.8, 90.4, 2], [22.6, 88.4, 2], [28.6, 77.2, 2], [19.1, 72.9, 2], [13, 77.6, 1], [31.5, 74.3, 1],
    [24.9, 67, 2], [35.7, 51.4, 2], [33.3, 44.4, 1], [24.7, 46.7, 1], [41, 29, 2], [30, 31.2, 2], [6.5, 3.4, 2],
    [-4.3, 15.3, 2], [9, 38.7, 1], [-1.3, 36.8, 1], [15.6, 32.5, 1], [33.6, -7.6, 1], [36.8, 3.1, 1], [14.7, -17.4, 1],
    [5.3, -4, 1], [-8.8, 13.2, 1], [-26.2, 28, 1], [-33.9, 18.4, 1], [55.8, 37.6, 2], [59.9, 30.3, 1], [50.5, 30.5, 1],
    [52.2, 21, 1], [52.5, 13.4, 1], [48.9, 2.35, 2], [51.5, -0.1, 2], [52.4, 4.9, 1], [40.4, -3.7, 1], [41.9, 12.5, 1],
    [45.5, 9.2, 1], [38, 23.7, 1], [55, 82.9, 1], [56.8, 60.6, 1], [43.2, 76.9, 1], [41.3, 69.3, 1], [-33.9, 151.2, 1],
    [-37.8, 145, 1], [-31.95, 115.9, 1], [-36.85, 174.8, 1], [40.7, -74, 2], [34.05, -118.2, 2], [41.9, -87.6, 2],
    [29.8, -95.4, 1], [25.8, -80.2, 1], [38.9, -77, 1], [37.8, -122.4, 1], [47.6, -122.3, 1], [39.7, -105, 1],
    [43.7, -79.4, 1], [45.5, -73.6, 1], [49.3, -123.1, 1], [19.4, -99.1, 2], [23.1, -82.4, 1], [4.7, -74.1, 1],
    [-12, -77, 1], [-33.45, -70.65, 1], [-34.6, -58.4, 2], [10.5, -66.9, 1], [-0.2, -78.5, 1], [-34.9, -56.2, 1],
    [-25.3, -57.6, 1], [-16.5, -68.15, 1]];
  // a seta que aponta o Brasil de cima, pelo norte (k contorno, a ouro, l luz, s sombra)
  const SETA = ["...kkkkk...", "...klask...", "...klask...", "...klask...", "kkkklaskkkk", ".klaaaaask.", "..klaaask..",
    "...klask...", "....kak....", ".....k....."];
  const CORES_SETA = { k: "#2a2217", a: "#f5c84d", l: "#fff1b0", s: "#c9962e" };
  // o brilho em volta da luz de uma cidade: [dx, dy, força]
  const HALO = [1, 0, 0.42, -1, 0, 0.42, 0, 1, 0.42, 0, -1, 0.42];
  const HALO_GRANDE = [1, 0, 0.62, -1, 0, 0.62, 0, 1, 0.62, 0, -1, 0.62, 1, 1, 0.34, -1, 1, 0.34, 1, -1, 0.34, -1, -1, 0.34,
    2, 0, 0.16, -2, 0, 0.16, 0, 2, 0.16, 0, -2, 0.16];
  // soma a cor (cr, cg, cb) com força m no pixel q da imagem, se ele for do disco
  function somar(d, q, m, cr, cg, cb) {
    if (d[q + 3] === 255) { d[q] += (cr - d[q]) * m; d[q + 1] += (cg - d[q + 1]) * m; d[q + 2] += (cb - d[q + 2]) * m; }
  }

  const norm = l => ((((l + 180) % 360) + 360) % 360) - 180;
  function semente(s) { return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }
  function hash(i, j, s) {
    let h = (i * 374761393 + j * 668265263 + s * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // projeção ortográfica centrada em (lat0, lon0): x para o leste, y para baixo, no buffer
  function projetar(lat, lon, lon0, lat0, raio) {
    const f = lat * RAD, l = (lon - lon0) * RAD, f0 = lat0 * RAD;
    const x = raio * Math.cos(f) * Math.sin(l), y = raio * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l));
    return { x: C + x, y: C - y, visivel: Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos(l) >= 0 };
  }
  // o caminho de volta: o ponto (x, y) do buffer em (lat, lon), ou null fora do disco
  function ponto(x, y, lon0, lat0, raio) {
    const u = (x - C) / raio, v = (C - y) / raio, r2 = u * u + v * v;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2), s0 = Math.sin(lat0 * RAD), c0 = Math.cos(lat0 * RAD);
    return { lat: Math.asin(Math.max(-1, Math.min(1, z * s0 + v * c0))) / RAD, lon: norm(lon0 + Math.atan2(u, z * c0 - v * s0) / RAD) };
  }
  // o ponto subsolar (onde o sol está a pino) numa data: declinação e longitude pela equação do tempo (aprox. do NOAA)
  function terminador(data) {
    const ms = data.getTime(), n = ms / 86400000 + 2440587.5 - 2451545;
    const L = 280.46 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * RAD;
    const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, eps = (23.439 - 0.0000004 * n) * RAD;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD, eot = norm(L - ra);
    const horas = (((ms % 86400000) + 86400000) % 86400000) / 3600000;
    return { latSol: Math.asin(Math.sin(eps) * Math.sin(lam)) / RAD, lonSol: norm(15 * (12 - horas) - eot) };
  }

  // ruído de valor sobre os 720x360 pixels de 0,5°, em células de sx por sy pixels, com a volta na longitude (sem
  // Math no laço: é a parte cara da montagem)
  function grade(sx, sy, s) {
    const nx = Math.round(TW / sx), ny = Math.ceil(TH / sy) + 1, g = new Float32Array(nx * (ny + 1));
    for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = hash(i, j, s);
    return (x, y) => {
      const fx = x / sx;
      let fy = y / sy;
      if (fy < 0) fy = 0; else if (fy > ny - 1e-6) fy = ny - 1e-6;
      let x0 = fx | 0;
      if (fx < x0) x0--;
      const y0 = fy | 0;
      let ax = fx - x0, ay = fy - y0, i0 = x0 % nx;
      if (i0 < 0) i0 += nx;
      const i1 = i0 + 1 === nx ? 0 : i0 + 1;
      ax = ax * ax * (3 - 2 * ax); ay = ay * ay * (3 - 2 * ay);
      const a = g[y0 * nx + i0], b = g[y0 * nx + i1], c = g[(y0 + 1) * nx + i0], d = g[(y0 + 1) * nx + i1];
      return a + (b - a) * ax + (c - a + (a - b + d - c) * ax) * ay;
    };
  }
  // o valor abaixo do qual fica a fração p do campo (por histograma)
  function quantil(d, p) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < min) min = v; if (v > max) max = v; }
    const h = new Uint32Array(1024), k = 1023 / (max - min || 1);
    for (let i = 0; i < d.length; i++) h[((d[i] - min) * k) | 0]++;
    for (let i = 0, soma = 0; i < 1024; i++) if ((soma += h[i]) >= d.length * p) return min + i / k;
    return max;
  }
  // limpa um campo no limiar l: pixel acima de l com um vizinho acima ou nenhum desce; pixel abaixo com três ou quatro
  // vizinhos acima sobe (nada de pixel solto nem de furo de um pixel na borda da nuvem)
  function limpar(d, l) {
    for (let vez = 0; vez < 3; vez++) for (let j = 1; j < TH - 1; j++) for (let i = 0; i < TW; i++) {
      const k = j * TW + i, e = i ? k - 1 : k + TW - 1, dd = i === TW - 1 ? k - TW + 1 : k + 1;
      const viz = (d[e] > l) + (d[dd] > l) + (d[k - TW] > l) + (d[k + TW] > l);
      if (d[k] > l && viz <= 1) d[k] = l - 1e-4; else if (d[k] <= l && viz >= 3) d[k] = l + 1e-4;
    }
  }
  // as nuvens, em duas camadas de 720x360: A, cúmulos e frentes com redemoinhos nas latitudes médias e a faixa do
  // equador mais cheia; B, fiapos esticados na longitude. O ruído sai numa grade de 1° e é ampliado para 0,5°; o céu do
  // Brasil e o do norte dele (onde fica a seta) ficam quase limpos na vista inicial. A borda é limpa nos limiares (sem
  // pixel solto). Montadas uma vez só, na primeira vez que o globo desenha.
  let campo = null, montagens = 0;
  function nuvens() {
    if (campo) return campo;
    const { exp, cos, sin } = Math, W2 = TW / 2, H2 = TH / 2;
    const oitavas = [[90, 0.32], [45, 0.25], [22.5, 0.19], [11.25, 0.14], [5.625, 0.1]].map(([S, p], i) => [grade(S, S, i + 1), p]);
    const fios = [[60, 12, 0.5], [30, 6, 0.3], [15, 3, 0.2]].map(([sx, sy, p], i) => [grade(sx, sy, i + 21), p]);
    const wx = grade(60, 60, 11), wy = grade(60, 60, 12), wb = grade(45, 45, 13);
    // [lon, lat, raio em graus, giro em radianos]: no norte giram para um lado, no sul para o outro
    const giros = [[-38, 54, 9, 2.6], [162, 46, 10, 2.4], [-150, 40, 8, 2.2], [20, 60, 7, 2], [62, -48, 10, -2.6],
      [-112, -52, 11, -2.4], [148, -50, 9, -2.2], [-20, -44, 8, -2]].map(([lo, la, r, a]) => [(lo + 180) * 2, (90 - la) * 2, r * 2, a]);
    const a1 = new Float32Array(W2 * (H2 + 1)), b1 = new Float32Array(W2 * (H2 + 1));
    for (let j = 0; j <= H2; j++) {
      const lat = 90 - j, al = lat < 0 ? -lat : lat;
      const peso0 = 0.8 + 0.26 * exp(-(((lat - 5) / 7) ** 2)) - 0.2 * exp(-(((al - 24) / 7) ** 2))
        + 0.12 * exp(-(((al - 52) / 11) ** 2)) - (al > 74 ? 0.12 : 0), pesoB0 = 0.85 + 0.3 * exp(-(((al - 45) / 15) ** 2));
      for (let i = 0; i < W2; i++) {
        const q = ((i - 180 + 54.5) / 30) ** 2 + ((lat + 10.5) / 30) ** 2, limpo = 1 - 0.2 * exp(-q * q);   // o céu do Brasil
        const peso = peso0 * limpo, pesoB = pesoB0 * limpo;
        let x = i * 2, y = j * 2;
        for (let m = 0; m < giros.length; m++) {
          const gr = giros[m], cx = gr[0], cy = gr[1], r = gr[2];
          let dx = x - cx;
          if (dx > TW / 2) dx -= TW; else if (dx < -TW / 2) dx += TW;
          const dy = y - cy, d2 = dx * dx + dy * dy;
          if (d2 > 9 * r * r) continue;
          const ang = gr[3] * exp(-d2 / (r * r)), co = cos(ang), se = sin(ang);
          x = cx + dx * co - dy * se; y = cy + dx * se + dy * co;
        }
        x += (wx(x, y) - 0.5) * 44; y += (wy(x, y) - 0.5) * 22;
        let v = 0;
        for (let m = 0; m < oitavas.length; m++) v += oitavas[m][0](x, y) * oitavas[m][1];
        a1[j * W2 + i] = v * peso;
        const xb = i * 2 + (wb(i * 2, j * 2) - 0.5) * 30;
        let f = 0;
        for (let m = 0; m < fios.length; m++) f += fios[m][0](xb, j * 2) * fios[m][1];
        b1[j * W2 + i] = f * pesoB;
      }
    }
    const A = new Float32Array(TW * TH), Bf = new Float32Array(TW * TH);
    for (let j = 0; j < TH; j++) {
      const fy = j / 2, y0 = fy | 0, ay = fy - y0;
      for (let i = 0; i < TW; i++) {
        const fx = i / 2, x0 = fx | 0, ax = fx - x0, x1 = x0 + 1 === W2 ? 0 : x0 + 1, k0 = y0 * W2, k1 = k0 + W2;
        A[j * TW + i] = (a1[k0 + x0] * (1 - ax) + a1[k0 + x1] * ax) * (1 - ay) + (a1[k1 + x0] * (1 - ax) + a1[k1 + x1] * ax) * ay;
        Bf[j * TW + i] = (b1[k0 + x0] * (1 - ax) + b1[k0 + x1] * ax) * (1 - ay) + (b1[k1 + x0] * (1 - ax) + b1[k1 + x1] * ax) * ay;
      }
    }
    montagens++;
    campo = { A, B: Bf, la: quantil(A, 0.82), la2: quantil(A, 0.92), lb: quantil(Bf, 0.94), lb2: quantil(Bf, 0.975) };
    for (const [d, l] of [[A, campo.la], [A, campo.la2], [Bf, campo.lb], [Bf, campo.lb2]]) limpar(d, l);
    return campo;
  }

  // o disco (pixel, normal e pontilhado de cada um) e o anel do halo: iguais para todo globo, calculados uma vez
  let disco = null;
  function geometria() {
    if (disco) return disco;
    const sqrt = Math.sqrt, fora = (1 + 5 / R) ** 2, n = [], a = [];
    for (let py = 0; py < B; py++) for (let px = 0; px < B; px++) {
      const u = (px + 0.5 - C) / R, v = (C - py - 0.5) / R, r2 = u * u + v * v;
      if (r2 <= 1) n.push(py * B + px);
      else if (r2 <= fora) a.push(py * B + px);
    }
    const anel = { n: a.length, O: Int32Array.from(a), U: new Float32Array(a.length), V: new Float32Array(a.length),
      D: new Float32Array(a.length), DZ: new Float32Array(a.length) };
    for (let k = 0; k < anel.n; k++) {
      const px = anel.O[k] % B, py = (anel.O[k] / B) | 0, u = (px + 0.5 - C) / R, v = (C - py - 0.5) / R, r = sqrt(u * u + v * v);
      anel.U[k] = u / r; anel.V[k] = v / r; anel.D[k] = (r - 1) * R; anel.DZ[k] = (BAYER[(py & 3) * 4 + (px & 3)] + 0.5) / 16 - 0.5;
    }
    const nd = n.length, O = Int32Array.from(n), U = new Float32Array(nd), V = new Float32Array(nd), Z = new Float32Array(nd);
    const DZ = new Float32Array(nd);
    for (let k = 0; k < nd; k++) {
      const px = O[k] % B, py = (O[k] / B) | 0, u = (px + 0.5 - C) / R, v = (C - py - 0.5) / R, w = 1 - u * u - v * v;
      U[k] = u; V[k] = v; Z[k] = sqrt(w > 0 ? w : 0); DZ[k] = (BAYER[(py & 3) * 4 + (px & 3)] + 0.5) / 16 - 0.5;
    }
    disco = { nd, O, U, V, Z, DZ, anel };
    return disco;
  }

  function criar({ dados, Camera, reduzido }) {
    // ?hora= é a hora de Brasília (UTC−3), parada, de hoje ou do dia de ?data=AAAA-MM-DD (o sol e a fase da lua); com
    // ?data= sozinho, vale esse dia com a hora de agora, andando
    const busca = new URLSearchParams(location.search), simulada = parseFloat(busca.get("hora"));
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(busca.get("data") || "") ? Date.parse(busca.get("data") + "T00:00:00Z") : NaN;
    const fixa = simulada >= 0 && simulada < 24 ? (() => {
      const hoje = Number.isFinite(dia) ? new Date(dia) : new Date(Date.now() - 3 * 3600000);
      return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()) + (simulada + 3) * 3600000);
    })() : null;
    const camera = Camera(CAIXA), versao = Number.isInteger(dados.versao) ? dados.versao : 0;
    let lon0 = LON0, lat0 = LAT0, vel = reduzido ? 0 : -GIRO, segurando = false, velArraste = 0, ultimo = 0, voo = null;
    let derivaA = 0, derivaB = 0, sol = null, solEm = -1e12, feito = { chave: "", t: -1e9, destaque: null }, telaFeita = "";
    // ms entre passadas: 30 Hz; 15 Hz se a passada passar de 12 ms (celular lento), e de volta a 30 Hz só depois de 10
    // passadas seguidas abaixo de 8 ms (sem alternar e trepidar perto do limite). A passada que monta as nuvens ou refaz
    // a tabela da projeção (a primeira, e as do arraste na vertical) não conta: ela faz um trabalho que não se repete
    let intervalo = 33, rapidas = 0;

    // a textura: a cor do dia e a água (B > G) de cada pixel de 0,5°; antes dela chegar, o globo é de mar
    const tex = new Uint8Array(TW * TH * 3), agua = new Uint8Array(TW * TH).fill(1);
    for (let k = 0; k < TW * TH * 3; k += 3) { tex[k] = MAR[0]; tex[k + 1] = MAR[1]; tex[k + 2] = MAR[2]; }
    ler("/mundo/terra.png?v=" + versao, TW, TH, d => {
      for (let k = 0; k < TW * TH; k++) {
        tex[k * 3] = d[k * 4]; tex[k * 3 + 1] = d[k * 4 + 1]; tex[k * 3 + 2] = d[k * 4 + 2];
        agua[k] = d[k * 4 + 2] > d[k * 4 + 1] ? 1 : 0;
      }
      // os vizinhos da América do Sul um pouco apagados, como no mapa: o Brasil se destaca
      for (let j = (90 - 13) * 2; j < (90 + 56) * 2; j++) for (let i = (180 - 82) * 2; i < (180 - 34) * 2; i++) {
        const k = j * TW + i;
        if (agua[k] || brasil[k]) continue;
        const r = tex[k * 3], g = tex[k * 3 + 1], b = tex[k * 3 + 2], cinza = 0.3 * r + 0.59 * g + 0.11 * b;
        tex[k * 3] = (r * 0.55 + cinza * 0.45) * 0.88;
        tex[k * 3 + 1] = (g * 0.55 + cinza * 0.45) * 0.88;
        tex[k * 3 + 2] = (b * 0.55 + cinza * 0.45) * 0.88;
      }
      feito.chave = "";   // a passada guardada era só de mar: refaz (com movimento reduzido, nada mais a refaria)
    });
    // as células de 0,5° do Brasil vêm prontas no mundo.json (80 linhas de 80, de lat 6 e lon −74); sem elas, vale a caixa
    const brasil = new Uint8Array(TW * TH), J0 = (90 - BRASIL[3]) * 2, I0 = (BRASIL[0] + 180) * 2;
    let alvoBrasil = null;
    const celulas = dados.niveis && dados.niveis.brasil && dados.niveis.brasil.celulas;
    if (Array.isArray(celulas) && celulas.length === 80 && celulas.every(l => typeof l === "string" && l.length === 80)) {
      alvoBrasil = new Uint8Array(TW * TH);   // o alvo do clique: o Brasil com 2° de folga, para o dedo
      for (let j = 0; j < 80; j++) for (let i = 0; i < 80; i++) {
        if (celulas[j][i] !== "1") continue;
        brasil[(j + J0) * TW + i + I0] = 1;
        for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) alvoBrasil[(j + J0 + b) * TW + i + I0 + a] = 1;
      }
    }
    // as luzes: [lat, lon, peso, fase, satélite]; cada cidade com umas cidadezinhas em volta
    const rnd = semente(11), luzes = [];
    const doMundo = (Array.isArray(dados.cidades) ? dados.cidades : []).filter(c => c && Number.isFinite(c.lat) && Number.isFinite(c.lon))
      .map(c => [c.lat, c.lon, c.id === "sao-paulo" || c.id === "rio-de-janeiro" ? 2 : 1]);
    for (const [lat, lon, peso] of [...CIDADES, ...doMundo]) {
      luzes.push([lat, lon, peso, rnd() * 6, false]);
      for (let i = 0; i < peso * 3; i++) luzes.push([lat + (rnd() - 0.5) * 1.8 * peso, lon + (rnd() - 0.5) * 2.2 * peso, 1, rnd() * 6, true]);
    }

    // a volta a (lat, lon) de cada pixel do disco depende só de lat0 e é refeita quando ele muda (o giro só soma lon0)
    const { nd, O, U, V, Z, DZ, anel } = geometria();
    const LIN = new Int32Array(nd), DL = new Float32Array(nd), K = new Int32Array(nd);
    let tabelaLat = NaN;
    function tabela() {
      if (tabelaLat === lat0) return;
      tabelaLat = lat0;
      const { asin, atan2 } = Math, s0 = Math.sin(lat0 * RAD), c0 = Math.cos(lat0 * RAD);
      for (let n = 0; n < nd; n++) {
        let w = Z[n] * s0 + V[n] * c0;
        w = w > 1 ? 1 : w < -1 ? -1 : w;
        const j = ((90 - asin(w) / RAD) * 2) | 0;
        LIN[n] = (j < 0 ? 0 : j > TH - 1 ? TH - 1 : j) * TW;
        DL[n] = atan2(U[n], Z[n] * c0 - V[n] * s0) / RAD * 2;
      }
    }
    const na = new Float32Array(B * B), nb = new Float32Array(B * B), marca = new Uint8Array(B * B), contorno = new Int32Array(nd);
    const tela = document.createElement("canvas"); tela.width = tela.height = B;
    const tctx = tela.getContext("2d");
    const imagem = (tctx && tctx.createImageData && tctx.createImageData(B, B)) || { data: new Uint8ClampedArray(B * B * 4) };
    // as estrelas [x, y, brilho 0 a 2, fase, velocidade, cor]: umas 330 soltas e uma faixa da Via Láctea, bem fraca
    const estrelas = [], re = semente(5), CORES_ESTRELA = ["220,230,255", "255,244,224", "200,214,255"];
    for (let i = 0; i < 330; i++) {
      const p = re();
      const cor = CORES_ESTRELA[Math.floor(re() * 3)];
      estrelas.push([re(), re(), p < 0.07 ? 2 : p < 0.3 ? 1 : 0, re() * 6, 0.6 + re() * 0.8, cor, "rgb(" + cor + ")"]);
    }
    for (let i = 0; i < 240; i++) {
      const a = re(), d = (re() + re() + re() - 1.5) * 0.09;
      estrelas.push([a, Math.min(0.999, Math.max(0, 0.95 - a * 0.8 + d)), -1, 0, 0, CORES_ESTRELA[2]]);
    }
    let cad = null, proxima = 3000 + 5000 * re();   // a estrela cadente

    const visao = (lat, lon) => {   // cosseno do ângulo entre (lat, lon) e o centro da vista
      const f = lat * RAD, f0 = lat0 * RAD;
      return Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos((lon - lon0) * RAD);
    };
    const celula = (lat, lon) => Math.min(TH - 1, Math.max(0, Math.floor((90 - lat) * 2))) * TW + ((Math.floor((lon + 180) * 2) % TW) + TW) % TW;
    const acerta = p => alvoBrasil ? alvoBrasil[celula(p.lat, p.lon)] === 1
      : p.lon >= BRASIL[0] && p.lon <= BRASIL[2] && p.lat >= BRASIL[1] && p.lat <= BRASIL[3];   // sem as células, a caixa
    const agora = () => fixa || (Number.isFinite(dia)
      ? new Date(dia + ((((Date.now() - 3 * 3600000) % 86400000) + 86400000) % 86400000) + 3 * 3600000) : new Date());

    // a escala do globo na tela: inteira (pixel nítido), a maior em que a caixa cabe; se a inteira encolher demais o
    // globo (tela pequena), a fracionária. A caixa cresce para a câmera chegar a ela.
    function ajustar() {
      const chave = camera.W + "x" + camera.H;
      if (chave === telaFeita) return;
      telaFeita = chave;
      const m = Math.min(camera.W, camera.H), b = m / (CAIXA[2] - CAIXA[0]), p = Math.floor(b), L = m / (p >= 1 && p / b >= 0.75 ? p : b);
      camera.limitar([C - L / 2, C - L / 2, C + L / 2, C + L / 2]);
    }

    function renderizar(t, destaque) {
      tabela();
      const d = imagem.data, N = nuvens(), A = N.A, NBf = N.B, f0 = lat0 * RAD, s0 = Math.sin(f0), c0 = Math.cos(f0);
      const f = sol.latSol * RAD, l = (sol.lonSol - lon0) * RAD;
      const sx = Math.cos(f) * Math.sin(l), sy = c0 * Math.sin(f) - s0 * Math.cos(f) * Math.cos(l);
      const sz = s0 * Math.sin(f) + c0 * Math.cos(f) * Math.cos(l);
      const hn = Math.hypot(sx, sy, sz + 1) || 1, hx = sx / hn, hy = sy / hn, hz = (sz + 1) / hn;   // meio-termo sol-olho: o brilho no mar
      const sl = Math.hypot(sx, sy), lado = sl > 0.12 ? Math.round(-sy / sl) * B + Math.round(sx / sl) : 0;   // um pixel na direção do sol
      const col0 = (norm(lon0) + 180) * 2, offA = derivaA * 2, offB = derivaB * 2;
      const realce = destaque ? (reduzido ? 0.26 : 0.2 + 0.08 * Math.sin(t / 260)) : 0;
      const roda = c => (c < 0 ? c + TW : c >= TW ? c - TW : c) | 0;
      // 1ª volta: a célula e as nuvens de cada pixel (a nuvem grande fica no buffer: a borda e a sombra olham os vizinhos)
      for (let n = 0; n < nd; n++) {
        const c = roda(col0 + DL[n]);
        K[n] = LIN[n] + c;
        na[O[n]] = A[LIN[n] + roda(c - offA)];
        nb[O[n]] = NBf[LIN[n] + roda(c - offB)];
      }
      d.fill(0); marca.fill(0);
      let nbr = 0;
      for (let n = 0; n < nd; n++) {
        const o = O[n], k = K[n], dz = DZ[n], u = U[n], v = V[n], z = Z[n], q = o * 4;
        let r = tex[k * 3], g = tex[k * 3 + 1], bl = tex[k * 3 + 2];
        const mar = agua[k], luz = u * sx + v * sy + z * sz;
        if (mar) {   // o sol brilhando no mar: um ponto pequeno e quente, sem pontilhado
          if (luz > 0.3 && u * hx + v * hy + z * hz > 0.99985) { r += (255 - r) * 0.6; g += (228 - g) * 0.6; bl += (170 - bl) * 0.6; }
        } else if (brasil[k]) {
          marca[o] = 1; contorno[nbr++] = n;
          if (realce) { r += (255 - r) * realce; g += (236 - g) * realce; bl += (170 - bl) * realce; }
        }
        // pixel de nuvem sem vizinho de nuvem (a beira do disco achata o campo) não é nuvem
        const a = na[o], la = N.la, lb = N.lb;
        // a nuvem: borda clara do lado do sol, borda azulada do outro, miolo branco, corpo cinza-azulado
        if (a > la && (na[o - 1] > la || na[o + 1] > la || na[o - B] > la || na[o + B] > la)) {
          if (lado && na[o + lado] <= N.la) { r = 255; g = 255; bl = 255; }
          else if (lado && na[o - lado] <= N.la) { r = 158; g = 174; bl = 198; }
          else if (a > N.la2) { r = 238; g = 243; bl = 250; } else { r = 202; g = 212; bl = 228; }
        } else if (lado && na[o + 3 * lado] > N.la) { r *= 0.66; g *= 0.68; bl *= 0.76; }   // a sombra dela no chão
        const fb = nb[o];
        if (fb > lb && (nb[o - 1] > lb || nb[o + 1] > lb || nb[o - B] > lb || nb[o + B] > lb)) {   // os fiapos
          const m = fb > N.lb2 ? 0.55 : 0.38;
          r += (236 - r) * m; g += (241 - g) * m; bl += (249 - bl) * m;
        }
        if (z < 0.3) {   // a atmosfera na beira do disco, mais forte do lado do sol
          const sobe = luz * 3 + 0.5, m = (((0.3 - z) / 0.3 * 0.5 * (sobe > 1 ? 1 : sobe < 0.15 ? 0.15 : sobe) + dz * 0.12) / 0.14 | 0) * 0.14;
          if (m > 0) { r += (110 - r) * m; g += (172 - g) * m; bl += (248 - bl) * m; }
        }
        const tt = luz + dz * 0.07;   // as faixas da luz, com pontilhado de Bayer na passagem
        let fx = FAIXAS[0];
        for (let i = 0; tt < fx[0]; ) fx = FAIXAS[++i];
        d[q] = r * fx[1] + fx[4]; d[q + 1] = g * fx[2] + fx[5]; d[q + 2] = bl * fx[3] + fx[6]; d[q + 3] = 255;
      }
      // o contorno do Brasil em dois tons, legível sobre qualquer bioma, de dia e de noite: ouro na beira da terra
      // brasileira e escuro logo por fora (no foco, o ouro clareia e o país inteiro acende por dentro)
      for (let i = 0; i < nbr; i++) {
        const o = O[contorno[i]];
        if (marca[o - 1] && marca[o + 1] && marca[o - B] && marca[o + B]) continue;
        for (let v = 0; v < 4; v++) {
          const w = v === 0 ? o - 1 : v === 1 ? o + 1 : v === 2 ? o - B : o + B;
          if (!marca[w] && d[w * 4 + 3] === 255) somar(d, w * 4, 0.82, 34, 26, 16);
        }
        marca[o] = 2;
      }
      for (let i = 0; i < nbr; i++) {
        const o = O[contorno[i]], q = o * 4;
        if (marca[o] === 2) { d[q] = 245; d[q + 1] = destaque ? 214 : 200; d[q + 2] = destaque ? 96 : 77; }
      }
      for (let m = 0; m < anel.n; m++) {   // o halo: azul do lado do dia, laranja no terminador, quase nada à noite
        const dz = anel.DZ[m], dist = anel.D[m], luz = anel.U[m] * sx + anel.V[m] * sy + 0.35 * sz + dz * 0.06, q = anel.O[m] * 4;
        let alfa = dist < 1.6 ? 0.78 : dist < 3.2 ? 0.36 : dz < 0 ? 0.14 : 0;
        if (luz > 0.1) { alfa *= 0.5 + 0.5 * Math.min(1, luz * 1.6); d[q] = 125; d[q + 1] = 190; d[q + 2] = 255; }
        else if (luz > -0.12) { alfa *= 0.75; d[q] = 255; d[q + 1] = 168; d[q + 2] = 122; }
        else { alfa *= 0.22; d[q] = 70; d[q + 1] = 90; d[q + 2] = 170; }
        d[q + 3] = alfa * 255;
      }
      for (const [lat, lon, peso, fase, satelite] of luzes) {   // as luzes das cidades: só no escuro
        if (visao(lat, lon) < 0.06 || (satelite && agua[celula(lat, lon)])) continue;
        const p = projetar(lat, lon, lon0, lat0, R), x = Math.floor(p.x), y = Math.floor(p.y), o = y * B + x;
        if (x < 2 || y < 2 || x >= B - 2 || y >= B - 2 || d[o * 4 + 3] !== 255) continue;
        const u = (x + 0.5 - C) / R, v = (C - y - 0.5) / R, z = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        const escuro = Math.min(1, (0.03 - (u * sx + v * sy + z * sz)) / 0.12);
        if (escuro <= 0) continue;
        const a = escuro * (reduzido ? 1 : 0.86 + 0.14 * Math.sin(t / 900 + fase)) * (satelite ? 0.7 : 1);
        if (!satelite) {
          const h = peso > 1 ? HALO_GRANDE : HALO;
          for (let i = 0; i < h.length; i += 3) somar(d, ((y + h[i + 1]) * B + x + h[i]) * 4, a * h[i + 2], 240, 150, 70);
        }
        if (satelite) somar(d, o * 4, a, 240, 180, 90); else somar(d, o * 4, a, 255, peso > 1 ? 226 : 208, peso > 1 ? 140 : 112);
      }
      if (tctx && tctx.putImageData) tctx.putImageData(imagem, 0, 0);
    }

    // o fundo do espaço com as estrelas fixas, em pixels do tamanho dos do globo, pintado uma vez por tamanho de tela
    let fundo = null;
    const lado = cam => Math.max(1, Math.round(cam.base));
    function ceu(cam) {
      if (fundo && fundo.width === cam.W && fundo.height === cam.H && fundo.lado === lado(cam)) return fundo;
      fundo = fundo || document.createElement("canvas"); fundo.width = cam.W; fundo.height = cam.H; fundo.lado = lado(cam);
      const g = fundo.getContext("2d"), S = fundo.lado;
      if (!g) return fundo;
      g.fillStyle = "#060914"; g.fillRect(0, 0, cam.W, cam.H);
      for (const [ex, ey, nv, , , cor] of estrelas) {
        if (nv > 0 && !reduzido) continue;   // as que cintilam vão por cima, a cada quadro
        const x = Math.floor(ex * cam.W / S) * S, y = Math.floor(ey * cam.H / S) * S;
        g.fillStyle = `rgba(${cor},${[0.16, 0.34, 0.62, 0.95][nv + 1]})`; g.fillRect(x, y, S, S);
        if (nv === 2) { g.fillStyle = `rgba(${cor},0.4)`; g.fillRect(x - S, y, S * 3, S); g.fillRect(x, y - S, S, S * 3); }
      }
      return fundo;
    }
    function cintilar(ctx, cam, t) {   // as estrelas médias e fortes, devagar, cada uma no seu ritmo (alfa, sem texto novo)
      const S = lado(cam);
      for (let i = 0; i < estrelas.length; i++) {
        const e = estrelas[i], nv = e[2];
        if (nv < 1) continue;
        const x = Math.floor(e[0] * cam.W / S) * S, y = Math.floor(e[1] * cam.H / S) * S, k = 0.62 + 0.38 * Math.sin(t / 1400 * e[4] + e[3]);
        ctx.fillStyle = e[6]; ctx.globalAlpha = (nv === 2 ? 0.95 : 0.62) * k; ctx.fillRect(x, y, S, S);
        if (nv === 2 && k > 0.55) {
          ctx.globalAlpha = 0.45 * k;
          ctx.fillRect(x - S, y, S * 3, S); ctx.fillRect(x, y - S, S, S * 3); ctx.fillRect(x, y, S, S);
        }
      }
      ctx.globalAlpha = 1;
    }
    function cadente(ctx, cam, t) {   // de vez em quando, um risco em diagonal de pixel (2 para o lado, 1 para baixo)
      if (!cad && t >= proxima) {
        cad = { t0: t, x: 0.1 + 0.8 * re(), y: 0.04 + 0.3 * re(), dx: re() < 0.5 ? -1 : 1 };
        proxima = t + 7000 + 9000 * re();
      }
      if (!cad) return;
      const k = (t - cad.t0) / 750;
      if (k >= 1) { cad = null; return; }
      const S = lado(cam), passo = Math.floor(k * 44);
      const x0 = Math.floor(cad.x * cam.W / S) * S + cad.dx * passo * 2 * S, y0 = Math.floor(cad.y * cam.H / S) * S + passo * S;
      const brilho = Math.min(1, k * 5, (1 - k) * 4);
      ctx.fillStyle = CADENTE;
      for (let i = 0; i < 12; i++) { ctx.globalAlpha = brilho * (1 - i / 12); ctx.fillRect(x0 - cad.dx * i * 2 * S, y0 - i * S, 2 * S, S); }
      ctx.globalAlpha = 1;
    }

    // a lua: 25 px com halo, crateras (parede escura do lado do sol, clara do outro), mares e a fase de verdade (a
    // crescente acesa à esquerda, como se vê do Brasil); o lado escuro com a luz da Terra e a beira mais clara
    let luaTela = null, luaChave = -1;
    const CRATERAS = [[-0.42, 0.42, 0.2], [0.42, 0.36, 0.16], [0.5, -0.4, 0.13], [-0.1, 0.62, 0.12], [0.08, -0.62, 0.11]];
    const MARES = [[-0.2, -0.2, 0.38, 0.28], [0.26, -0.12, 0.22, 0.3], [-0.42, 0.06, 0.18, 0.2]];
    function desenharLua(data) {
      const idade = ((((data.getTime() / 86400000 + 2440587.5 - 2451550.1) / 29.530588853) % 1) + 1) % 1, passo = Math.round(idade * 48) % 48;
      if (luaTela && luaChave === passo) return luaTela;
      luaChave = passo;
      luaTela = luaTela || document.createElement("canvas"); luaTela.width = luaTela.height = 29;
      const g = luaTela.getContext("2d"), a = passo / 48 * 2 * Math.PI, lx = -Math.sin(a), lz = -Math.cos(a);
      if (!g) return luaTela;
      g.clearRect(0, 0, 29, 29);
      for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++) {
        const nx = (x - 14) / 12.4, ny = (y - 14) / 12.4, r2 = nx * nx + ny * ny, dz = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
        if (r2 > 1) {   // o halo, só em volta da parte acesa
          if (r2 < 1.18 && nx * lx + 0.6 * lz > 0.05) { g.fillStyle = "rgba(236,236,226,0.2)"; g.fillRect(x, y, 1, 1); }
          continue;
        }
        const acesa = nx * lx + Math.sqrt(1 - r2) * lz + dz * 0.05 > 0;
        const mare = MARES.some(([cx, cy, rx, ry]) => ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2 < 1 - hash(x, y, 7) * 0.2);
        const cr = CRATERAS.find(([cx, cy, rr]) => (nx - cx) ** 2 + (ny - cy) ** 2 < rr * rr);
        let cor;
        if (acesa) {
          cor = mare ? "#b6b2a6" : "#e4dfd1";
          if (cr) { const w = (nx - cr[0]) * lx; cor = w > cr[2] * 0.35 ? "#9e998c" : w < -cr[2] * 0.35 ? "#f7f4ec" : "#cdc7b8"; }
          if (r2 > 0.86 && !cr) cor = mare ? "#a5a196" : "#d2ccbd";
        } else cor = r2 > 0.9 ? "rgba(170,185,225,0.13)" : "rgba(150,165,205,0.07)";   // a luz da Terra: quase transparente
        g.fillStyle = cor; g.fillRect(x, y, 1, 1);
      }
      return luaTela;
    }

    const nivel = {
      nome: "globo", camera, destaque: null,
      entrar(p) {   // voltando do Brasil, o globo chega com o Brasil de frente e se afasta
        ajustar();
        camera.x = camera.y = C; camera.z = camera.alvoZ = 1; camera.voo = camera.ancora = null; camera.vx = camera.vy = 0;
        voo = null; segurando = false;
        if (p && p.nivel === "brasil") {
          lon0 = LON0; lat0 = LAT0;
          if (!reduzido) { camera.z = 3; camera.zoomPara(1); vel = 0; }
        }
        camera.limitar();
      },
      sair() { nivel.destaque = null; voo = null; segurando = false; },
      quadro(ctx, dt, t) {
        ajustar();
        let acao = null;
        if (voo) {   // girando até o Brasil, pelo caminho curto
          const dl = norm(voo.lon - lon0), df = voo.lat - lat0, dist = Math.hypot(dl, df), passo = Math.min(240, Math.max(30, dist * 3)) * dt;
          if (dist <= passo || dist < 0.5) { lon0 = voo.lon; lat0 = voo.lat; vel = 0; if (voo.descer) acao = { ir: "brasil" }; voo = null; }
          else { lon0 = norm(lon0 + dl / dist * passo); lat0 += df / dist * passo; }
        } else if (!segurando) {
          if (!reduzido && nivel.destaque === "brasil" && visao(LAT0, LON0) < Math.cos(35 * RAD)) voo = { lon: LON0, lat: LAT0, descer: false };
          const base = reduzido || nivel.destaque ? 0 : -GIRO;
          vel = reduzido ? 0 : vel + (base - vel) * (1 - Math.exp(-dt * 1.5));
          if (vel) lon0 = norm(lon0 + vel * dt);
        }
        if (!reduzido) { derivaA = (derivaA + NUVEM_A * dt) % 360; derivaB = (derivaB + NUVEM_B * dt) % 360; }   // as nuvens andam para leste
        const data = agora();
        if (!sol || Math.abs(data - solEm) > 1000) { sol = terminador(data); solEm = +data; }

        const cam = camera, P = cam.P, [ox, oy] = cam.origem();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(ceu(cam), 0, 0);
        if (!reduzido) { cintilar(ctx, cam, t); cadente(ctx, cam, t); }
        ctx.setTransform(P, 0, 0, P, ox, oy);
        ctx.drawImage(desenharLua(data), LUA[0] - 14, LUA[1] - 14);
        // a passada pixel a pixel sai a ~30 Hz (a 6°/s o globo anda uns 14 px por segundo; se ela passar de 12 ms, a 15 Hz),
        // a cada quadro no arraste e no giro até o Brasil, e só quando algo muda com movimento reduzido; céu, lua e seta
        // seguem a cada quadro
        const chave = [lon0, lat0, solEm, Math.floor(derivaA * 2), Math.floor(derivaB * 2)].join(), destaque = nivel.destaque === "brasil";
        const vez = !reduzido && t - feito.t >= intervalo, mudou = chave !== feito.chave && (segurando || voo || reduzido);
        if (vez || mudou || destaque !== feito.destaque) {
          const t0 = performance.now(), m0 = montagens, l0 = tabelaLat;
          renderizar(t, destaque); feito = { chave, t, destaque };
          const custo = performance.now() - t0;
          if (montagens !== m0 || tabelaLat !== l0) { /* montou o campo ou a tabela: não mede */ }
          else if (custo > 12) { intervalo = 66; rapidas = 0; } else if (custo < 8) { if (++rapidas >= 10) intervalo = 33; } else rapidas = 0;
        }
        ctx.drawImage(tela, 0, 0);

        if (!voo && visao(-11, -51) > 0.35) {   // a seta, ao norte do Brasil, apontando para ele (sem cobrir o país)
          const alvo = projetar(5.6, -59, lon0, lat0, R), pulo = reduzido ? 0 : Math.sin(t / 320) > 0 ? 1 : 0;
          const x0 = Math.round(alvo.x) - 5, y0 = Math.round(alvo.y) - SETA.length - pulo;
          SETA.forEach((linha, y) => {
            for (let x = 0; x < linha.length; x++) if (linha[x] !== ".") { ctx.fillStyle = CORES_SETA[linha[x]]; ctx.fillRect(x0 + x, y0 + y, 1, 1); }
          });
        }
        return acao;
      },
      clique(x, y) { const p = ponto(x, y, lon0, lat0, R); return p && acerta(p) ? { ir: "brasil" } : null; },
      // zoom: sobre o Brasil (ou com ele de frente) desce já; fora dele, o globo gira até o Brasil e então desce
      zoom(sinal, sx, sy) {
        if (sinal <= 0) return null;
        const p = sx != null ? ponto(...camera.mundo(sx, sy), lon0, lat0, R) : null;
        if ((p && acerta(p)) || (!p && visao(LAT0, LON0) > Math.cos(25 * RAD))) return { ir: "brasil" };
        if (reduzido) { lon0 = LON0; lat0 = LAT0; return { ir: "brasil" }; }
        voo = { lon: LON0, lat: LAT0, descer: true };
        return null;
      },
      // arrastar gira o globo (dx, dy em pixels da tela); solto em movimento, segue girando e volta aos 6°/s
      arrastar(dx, dy) {
        const k = 1 / (R * camera.P * RAD), agoraMs = performance.now(), dtm = Math.max(8, agoraMs - ultimo) / 1000;
        lon0 = norm(lon0 - dx * k); lat0 = Math.max(-70, Math.min(70, lat0 + dy * k));
        velArraste = Math.max(-240, Math.min(240, 0.7 * (-dx * k / dtm) + 0.3 * velArraste));
        ultimo = agoraMs; segurando = true; voo = null;
      },
      soltar(lancado) { segurando = false; vel = reduzido || !lancado ? 0 : velArraste; velArraste = 0; },
      mergulho() { const p = projetar(LAT0, LON0, lon0, lat0, R); return p.visivel ? [p.x, p.y] : [C, C]; },
      sobre(x, y) { const p = ponto(x, y, lon0, lat0, R); return p && acerta(p) ? alvoDoBrasil(x, y) : null; },
      alvos() { return [alvoDoBrasil(C, C)]; },
      get rotacao() { return { lon: lon0, lat: lat0 }; },
    };
    function alvoDoBrasil(x, y) {
      return { id: "brasil", x, y, alto: 12, titulo: "Brasil", texto: "Descer ao mapa do Brasil",
               rotulo: "Brasil: descer ao mapa do Brasil, com o tempo de agora em cada capital", acao: { ir: "brasil" } };
    }
    return nivel;
  }

  // a imagem é da mesma origem, então o getImageData funciona; se o canvas sair "sujo" (ou no teste), fica o globo de mar
  function ler(src, w, h, usar) {
    const img = new Image();
    img.addEventListener("load", () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d");
      if (!g) return;
      g.drawImage(img, 0, 0);
      let d = null;
      try { d = g.getImageData(0, 0, w, h); } catch (e) { return; }
      if (d && d.data) usar(d.data);
    });
    img.src = src;
  }

  return { criar, projetar, ponto, terminador, nuvens, get montagens() { return montagens; }, B, R, CADENTE };
})();
window.Globo = Globo;
