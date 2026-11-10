"use strict";
// Datas festivas no mundo público: a festa do dia (festas.js, com ?data=) enfeita a cidade e o Brasil. Só o calendário
// embutido vale; as festas desligadas chegam da rota do clima, e antes dela nada de enfeite. Usa o arnês do
// test_mundo_navegacao.js (a página inteira numa VM, sem navegador).
const assert = require("node:assert/strict");
const { abrir, carregar, ATLAS, CLIMA, MUNDO } = require("./test_mundo_navegacao.js");

const NOITE = { ...CLIMA, cidades: Object.fromEntries(MUNDO.cidades.map(c => [c.id, { tipo: "limpo", vento: 0, noite: true }])) };
const cruza = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// a cidade numa data, carregada e rodando alguns quadros; devolve o estado dos enfeites do último quadro e as cores pintadas
async function cidade(data, opcoes = {}, quadros = 40) {
  const m = await abrir("#cidade=sao-paulo", { busca: data ? "?data=" + data : "", opaco: true, passo: 100, ...opcoes });
  await carregar(m);
  m.contexto.cores = new Set(); m.contexto.gravar = [];
  let fogos = 0, confete = 0, serpentina = 0, morcegos = 0;
  for (let i = 0; i < quadros; i++) {
    m.rodar();
    const e = m.M.niveis.cidade.enfeites;
    fogos = Math.max(fogos, e.fogos); confete = Math.max(confete, e.confete);
    serpentina = Math.max(serpentina, e.serpentina); morcegos = Math.max(morcegos, e.morcegos);
  }
  return { m, e: { ...m.M.niveis.cidade.enfeites, fogos, confete, serpentina, morcegos }, cores: m.contexto.cores };
}
const pintou = (cores, lista) => lista.every(c => cores.has(c.toLowerCase()));

