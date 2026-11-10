// Sons sintetizados (WebAudio, sem arquivos). Categorias configuráveis pela pessoa:
// teclado, conversas ("simlês", com voz própria de cada agente), jogos, avisos, clima e ambiente
// (passos conforme o piso, portas, máquina de café, gato, pássaros de dia e grilos à noite).
// Tudo começa desligado; o áudio só é criado depois de um clique ou tecla (política de autoplay).
// Cada som varia um pouco de tom e volume para não repetir sempre igual.
"use strict";

const Som = (() => {
  const PADRAO = { ligado: false, volume: 0.6, teclado: true, conversa: true, jogos: true, avisos: true, clima: true, ambiente: true };
  let cfg = { ...PADRAO };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem("escritorio.som2") || "{}")); } catch (e) { /* sem storage */ }
  let ctx = null, mestre = null, ruidoBuf = null, gesto = false;
  let chuvaNo = null, chuvaGanho = null, zumbido = null, vento = null, proxTecla = 0, proxBicho = 0, proxHora = 0, hora = 12;

  // o navegador só libera áudio depois de um gesto da pessoa
  const liberar = () => { gesto = true; if (ctx && cfg.ligado && ctx.state === "suspended") ctx.resume(); };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, liberar, { capture: true, passive: true });

  function salvar() { try { localStorage.setItem("escritorio.som2", JSON.stringify(cfg)); } catch (e) { /* ok */ } }
  function garantir() {
    if (!gesto) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();   // segura os picos quando vários sons coincidem
      comp.threshold.value = -16; comp.ratio.value = 4;
      mestre = ctx.createGain(); mestre.connect(comp); comp.connect(ctx.destination);
      const n = ctx.sampleRate * 2; ruidoBuf = ctx.createBuffer(1, n, ctx.sampleRate);   // um ruído só, reaproveitado
      const d = ruidoBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    mestre.gain.value = cfg.volume * 0.5;
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  const pode = cat => cfg.ligado && cfg[cat] && garantir();
  const vari = (x, p = 0.06) => x * (1 + (Math.random() * 2 - 1) * p);   // variação leve
  const trecho = dur => Math.random() * Math.max(0, 1.9 - dur);           // onde começar no ruído de 2 s

  function tom(freq, dur, tipo = "sine", vol = 0.3, quando = 0, ate = null) {
    const t0 = ctx.currentTime + quando, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tipo; o.frequency.setValueAtTime(vari(freq, 0.03), t0);
    if (ate) o.frequency.exponentialRampToValueAtTime(vari(ate, 0.03), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vari(vol, 0.12), t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(mestre); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  // rajada de ruído filtrado (o trecho do ruído é sorteado: cada estalo sai diferente)
  function estalo(freq, vol, dur = 0.03, tipo = "bandpass", quando = 0, q = 1, ataque = 0.004) {
    const t0 = ctx.currentTime + quando, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = ruidoBuf; f.type = tipo; f.frequency.value = vari(freq, 0.1); f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vari(vol, 0.15), t0 + ataque); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(mestre); s.start(t0, trecho(dur)); s.stop(t0 + dur + 0.02);
  }
  function chiado(de, ate, vol, dur, quando = 0) { // ruído com o filtro varrendo (porta de vidro, vapor)
    const t0 = ctx.currentTime + quando, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = ruidoBuf; f.type = "bandpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(de, t0); f.frequency.exponentialRampToValueAtTime(ate, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vari(vol, 0.15), t0 + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(mestre); s.start(t0, trecho(dur)); s.stop(t0 + dur + 0.02);
  }
  function laço(freq, tipo) { // ruído contínuo em loop (chuva, vento, zumbido), começa mudo
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = ruidoBuf; s.loop = true; f.type = tipo; f.frequency.value = freq; g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(mestre); s.start();
    return { g, f };
  }
  const aproxima = (no, alvo, k) => { if (no) no.g.gain.value += (alvo - no.g.gain.value) * k; };

  // "Simlês": sílabas com formantes de vogal; cada agente tem seu tom de voz
  const VOGAIS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1700]];
  function voz(semente) {
    let h = 0; for (const ch of semente || "x") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const base = 150 + (h % 130), silabas = 3 + Math.floor(Math.random() * 4), pergunta = Math.random() < 0.25;
    let t = 0;
    for (let i = 0; i < silabas; i++) {
      const dur = 0.07 + Math.random() * 0.08, [f1, f2] = VOGAIS[Math.floor(Math.random() * VOGAIS.length)];
      const sobe = pergunta && i === silabas - 1 ? 1.35 : 1;   // às vezes termina subindo, como pergunta
      const t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.35), t0);
      o.frequency.linearRampToValueAtTime(base * (0.85 + Math.random() * 0.4) * sobe, t0 + dur);
      const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(); a.type = b.type = "bandpass"; a.frequency.value = f1; b.frequency.value = f2; a.Q.value = 8; b.Q.value = 10;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vari(0.45, 0.15), t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(a); o.connect(b); a.connect(g); b.connect(g); g.connect(mestre); o.start(t0); o.stop(t0 + dur + 0.02);
      t += dur + 0.02 + Math.random() * 0.05;
    }
  }

  // passos: cada piso tem seu timbre (filtro, frequência, volume e duração)
  const PISO = {
    madeira:  [["lowpass", 520, 0.07, 0.05], ["bandpass", 1500, 0.015, 0.012]],
    carpete:  [["lowpass", 260, 0.045, 0.05]],
    ladrilho: [["highpass", 2400, 0.03, 0.018], ["lowpass", 380, 0.03, 0.03]],
    concreto: [["bandpass", 950, 0.045, 0.025]],
    calcada:  [["bandpass", 1300, 0.04, 0.04], ["lowpass", 300, 0.025, 0.04]],
  };
  // portas: vidro corre (chiado), madeira range e bate, metal tine, vaivém abana
  function porta(tipo) {
    if (tipo === "vidro" || tipo === "fosca" || tipo === "lateral") { chiado(500, 1800, tipo === "fosca" ? 0.035 : 0.05, 0.45); tom(2093, 0.25, "sine", 0.012, 0.05); }
    else if (tipo === "metal") { tom(523, 0.35, "triangle", 0.05); tom(1357, 0.25, "sine", 0.025, 0.01); estalo(3000, 0.05, 0.03, "highpass"); }
    else if (tipo === "vaivem") { estalo(700, 0.08, 0.08, "lowpass"); estalo(600, 0.05, 0.07, "lowpass", 0.22); }
    else { tom(140, 0.28, "sawtooth", 0.018, 0, 190); estalo(220, 0.09, 0.12, "lowpass", 0.05); }   // madeira, madeira escura, pintada
  }
  const ESCALA = [523, 587, 659, 784, 880, 1047, 1175, 1319];   // pentatônica para os fliperamas

  const EFEITOS = {
    aprovacao: ["avisos", () => { tom(880, 0.18, "sine", 0.35); tom(1320, 0.3, "sine", 0.3, 0.16); }],
    pergunta: ["avisos", () => { tom(660, 0.14, "triangle", 0.3); tom(990, 0.22, "triangle", 0.25, 0.12); }],
    pronto: ["avisos", () => { [784, 988, 1175, 1568].forEach((f, i) => tom(f, 0.12, "triangle", 0.12, i * 0.08)); }],
    festa: ["avisos", () => { estalo(3200, 0.16, 0.22, "highpass", 0, 0.7, 0.002); for (let i = 0; i < 6; i++) estalo(5000 + Math.random() * 3000, 0.04, 0.03, "highpass", 0.08 + Math.random() * 0.4); }],
    conversa: ["conversa", d => voz(d && d.voz)],
    jogo_arcade: ["jogos", () => {
      if (Math.random() < 0.15) { tom(988, 0.07, "square", 0.05); tom(1319, 0.2, "square", 0.05, 0.07); return; }   // ficha
      let n = Math.floor(Math.random() * 5); for (let i = 0; i < 4; i++) { n = Math.max(0, Math.min(ESCALA.length - 1, n + Math.floor(Math.random() * 5) - 2)); tom(ESCALA[n], 0.07, "square", 0.04, i * 0.08); }
    }],
    jogo_videogame: ["jogos", () => { if (Math.random() < 0.5) tom(330, 0.18, "square", 0.04, 0, 990); else [392, 523, 659].forEach((f, i) => tom(f, 0.06, "square", 0.04, i * 0.06)); estalo(3000, 0.04); }],
    jogo_pingpong: ["jogos", () => { let t = 0; for (let i = 0; i < 4; i++) { tom(1500, 0.03, "sine", 0.16, t); tom(950, 0.025, "sine", 0.1, t + 0.17); t += vari(0.42, 0.1); } }],
    jogo_sinuca: ["jogos", () => { estalo(300, 0.18, 0.05, "lowpass"); let t = 0.06; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) { estalo(2600, 0.4, 0.02, "highpass", t); t += 0.05 + Math.random() * 0.25; } if (Math.random() < 0.3) estalo(180, 0.25, 0.15, "lowpass", t + 0.2); }],
    jogo_pebolim: ["jogos", () => { let t = 0; for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) { estalo(1200 + Math.random() * 600, 0.28, 0.025, "bandpass", t); t += 0.05 + Math.random() * 0.1; } }],
    vitoria: ["jogos", () => { [523, 659, 784, 1047].forEach((f, i) => tom(f, i === 3 ? 0.22 : 0.08, "square", 0.04, i * 0.08)); }],
    porta: ["ambiente", d => porta(d && d.tipo)],
    passo: ["ambiente", d => { for (const [tipo, f, vol, dur] of PISO[(d && d.piso)] || PISO.madeira) estalo(f, vol, dur, tipo); }],
    cafe: ["ambiente", () => { // moedor, café caindo e um chiado de vapor no fim
      const t0 = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), prof = ctx.createGain();
      s.buffer = ruidoBuf; f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 2; lfo.frequency.value = 32; prof.gain.value = 0.03;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05); g.gain.setValueAtTime(0.05, t0 + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
      lfo.connect(prof); prof.connect(g.gain); s.connect(f); f.connect(g); g.connect(mestre); s.start(t0, trecho(0.8)); s.stop(t0 + 0.8); lfo.start(t0); lfo.stop(t0 + 0.8);
      chiado(2600, 2200, 0.07, 1.3, 0.85); chiado(4000, 7000, 0.03, 0.6, 2.1);
    }],
    miau: ["ambiente", () => { // miado: serra com formante de "i-a-u" e o tom subindo e descendo
      const t0 = ctx.currentTime, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), b = vari(520, 0.08);
      o.type = "sawtooth"; o.frequency.setValueAtTime(b, t0); o.frequency.linearRampToValueAtTime(b * 1.5, t0 + 0.18); o.frequency.linearRampToValueAtTime(b * 1.1, t0 + 0.55);
      f.type = "bandpass"; f.Q.value = 6; f.frequency.setValueAtTime(2200, t0); f.frequency.linearRampToValueAtTime(1100, t0 + 0.55);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(f); f.connect(g); g.connect(mestre); o.start(t0); o.stop(t0 + 0.62);
    }],
    robo: ["ambiente", () => { tom(1200, 0.08, "sine", 0.05); tom(1600, 0.1, "sine", 0.05, 0.1); }],
    aplauso: ["conversa", () => { let t = 0; for (let i = 0; i < 5 + Math.floor(Math.random() * 4); i++) { estalo(1600, 0.12, 0.03, "bandpass", t, 0.8, 0.002); t += vari(0.13, 0.25); } }],   // palmas curtas
    // brincadeiras (vida.js) e objetos clicáveis (brincar.js): curtos e baixos, cada um na sua categoria
    risada: ["conversa", () => { const b = vari(420, 0.15); for (let i = 0; i < 4; i++) tom(b * (1 - i * 0.06), 0.09, "triangle", 0.05, i * 0.13, b * (0.85 - i * 0.06)); }],   // "ha-ha-ha" descendo
    palma: ["conversa", () => { estalo(1600, 0.16, 0.035, "bandpass", 0, 0.8, 0.002); }],   // high-five: um tapa só
    jogo_xadrez: ["jogos", () => { estalo(900, 0.12, 0.04, "bandpass", 0, 3); estalo(500, 0.06, 0.06, "lowpass", 0.01); }],   // peça de madeira no tabuleiro
    dardo: ["jogos", d => { chiado(2500, 1200, 0.03, 0.18); estalo(d && d.acerto ? 260 : 700, 0.14, 0.05, "lowpass", 0.2); }],   // voa e crava
    cesta: ["jogos", d => {   // a bola vai, passa pela rede (ou bate no aro) e quica
      chiado(1800, 900, 0.025, 0.3);
      if (d && d.acerto) chiado(5000, 2500, 0.03, 0.25, 0.32); else estalo(1300, 0.12, 0.06, "bandpass", 0.3, 6);
      estalo(140, 0.12, 0.08, "lowpass", 0.55);
    }],
    papel: ["ambiente", () => { for (let i = 0; i < 5; i++) estalo(3500 + Math.random() * 2500, 0.05, 0.02, "highpass", i * 0.03 + Math.random() * 0.02); }],   // papel amassado
    musica: ["ambiente", d => {   // quem toca: piano (notas longas), jukebox (baixo e melodia de 8 bits) ou violão (dedilhado)
      const inst = d && d.instrumento, n0 = Math.floor(Math.random() * 4);
      if (inst === "violao") { for (let i = 0; i < 4; i++) tom(ESCALA[(n0 + i) % 5] / 2, 0.5, "triangle", 0.04, i * 0.16); return; }
      if (inst === "jukebox") {
        tom(ESCALA[n0] / 4, 0.25, "square", 0.025); tom(ESCALA[n0] / 4, 0.25, "square", 0.025, 0.5);
        for (let i = 0; i < 3; i++) tom(ESCALA[(n0 + i * 2) % ESCALA.length], 0.12, "square", 0.018, 0.25 + i * 0.25);
        return;
      }
      for (let i = 0; i < 3; i++) tom(ESCALA[(n0 + i * 2) % ESCALA.length] / 2, 0.7, "sine", 0.05, i * 0.3);
    }],
    sino: ["avisos", () => { const f = vari(1318, 0.02); tom(f, 1.4, "sine", 0.12); tom(f * 2.76, 0.6, "sine", 0.04); tom(f * 5.4, 0.25, "sine", 0.02); }],   // sino de balcão
    ronrono: ["ambiente", () => {   // ruído grave pulsando ~24 vezes por segundo
      const t0 = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), prof = ctx.createGain();
      s.buffer = ruidoBuf; f.type = "lowpass"; f.frequency.value = 180; lfo.frequency.value = vari(24, 0.1); prof.gain.value = 0.05;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.15); g.gain.setValueAtTime(0.05, t0 + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      lfo.connect(prof); prof.connect(g.gain); s.connect(f); f.connect(g); g.connect(mestre); s.start(t0, trecho(1.6)); s.stop(t0 + 1.6); lfo.start(t0); lfo.stop(t0 + 1.6);
    }],
    jukebox: ["ambiente", () => { tom(196, 0.45, "triangle", 0.05); [392, 494, 587, 784].forEach((f, i) => tom(f, 0.12, "square", 0.03, i * 0.09)); }],   // vinheta ao ligar
    camera: ["avisos", () => { estalo(3000, 0.12, 0.02, "highpass", 0, 0.7, 0.002); estalo(1800, 0.08, 0.04, "bandpass", 0.07, 1.5); }],   // obturador
    // vida social (vida.js): o gongo chama para o ringue, os socos de desenho animado na nuvem e a torcida em volta
    gongo: ["jogos", () => { const f = vari(196, 0.03); tom(f, 1.8, "sine", 0.1); tom(f * 2.4, 1.1, "sine", 0.04); tom(f * 4.2, 0.5, "sine", 0.02); }],
    soco: ["jogos", () => { estalo(vari(160, 0.2), 0.14, 0.07, "lowpass"); estalo(vari(900, 0.2), 0.05, 0.03, "bandpass", 0.01, 2); }],   // "tchum" abafado
    torcida: ["conversa", () => { chiado(700, 1100, 0.04, 1.4); chiado(1400, 900, 0.02, 1.1, 0.25); }],   // "uuuh" da plateia
    // greve: o coro "gre-ve! gre-ve!" (duas sílabas, duas vezes, com o burburinho da turma) e a festa de quem foi atendido
    protesto: ["conversa", () => {
      for (const t of [0, 0.55]) { tom(vari(233, 0.04), 0.16, "sawtooth", 0.014, t, 247); tom(vari(196, 0.04), 0.22, "sawtooth", 0.014, t + 0.2, 185); estalo(1500, 0.06, 0.03, "bandpass", t + 0.2, 0.8, 0.002); }
      chiado(500, 700, 0.025, 1.1);
    }],
    // entrega do pedido: o "dim-dom" da campainha quando o entregador chega e o "eeee!" da turma
    campainha: ["avisos", () => { tom(vari(784, 0.02), 0.5, "sine", 0.1); tom(vari(622, 0.02), 0.8, "sine", 0.1, 0.32); }],
    eba: ["conversa", () => { chiado(900, 1600, 0.035, 0.9); chiado(1300, 2100, 0.02, 0.7, 0.12); for (let i = 0; i < 4; i++) estalo(1600, 0.08, 0.03, "bandpass", 0.35 + i * vari(0.12, 0.3), 0.8, 0.002); }],
    atendida: ["conversa", () => {
      [523, 659, 784, 1047].forEach((f, i) => tom(f, i === 3 ? 0.24 : 0.09, "triangle", 0.05, i * 0.08));
      let t = 0.3; for (let i = 0; i < 7; i++) { estalo(1600, 0.1, 0.03, "bandpass", t, 0.8, 0.002); t += vari(0.11, 0.3); }
    }],
    // a entrega de cada pedido (app.js, uma vez por entrega): a moto do motoboy chegando e o som do que chegou
    moto: ["avisos", () => { tom(vari(70, 0.05), 0.9, "sawtooth", 0.025, 0, 95); tom(vari(140, 0.05), 0.9, "square", 0.008, 0, 190); tom(440, 0.12, "square", 0.04, 1.0); tom(440, 0.18, "square", 0.04, 1.2); }],   // vrum e "bi-biii"
    entrega_pizza: ["conversa", () => { estalo(500, 0.06, 0.09, "lowpass", 0, 0.7, 0.01); estalo(380, 0.05, 0.1, "lowpass", 0.22, 0.7, 0.01); chiado(1200, 2200, 0.02, 0.5, 0.35); }],   // as tampas abrindo
    entrega_cafe: ["conversa", () => { for (let i = 0; i < 5; i++) tom(vari(420 + i * 45, 0.05), 0.07, "sine", 0.05, i * 0.11, vari(300 + i * 40, 0.05)); chiado(2500, 3800, 0.015, 0.8, 0.6); }],   // o "glu-glu" e o vapor
    entrega_ar: ["avisos", () => { tom(2093, 0.06, "square", 0.03); tom(2637, 0.08, "square", 0.03, 0.09); chiado(300, 900, 0.03, 1.6, 0.2); }],   // o bipe do controle e a brisa
    entrega_faixa: ["conversa", () => { tom(vari(523, 0.03), 0.35, "sawtooth", 0.025, 0, 698); tom(vari(659, 0.03), 0.4, "sawtooth", 0.02, 0.3, 880); for (let i = 0; i < 5; i++) estalo(2500, 0.05, 0.02, "highpass", 0.5 + i * 0.07, 0.8, 0.002); }],   // a língua de sogra e o confete
    entrega_bolo: ["conversa", () => { [392, 392, 440, 392, 523, 494].forEach((f, i) => tom(f, i === 5 ? 0.5 : 0.18, "triangle", 0.045, [0, 0.15, 0.3, 0.55, 0.8, 1.05][i])); }],   // o comecinho do "parabéns"
    entrega_pufe: ["conversa", () => { estalo(160, 0.12, 0.25, "lowpass", 0, 0.7, 0.02); chiado(600, 250, 0.03, 0.5, 0.05); }],   // o "puf" de quem se joga
    entrega_roteador: ["avisos", () => { [1200, 1600, 2000].forEach((f, i) => tom(f, 0.05, "square", 0.025, i * 0.12)); tom(1319, 0.25, "sine", 0.05, 0.45); tom(1760, 0.3, "sine", 0.05, 0.6); }],   // conectando… conectou!
    entrega_travesseiro: ["conversa", () => { estalo(220, 0.07, 0.2, "lowpass", 0, 0.7, 0.02); tom(vari(330, 0.04), 0.9, "sine", 0.03, 0.35, 196); }],   // o "fofo" e o bocejo
    konami: ["jogos", () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tom(f, i === 6 ? 0.3 : 0.07, "square", 0.04, i * 0.07)); }],
  };

  // bichos lá fora, bem esparsos: pássaros de dia (sem chuva), grilos à noite
  function bichos(agora) {
    if (agora < proxBicho) return;
    const chuva = window.Clima && Clima.chove();
    if (hora >= 6 && hora < 17.5 && !chuva) {
      proxBicho = agora + 9 + Math.random() * 16;
      const n = 2 + Math.floor(Math.random() * 3), f = 2800 + Math.random() * 1400;
      for (let i = 0; i < n; i++) tom(f * (1 + Math.random() * 0.2), 0.07, "sine", 0.012, i * 0.13, f * 1.4);
    } else if ((hora >= 19 || hora < 5.5) && !chuva) {
      proxBicho = agora + 3 + Math.random() * 5;
      const f = 4300 + Math.random() * 500;
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) tom(f, 0.025, "sine", 0.008, i * 0.06);
    } else proxBicho = agora + 5;
  }

  return {
    get ligado() { return cfg.ligado; },
    get config() { return { ...cfg }; },
    ajustar(muda) {
      Object.assign(cfg, muda); salvar();
      if (cfg.ligado) garantir();   // retoma o contexto (só depois de um gesto)
      if (!cfg.ligado || !cfg.clima) this.chuva(0);
      if (!cfg.ligado && ctx && ctx.state === "running") ctx.suspend();   // desligado: nada rodando com ganho zero
    },
    alternar() { this.ajustar({ ligado: !cfg.ligado }); if (cfg.ligado && garantir()) EFEITOS.conversa[1]({ voz: "oi" }); return cfg.ligado; },
    evento(nome, dados) { const e = EFEITOS[nome]; if (e && pode(e[0])) e[1](dados); },
    // chamado a cada quadro: zumbido de escritório (mais baixo à noite), vento com neve ou tempestade, bichos lá fora
    ambiente(ativo) {
      const ok = ativo && pode("ambiente");
      if (!ok) { aproxima(zumbido, 0, 0.1); aproxima(vento, 0, 0.1); return; }
      const agora = ctx.currentTime;
      if (agora > proxHora) { proxHora = agora + 1; hora = window.Ceu ? Ceu.agora().h : 12; }
      if (!zumbido) { zumbido = laço(220, "lowpass"); vento = laço(380, "lowpass"); }
      const fechado = window.Expediente ? Expediente.fora(hora) : hora >= 20 || hora < 7;   // escritório fechado: zumbido mais baixo
      aproxima(zumbido, fechado ? 0.025 : 0.045, 0.02);
      const forca = cfg.clima && window.Clima ? Clima.vento || 0 : 0;   // o vento de agora, já com as rajadas
      aproxima(vento, forca > 0.08 ? forca * 0.1 + Math.sin(agora * 0.4) * 0.02 * forca : 0, 0.02);
      bichos(agora);
    },
    // teclado: cliques variados, espaço e enter de vez em quando, rajadas com pausas de quem pensa
    teclado(qtd, t) {
      if (!qtd || t < proxTecla || !pode("teclado")) return;
      const r = Math.random();
      if (r < 0.1) estalo(900, 0.1, 0.05, "bandpass", 0, 1.5);                                        // espaço
      else if (r < 0.14) { estalo(1700, 0.12, 0.03); estalo(1500, 0.1, 0.035, "bandpass", 0.06); }   // enter
      else estalo(1800 + Math.random() * 1400, 0.11, 0.022, "bandpass", 0, 1.2);
      const pausa = Math.random() < 0.08 ? 700 + Math.random() * 900 : Math.random() < 0.15 ? 300 : 60 + Math.random() * 110;
      proxTecla = t + pausa / Math.min(qtd, 3);
    },
    chuva(intens) {
      if (!pode("clima")) { if (chuvaGanho) chuvaGanho.gain.value = 0; return; }
      if (!chuvaNo && intens > 0) { const l = laço(1400, "lowpass"); chuvaNo = l; chuvaGanho = l.g; }
      if (chuvaGanho) chuvaGanho.gain.value += (intens * 0.18 - chuvaGanho.gain.value) * 0.05;
    },
    trovao(forca = 1) { // forca: 1 é o raio bem perto (estalo seco e alto); longe, ronco baixo e abafado
      if (!pode("clima")) return;
      const t0 = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), dur = vari(2.6, 0.2);
      s.buffer = ruidoBuf; f.type = "lowpass"; f.frequency.value = vari(100 + forca * 80, 0.2);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vari(0.8 * forca, 0.15), t0 + 0.04 + (1 - forca) * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(mestre); s.start(t0, trecho(dur + 0.1)); s.stop(t0 + dur + 0.1);
    },
  };
})();

window.Som = Som;
