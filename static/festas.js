// Datas comemorativas: decide pela data de hoje (fuso de Brasília) qual festa está valendo e o que muda
// no escritório: enfeites, chapéu dos agentes, falas e fogos. Vale a primeira data própria (Personalizar,
// /api/config "festas") que cobre o dia; sem nenhuma, a festa do calendário que não foi desligada.
// ?data=2026-12-25 simula outra data.
"use strict";

const Festas = (() => {
  // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher); Carnaval = Páscoa - 47 dias
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(ano, mes - 1, dia));
  }
  // Ano Novo Chinês e Diwali mudam com o calendário lunar: tabela de datas
  const ANO_NOVO_CHINES = { 2025: "01-29", 2026: "02-17", 2027: "02-06", 2028: "01-26", 2029: "02-13", 2030: "02-03", 2031: "01-23", 2032: "02-11", 2033: "01-31", 2034: "02-19", 2035: "02-08" };
  const DIWALI = { 2025: "10-21", 2026: "11-08", 2027: "10-29", 2028: "10-17", 2029: "11-05", 2030: "10-26", 2031: "11-14", 2032: "11-02" };

  const FESTAS = {
    natal:       { nome: "Natal", cores: ["#e11d48", "#22c55e", "#facc15"], enfeites: ["pisca", "arvore_natal", "presentes", "guirlanda"], chapeu: "noel", falas: ["Feliz Natal! 🎄", "Ho ho ho!", "Quem tirou quem no amigo secreto?", "Panetone com ou sem fruta?"] },
    anonovo:     { nome: "Ano Novo", cores: ["#facc15", "#ffffff", "#a855f7"], enfeites: ["pisca", "champanhe", "confete", "fogos"], chapeu: "festa", falas: ["Feliz Ano Novo! 🎆", "Metas pro ano: deploy sem bug", "5… 4… 3… 2… 1…"] },
    carnaval:    { nome: "Carnaval", cores: ["#f43f5e", "#facc15", "#22d3ee", "#a855f7"], enfeites: ["bandeirinhas", "confete", "mascara", "serpentina"], chapeu: "festa", falas: ["Ô abre alas! 🎭", "Bloco do commit!", "Alalaô!"] },
    pascoa:      { nome: "Páscoa", cores: ["#f9a8d4", "#a7f3d0", "#fde68a", "#c4b5fd"], enfeites: ["ovos", "coelho", "bandeirinhas"], chapeu: "coelho", falas: ["Feliz Páscoa! 🐰", "Achei um ovo escondido!", "Chocolate liberado"] },
    chines:      { nome: "Ano Novo Chinês", cores: ["#dc2626", "#facc15"], enfeites: ["lanternas", "fogos", "pisca"], chapeu: "festa", falas: ["新年快乐! 🧧", "Ano novo lunar, código novo", "Envelope vermelho?"] },
    junina:      { nome: "Festa Junina", cores: ["#f97316", "#facc15", "#22c55e", "#3b82f6", "#e11d48"], enfeites: ["bandeirinhas", "fogueira"], chapeu: "palha", falas: ["Arraiá da firma! 🌽", "Olha a cobra! É mentira!", "Pamonha ou curau?"] },
    halloween:   { nome: "Halloween", cores: ["#f97316", "#7c3aed", "#22c55e"], enfeites: ["abobora", "morcegos", "pisca"], chapeu: "bruxa", falas: ["Gostosuras ou travessuras? 🎃", "Esse bug é assombrado", "Buuu!"] },
    independencia:{ nome: "Independência do Brasil", cores: ["#16a34a", "#facc15", "#1d4ed8"], enfeites: ["bandeirinhas"], chapeu: null, falas: ["Viva o Brasil! 🇧🇷", "Feriadão!"] },
    programador: { nome: "Dia do Programador", cores: ["#22d3ee", "#a3e635"], enfeites: ["pisca", "confete"], chapeu: "festa", falas: ["Feliz dia 256! 💻", "0x100 dias no ano", "Hoje o deploy é por conta da casa"] },
    diwali:      { nome: "Diwali", cores: ["#f59e0b", "#e11d48", "#a855f7"], enfeites: ["diwali", "pisca", "fogos"], chapeu: null, falas: ["Feliz Diwali! 🪔", "Festival das luzes!"] },
    namorados:   { nome: "Dia dos Namorados", cores: ["#f43f5e", "#fda4af"], enfeites: ["coracoes", "pisca"], chapeu: null, falas: ["Amor é código sem bug 💘", "Quem vai jantar fora?"] },
    criancas:    { nome: "Dia das Crianças", cores: ["#38bdf8", "#facc15", "#f472b6"], enfeites: ["baloes", "confete"], chapeu: "festa", falas: ["Bora jogar videogame! 🎈", "Hoje pode doce"] },
    trabalho:    { nome: "Dia do Trabalho", cores: ["#ef4444", "#f8fafc"], enfeites: ["bandeirinhas"], chapeu: null, falas: ["Feriado! Até os agentes descansam", "Dia do trabalho… e a gente trabalhando 😅"] },
  };

  // catálogo fechado de temas das datas próprias: os das 13 festas e um genérico nas cores da marca
  const GENERICO = { nome: "Festa", enfeites: ["confete", "bandeirinhas"], chapeu: "festa", falas: ["Hoje é dia de festa! 🎉", "Tem bolo na cozinha", "Parabéns pra nós!"] };
  const ANUAL = /^(\d{2})-(\d{2})$/, UNICA = /^(\d{4})-(\d{2})-(\d{2})$/;
  let proprias = [], desligadas = new Set(), corMarca = "#f5b83d";

  const temaDe = k => (Object.hasOwn(FESTAS, k) ? k : "generico");   // tema desconhecido vira o genérico
  function tema(k) { return temaDe(k) === "generico" ? { ...GENERICO, cores: [corMarca, "#f8fafc", "#facc15"] } : FESTAS[k]; }
  function temas() { return ["generico", ...Object.keys(FESTAS)].map(k => ({ chave: k, ...tema(k) })); }

  // config.festas do servidor (já validada lá; aqui só não deixa um valor torto quebrar o mapa) e a cor da marca
  function configurar(cfg, cor) {
    if (typeof cor === "string" && /^#[0-9a-f]{6}$/i.test(cor)) corMarca = cor;
    const c = cfg && typeof cfg === "object" ? cfg : {}, texto = t => typeof t === "string" && t.length > 0;
    proprias = (Array.isArray(c.proprias) ? c.proprias : []).filter(p => p && texto(p.nome) && texto(p.data) && (ANUAL.test(p.data) || UNICA.test(p.data)))
      .slice(0, 24).map(p => ({ nome: p.nome, data: p.data, dias: Number.isInteger(p.dias) && p.dias >= 1 && p.dias <= 14 ? p.dias : 1,
        tema: typeof p.tema === "string" ? p.tema : "generico", falas: Array.isArray(p.falas) ? p.falas.filter(texto).slice(0, 3) : [] }));
    desligadas = new Set((Array.isArray(c.desligadas) ? c.desligadas : []).filter(k => typeof k === "string"));
  }

  // início (ms UTC) da data própria no ano y, ou null: a anual vale todo ano (29/02 só nos bissextos), a única só no ano dela
  function inicio(p, y) {
    const u = UNICA.exec(p.data), a = ANUAL.exec(p.data);
    if (u && +u[1] !== y) return null;
    const m = +(u ? u[2] : a[1]), d = +(u ? u[3] : a[2]), ms = utc(y, m, d), t = new Date(ms);
    return t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? ms : null;   // 31/04 ou 29/02 fora do bissexto não existem
  }
  // a primeira data própria que cobre o dia, de data até data + dias - 1 (a do ano anterior também: festa que vira o ano)
  function propria(y, m, d) {
    const dt = utc(y, m, d);
    for (const p of proprias) for (const ano of [y, y - 1]) {
      const ini = inicio(p, ano);
      if (ini != null && entre(dt, ini, ini + (p.dias - 1) * DIA)) return p;
    }
    return null;
  }

  function hoje() {
    const sim = new URLSearchParams(location.search).get("data");
    if (sim && /^\d{4}-\d{2}-\d{2}$/.test(sim)) { const [y, m, d] = sim.split("-").map(Number); return { y, m, d }; }
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }

  function entre(dt, ini, fim) { return dt >= ini && dt <= fim; }
  function utc(y, m, d) { return Date.UTC(y, m - 1, d); }
  const DIA = 86400000;

  function ativa() {
    const { y, m, d } = hoje(), p = propria(y, m, d);
    if (p) { const t = tema(p.tema); return { chave: "propria", tema: temaDe(p.tema), ...t, nome: p.nome, falas: p.falas.length ? p.falas : t.falas }; }
    const k = chave(y, m, d);
    return k && !desligadas.has(k) ? { chave: k, ...FESTAS[k] } : null;
  }

  // qual festa vale no dia (ou null)
  function chave(y, m, d) {
    const dt = utc(y, m, d), md = m * 100 + d;
    const pas = pascoa(y).getTime(), carn = pas - 47 * DIA;
    const anc = ANO_NOVO_CHINES[y] ? utc(y, +ANO_NOVO_CHINES[y].slice(0, 2), +ANO_NOVO_CHINES[y].slice(3)) : null;
    const diw = DIWALI[y] ? utc(y, +DIWALI[y].slice(0, 2), +DIWALI[y].slice(3)) : null;
    const diaDoAno = Math.round((dt - utc(y, 1, 1)) / DIA) + 1;
    let k = null;
    if (md >= 1230 || md <= 102) k = "anonovo";
    else if (md >= 1201) k = "natal";
    else if (entre(dt, carn - 4 * DIA, carn + DIA)) k = "carnaval";
    else if (entre(dt, pas - 3 * DIA, pas + DIA)) k = "pascoa";
    else if (anc && entre(dt, anc - DIA, anc + 3 * DIA)) k = "chines";
    else if (diw && entre(dt, diw - 2 * DIA, diw + 2 * DIA)) k = "diwali";
    else if (md >= 1025 && md <= 1101) k = "halloween";
    else if (m === 6 || (m === 7 && d <= 10)) k = md === 612 ? "namorados" : "junina";
    else if (md >= 905 && md <= 907) k = "independencia";
    else if (diaDoAno === 256) k = "programador";
    else if (md === 1012) k = "criancas";
    else if (md === 501) k = "trabalho";
    return k;
  }

  // Um dia de cada festa do calendário no ano: [{ chave, nome, data: "AAAA-MM-DD" }] na ordem do FESTAS.
  // Parte do dia típico (25/12, 24/06 de São João, 31/10...) e procura o mais perto que o chave() reconhece:
  // assim uma festa que cai dentro de outra (o Ano Novo Chinês de 2026 no Carnaval) sai num dia em que ela vale.
  // Festa sem dia no ano (Ano Novo Chinês ou Diwali fora das tabelas) fica de fora.
  function embutidas(ano) {
    const y = Math.floor(Number(ano)), r = [];
    if (!(y >= 1583 && y <= 9999)) return r;   // calendário gregoriano
    const ini = utc(y, 1, 1), fim = utc(y, 12, 31), dia = md => utc(y, +md.slice(0, 2), +md.slice(3)), pas = pascoa(y).getTime();
    const tipico = { natal: dia("12-25"), anonovo: dia("12-31"), carnaval: pas - 47 * DIA, pascoa: pas, junina: dia("06-24"),
      halloween: dia("10-31"), independencia: dia("09-07"), programador: ini + 255 * DIA, namorados: dia("06-12"),
      criancas: dia("10-12"), trabalho: dia("05-01"), chines: ANO_NOVO_CHINES[y] ? dia(ANO_NOVO_CHINES[y]) : null,
      diwali: DIWALI[y] ? dia(DIWALI[y]) : null };
    const vale = (ms, k) => { const x = new Date(ms); return ms >= ini && ms <= fim && chave(y, x.getUTCMonth() + 1, x.getUTCDate()) === k; };
    for (const k of Object.keys(FESTAS)) {
      const t = tipico[k];
      if (t == null) continue;
      for (let i = 0; i <= 10; i++) {   // até 10 dias para cada lado do dia típico
        const ms = vale(t + i * DIA, k) ? t + i * DIA : vale(t - i * DIA, k) ? t - i * DIA : null;
        if (ms != null) { r.push({ chave: k, nome: FESTAS[k].nome, data: new Date(ms).toISOString().slice(0, 10) }); break; }
      }
    }
    return r;
  }
  // o menu de simulação: as festas do calendário que estão ligadas e o primeiro dia de cada data própria no ano
  function lista(ano) {
    const y = Math.floor(Number(ano)), r = embutidas(y).filter(f => !desligadas.has(f.chave));
    if (!(y >= 1583 && y <= 9999)) return r;
    proprias.forEach((p, i) => { const ini = inicio(p, y); if (ini != null) r.push({ chave: `propria-${i}`, nome: p.nome, data: new Date(ini).toISOString().slice(0, 10) }); });
    return r;
  }

  return { ativa, pascoa, lista, embutidas, temas, tema, configurar };
})();

window.Festas = Festas;