async function principal() {
  const F = (await abrir("#globo")).contexto.window.Festas;

  // Natal de dia: pisca nos telhados (apagado de dia, mas com as cores), guirlanda nos postes e a árvore ao lado da fonte
  const natal = await cidade("2026-12-25");
  assert.equal(natal.e.chave, "natal");
  assert.ok(natal.e.luzes > 20, "pisca nos telhados e em volta da praça: " + natal.e.luzes);
  assert.ok(natal.e.formas.includes("guirlanda"), natal.e.formas.join());
  assert.ok(natal.e.pecas.some(([n]) => n === "festa-arvore-natal"), "a árvore do PixelLab");
  assert.ok(pintou(natal.cores, F.tema("natal").cores), "as cores do Natal");
  assert.match(natal.m.canvas["aria-label"], /Natal/);
  assert.match(natal.m.elementos["mundo-estado"].textContent, /Hoje é Natal\./);
  // as peças ficam na quadra da praça, ao lado da fonte, sem cruzar a fonte nem outra peça
  const p = natal.m.contexto.window.CidadePlanta.planta("sao-paulo", MUNDO.cidades.find(c => c.id === "sao-paulo"));
  const [, , fw, fh] = ATLAS.quadros[p.praca.peca];
  const fonte = [p.praca.x - fw / 2, p.praca.y - fh, p.praca.x + fw / 2, p.praca.y];
  for (const [nome, ...r] of natal.e.pecas) {
    assert.ok(!cruza(r, fonte), `${nome} sobre a fonte`);
    assert.ok(r[0] >= p.praca.r[0] && r[2] <= p.praca.r[2], `${nome} fora da quadra da praça`);
    const recorte = ATLAS.quadros[nome];
    assert.ok(natal.m.contexto.gravar.some(g => JSON.stringify(g) === JSON.stringify(recorte)), `${nome} desenhada`);
  }

  // Ano Novo à noite: pisca aceso piscando, confete e fogos sobre a cidade, e o palco ao lado da fonte
  const ano = await cidade("2026-12-31", { escuro: 1, clima: NOITE }, 120);
  assert.equal(ano.e.chave, "anonovo");
  assert.ok(ano.e.fogos > 0 && ano.e.confete > 0 && ano.e.acesas > 0, JSON.stringify(ano.e));
  assert.ok(ano.e.piscando, "à noite o pisca pisca");
  assert.ok(ano.e.pecas.some(([n]) => n === "festa-palco-anonovo"));
  // Festa Junina: bandeirinhas presas nos postes atravessando as ruas, fogueira e barraca
  const jun = await cidade("2026-06-24");
  assert.equal(jun.e.chave, "junina");
  assert.ok(jun.e.cordoes >= 8 && jun.e.bandeirinhas > 40, JSON.stringify(jun.e));
  assert.equal(jun.e.pecas.map(([n]) => n).sort().join(), "festa-barraca-junina,festa-fogueira");
  assert.ok(pintou(jun.cores, F.tema("junina").cores), "as bandeirinhas nas cores da festa");
  // Halloween à noite: pisca, morcegos e a abóbora
  const hal = await cidade("2026-10-31", { escuro: 1, clima: NOITE });
  assert.equal(hal.e.chave, "halloween");
  assert.ok(hal.e.morcegos > 0 && hal.e.acesas > 0 && hal.e.pecas.some(([n]) => n === "festa-abobora"), JSON.stringify(hal.e));
  // Carnaval: bandeirinhas, confete, serpentina, máscaras nos postes e o carro alegórico
  const car = await cidade("2027-02-07");
  assert.equal(car.e.chave, "carnaval");
  assert.ok(car.e.cordoes > 0 && car.e.confete > 0 && car.e.serpentina > 0 && car.e.formas.includes("mascara"), JSON.stringify(car.e));
  assert.ok(car.e.pecas.some(([n]) => n === "festa-carro-alegorico"));
  // Páscoa: bandeirinhas, o ovo e o coelho
  const pas = await cidade("2026-04-05");
  assert.equal(pas.e.chave, "pascoa");
  assert.ok(pas.e.cordoes > 0 && pas.e.formas.includes("coelho") && pas.e.pecas.some(([n]) => n === "festa-ovo-pascoa"));

  // nas 28 cidades, toda festa com peça de praça desenha a arte dela ao lado da fonte ou do lago (a praça abre espaço nas
  // filas estreitas), sem cruzar a fonte, outra peça ou a fila da praça; a forma por código só sem a arte (teste abaixo)
  const DA_PRACA = { natal: ["festa-arvore-natal"], junina: ["festa-fogueira", "festa-barraca-junina"], halloween: ["festa-abobora"],
                     pascoa: ["festa-ovo-pascoa"], carnaval: ["festa-carro-alegorico"], anonovo: ["festa-palco-anonovo"] };
  const DATAS = { natal: "2026-12-25", junina: "2026-06-24", halloween: "2026-10-31", pascoa: "2026-04-05", carnaval: "2027-02-07",
                  anonovo: "2026-12-31" };
  const faltas = [], vistas = [];
  for (const [chave, pecas] of Object.entries(DA_PRACA)) {
    const v = await abrir("#cidade=" + MUNDO.cidades[0].id, { busca: "?data=" + DATAS[chave], reduzido: true });
    await carregar(v);
    for (const cc of MUNDO.cidades) {
      v.M.ir("cidade", { cidade: cc.id }); v.rodar(3);
      const e = v.M.niveis.cidade.enfeites, desenhadas = e.pecas.map(([n]) => n);
      assert.equal(e.chave, chave, cc.id);
      for (const n of pecas) if (!desenhadas.includes(n)) faltas.push(`${cc.id}/${chave}: ${n}`);
      vistas.push([`${cc.id}/${chave}`, v.contexto.window.CidadePlanta.planta(cc.id, cc).praca.r, e.pecas, e.fonte]);
    }
  }
  assert.equal(faltas.join(", "), "", "peças sem lugar");
  for (const [onde, fila, pecas, fonte] of vistas) {
    assert.ok(fonte[0] >= fila[0] && fonte[2] <= fila[2], `${onde}: a fonte fora da fila da praça`);
    for (const [n, ...r] of pecas) {
      assert.ok(!cruza(r, fonte), `${onde}: ${n} sobre a fonte`);
      assert.ok(r[0] >= fila[0] && r[2] <= fila[2], `${onde}: ${n} fora da fila da praça`);
      for (const [m, ...q] of pecas) if (m !== n) assert.ok(!cruza(r, q), `${onde}: ${n} sobre ${m}`);
    }
  }

  // a peça do PixelLab ausente no atlas não quebra: a festa segue com o enfeite por código no lugar dela
  const semArvore = { ...ATLAS, quadros: { ...ATLAS.quadros } };
  delete semArvore.quadros["festa-arvore-natal"];
  const sa = await cidade("2026-12-25", { atlas: semArvore });
  assert.equal(sa.e.chave, "natal");
  assert.equal(sa.e.pecas.length, 0);
  assert.ok(sa.e.formas.includes("arvore_natal"), "a árvore por código: " + sa.e.formas.join());

  // arte larga demais para qualquer praça (nem com a fonte afastada): em último caso, a forma por código no lugar
  const enorme = { ...ATLAS, quadros: { ...ATLAS.quadros, "festa-arvore-natal": [0, 0, 160, 40] } };
  const en = await cidade("2026-12-25", { atlas: enorme });
  assert.equal(en.e.pecas.length, 0);
  assert.ok(en.e.formas.includes("arvore_natal"), "a forma no lugar da arte que não cabe: " + en.e.formas.join());

  // festa desligada pela instalação: nada de enfeite (nem a festa no texto); sem resposta da rota ainda, também nada
  const vazio = e => e.chave === null && !e.luzes && !e.cordoes && !e.fogos && !e.confete && !e.formas.length && !e.pecas.length;
  const des = await cidade("2026-12-25", { clima: { ...CLIMA, festas_desligadas: ["natal"] } });
  assert.ok(vazio(des.e), JSON.stringify(des.e));
  assert.doesNotMatch(des.m.elementos["mundo-estado"].textContent + des.m.canvas["aria-label"], /Natal/);
  const pend = await cidade("2026-12-25", { climaPendente: true });
  assert.ok(vazio(pend.e), "antes da resposta, nada de enfeite");
  // a rota falhou: vale o calendário, sem desligadas
  assert.equal((await cidade("2026-12-25", { climaFalha: true })).e.chave, "natal");
  // nem uma data própria que viesse (indevidamente) na resposta entra: só o calendário embutido
  const intrusa = { ...CLIMA, festas_desligadas: [], proprias: [{ nome: "Segredo da firma", data: "12-25", tema: "natal" }] };
  const pr = await cidade("2026-12-25", { clima: intrusa });
  assert.equal(pr.e.chave, "natal");
  assert.doesNotMatch(pr.m.elementos["mundo-estado"].textContent + pr.m.canvas["aria-label"], /Segredo/);
  // dia sem festa: a cidade de sempre
  const comum = await cidade("2026-11-18");
  assert.ok(vazio(comum.e));

  // movimento reduzido: sem fogos, confete nem serpentina; o pisca fica aceso e parado
  for (const [data, chave] of [["2026-12-31", "anonovo"], ["2027-02-07", "carnaval"]]) {
    const r = await cidade(data, { escuro: 1, clima: NOITE, reduzido: true }, 120);
    assert.equal(r.e.chave, chave);
    assert.equal(r.e.fogos + r.e.confete + r.e.serpentina, 0, `${chave} reduzido: ${JSON.stringify(r.e)}`);
    assert.equal(r.e.piscando, false);
    if (chave === "anonovo") assert.equal(r.e.acesas, r.e.luzes, "reduzido: todas as luzes acesas");
  }

  // Brasil: o texto diz a festa; com fogos, fogos discretos sobre as capitais à noite (nenhum com movimento reduzido)
  for (const reduz of [false, true]) {
    const b = await abrir("#brasil", { busca: "?data=2026-12-31", clima: NOITE, reduzido: reduz });
    let max = 0;
    for (let i = 0; i < 300; i++) { b.rodar(); max = Math.max(max, b.M.niveis.brasil.fogos); }
    assert.match(b.elementos["mundo-estado"].textContent, /Hoje é Ano Novo\./);
    assert.equal(max > 0, !reduz, `fogos no Brasil (reduzido: ${reduz}): ${max}`);
  }
  const bd = await abrir("#brasil", { busca: "?data=2026-12-31" });   // de dia: sem fogos
  bd.rodar(300);
  assert.equal(bd.M.niveis.brasil.fogos, 0);
  // no globo, nada da festa
  const gl = await abrir("#globo", { busca: "?data=2026-12-25" });
  gl.rodar(5);
  assert.doesNotMatch(gl.elementos["mundo-estado"].textContent + gl.canvas["aria-label"], /Natal/);
}
principal().catch(e => { console.error(e); process.exitCode = 1; });
