"use strict";
// Reuniões (static/reunioes.js, 1.6 Onda 3): a parte pura. O link da sala só https e num host da lista do servidor; a
// semana começa na segunda; o aviso de "começa em 5 min" uma vez por reunião. O .ics sai do servidor.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const contexto = { window: {}, Date, Intl, URL };   // sem document: só a parte pura carrega
vm.runInNewContext(fs.readFileSync("static/reunioes.js", "utf8"), contexto);
const R = contexto.window.Reunioes;
const igual = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

// ---- o link da sala (contrato da Onda 3, item 2): https, host da lista (o "*." vale para o domínio e os subdomínios),
// sem usuário e senha, sem porta, até 500, só ASCII visível. A senha na query (?pwd= do Zoom) é do serviço e passa
{
  const hosts = ["meet.google.com", "*.zoom.us", "meet.jit.si", "teams.microsoft.com", "whereby.com", "jitsi.acme.com.br"];
  for (const url of ["https://meet.google.com/abc-defg-hij", "https://us02web.zoom.us/j/123?pwd=x", "https://zoom.us/j/1",
    "https://teams.microsoft.com/l/meetup-join/x", "https://jitsi.acme.com.br/sala", " https://meet.jit.si/Sala ", "https://MEET.GOOGLE.COM/x",
    "https://whereby.com/acme"])
    assert.equal(R.linkValido(url, hosts).ok, true, url);
  for (const url of ["http://meet.google.com/x", "https://meet.google.com.mal.com/x", "https://malzoom.us/j/1", "https://evil.com/?meet.google.com",
    "javascript:alert(1)", "https://user:senha@meet.google.com/x", "https://a@meet.google.com/x", "meet.google.com/x", "", null, 3,
    "https://meet.google.com:8443/x", `https://meet.google.com/${"a".repeat(480)}`, "https://meet.google.com/a b", "https://meet.google.com/a<b",
    "https://meet.google.com/ação", "https://sub.meet.google.com/x", "https://meet.google.com/a\b", "https://meet.google.com/{x}"])
    assert.equal(R.linkValido(url, hosts).ok, false, String(url).slice(0, 60));
  assert.equal(R.linkValido("https://evil.com/x", hosts).mensagem, "Use um link https de Meet, Zoom, Jitsi, Teams ou Whereby, sem senha no endereço.");
  assert.equal(R.linkValido(" https://meet.jit.si/Sala ", hosts).url, "https://meet.jit.si/Sala", "sai sem os espaços das pontas");
  assert.equal(R.linkValido("https://meet.google.com/x", []).ok, false, "sem lista, nada passa");
  assert.equal(R.linkValido("https://meet.google.com/x", null).ok, false);
}

// ---- o nome da sala, como o servidor escreve no aviso
{
  assert.equal(R.nomeSala("recepcao"), "Recepção");
  assert.equal(R.nomeSala("reuniao"), "Sala de reunião");
  assert.equal(R.nomeSala("cozinha"), "Cozinha");
  assert.equal(R.nomeSala("lounge"), "Lounge");
  assert.equal(R.nomeSala("time:Design"), "Design");
  assert.equal(R.nomeSala(3), "");
}

// ---- a semana: de segunda a domingo, à meia-noite local; o "de" do GET em epoch s
{
  const quarta = new Date(2026, 10, 18, 15, 30);   // 18/11/2026, quarta
  const dias = R.semana(quarta);
  assert.equal(dias.length, 7);
  igual(dias.map(d => [d.getDate(), d.getDay(), d.getHours()]), [[16, 1, 0], [17, 2, 0], [18, 3, 0], [19, 4, 0], [20, 5, 0], [21, 6, 0], [22, 0, 0]]);
  assert.equal(R.semana(new Date(2026, 10, 22, 23, 0))[0].getDate(), 16, "domingo ainda é da semana que começou na segunda");
  assert.equal(R.semana(new Date(2026, 10, 23, 0, 1))[0].getDate(), 23, "segunda começa outra");
  assert.equal(R.semana(quarta, 1)[0].getDate(), 23, "a próxima semana");
  assert.equal(R.semana(quarta, -1)[0].getDate(), 9, "a anterior");
  assert.equal(R.epoch(dias[0]), Math.floor(new Date(2026, 10, 16).getTime() / 1000));
  assert.equal(R.mesmoDia(new Date(2026, 10, 18, 0, 0), R.data(Math.floor(new Date(2026, 10, 18, 23, 59).getTime() / 1000))), true);
  // as reuniões de um dia, por início
  const s = d => Math.floor(d.getTime() / 1000);
  const rs = [{ id: 2, inicio: s(new Date(2026, 10, 18, 15)) }, { id: 1, inicio: s(new Date(2026, 10, 18, 9)) }, { id: 3, inicio: s(new Date(2026, 10, 19, 9)) }];
  igual(R.doDia(rs, dias[2]).map(r => r.id), [1, 2]);
  igual(R.doDia(rs, dias[0]), []);
}

// ---- "começa em 5 min" na tela: de 0 a aviso_min, uma vez por reunião (e de novo se o horário mudar)
{
  const agora = Date.UTC(2026, 10, 18, 13, 0) / 1000;
  const em = min => agora + min * 60;
  const rs = [{ id: 1, inicio: em(4) }, { id: 2, inicio: em(6) }, { id: 3, inicio: em(-1) }, { id: 4, inicio: em(5) }, { id: 5, inicio: "x" }, { id: 6, inicio: em(0) }];
  const avisadas = new Set();
  igual(R.emBreve(rs, agora, avisadas, 5).map(r => r.id), [6, 1, 4], "em ordem de início");
  for (const r of R.emBreve(rs, agora, avisadas, 5)) avisadas.add(R.chaveAviso(r));
  igual(R.emBreve(rs, agora, avisadas, 5).map(r => r.id), [], "uma vez só");
  igual(R.emBreve([{ id: 1, inicio: em(3) }], agora, avisadas, 5).map(r => r.id), [1], "mudou o horário: avisa de novo");
  igual(R.emBreve([{ id: 7, inicio: em(9) }], agora, avisadas, 10).map(r => r.id), [7], "o aviso_min do config");
  igual(R.emBreve(null, agora, avisadas, 5), []);
  assert.equal(R.textoEmBreve({ titulo: "Planejamento", sala: "reuniao", inicio: em(4) }, agora), "Planejamento começa em 4 min, na Sala de reunião.");
  assert.equal(R.textoEmBreve({ titulo: "Planejamento", sala: "reuniao", inicio: em(0) }, agora), "Planejamento começa agora, na Sala de reunião.");
  assert.equal(R.textoEmBreve({ titulo: "Daily", sala: "time:Design", inicio: em(1) }, agora), "Daily começa em 1 min, na Design.");
}

// ---- a hora e a duração na tela
{
  assert.equal(R.duracaoTexto(30), "30 min");
  assert.equal(R.duracaoTexto(60), "1 h");
  assert.equal(R.duracaoTexto(90), "1 h 30 min");
  const ini = Math.floor(new Date(2026, 10, 18, 9, 5).getTime() / 1000);
  assert.equal(R.faixa({ inicio: ini, fim: ini + 50 * 60 }), "09:05 – 09:55");
  assert.equal(R.faixa({ inicio: "x", fim: 1 }), "");
  assert.equal(R.urlIcs(12), "api/reunioes/ics?id=12");
}

// ---- o formulário, com os limites do config.equipe.reunioes, antes de ir ao servidor
{
  const LIM = { duracao_min: 5, duracao_max: 480, titulo_max: 80, convidados_max: 50 };
  const agora = new Date(2026, 10, 18, 10, 0).getTime();
  const ok = R.validarReuniao({ titulo: " Planejamento ", sala: "reuniao", dia: "2026-11-18", hora: "14:30", duracao: "45", convidados: ["bia"] }, agora, LIM);
  assert.equal(ok.problema, null);
  igual(ok.corpo, { titulo: "Planejamento", sala: "reuniao", inicio: Math.floor(new Date(2026, 10, 18, 14, 30).getTime() / 1000), duracao: 45, convidados: ["bia"] });
  const v = c => R.validarReuniao({ titulo: "a", sala: "reuniao", dia: "2026-11-18", hora: "14:30", duracao: "45", convidados: [], ...c }, agora, LIM).problema;
  assert.match(v({ titulo: " " }), /título/);
  assert.match(v({ titulo: "x".repeat(81) }), /80/);
  assert.match(v({ sala: "" }), /sala/);
  assert.match(v({ dia: "" }), /dia/);
  assert.match(v({ hora: "25:00" }), /hora/);
  assert.match(v({ hora: "09:58" }), /passou/);
  assert.equal(v({ hora: "10:00" }), null, "agora mesmo vale (o servidor tolera 60 s)");
  assert.match(v({ dia: "2027-11-19" }), /1 ano/);
  assert.match(v({ duracao: "4" }), /5 a 480/);
  assert.match(v({ duracao: "481" }), /5 a 480/);
  assert.match(v({ duracao: "x" }), /5 a 480/);
  assert.match(v({ convidados: Array.from({ length: 51 }, (_, i) => `p${i}`) }), /50/);
}
console.log("test_reunioes.js ok");
