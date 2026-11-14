// Vida dos agentes: vão para a mesa quando têm tarefa, saem para a sala comunal quando ficam livres,
// visitam colegas, fazem roda de café, jogam, sentam de verdade, brincam com o gato e conversam por
// balões. Nenhum nome real no código: todas as frases ficam em FRASES (troque ali no white-label).
// Este arquivo só decide comportamento e pose (b.pose, b.olha, b.chave); quem desenha é o avatar.js.
"use strict";

const Vida = (() => {
  const VEL = 40;                 // px do mapa por segundo
  const GRADE = 4;                // célula da grade de caminhos dentro das salas
  const FRASES = {
    atividade: {
      videogame: ["Bora mais uma partida?", "GG!", "Essa fase é impossível", "Passa o controle!", "Recorde novo!"],
      tv: ["Esse episódio é top", "Não dá spoiler!", "Alguém viu o jogo ontem?", "Muda de canal?"],
      arcade: ["Só mais uma ficha", "Combo!", "Quase bati o recorde", "Esse fliperama é raiz"],
      sinuca: ["Na caçapa!", "Bola sete no canto", "Errei feio", "Sua vez"],
      cafe: ["Café tá pronto ☕", "Mais um café?", "Hoje o dia rende", "Cheirinho de café"],
      poltrona: ["Pausa merecida", "Lendo a documentação…", "Só descansando os circuitos"],
      pufe: ["Que pufe confortável", "Pensando na próxima ideia"],
      papo: ["E aí, como foi o deploy?", "Viu o post novo?", "Bora revisar aquele PR?", "Tudo tranquilo por aí?"],
      recepcao: ["Esperando a próxima tarefa", "Alguém precisa de ajuda?"],
      reuniao: ["Alinhando a sprint", "Próximo item da pauta", "Quem anota a ata?", "Fechado, vamos nessa"],
      cozinha: ["Quem deixou a pizza aqui?", "Esquentando o almoço", "Tem bolo!"],
      lanche: ["Hora do lanche", "Esse café tá forte", "Pausa rápida"],
      pebolim: ["Gol!", "Defende essa!", "Revanche?"],
      pingpong: ["Saque!", "Na quina!", "Ponto meu"],
      musica: ["Tocando um lo-fi", "Bora uma jam?", "Essa é das antigas"],
      pc: ["Só uma partida rapidinha", "Testando a build nova", "GG WP"],
      roda: ["Pausa pro café ☕", "Alguém quer açúcar?", "Esse café salva o dia", "E o fim de semana?", "Bora que hoje rende"],
      gato: ["Psiu, gatinho!", "Quem é o gato mais lindo?", "Ele dormiu de novo", "Miau? 🐱"],
    },
    respostas: ["Haha, verdade", "Bora!", "Depois te conto", "Tô dentro", "Boa!", "Nem me fala", "Com certeza"],
    dialogos: [
      ["E aí, como tá o sprint?", "Puxado, mas sai!"], ["Viu o deploy de ontem?", "Vi! Zero erro, milagre"], ["Esse café tá ótimo", "É o grão novo"],
      ["Bora revisar aquele PR?", "Depois do café, fechado"], ["Que chuva, hein?", "Bom pra ficar no código"], ["Alguém viu meu teclado?", "Tá embaixo dos papéis"],
      ["Terminei a pauta", "Manda pro time revisar"], ["O cliente aprovou!", "Bora comemorar!"], ["Testou no celular?", "Testei, ficou lindo"],
      ["Qual o plano pra hoje?", "Fechar a fila de aprovações"], ["Ouvi falar em pizza", "Sexta tem!"], ["Essa música é boa", "Playlist de foco"],
    ],
    convites: { sinuca: "Bora uma sinuca?", pebolim: "Pebolim? Valendo café!", pingpong: "Topa um pingue-pongue?", videogame: "Pega o outro controle!",
      reuniao: "Bora alinhar rapidinho?", roda: "Pausa pro café?", padrao: "Bora um café?" },
    jogo: { ganhou: ["Ganhei!", "Isso!", "Que jogada!"], perdeu: ["Revanche!", "Quase…", "Sorte sua"] },
    daily: ["Ontem fechei a pauta", "Hoje vou revisar os PRs", "Sem bloqueios por aqui", "Preciso de ajuda com o deploy", "Bora que a sprint acaba sexta"],
    reuniaoDados: [["Vamos alinhar isso", "Fechado"], ["Te mandei o resumo", "Já tô lendo"], ["Faz sentido pra você?", "Faz, segue assim"], ["Próximo ponto", "Anotado"]],
    visita: { chega: ["Tem um minuto?", "Dá uma olhada nisso", "Posso te mostrar uma coisa?"], responde: ["Claro, manda", "Deixa eu ver…", "Boa ideia!"],
      tchau: ["Valeu!", "Fechado então", "Te mando depois"] },
    // balões genéricos de quem trabalha, pela função do agente (nunca o conteúdo das mensagens)
    trabalho: {
      dev: ["Compilando…", "Rodando os testes…", "Quase lá", "Refatorando…"], qa: ["Revisando…", "Achei um detalhe", "Testando de novo…"],
      conteudo: ["Escrevendo…", "Ajustando o texto…", "Ficou bom!"], infra: ["Olhando os logs…", "Tudo verde", "Subindo o serviço…"],
      dados: ["Cruzando os dados…", "Hmm, interessante", "Gráfico pronto"], gestao: ["Organizando a fila…", "Alinhando o time…", "Priorizando…"],
      geral: ["Trabalhando nisso…", "Quase lá", "Hmm, interessante"],
    },
    estado: { aprovacao: "Preciso do seu OK!", pergunta: "Tenho uma pergunta pra você", aindaAprovacao: "Ainda esperando seu OK…",
      aindaPergunta: "Preciso de uma resposta sua", partiu: "Partiu trabalhar!", pronto: "Pronto! ✔" },
    // quando você aprova ou responde e o agente volta a trabalhar
    obrigado: ["Obrigado, chefe!", "Valeu! Seguindo…", "Opa, liberado! Obrigado!"], aplauso: ["Isso aí!", "👏👏", "Boa, chefe!"],
    parabens: ["Boa!", "Mandou bem!", "Arrasou!", "👏👏"],
    chegada: ["Bom dia, time!", "Cheguei!", "Bom dia!"],
    saida: ["Até amanhã, time!", "Fui, até amanhã!"],
    robo: ["Opa, robozinho!", "Valeu pela faxina"],
    recorde: ["Recorde novo!", "Bati meu recorde!"],
    // brincadeiras: campeonato com placar e torcida, piada na roda, high-five, música, papel, dardos e basquete
    campeao: { padrao: ["Campeão!", "É campeão!", "Levei essa!"], xadrez: ["Xeque-mate!", "Mate em três!"] },
    revanche: ["Quero revanche!", "Semana que vem eu ganho", "Foi sorte…", "Melhor de cinco?"],
    torcida: { chega: ["Quem tá ganhando?", "Vim torcer!", "Partida boa essa"], ponto: ["Uhuul!", "Que jogada!", "Vai, vai!", "Boa!"],
      final: ["👏👏", "Que final!", "Campeão!"] },
    piadas: [["Por que o dev foi ao médico?", "Tava cheio de bugs 🐛"], ["Qual o café preferido do dev?", "O Java ☕"],
      ["Quantos devs pra trocar uma lâmpada?", "Nenhum, é problema de hardware"], ["Por que o teste ficou triste?", "Ninguém deu assert nele"],
      ["O que o servidor disse pro cliente?", "Tô sem cache pra isso"], ["Qual o animal preferido do dev?", "O pato de borracha 🦆"]],
    risadas: ["Hahaha", "kkkk", "Essa foi boa", "😂", "Ai, não…"],
    highfive: ["Toca aqui! ✋", "Boa, parceiro! ✋"], highfiveVolta: ["✋", "Opa! ✋"],
    karaoke: ["🎤 Lá-lá-lá…", "🎤 Essa eu sei!", "🎤 Agora todo mundo!", "🎵 Aumenta o som!"],
    danca: ["Uhuu!", "🎶", "Olha o passinho!", "Essa música é boa"],
    violao: ["🎸 Uma moda?", "🎸 Essa é das antigas", "🎸 Pede uma música!"], plateia: ["Toca mais uma!", "Que bonito", "Essa eu conheço!"],
    papel: { acerto: ["Cesta!", "No lixo, de primeira", "Três pontos!"], erro: ["Errei…", "Depois eu pego", "Quase"] },
    aviao: ["Lá vai o aviãozinho! ✈️", "Correio aéreo!"], aviaoVolta: ["Pousou!", "Haha, mandou bem"],
    guerra: ["Guerra de papel!", "Toma essa!", "Revida!", "Sextou!"],
    dardos: { acerto: ["Na mosca!", "Cinquenta!", "Bem no centro"], erro: ["Errei feio", "Quase na mosca", "Mais uma"] },
    basquete: { acerto: ["Cesta!", "Swish!", "Três pontos!"], erro: ["Bateu no aro", "Ihhh", "Agora vai"] },
    objeto: { aquario: ["Olha o peixinho!", "Alguém deu comida pros peixes?"], lousa: ["Quem desenhou isso?", "Bora rabiscar uma ideia"],
      quadro_avisos: ["Tem aviso novo?", "Já li esse aviso"], relogio: ["Já é hora do café?", "O dia tá voando"],
      luminaria: ["Agora sim, iluminou", "Clima de foco"], planta: ["Alguém regou a planta?", "Que planta bonita"],
      sino: ["Venda fechada!", "Bateu a meta!", "🔔 Bora comemorar!"] },
    // vida social (o servidor decide quem e quando; aqui só o "como"). Sem nome no balão, sem xingamento, humor de escritório
    social: {
      desafio: ["Pro ringue, agora!", "Isso vai ter volta!", "Vem resolver no ringue!"],
      chega: ["Briga no ringue!", "Vai começar!", "Separa! Separa!", "Alguém chama o RH!"],
      luta: ["Separa! Separa!", "Alguém chama o RH!", "Uuuh!", "Que confusão!", "Isso é hora?"],
      vitoria: ["Venci!", "Campeão do ringue!", "Ninguém mexe no meu grampeador!"],
      final: ["É campeão!", "👏👏", "Que luta!"],
      tonto: ["Vi estrelinhas…", "Onde eu tô?", "Revanche na sexta!"],
      trabalho: "Opa, chegou trabalho!",
      cafe: [["Bora um café?", "Bora!"], ["Pausa pro café?", "Só se for agora"]],
      papo: [["E aí, tudo certo?", "Tudo ótimo!"], ["Viu o post novo?", "Vi, ficou top"], ["Bom te ver!", "Igualmente!"]],
      esbarrao: [["Opa, foi mal!", "Olha o café!"], ["Ei, cuidado!", "Desculpa, desculpa!"]],
      grampeador: [["Quem pegou meu grampeador?!", "Não fui eu!"], ["Cadê meu grampeador?", "Nem sei do que você tá falando"]],
      pazes: [["Foi mal pelo ringue", "Tranquilo. Café?"], ["Sem ressentimentos?", "Que nada, toca aqui ✋"]],
      // fatia 2: reclamação, sugestão e fofoca (balões), greve (plaquinhas curtas, em maiúsculas) e os gritos dela
      reclamacao: ["O ar-condicionado tá um gelo!", "Quem mexeu no termostato?", "A impressora travou de novo…", "Acabou o café. DE NOVO.",
        "Esse Wi-Fi tá de brincadeira", "Essa reunião podia ser um e-mail…", "Cadê a caneta que funciona?", "Tá calor ou é impressão minha?",
        "Quem deixou a louça na pia?", "Minha cadeira range a cada clique"],
      sugestao: ["E se a gente tivesse pufe novo?", "Proposta: sexta do bolo!", "Bora um happy hour?", "Que tal uma playlist do time?",
        "Ideia: planta em toda mesa", "Sugiro café especial na copa", "Podia ter mais tomada aqui", "Campeonato de dardos, quem topa?"],
      fofoca: [["Psiu… cê viu aquilo?", "Não acredito!"], ["Psiu… fiquei sabendo de uma…", "Conta tudo!"], ["Psiu… mas não espalha, hein", "Sou um túmulo"],
        ["Psiu… adivinha quem chegou atrasado", "Sério?!"], ["Psiu… o bolo de sexta é surpresa", "Boca de siri!"]],
      greve: ["MAIS CAFÉ", "SEXTA LIVRE", "PUFE JÁ!", "WI-FI DIGNO", "MENOS REUNIÃO", "BOLO NA SEXTA", "ABAIXO O BUG", "QUEREMOS PIZZA", "SONECA LIVRE", "AR NO 23"],
      grito: ["Queremos café!", "Sem café, sem código!", "Greve! Greve!", "A luta continua!", "Ô, ô, ô, mais pufe pro escritório!", "Daqui ninguém levanta!"],
      greveFim: ["Por hoje chega…", "Amanhã tem mais", "Cansei, vou pra mesa"],
      atendida: ["Obrigado, chefe!", "Conquista histórica!", "Valeu, chefe!", "Vitória do escritório!"],
      // a entrega do pedido: o entregador anuncia e a turma reage conforme o item
      entrega: { chegou: ["Entrega pro escritório!", "Chegou o pedido!"], cafe: ["Café novo!", "Cheirinho de café!"],
        pizza: ["Pizza!!", "Eu fico com a de calabresa"], ar: ["Ahh, agora sim", "23 graus, que paz"], faixa: ["Eeee!", "Vitória!"],
        pufe: ["Pufe novo!", "Que macio!"], roteador: ["Wi-Fi voando!", "Agora sim, 5 barrinhas"], bolo: ["Bolo!", "Quem corta?"],
        travesseiro: ["Zzz…", "Só 5 minutinhos"] },
    },
    // Jornal do escritório (jornal.js): {nome}, {qtd} e {lista} são trocados na hora; de cada lista sai uma frase fixa por semana
    jornal: {
      nome: "Gazeta do Escritório",
      manchete: ["Destaque da semana: {nome}, com {qtd}", "{nome} é o destaque da semana: {qtd}", "Ninguém segurou {nome}: {qtd} na semana"],
      calma: ["Semana tranquila: nenhuma tarefa terminada até agora", "Redação em silêncio: ainda sem tarefa terminada"],
      atras: "Logo atrás: {lista}.",
      aprovacoes: ["Quem mais pediu a sua aprovação", "{nome}, com {qtd}"],
      respostas: ["Quem mais fez perguntas", "{nome}, com {qtd}"],
      minutos: ["Mais tempo trabalhando", "{nome}, cerca de {qtd}"],
      ringue: ["Campeão do ringue", "{nome}, com {qtd}"],
      chuva: ["Semana de chuva", "{qtd} com chuva, garoa ou tempestade. Guarda-chuva na porta!"],
      sol: ["Semana de sol", "{qtd} de céu limpo. Teve gente almoçando lá fora."],
      neve: ["Neve no escritório", "{qtd} com neve. O café acabou cedo."],
      variado: ["Tempo variado", "Teve de tudo um pouco: {lista}."],
      agito: ["Agitação na sala comunal", "{lista} na semana."],
      paz: ["Semana em paz", "Nenhuma greve e nenhuma briga."],
    },
  };
  // função do agente (texto livre do agentes.chat) -> grupo de balões de trabalho
  const PAPEIS = [[/qa|revis|teste|complian|lgpd/i, "qa"], [/dev|c[oó]dig|full|front|back|tech|arquitet|program/i, "dev"],
    [/conte[uú]do|rede|social|marketing|copy|comunidade/i, "conteudo"], [/infra|noc|ops|servidor|deploy/i, "infra"],
    [/dado|seo|estrat|an[aá]lis/i, "dados"], [/chefe|orquestr|gest|gerent|gabinete|coorden/i, "gestao"]];
  // material do piso de cada sala (índice "piso" do times.json), para o som dos passos
  const MATERIAL = ["ladrilho", "madeira", "carpete", "carpete", "ladrilho", "carpete", "ladrilho", "carpete", "concreto", "madeira"];

  // Peso de cada atividade: jogos e conversa atraem mais que a recepção
  const PESO = { videogame: 3, arcade: 3, sinuca: 3, pebolim: 3, pingpong: 3, pc: 3, musica: 2, cafe: 2.5, lanche: 2.5, papo: 2.5, tv: 2, reuniao: 1, poltrona: 1.2, pufe: 1.2, cozinha: 1.5, recepcao: 0.4,
    xadrez: 2.5, dardos: 2.5, basquete: 2.5 };
  const EM_DUPLA = new Set(["sinuca", "pebolim", "pingpong", "cafe", "lanche", "papo", "videogame", "reuniao", "xadrez", "dardos", "basquete"]);
  const JOGOS = new Set(["sinuca", "pebolim", "pingpong", "videogame", "xadrez", "dardos", "basquete"]);   // em dupla: placar até 3
  const ARREMESSO = new Set(["dardos", "basquete"]);   // jogo de mira: cada vez é um arremesso, que acerta ou erra
  const PLACAR = 3;
  const SENTA = new Set(["tv", "poltrona", "pufe", "recepcao", "reuniao", "lanche", "videogame"]);
  const OLHA = { arcade: "cima", pc: "cima", videogame: "cima", musica: "cima", cozinha: "cima", cafe: "cima" };
  const POSE = { videogame: "jogando", arcade: "fliperama", pc: "fliperama", pingpong: "raquete", sinuca: "taco", pebolim: "pebolim",
    musica: "tocando", cafe: "cafe", lanche: "cafe", roda: "cafe", gato: "carinho", greve: "sentado_chao" };
  const VIZ = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  // expediente.js traz o horário do Personalizar (inclusive o turno que vira a meia-noite); sem ele, 07:00-20:00
  const foraDoExpediente = (h = Ceu.agora().h) => window.Expediente ? Expediente.fora(h) : h >= 20 || h < 7;
  const sorteia = lista => lista[Math.floor(Math.random() * lista.length)];
  const entre = (a, b) => a + Math.random() * (b - a);
  const esperando = b => !!b.trabalho && /^waiting/.test(b.trabalho.status);
  const trabalhando = b => !!b.trabalho && !esperando(b);
  const rumo = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "esq" : "dir") : (dy < 0 ? "cima" : "baixo"));

  function criarMundo(predio) {
    const vagas = predio.vagas.map(v => ({ ...v, ocupante: null }));
    const m = { predio, vagas, bonecos: new Map(), lista: [], grades: new Map(), eventos: [], roda: null,
      proxPapo: 4, proxTrabalho: 10, proxJogo: 0, proxVisita: entre(12, 25), proxRoda: entre(40, 80), proxGato: entre(30, 60), proxRobo: 1, proxPasso: 0,
      proxToca: 0.4, proxMusica: 2, proxViolao: entre(30, 60), proxPapel: entre(20, 40), proxAviao: entre(40, 80), proxGuerra: 8,
      cena: null, cenaSocial: null, vistos: new Set() };   // vida social: a cena desta tela, o que o efeitos.js desenha e os eventos já encenados
    for (const v of vagas) {   // a mesa de xadrez vem do mapa com duas vagas de papo: aqui viram partida (a cópia é da vida.js)
      if (v.tipo === "papo" && movelPerto(predio, v, /^mesa_xadrez/, 40)) v.tipo = "xadrez";
      if (v.tipo === "musica") v.jukebox = !!movelPerto(predio, v, /^jukebox/, 48);
    }
    for (const v of vagas) prepararVaga(m, v);
    for (const v of vagas) if (["recepcao", "reuniao", "lounge", "cozinha"].includes(v.sala.tipo)) v.fechada = !alcanca(m, v);
    return m;
  }

  // móvel com esse nome a até "raio" px do ponto (distância até a borda do retângulo)
  function movelPerto(predio, p, nome, raio) {
    for (const ob of predio.objetos) {
      if (!ob.nome || !nome.test(ob.nome)) continue;
      const dx = Math.max(ob.x - p.x, 0, p.x - (ob.x + ob.w)), dy = Math.max(ob.y - p.y, 0, p.y - (ob.y + ob.h));
      if (Math.hypot(dx, dy) <= raio) return ob;
    }
    return null;
  }

  // assento, direção do olhar e ordem de desenho de cada vaga, a partir do móvel que fica embaixo dela
  function prepararVaga(m, v) {
    let o = null;
    for (const ob of m.predio.objetos) {
      if (!ob.nome || ob.chave < 0 || v.x < ob.x || v.x > ob.x + ob.w || v.y < ob.y || v.y > ob.y + ob.h + 2) continue;
      if (!o || ob.w * ob.h < o.w * o.h) o = ob;
    }
    // senta só com um assento embaixo (a mesa de reunião e a da cozinha já trazem as cadeiras no desenho)
    v.senta = !!o && ((SENTA.has(v.tipo) || v.tipo === "papo") && /sofa|poltrona|pufe|banco|cadeira/.test(o.nome) || v.tipo === "reuniao" || v.tipo === "lanche");
    v.chave = v.senta && o ? o.chave + 0.2 : v.y + 0.5;   // sentado fica na frente (em cima) do próprio móvel
    if (!v.olha) {
      const irmas = m.vagas.filter(o2 => o2 !== v && o2.tipo === v.tipo && o2.sala === v.sala && Math.hypot(o2.x - v.x, o2.y - v.y) < 120);
      if (OLHA[v.tipo]) v.olha = OLHA[v.tipo];
      else if (v.senta || !irmas.length) v.olha = "baixo";
      else v.olha = rumo(irmas.reduce((t, o2) => t + o2.x, 0) / irmas.length - v.x, irmas.reduce((t, o2) => t + o2.y, 0) / irmas.length - v.y);
    }
  }

  // --- caminhos -------------------------------------------------------------------------
  // dentro das salas: busca em largura numa grade de 4 px sobre o chão livre (predio.livre)
  function grade(m, s) {
    let g = m.grades.get(s);
    if (g) return g;
    const y0 = s.chao, cols = Math.ceil(s.pw / GRADE), lins = Math.ceil((s.py + s.ph - y0) / GRADE), n = cols * lins;
    const livre = new Uint8Array(n), ok = m.predio.livre || (() => true);
    for (let j = 0; j < lins; j++) for (let i = 0; i < cols; i++) { // a célula inteira (centro e cantos) fora dos móveis
      const x = s.px + i * GRADE, y = y0 + j * GRADE;
      livre[j * cols + i] = ok(x + 2, y + 2) && ok(x, y) && ok(x + GRADE, y) && ok(x, y + GRADE) && ok(x + GRADE, y + GRADE) ? 1 : 0;
    }
    g = { x0: s.px, y0, cols, lins, livre, de: new Int32Array(n), fila: new Int32Array(n) };
    m.grades.set(s, g);
    return g;
  }

  function rotaNaSala(m, s, a, b) {
    const g = grade(m, s), { cols, lins } = g;
    const ci = x => Math.max(0, Math.min(cols - 1, Math.floor((x - g.x0) / GRADE))), cj = y => Math.max(0, Math.min(lins - 1, Math.floor((y - g.y0) / GRADE)));
    const ai = ci(a[0]), aj = cj(a[1]), bi = ci(b[0]), bj = cj(b[1]);
    // perto da saída ou do destino pode passar "dentro" do móvel: é onde o agente senta
    const passa = (i, j) => i >= 0 && j >= 0 && i < cols && j < lins && (g.livre[j * cols + i] === 1 || (i - ai) ** 2 + (j - aj) ** 2 <= 16 || (i - bi) ** 2 + (j - bj) ** 2 <= 16);
    g.de.fill(-1);
    const ini = aj * cols + ai, fim = bj * cols + bi;
    let cab = 0, cauda = 0;
    g.fila[cauda++] = ini; g.de[ini] = ini;
    while (cab < cauda && g.de[fim] < 0) {
      const c = g.fila[cab++], i = c % cols, j = (c - i) / cols;
      for (const [di, dj] of VIZ) {
        const ni = i + di, nj = j + dj;
        if (!passa(ni, nj) || (di && dj && (!passa(i + di, j) || !passa(i, j + dj)))) continue;   // diagonal sem cortar quina
        const k = nj * cols + ni;
        if (g.de[k] < 0) { g.de[k] = c; g.fila[cauda++] = k; }
      }
    }
    if (g.de[fim] < 0) return null;
    const celulas = [];
    for (let c = fim; c !== ini; c = g.de[c]) celulas.push(c);
    celulas.reverse();
    const ponto = c => [g.x0 + (c % cols) * GRADE + GRADE / 2, g.y0 + Math.floor(c / cols) * GRADE + GRADE / 2];
    const vista = (p, q) => { // linha reta entre p e q só por células que passam
      const passos = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2);
      for (let k = 1; k < passos; k++) { const x = p[0] + ((q[0] - p[0]) * k) / passos, y = p[1] + ((q[1] - p[1]) * k) / passos; if (!passa(ci(x), cj(y))) return false; }
      return true;
    };
    const rota = [];
    let atual = a;
    for (let k = 0; k < celulas.length;) { // corta caminho onde a linha reta é livre (andar natural, sem escadinha)
      let longe = k;
      while (longe + 1 < celulas.length && vista(atual, ponto(celulas[longe + 1]))) longe++;
      atual = ponto(celulas[longe]); rota.push(atual); k = longe + 1;
    }
    rota.push([b[0], b[1]]);
    return rota;
  }

  function entradas(m, s) { // ponto logo dentro de cada porta e o trecho até o corredor
    const cy = m.predio.corredorY;
    if (s.portas) return s.portas.map(px => ({ dentro: [px, s.chao + 8], fora: [[px, cy]] }));
    return [{ dentro: [s.porta.x, s.py + s.ph - 8], fora: [[s.porta.x, s.py + s.ph + 6], [s.porta.x, cy]] }];
  }
  const portaPerto = (m, s, x) => entradas(m, s).reduce((a, b) => (Math.abs(b.dentro[0] - x) < Math.abs(a.dentro[0] - x) ? b : a));

  function alcanca(m, v) { const e = portaPerto(m, v.sala, v.x); return !!rotaNaSala(m, v.sala, e.dentro, [v.x, v.y]); }

  function saidaMesa(m, k) {
    const s = k.sala;
    if (s.porta.emCima) // sala de time na fileira de baixo: a porta fica na parede de cima
      return [[k.saida, k.pe], [k.saida, k.corredor], [s.faixaX, k.corredor], [s.faixaX, s.chao + 8], [s.porta.x, s.chao + 8], [s.porta.x, m.predio.corredorY]];
    return [[k.saida, k.pe], [k.saida, k.corredor], [s.faixaX, k.corredor], [s.faixaX, s.py + s.ph - 6], [s.porta.x, s.py + s.ph + 6], [s.porta.x, m.predio.corredorY]];
  }

  function rotaRua(m) { // da ponta do corredor até sumir na calçada, à esquerda
    const p = m.predio, e = p.entrada;
    return [[e.x, p.corredorY], [e.x - 22, p.corredorY], [e.x - 22, e.calcadaY], [-24, e.calcadaY]];
  }

  const pontoDe = l => (l.tipo === "mesa" ? [l.mesa.x, l.mesa.pe] : [l.vaga.x, l.vaga.y]);
  const mesaDe = l => (l.tipo === "mesa" ? l.mesa : l.vaga && l.vaga.mesa) || null;

  function sair(m, l) { // do lugar até o corredor
    const k = mesaDe(l);
    if (k) return saidaMesa(m, k);
    const p = pontoDe(l), e = portaPerto(m, l.vaga.sala, p[0]);
    return [...(rotaNaSala(m, l.vaga.sala, p, e.dentro) || [e.dentro]), ...e.fora];
  }

  function entrar(m, l) { // do corredor até o lugar
    const k = mesaDe(l), p = pontoDe(l);
    if (k) return [...saidaMesa(m, k).reverse(), p];
    const e = portaPerto(m, l.vaga.sala, p[0]);
    return [...[...e.fora].reverse(), e.dentro, ...(rotaNaSala(m, l.vaga.sala, e.dentro, p) || [p])];
  }

  function caminho(m, de, para) {
    const k = de && de.tipo !== "fora" && mesaDe(de);
    if (k && para.tipo !== "fora" && mesaDe(para) === k) return [[k.saida, k.pe], pontoDe(para)];   // ali do lado da própria mesa
    if (de && de.tipo !== "fora" && para.tipo !== "fora" && !mesaDe(de) && !mesaDe(para) && de.vaga.sala === para.vaga.sala) {
      const r = rotaNaSala(m, de.vaga.sala, pontoDe(de), pontoDe(para));
      if (r) return r;
    }
    const ida = !de ? [] : de.tipo === "fora" ? rotaRua(m).reverse().slice(1) : sair(m, de);
    return para.tipo === "fora" ? [...ida, ...rotaRua(m)] : [...ida, ...entrar(m, para)];
  }

  // --- estado vindo do agentes.chat ------------------------------------------------------
  function sincronizar(m, agentes, trabalhos, mesasPorHandle, aparencia, primeira) {
    const vistos = new Set(), agora = performance.now() / 1000;
    for (const ag of agentes) {
      vistos.add(ag.id);
      const t = trabalhos.find(x => x.agente_id === ag.id) || null;
      let b = m.bonecos.get(ag.id);
      const mesa = mesasPorHandle.get(ag.handle) || null;
      if (!b) {
        b = { id: ag.id, handle: ag.handle, nome: ag.nome, funcao: ag.funcao, ap: aparencia(ag.handle), mesa, rota: [], lugar: null, fala: null, ate: 0, status: null,
          pose: "parado", olha: "baixo", chave: 0, festa: 0, aceno: 0, passos: 0, semente: [...ag.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 997 };
        m.bonecos.set(ag.id, b);
        if (t && mesa) colocar(b, { tipo: "mesa", mesa });
        else if (foraDoExpediente()) colocar(b, { tipo: "fora" });
        else { const v = vagaLivre(m, b); colocar(b, v ? { tipo: "vaga", vaga: v } : mesa ? { tipo: "mesa", mesa } : { tipo: "fora" }); }
      }
      b.nome = ag.nome; b.funcao = ag.funcao; b.mesa = mesa || b.mesa; b.ap = aparencia(ag.handle);
      b.papel = (PAPEIS.find(([re]) => re.test(ag.funcao || "")) || [0, "geral"])[1];
      const antes = b.status, depois = t ? t.status : null;
      b.trabalho = t;
      if (!primeira && antes !== depois) {
        if (depois === "waiting_approval") { falar(b, FRASES.estado.aprovacao, 6); m.eventos.push({ nome: "aprovacao" }); }
        else if (depois === "waiting_input") { falar(b, FRASES.estado.pergunta, 6); m.eventos.push({ nome: "pergunta" }); }
        else if (depois && !antes) falar(b, FRASES.estado.partiu, 3);
        else if (depois && /^waiting/.test(antes)) agradecer(m, b, agora);
        else if (!depois && antes) comemorar(m, b, agora);
      }
      b.status = depois;
    }
    for (const id of [...m.bonecos.keys()]) if (!vistos.has(id)) {
      const b = m.bonecos.get(id), d = b.destino && b.destino.vaga;
      soltarVaga(b); if (d && d.ocupante === b.id) d.ocupante = null;   // a reservada no destino também
      sairDaRoda(m, b); m.bonecos.delete(id);
    }
    m.lista = [...m.bonecos.values()];
    combinarReunioes(m);
  }

  // tarefa terminou: sai de trás da mesa (para aparecer), pula com confete (efeitos.js) e os colegas aplaudem
  function comemorar(m, b, agora) {
    falar(b, FRASES.estado.pronto, 4);
    m.eventos.push({ nome: "pronto" });
    const k = b.lugar && b.lugar.tipo === "mesa" && !b.rota.length && b.lugar.mesa;
    if (k) irPara(m, b, { tipo: "vaga", vaga: { sala: k.sala, x: k.saida, y: k.pe + 2, tipo: "festa", mesa: k, olha: "baixo", chave: k.topo + 18, temp: true } });
    else festejar(m, b, agora);
    for (const o of m.lista) if (o !== b && !o.rota.length && o.lugar && o.lugar.tipo !== "fora" && Math.hypot(o.x - b.x, o.y - b.y) < 130 && Math.random() < 0.7)
      o.responde = { em: agora + entre(0.5, 1.4), texto: sorteia(FRASES.parabens), aceno: true };
  }

  // você aprovou ou respondeu: o agente agradece acenando para a câmera e o colega mais perto aplaude
  function agradecer(m, b, agora) {
    falar(b, sorteia(FRASES.obrigado), 3.5); b.aceno = agora + 1.5;
    let perto = null, dist = 130;
    for (const o of m.lista) {
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (o !== b && d < dist && !esperando(o) && !o.rota.length && o.lugar && o.lugar.tipo !== "fora") { perto = o; dist = d; }   // quem espera você segue parado
    }
    if (perto) perto.responde = { em: agora + entre(0.7, 1.2), texto: sorteia(FRASES.aplauso), aceno: true, som: "aplauso" };
  }

  function festejar(m, b, agora) { b.confete = performance.now(); b.festa = agora + 2.6; m.eventos.push({ nome: "festa" }); }

  // conversa entre agentes nos dados ("Lendo a resposta de <nome>"): os dois vão para a reunião,
  // desde que quem trabalha não esteja esperando você e o outro esteja livre (ou na mesma conversa)
  function combinarReunioes(m) {
    const porNome = new Map(m.lista.map(b => [b.nome, b]));
    for (const b of m.lista) { const r = trabalhando(b) && /^Lendo a resposta de (.+)$/.exec(b.trabalho.rotulo || ""); b.conversaCom = r && porNome.get(r[1]) || null; }
    for (const b of m.lista) b.reuniao = null;
    for (const b of m.lista) {
      const p = b.conversaCom;
      if (!p || p === b || b.reuniao || p.reuniao) continue;
      const pOk = p.conversaCom === b || (!p.trabalho && !(foraDoExpediente() && p.lugar && p.lugar.tipo === "fora"));
      if (pOk && m.vagas.some(v => v.tipo === "reuniao" && !v.fechada)) { b.reuniao = p.id; p.reuniao = b.id; }
    }
  }

  function colocar(b, lugar) {
    soltarVaga(b);
    b.lugar = lugar; b.rota = [];
    if (lugar.tipo === "fora") { b.x = -24; b.y = 0; }
    else if (lugar.tipo === "mesa") { b.x = lugar.mesa.x; b.y = lugar.mesa.pe; }
    else { lugar.vaga.ocupante = b.id; b.x = lugar.vaga.x; b.y = lugar.vaga.y; }
    b.desde = performance.now() / 1000; b.fica = entre(25, 70);
  }

  function soltarVaga(b) { if (b && b.lugar && b.lugar.vaga && b.lugar.vaga.ocupante === b.id) b.lugar.vaga.ocupante = null; }

  // rotina do dia (horário real): daily, almoço e pausa do café puxam todo mundo que está livre; fora do expediente, nada
  function momento() {
    const h = Ceu.agora().h;
    if (foraDoExpediente(h)) return null;
    if (h >= 9.5 && h < 9.84) return { nome: "daily", tipos: { reuniao: 60 } };
    if (h >= 12 && h < 13) return { nome: "almoco", tipos: { lanche: 12, cozinha: 10, cafe: 4 } };
    if (h >= 15.5 && h < 15.84) return { nome: "cafe", tipos: { cafe: 14, lanche: 6, roda: 1 } };
    return null;
  }

  function vagaLivre(m, b, evitar) {
    const livres = m.vagas.filter(v => !v.ocupante && !v.fechada && v !== evitar);
    if (!livres.length) return null;
    const mo = m.mo !== undefined ? m.mo : momento();   // o passo já lê o momento uma vez por quadro
    let tot = 0; const pesos = livres.map(v => (tot += (mo && mo.tipos[v.tipo]) || PESO[v.tipo] || 1));
    const r = Math.random() * tot;
    return livres[pesos.findIndex(p => p >= r)];
  }

  // vaga irmã: mesma atividade, livre e perto (o parceiro do jogo ou da conversa)
  const BEBIDA = ["cafe", "lanche", "papo"];
  function vagaIrma(m, v) {
    const op = m.vagas.filter(o => o !== v && !o.ocupante && !o.fechada && o.sala === v.sala && (o.tipo === v.tipo || (BEBIDA.includes(v.tipo) && BEBIDA.includes(o.tipo))) && Math.hypot(o.x - v.x, o.y - v.y) < 130);
    return op.sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0] || null;
  }

  // quem está numa briga da vida social (lutador já chamado ou esperando o gongo, ou plateia) não é convidado para nada
  const livreParaConvite = (m, b, agora) => !b.trabalho && !b.reuniao && !b.grupo && !b.parceiro && !b.rota.length && b.lugar && b.lugar.tipo === "vaga"
    && !b.lugar.vaga.temp && agora - b.desde > 6 && !naCena(m, b);

  // chama um colega livre para a mesma atividade
  function chamarParceiro(m, b, v, agora) {
    if (!EM_DUPLA.has(v.tipo) || b.reuniao) return;
    const irma = vagaIrma(m, v); if (!irma) return;
    const cand = m.lista.filter(o => o !== b && livreParaConvite(m, o, agora));
    if (!cand.length || Math.random() < 0.25) return;
    const o = sorteia(cand);
    irPara(m, o, { tipo: "vaga", vaga: irma });
    b.parceiro = o.id; o.parceiro = b.id; b.vez = 0; o.vez = 1;
    falar(b, FRASES.convites[v.tipo] || FRASES.convites.padrao, 3); m.eventos.push({ nome: "conversa", voz: b.handle });
  }

  function irPara(m, b, para) {
    b.rota = caminho(m, b.lugar, para);
    soltarVaga(b);
    if (b.parceiro) { const o = m.bonecos.get(b.parceiro); if (o && o.parceiro === b.id) o.parceiro = null; b.parceiro = null; }
    if (b.grupo && para.vaga !== b.grupo.vagas.get(b.id)) sairDaRoda(m, b);
    if (!(para.vaga && para.vaga.tipo === "visita")) b.visita = null;
    b.violao = 0; b.placar = null;   // levantou: acabou a música e a partida
    if (para.vaga) para.vaga.ocupante = b.id; // reserva ao sair
    b.destino = para;
    b.lugar = null;
  }

  function falar(b, texto, seg) { b.fala = texto; b.ate = performance.now() / 1000 + (seg || 4); }

  // --- iniciativas: visita, roda de café, gato e robô --------------------------------------
  function visitar(m, agora) {
    const alvos = m.lista.filter(o => trabalhando(o) && !o.reuniao && !o.rota.length && o.lugar && o.lugar.tipo === "mesa" && !m.lista.some(x => x.visita === o.id));
    const quem = m.lista.filter(b => livreParaConvite(m, b, agora));
    if (!alvos.length || !quem.length) return;
    const b = sorteia(quem), o = sorteia(alvos), k = o.lugar.mesa;
    b.visita = o.id;
    irPara(m, b, { tipo: "vaga", vaga: { sala: k.sala, x: k.saida, y: k.pe, tipo: "visita", mesa: k, olha: "esq", chave: k.pe + 0.5, temp: true } });
  }

  // pontos de chão livre numa elipse em volta de (cx, cy), olhando para o centro (roda de café, torcida, plateia)
  function pontosEmVolta(m, s, cx, cy, rx, ry, tipo, longeDe) {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
      if (x > s.px + 6 && x < s.px + s.pw - 6 && y > s.chao + 6 && y < s.py + s.ph - 4 && (!m.predio.livre || m.predio.livre(x, y))
        && !(longeDe && longeDe.some(o => Math.hypot(o.x - x, o.y - y) < 16)))
        pts.push({ sala: s, x, y, tipo, olha: rumo(cx - x, cy - y), chave: y + 0.5, temp: true });
    }
    return pts;
  }

  function pontosDeRoda(m, centro, n) {
    const pts = pontosEmVolta(m, centro.sala, centro.x, centro.y + 20, 18 + n * 4, 13, "roda");
    const passo = pts.length / n;   // espalha em volta do centro
    return pts.length < n ? pts : Array.from({ length: n }, (_, i) => pts[Math.floor(i * passo)]);
  }

  // torcida (jogo em dupla) e plateia (violão): até "max" livres vêm assistir em volta e saem quando acaba
  function chamarPublico(m, dono, cx, cy, rx, ry, tipo, max, agora) {
    const cand = m.lista.filter(o => o !== dono && livreParaConvite(m, o, agora) && Math.hypot(o.x - cx, o.y - cy) < 600);
    if (!cand.length) return;
    const ocupadas = m.vagas.filter(v => v.ocupante && v.sala === dono.lugar.vaga.sala);
    const pts = pontosEmVolta(m, dono.lugar.vaga.sala, cx, cy, rx, ry, tipo, [...m.lista.filter(o => o.lugar && o.lugar.vaga && o.lugar.vaga.sala === dono.lugar.vaga.sala), ...ocupadas])
      .filter(v => alcanca(m, v)).sort(() => Math.random() - 0.5);
    cand.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(max, pts.length, cand.length); i++) { pts[i].dono = dono.id; irPara(m, cand[i], { tipo: "vaga", vaga: pts[i] }); }
  }

  // reação do público do dono: "ponto", "final" (aplaude, um som só) ou "chega"
  function reagirPublico(m, dono, tipo, agora) {
    let som = tipo === "final";
    for (const t of m.lista) {
      const v = t.lugar && t.lugar.vaga;
      if (!v || v.dono !== dono.id || t.rota.length || Math.random() > (tipo === "final" ? 0.9 : 0.5)) continue;
      t.responde = { em: agora + entre(0.3, 1.1), texto: sorteia(tipo === "final" && v.tipo === "plateia" ? FRASES.aplauso : FRASES.torcida[tipo]), aceno: true, som: som ? "aplauso" : undefined };
      som = false;
      if (tipo === "final") t.fica = agora - t.desde + entre(2.5, 4);   // aplaude e vai embora
    }
  }

  // devolve true se montou; senão o motivo (fica em m.rodaMotivo, para conferir) e quem chamou tenta de novo
  function montarRoda(m, agora, maximo) {
    if (m.roda) return true;
    // parados e quem está a caminho de uma vaga comum (esse termina o trecho e segue para a roda)
    const aCaminho = b => b.rota.length && b.destino && b.destino.vaga && !b.destino.vaga.temp;
    const quem = m.lista.filter(b => livreParaConvite(m, b, agora) || (m.mo && !b.trabalho && !b.grupo && !b.reuniao && !b.visita && !naCena(m, b)
      && ((!b.rota.length && b.lugar && b.lugar.tipo === "vaga") || aCaminho(b))));
    if (quem.length < 3) return (m.rodaMotivo = `só ${quem.length} livres`);
    // centro: o café da cozinha; se ali não couberem 3, o café da sala comunal
    const cafes = m.vagas.filter(v => v.tipo === "cafe" && !v.fechada).sort((a, b) => (b.sala.tipo === "cozinha") - (a.sala.tipo === "cozinha"));
    let pts = [];
    for (const centro of cafes) { pts = pontosDeRoda(m, centro, Math.min(quem.length, maximo)).filter(v => alcanca(m, v)); if (pts.length >= 3) break; }
    if (pts.length < 3) return (m.rodaMotivo = cafes.length ? `só ${pts.length} pontos livres em volta do café` : "sem vaga de café");
    quem.sort(() => Math.random() - 0.5);
    const roda = { membros: new Set(), vagas: new Map(), fim: agora + entre(25, 45), proxFala: 3, ultimo: null };
    m.roda = roda;
    pts.forEach((v, i) => {
      const b = quem[i]; roda.vagas.set(b.id, v);
      if (b.rota.length) { b.irRoda = v; v.ocupante = b.id; } else irPara(m, b, { tipo: "vaga", vaga: v });
      b.grupo = roda; roda.membros.add(b);
    });
    falar(quem.find(b => !b.rota.length) || quem[0], FRASES.convites.roda, 3); m.eventos.push({ nome: "conversa", voz: quem[0].handle });
    m.rodaMotivo = null;
    return true;
  }

  function sairDaRoda(m, b) {
    const r = b.grupo; if (!r) return;
    const v = r.vagas.get(b.id); if (b.irRoda === v && v && v.ocupante === b.id) v.ocupante = null;
    b.grupo = null; b.irRoda = null; r.membros.delete(b); r.vagas.delete(b.id);
    if (r.membros.size < 2) encerrarRoda(m, r);
  }

  function encerrarRoda(m, r) {
    const agora = performance.now() / 1000;
    for (const b of r.membros) {
      if (b.irRoda && b.irRoda.ocupante === b.id) b.irRoda.ocupante = null;   // ainda não tinha chegado
      b.irRoda = null; b.grupo = null; b.desde = agora; b.fica = entre(0.5, 5);
    }
    r.membros.clear();
    if (m.roda === r) m.roda = null;
  }

  function cuidarDaRoda(m, dt, agora) {
    const r = m.roda; if (!r) return;
    if (agora > r.fim) { encerrarRoda(m, r); return; }
    if ((r.proxFala -= dt) > 0) return;
    const chegados = [...r.membros].filter(b => !b.rota.length && b.lugar && b.lugar.vaga === r.vagas.get(b.id));
    if (chegados.length < 2) { r.proxFala = 0.5; return; }
    r.proxFala = entre(2.2, 3.6);
    const a = sorteia(chegados.filter(b => b !== r.ultimo)) || chegados[0];
    r.ultimo = a;
    const outro = sorteia(chegados.filter(b => b !== a)), r0 = Math.random();
    if (r0 < 0.15) {   // piada: pergunta, resposta e a roda inteira ri (uma risada só no som)
      const [p, q] = sorteia(FRASES.piadas);
      falar(a, p, 2.6); a.responde = { em: agora + 2.8, texto: q };
      let som = true;
      for (const o of chegados) if (o !== a) { o.responde = { em: agora + entre(4, 4.8), texto: sorteia(FRASES.risadas), som: som ? "risada" : undefined }; som = false; }
      r.proxFala = 7.5;
    } else if (r0 < 0.45) { const d = sorteia(FRASES.dialogos); falar(a, d[0], 2.6); outro.responde = { em: agora + 1.6, texto: d[1] }; }
    else falar(a, sorteia(Math.random() < 0.7 ? FRASES.atividade.roda : FRASES.respostas), 2.6);
    m.eventos.push({ nome: "conversa", voz: a.handle });
  }

  function verGato(m, agora) {
    const g = m.predio.animados.find(a => a.tipo === "gato"), quem = m.lista.filter(b => livreParaConvite(m, b, agora));
    if (!g || !quem.length || m.lista.some(b => b.lugar && b.lugar.vaga && b.lugar.vaga.tipo === "gato")) return;
    const s = [...m.predio.salas, ...m.predio.baixo].find(x => g.x >= x.px && g.x <= x.px + x.pw && g.y >= x.py && g.y <= x.py + x.ph);
    if (!s) return;
    const y = Math.min(g.y + g.h, s.py + s.ph - 6);
    for (const [x, olha] of [[g.x - 7, "dir"], [g.x + g.w + 7, "esq"]]) {
      const v = { sala: s, x: Math.round(x), y: Math.round(y), tipo: "gato", olha, chave: y + 0.5, temp: true };
      if ((!m.predio.livre || m.predio.livre(v.x, v.y)) && alcanca(m, v)) { irPara(m, sorteia(quem), { tipo: "vaga", vaga: v }); return; }
    }
  }

  function verRobo(m, agora) {
    const r = window.Efeitos && Efeitos.aspirador && Efeitos.aspirador();
    if (!r) return;
    for (const b of m.lista) if (!b.rota.length && !b.fala && b.lugar && b.lugar.tipo !== "fora" && Math.hypot(b.x - r.x, b.y - r.y) < 20 && agora > (b.proxRobo || 0)) {
      b.proxRobo = agora + 40; falar(b, sorteia(FRASES.robo), 3); b.aceno = agora + 1.5; m.eventos.push({ nome: "robo" });
    }
  }

  // --- passo de simulação ----------------------------------------------------------------
  function passo(m, dt) {
    const agora = performance.now() / 1000, ceu = Ceu.agora();
    m.fora = foraDoExpediente(ceu.h); m.noite = ceu.escuro; m.mo = momento();   // lidos uma vez por quadro
    for (const b of m.lista) {
      if (b.fala && agora > b.ate) b.fala = null;
      if (b.responde && agora >= b.responde.em) {
        if (!b.rota.length) {
          falar(b, b.responde.texto, 3); m.eventos.push({ nome: "conversa", voz: b.handle }); if (b.responde.aceno) b.aceno = agora + 1.2; if (b.responde.som) m.eventos.push({ nome: b.responde.som });
          const o = b.responde.lanca && m.bonecos.get(b.responde.lanca);   // guerra de papel: revida
          if (o && o.lugar && window.Efeitos && Efeitos.lancar) { b.arremesso = agora + 0.8; Efeitos.lancar(b.x, b.y - 16, o.x, o.y - 14, "papel"); m.eventos.push({ nome: "papel" }); }
        }
        b.responde = null;
      }
      if (b.rota.length) { andar(m, b, dt, agora); if (!b.rota.length) chegar(m, b, agora); }
      else if (b.lugar) decidir(m, b, dt, agora);
      posar(m, b, agora);
    }
    duplas(m, dt, agora);
    cuidarDaRoda(m, dt, agora);
    cuidarDaCena(m, dt, agora);
    cuidarDaEntrega(m, dt, agora);
    if (!m.fora) {
      if ((m.proxVisita -= dt) <= 0) { m.proxVisita = entre(25, 50); visitar(m, agora); }
      if ((m.proxGato -= dt) <= 0) { m.proxGato = entre(45, 90); verGato(m, agora); }
      const mo = m.mo;
      if (mo && mo.nome === "cafe" && !m.roda && !m.rodaDoCafe && m.proxRoda > 5) m.proxRoda = 0;   // começou a pausa: tenta já
      if ((m.proxRoda -= dt) <= 0) {
        const pausa = !!mo && mo.nome === "cafe", ok = montarRoda(m, agora, pausa ? 5 : 4) === true;
        m.proxRoda = ok ? entre(70, 140) : pausa ? 5 : entre(20, 40);   // na pausa do café, tenta de novo logo
        if (pausa && ok) m.rodaDoCafe = true;
      }
      if (!mo) m.rodaDoCafe = false;
    }
    if ((m.proxRobo -= dt) <= 0) { m.proxRobo = 1; verRobo(m, agora); }
    passoPessoas(m, dt, agora);
    jogosSozinho(m, dt);
    if (!m.fora) brincadeiras(m, dt, agora);
    papo(m, dt, agora);
    comentarTrabalho(m, dt);
  }

  // onde cada um quer estar agora: dados primeiro (reunião, mesa), depois o horário
  function alvoDe(m, b) {
    if (b.reuniao) return "reuniao";
    if (b.trabalho && b.mesa) return "mesa";
    return m.fora ? "fora" : "livre";
  }

  function decidir(m, b, dt, agora) {
    const alvo = alvoDe(m, b), l = b.lugar;
    if (alvo === "fora") {
      if (l.tipo !== "fora" && Math.random() < dt * 0.25) { falar(b, sorteia(FRASES.saida), 3); irPara(m, b, { tipo: "fora" }); }
      return;
    }
    if (alvo === "mesa") { if (l.tipo !== "mesa") irPara(m, b, { tipo: "mesa", mesa: b.mesa }); return; }
    if (alvo === "reuniao") { if (!(l.vaga && l.vaga.tipo === "reuniao") && agora > (b.espera || 0)) irReuniao(m, b, agora); return; }
    if (l.tipo === "fora") {
      if (Math.random() < dt * 0.2) { const v = vagaLivre(m, b); if (v) { irPara(m, b, { tipo: "vaga", vaga: v }); b.chegou = true; } }
      return;
    }
    // lutador de uma briga ainda não chamada: quem parou fica, até o outro parar e o gongo tocar (o trabalho real já passou acima)
    if (m.cena && m.cena.fase === "espera" && m.cena.lutadores.includes(b.id)) return;
    if (l.tipo === "mesa") { // comemora antes de levantar; sem vaga livre, tenta de novo daqui a pouco
      if (b.festa < agora && agora > (b.espera || 0)) { const v = vagaLivre(m, b); if (v) irPara(m, b, { tipo: "vaga", vaga: v }); else b.espera = agora + entre(3, 6); }
      return;
    }
    const v = l.vaga;
    if (b.emReuniao) { b.emReuniao = false; b.fica = 0; }
    if (v.tipo === "luta" || v.tipo === "ringue" || v.tipo === "greve") {   // vida social: fica enquanto a cena dura; depois, o lutador volta um tempo para a mesa
      if (cenaAtiva(m, v.dono)) return;
      if (v.tipo === "greve") { b.fica = Math.min(b.fica, agora - b.desde + entre(0.5, 2.5)); }   // a greve acabou: cada um levanta no seu tempo
      if (v.tipo === "luta" && b.mesa) { irPara(m, b, { tipo: "mesa", mesa: b.mesa }); b.espera = agora + entre(20, 35); return; }
      b.fica = Math.min(b.fica, agora - b.desde + (v.tipo === "ringue" ? entre(1, 3) : 0));   // a plateia aplaude e sai
    }
    if (v.tipo === "entrega") {   // a turma fica até a entrega acabar; depois, cada um volta para o seu canto no seu tempo
      if (m.entrega && m.entrega.id === v.dono && m.entrega.fase !== "fim") return;
      b.fica = Math.min(b.fica, agora - b.desde + entre(0.5, 2.5));
    }
    if (v.tipo === "visita") { const o = m.bonecos.get(b.visita); if (!o || !o.lugar || o.lugar.mesa !== v.mesa || !o.trabalho) b.fica = Math.min(b.fica, agora - b.desde); }
    if (v.dono) {   // torcida e plateia: acabou o jogo (ou a música), vão embora logo
      const d = m.bonecos.get(v.dono), ativo = d && (v.tipo === "torcida" ? !!d.parceiro : d.violao > agora - 5);   // 5 s para aplaudir no fim
      if (!ativo) b.fica = Math.min(b.fica, agora - b.desde + 2);
    }
    if (b.grupo || b.violao > agora) return;
    const mo = m.mo, cansou = agora - b.desde > b.fica, foraDaHora = mo && !mo.tipos[v.tipo] && agora - b.desde > 4;
    if (!cansou && !foraDaHora) return;
    const nv = vagaLivre(m, b, v);
    if (!nv) { b.desde = agora; b.fica = entre(3, 6); return; }
    if (v.tipo === "visita") { falar(b, sorteia(FRASES.visita.tchau), 2.5); b.visita = null; }
    irPara(m, b, { tipo: "vaga", vaga: nv });
  }

  function irReuniao(m, b, agora) {
    const p = m.bonecos.get(b.reuniao), pv = p && ((p.destino && p.destino.vaga) || (p.lugar && p.lugar.vaga));
    const livres = m.vagas.filter(v => v.tipo === "reuniao" && !v.ocupante && !v.fechada);
    if (!livres.length) { if (b.mesa && b.lugar.tipo !== "mesa") irPara(m, b, { tipo: "mesa", mesa: b.mesa }); else b.espera = agora + entre(3, 6); return; }
    const oposto = { cima: "baixo", baixo: "cima", esq: "dir", dir: "esq" };
    const nota = v => (pv && pv.tipo === "reuniao" ? Math.hypot(v.x - pv.x, v.y - pv.y) - (oposto[v.olha] === pv.olha ? 60 : 0) : Math.random());
    irPara(m, b, { tipo: "vaga", vaga: livres.sort((a, c) => nota(a) - nota(c))[0] });
    b.emReuniao = true;
  }

  function andar(m, b, dt, agora) {
    if (b.pausa > agora) return;   // parou um instante no caminho (high-five)
    let resto = VEL * (b.pressa || 1) * dt;   // pressa: a plateia do ringue vem correndo
    while (resto > 0 && b.rota.length) {
      const [tx, ty] = b.rota[0], dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
      if (d > 0.5) b.olha = rumo(dx, dy);
      if (d <= resto) { b.x = tx; b.y = ty; b.rota.shift(); resto -= d; b.passos += d; }
      else { b.x += (dx / d) * resto; b.y += (dy / d) * resto; b.passos += resto; resto = 0; }
    }
    if (b.passos > 11) { // um passo a cada ~0,3 s de caminhada, no som do piso de onde ele pisa
      b.passos = 0;
      if (agora > m.proxPasso && b.x > -20) { m.proxPasso = agora + 0.12; m.eventos.push({ nome: "passo", piso: pisoEm(m, b.x, b.y) }); }
    }
  }

  function pisoEm(m, x, y) {
    const p = m.predio;
    for (const s of p.salas) if (x >= s.px && x <= s.px + s.pw && y >= s.py && y <= s.py + s.ph) return MATERIAL[s.piso] || "madeira";
    for (const s of p.baixo) if (x >= s.px && x <= s.px + s.pw && y >= s.py && y <= s.py + s.ph) return MATERIAL[s.piso] || "madeira";
    const r = p.predioRet;
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h ? "ladrilho" : "calcada";
  }

  function chegar(m, b, agora) {
    const d = b.destino; b.destino = null;
    b.lugar = d; b.desde = agora; b.fica = entre(25, 70); b.pressa = 0;
    if (b.irRoda && !b.trabalho) { const v = b.irRoda; b.irRoda = null; if (b.grupo && b.grupo.vagas.get(b.id) === v) { irPara(m, b, { tipo: "vaga", vaga: v }); return; } }   // chamado para a roda no caminho
    if (b.chegou && d.tipo !== "fora") { falar(b, sorteia(FRASES.chegada), 3); b.aceno = agora + 1.5; b.chegou = false; }
    if (!d.vaga) return;
    const tipo = d.vaga.tipo;
    if (tipo !== "reuniao") b.emReuniao = false;
    if (tipo === "visita") {
      const o = m.bonecos.get(b.visita);
      falar(b, sorteia(FRASES.visita.chega), 3); m.eventos.push({ nome: "conversa", voz: b.handle });
      if (o) o.responde = { em: agora + 1.8, texto: sorteia(FRASES.visita.responde) };
      b.fica = entre(9, 14);
    } else if (tipo === "festa") {
      festejar(m, b, agora); b.fica = 3.2;
    } else if (tipo === "torcida" || tipo === "plateia" || tipo === "ringue") {
      if (Math.random() < 0.4) falar(b, sorteia(tipo === "torcida" ? FRASES.torcida.chega : tipo === "ringue" ? FRASES.social.chega : FRASES.plateia), 2.6);
      b.fica = 120;   // fica até o jogo, a música ou a briga acabar (decidir)
    } else if (tipo === "aquario") {
      falar(b, sorteia(FRASES.objeto.aquario), 3); b.fica = entre(7, 11);
    } else if (tipo === "gato") {
      falar(b, sorteia(FRASES.atividade.gato), 3); m.eventos.push({ nome: "miau" }); b.fica = entre(6, 10);
    } else if (tipo === "reuniao" && b.reuniao) {
      const p = m.bonecos.get(b.reuniao);
      if (p && !p.rota.length && p.lugar && p.lugar.vaga && p.lugar.vaga.tipo === "reuniao") { b.parceiro = p.id; p.parceiro = b.id; b.vez = 0; p.vez = 1; }
    } else if (!d.vaga.temp && !b.parceiro) chamarParceiro(m, b, d.vaga, agora);
    if (tipo === "cafe") m.eventos.push({ nome: "cafe" });
  }

  // pose, direção e ordem de desenho de cada um (o avatar.js só lê estes campos)
  function posar(m, b, agora) {
    const l = b.lugar;
    b.chave = b.y + 0.5; b.sentado = false;
    if (b.rota.length || !l) { b.pose = !b.rota.length ? "parado" : b.pausa > agora ? "acenando" : "andando"; return; }
    if (l.tipo === "mesa") {
      b.olha = "baixo"; b.sentado = true;
      b.pose = b.festa > agora ? "comemorando" : b.aceno > agora ? "acenando" : b.arremesso > agora ? "arremesso" : trabalhando(b) ? "digitando" : esperando(b) ? "esperando" : "sentado";
      return;
    }
    if (l.tipo !== "vaga") return;
    const v = l.vaga;
    b.olha = v.olha || "baixo"; b.chave = v.chave || b.chave;
    if (b.festa > agora) b.pose = "comemorando";
    else if (b.tonto > agora) b.pose = "tonto";   // perdeu a briga: as estrelinhas são do efeitos.js
    else if (b.arremesso > agora) b.pose = "arremesso";
    else if (b.violao > agora) b.pose = "violao";
    else if (b.aceno > agora) b.pose = v.senta ? "sentado" : "acenando";
    else if (b.danca > agora && !v.senta && v.tipo !== "luta") b.pose = "dancando";
    else if (v.pose && m.entrega && m.entrega.id === v.dono && m.entrega.fase === "entregue") b.pose = v.pose;   // come ou cochila depois que chegou
    else if (POSE[v.tipo]) b.pose = POSE[v.tipo];
    else if (v.senta) b.pose = m.noite > 0.6 && v.tipo !== "reuniao" ? "dormindo" : "sentado";
    else b.pose = "parado";
    b.sentado = v.senta;
  }

  // duplas: quem chegou junto conversa (ou joga) revezando a vez
  function duplas(m, dt, agora) {
    for (const b of m.lista) {
      if (!b.parceiro || b.vez !== 0) continue;
      const o = m.bonecos.get(b.parceiro);
      if (!o || o.parceiro !== b.id) { b.parceiro = null; b.placar = null; continue; }
      const juntos = !b.rota.length && !o.rota.length && b.lugar && o.lugar && b.lugar.tipo === "vaga" && o.lugar.tipo === "vaga" && Math.hypot(b.x - o.x, b.y - o.y) < 160;
      if (!juntos || (b.proxFala = (b.proxFala || 0) - dt) > 0) continue;
      b.proxFala = entre(2.4, 4);
      const tipo = b.lugar.vaga.tipo, jogo = JOGOS.has(tipo) && !b.reuniao;
      if (jogo) { partida(m, b, o, tipo, agora); continue; }
      if (!b.dialogo || b.passoDialogo >= b.dialogo.length) {
        b.dialogo = b.reuniao ? sorteia(FRASES.reuniaoDados) : sorteia(FRASES.dialogos);
        b.passoDialogo = 0; b.rodadas = (b.rodadas || 0) + 1;
      }
      const quem = b.passoDialogo % 2 === 0 ? b : o;
      falar(quem, b.dialogo[b.passoDialogo++], 2.6);
      m.eventos.push({ nome: "conversa", voz: quem.handle });
      if (!b.reuniao && b.rodadas > 4 && b.passoDialogo >= b.dialogo.length) { b.parceiro = null; o.parceiro = null; b.rodadas = 0; b.fica = 0; o.fica = 3; } // cansaram
    }
  }

  // jogo em dupla: cada vez é uma jogada; quem fizer 3 pontos é campeão (a torcida chega no começo e aplaude no fim)
  function partida(m, b, o, tipo, agora) {
    if (!b.placar) { b.placar = [0, 0]; b.vezJogo = 0; if (Math.random() < 0.7) chamarPublico(m, b, (b.x + o.x) / 2, (b.y + o.y) / 2, 52, 30, "torcida", 3, agora); }
    const quem = b.vezJogo++ % 2 === 0 ? b : o, outro = quem === b ? o : b;
    let ponto = null;
    if (ARREMESSO.has(tipo)) {   // dardos e basquete: quem joga arremessa e acerta ou erra
      const acerta = Math.random() < 0.45;
      quem.arremesso = agora + 0.8; falar(quem, sorteia(FRASES[tipo][acerta ? "acerto" : "erro"]), 2.2);
      m.eventos.push({ nome: tipo === "dardos" ? "dardo" : "cesta", acerto: acerta });
      if (acerta) ponto = quem;
    } else {
      falar(quem, sorteia(FRASES.atividade[tipo] || ["GG!"]), 2.6);
      m.eventos.push({ nome: "jogo_" + tipo });
      if (Math.random() < 0.35) ponto = Math.random() < 0.5 ? b : o;
    }
    if (!ponto) { if (b.vezJogo > 40) encerrarPartida(m, b, o); return; }   // segurança: ninguém joga para sempre
    const p = b.placar, perde = ponto === b ? o : b;
    p[ponto === b ? 0 : 1]++;
    if (Math.max(p[0], p[1]) >= PLACAR) {   // fim: campeão comemora, o outro pede revanche, a torcida aplaude
      ponto.festa = agora + 2.6; falar(ponto, `${sorteia(FRASES.campeao[tipo] || FRASES.campeao.padrao)} ${p[0]} x ${p[1]}`, 3.2);
      perde.responde = { em: agora + 1.4, texto: sorteia(FRASES.revanche) };
      m.eventos.push({ nome: "vitoria" });
      reagirPublico(m, b, "final", agora);
      encerrarPartida(m, b, o);
      return;
    }
    if (!ARREMESSO.has(tipo)) { ponto.festa = agora + 1.4; falar(ponto, `${sorteia(FRASES.jogo.ganhou)} ${p[0]} x ${p[1]}`, 2.4); perde.responde = { em: agora + 1.2, texto: sorteia(FRASES.jogo.perdeu) }; }
    else outro.responde = { em: agora + 1.2, texto: `${p[0]} x ${p[1]}` };
    reagirPublico(m, b, "ponto", agora);
  }

  function encerrarPartida(m, b, o) {
    b.placar = null; b.vezJogo = 0; b.parceiro = null; o.parceiro = null; b.rodadas = 0;
    b.fica = Math.min(b.fica, performance.now() / 1000 - b.desde + 4); o.fica = Math.min(o.fica, performance.now() / 1000 - o.desde + 6);
  }

  // --- brincadeiras soltas -----------------------------------------------------------------
  // high-five no caminho, música (dancinha e karaokê na jukebox), violão com plateia, cesta de papel na mesa,
  // aviãozinho e guerra de bolinha de papel na sexta à tarde. Tudo por temporizador, nada por quadro.
  function brincadeiras(m, dt, agora) {
    if ((m.proxToca -= dt) <= 0) { m.proxToca = 0.4; highFive(m, agora); }
    if ((m.proxMusica -= dt) <= 0) { m.proxMusica = entre(2.5, 4); musica(m, agora); }
    if ((m.proxViolao -= dt) <= 0) { m.proxViolao = entre(60, 120); violao(m, agora); }
    if ((m.proxPapel -= dt) <= 0) { m.proxPapel = entre(25, 50); cestaDePapel(m, agora); }
    if ((m.proxAviao -= dt) <= 0) { m.proxAviao = entre(50, 100); lancarPapel(m, agora, "aviao"); }
    if ((m.proxGuerra -= dt) <= 0) { m.proxGuerra = entre(7, 12); if (sextaATarde()) lancarPapel(m, agora, "guerra"); }
  }

  // sexta das 16h às 18h (a data respeita ?data=AAAA-MM-DD, como as festas)
  function sextaATarde() {
    const h = Ceu.agora().h, d = new URLSearchParams(location.search).get("data");
    return h >= 16 && h < 18 && (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date()).getDay() === 5;
  }

  // dois livres que se cruzam andando param um instante e batem a mão (cada um no máximo a cada 1-2 min)
  function highFive(m, agora) {
    const L = m.lista;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.rota.length || a.trabalho || a.pausa > agora || agora < (a.proxToca || 0) || a.x < 0) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (!b.rota.length || b.trabalho || b.pausa > agora || agora < (b.proxToca || 0) || Math.abs(a.x - b.x) > 16 || Math.abs(a.y - b.y) > 10) continue;
        a.proxToca = b.proxToca = agora + entre(60, 120);
        if (Math.random() < 0.5) break;   // nem todo cruzamento vira high-five
        a.pausa = b.pausa = a.aceno = b.aceno = agora + 0.9;
        a.olha = b.x < a.x ? "esq" : "dir"; b.olha = a.x < b.x ? "esq" : "dir";
        falar(a, sorteia(FRASES.highfive), 1.8); falar(b, sorteia(FRASES.highfiveVolta), 1.8);
        m.eventos.push({ nome: "palma" });
        return;
      }
    }
  }

  // quem toca (piano, jukebox ou violão) faz som; na jukebox canta e quem está de pé na sala dança
  function musica(m, agora) {
    for (const b of m.lista) {
      if (b.violao && b.violao <= agora) { b.violao = 0; reagirPublico(m, b, "final", agora); continue; }   // acabou a música: aplausos
      const v = !b.rota.length && b.lugar && b.lugar.vaga, viola = b.violao > agora;
      if (!viola && !(v && v.tipo === "musica")) continue;
      m.eventos.push({ nome: "musica", instrumento: viola ? "violao" : v.jukebox ? "jukebox" : "piano" });
      if (viola) { if (Math.random() < 0.2 && !b.fala) falar(b, sorteia(FRASES.violao), 2.6); continue; }
      if (!v.jukebox) continue;
      b.danca = agora + 5;
      if (Math.random() < 0.25 && !b.fala) falar(b, sorteia(FRASES.karaoke), 2.6);
      for (const o of m.lista) {
        const ov = o !== b && !o.rota.length && o.lugar && o.lugar.vaga;
        if (!ov || ov.sala !== v.sala || ov.senta || o.trabalho || o.reuniao) continue;
        o.danca = agora + 5;
        if (Math.random() < 0.08 && !o.fala) falar(o, sorteia(FRASES.danca), 2.2);
      }
    }
  }

  // alguém sentado num pufe, poltrona ou sofá pega o violão; até 2 colegas vêm ouvir
  function violao(m, agora) {
    if (m.lista.some(b => b.violao > agora)) return;
    const quem = m.lista.filter(b => livreParaConvite(m, b, agora) && b.lugar.vaga.senta && ["pufe", "poltrona", "papo", "tv"].includes(b.lugar.vaga.tipo));
    if (!quem.length) return;
    const b = sorteia(quem);
    b.violao = agora + entre(25, 40); falar(b, sorteia(FRASES.violao), 3);
    chamarPublico(m, b, b.x, b.y + 6, 34, 22, "plateia", 2, agora);
  }

  // quem trabalha na mesa amassa um papel e joga na lixeira mais perto (sem lixeira por perto, não joga)
  function cestaDePapel(m, agora) {
    const quem = m.lista.filter(b => trabalhando(b) && !b.rota.length && b.lugar && b.lugar.tipo === "mesa" && !b.fala);
    if (!quem.length) return;
    const b = sorteia(quem), lixo = movelPerto(m.predio, b, /^lixeira/, 90);
    if (!lixo) return;
    const acerta = Math.random() < 0.6, lx = lixo.x + lixo.w / 2 + (acerta ? 0 : Math.random() < 0.5 ? -10 : 10);
    b.arremesso = agora + 0.8; falar(b, sorteia(FRASES.papel[acerta ? "acerto" : "erro"]), 2.4);
    if (window.Efeitos && Efeitos.lancar) Efeitos.lancar(b.x + 6, b.y - 16, lx, lixo.y + lixo.h / 2, "papel");
    m.eventos.push({ nome: "papel" });
  }

  // aviãozinho (qualquer hora) ou guerra de bolinha (sexta à tarde, com revide) entre dois livres da mesma sala
  function lancarPapel(m, agora, modo) {
    const quem = m.lista.filter(b => livreParaConvite(m, b, agora) && !b.fala);
    for (const a of quem.sort(() => Math.random() - 0.5)) {
      const alvo = quem.find(o => o !== a && o.lugar.vaga.sala === a.lugar.vaga.sala && Math.abs(Math.hypot(o.x - a.x, o.y - a.y) - 95) < 65);
      if (!alvo) continue;
      a.arremesso = agora + 0.8;
      falar(a, sorteia(modo === "aviao" ? FRASES.aviao : FRASES.guerra), 2.4);
      if (window.Efeitos && Efeitos.lancar) Efeitos.lancar(a.x, a.y - 16, alvo.x, alvo.y - 14, modo === "aviao" ? "aviao" : "papel");
      alvo.responde = modo === "aviao" ? { em: agora + 1, texto: sorteia(FRASES.aviaoVolta) } : { em: agora + 1.2, texto: sorteia(FRASES.guerra), lanca: a.id };
      m.eventos.push({ nome: "papel" });
      return;
    }
  }

  // --- vida social (contrato S): o servidor decide quem briga, quando e quem vence; aqui só se encena ----------------
  // Vida.social(m, social) a cada leitura (null desliga: Simulação, servidor antigo). Os horários valem pela diferença
  // para o social.agora (o relógio da máquina não importa). Quem tem tarefa, ou espera você, nunca briga nem assiste:
  // o trabalho real manda, e o lutador que pega tarefa vai para a mesa pelo alvoDe de sempre.
  // Para o efeitos.js: m.cenaSocial = { id, tipo, x, y, fase ("chamado", "luta" ou "resultado"), ate, a, b, vencedor } ou null
  // e b.tonto (até quando o perdedor fica tonto, no relógio do performance.now). Sons: gongo, soco e torcida.
  const calmo = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const PRESSA = 1.6, PRESSA_MAX = 3, LUTA_MIN = 12, PLATEIA_MAX = 10, RESULTADO = 6, CHEGAR_ATE = 8, EVENTO_IDADE = 60;
  const noPredio = b => b.x >= 0 && (b.rota.length ? !(b.destino && b.destino.tipo === "fora") : !!b.lugar && b.lugar.tipo !== "fora");
  const livreSocial = b => !!b && !b.trabalho && !b.reuniao && noPredio(b);
  const cenaAtiva = (m, id) => !!m.cena && m.cena.id === id && m.cena.fase !== "fim";
  const donoDe = b => (b.lugar && b.lugar.vaga && b.lugar.vaga.dono) || (b.destino && b.destino.vaga && b.destino.vaga.dono) || null;
  const naCena = (m, b) => !!m.cena && m.cena.fase !== "fim" && (m.cena.lutadores.includes(b.id) || m.cena.participantes.includes(b.id)
    || donoDe(b) === m.cena.id);

  function social(m, s) {
    if (!m) return;
    const agora = performance.now() / 1000;
    if (s && typeof s.agora === "string" && Number.isFinite(Date.parse(s.agora))) m.desvio = agora - Date.parse(s.agora) / 1000;
    // sem o "agora" (a resposta do "Mandar pro ringue"), vale o desvio da última leitura
    const c = s && !s.serio && m.desvio !== undefined && s.cena && (s.cena.tipo === "briga" || s.cena.tipo === "greve") ? s.cena : null;
    if (!s || s.serio) encerrarEntrega(m);   // modo sério e Simulação: a entrega some na hora
    if (!c) { encerrarCena(m); m.cena = null; }
    else if (!m.cena || m.cena.id !== c.id) { encerrarCena(m); m.cena = novaCena(m, c); }
    else if (c.tipo === "greve" && Array.isArray(c.participantes)) m.cena.participantes = c.participantes.filter(x => typeof x === "string");   // quem pegou tarefa saiu
    if (!s || s.serio || m.desvio === undefined || !Array.isArray(s.eventos)) return;
    const servidor = agora - m.desvio;
    for (const ev of s.eventos) {
      if (!ev || typeof ev.id !== "string" || m.vistos.has(ev.id)) continue;
      m.vistos.add(ev.id);
      const idade = servidor - Date.parse(ev.em) / 1000;
      if (idade >= -5 && idade <= EVENTO_IDADE) encenarEvento(m, ev, agora);
    }
    if (m.vistos.size > 300) m.vistos = new Set([...m.vistos].slice(-100));
  }

  function novaCena(m, c) {
    const local = t => Date.parse(t) / 1000 + m.desvio, inicio = local(c.inicio);
    if (c.tipo === "greve") {   // a greve acaba no "ate"; o fim dela é o mesmo campo "fim" da briga
      const fim = local(c.ate), ps = Array.isArray(c.participantes) ? c.participantes.filter(x => typeof x === "string") : [];
      const ok = typeof c.id === "string" && ps.length > 0 && Number.isInteger(c.motivo) && Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio;
      return { id: c.id, tipo: "greve", participantes: ps, motivo: ok ? c.motivo : 0, inicio, fim, lutadores: [], fase: ok ? "chamado" : "fim", prox: 0 };
    }
    const fim = local(c.fim);
    const ok = typeof c.id === "string" && typeof c.a === "string" && typeof c.b === "string" && c.a !== c.b && [c.a, c.b].includes(c.vencedor)
      && Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio;
    return { id: c.id, tipo: "briga", a: c.a, b: c.b, vencedor: c.vencedor, inicio, fim, lutadores: [c.a, c.b], participantes: [], fase: ok ? "espera" : "fim" };
  }

  // a cena acaba nesta tela: quem está no ringue, na plateia ou na greve segue pelo decidir (a vaga sem cena ativa manda
  // embora); as plaquinhas saem na hora
  function encerrarCena(m) {
    if (m.cena) m.cena.fase = "fim";
    m.cenaSocial = null;
    for (const b of m.lista) b.placa = null;
  }

  // onde é o ringue: o cantinho do mapa.js (predio.ringue) ou, sem ele, o meio da sala comunal, sem cordas
  function ringue(m) {
    const p = m.predio, r = p.ringue;
    if (r) return { sala: r.sala, cx: r.x + r.w / 2, cy: (r.pontos[0][1] + r.pontos[1][1]) / 2, pontos: r.pontos, plateia: r.plateia };
    const s = p.lounge;
    if (!s) return null;
    const cx = Math.round(s.px + s.pw / 2), cy = Math.round((s.chao + s.py + s.ph) / 2), pontos = [[cx - 19, cy], [cx + 19, cy]];
    return pontos.every(([x, y]) => !p.livre || p.livre(x, y)) ? { sala: s, cx, cy, pontos } : null;
  }

  // gongo: os dois andam até os pontos de luta e até 10 livres (os mais perto primeiro) vêm correndo assistir
  function chamar(m, c, a, b, agora) {
    const r = ringue(m);
    if (!r) return false;
    const lutas = r.pontos.map(([x, y], i) => ({ sala: r.sala, x, y, tipo: "luta", olha: i ? "esq" : "dir", chave: y + 0.5, temp: true, dono: c.id }));
    if (!lutas.every(v => alcanca(m, v))) return false;
    for (const [l, v] of [[a, lutas[0]], [b, lutas[1]]]) {
      if (l.rota.length) {   // vinha andando pelo corredor: solta a vaga reservada no destino; sem lugar, o caminho parte do corredor
        for (const r of [l.destino && l.destino.vaga, l.irRoda]) if (r && r.ocupante === l.id) r.ocupante = null;
        l.irRoda = null;
      }
      irPara(m, l, { tipo: "vaga", vaga: v });
    }
    // quem está longe apressa o passo (até 3×) para chegar ao gongo ou, no mais tardar, a tempo de lutar uns segundos:
    // sem isso, no prédio largo o lutador chegava depois do fim e a briga contada não aparecia. Com movimento reduzido
    // ninguém corre: quem não chega a tempo andando aparece direto no ponto de luta (a vaga já é dele desde o irPara)
    const prazo = Math.max(1, Math.max(c.inicio, c.fim - LUTA_MIN) - agora);
    for (const l of [a, b]) {
      let d = 0, x = l.x, y = l.y;
      for (const [px, py] of l.rota) { d += Math.hypot(px - x, py - y); x = px; y = py; }
      if (!calmo.matches) { l.pressa = Math.min(PRESSA_MAX, Math.max(1, d / (VEL * prazo))); continue; }
      l.pressa = 1;
      if (d > VEL * prazo) { l.x = l.destino.vaga.x; l.y = l.destino.vaga.y; l.rota = []; chegar(m, l, agora); }
    }
    falar(a, sorteia(FRASES.social.desafio), 3);
    m.eventos.push({ nome: "gongo" });
    c.r = r; c.cx = r.cx; c.cy = r.cy; c.lutas = lutas; c.proxPlateia = 0;
    return true;
  }

  // até 10 livres (os mais perto primeiro), parados numa vaga comum ou na própria mesa; quem fica livre durante o chamado
  // e a luta também vem (o cuidarDaCena chama de novo a cada 1 s)
  function chamarPlateia(m, c, agora) {
    const r = c.r, ja = m.lista.filter(o => !c.lutadores.includes(o.id) && donoDe(o) === c.id).length;
    const quem = m.lista.filter(o => !c.lutadores.includes(o.id) && !o.trabalho && !o.reuniao && !o.rota.length && o.lugar && o.lugar.tipo !== "fora"
      && !(o.lugar.vaga && o.lugar.vaga.temp) && !(o.violao > agora) && !(o.festa > agora) && noPredio(o))
      .sort((p, q) => Math.hypot(p.x - r.cx, p.y - r.cy) - Math.hypot(q.x - r.cx, q.y - r.cy)).slice(0, Math.max(0, PLATEIA_MAX - ja));
    if (!quem.length) return;
    // pontos de chão livre fora das cordas, longe de quem já está ou vai estar por ali e uns dos outros; o alcance só é medido
    // nos sorteados
    const perto = [...m.lista.map(o => (o.destino && o.destino.vaga) || (o.lugar && o.lugar.vaga)).filter(v => v && v.sala === r.sala),
      ...m.vagas.filter(v => v.ocupante && v.sala === r.sala), ...c.lutas];
    const brutos = (r.plateia || pontosEmVolta(m, r.sala, r.cx, r.cy, 62, 44, "ringue").map(v => [v.x, v.y])).slice().sort(() => Math.random() - 0.5);
    const pts = [];
    for (const [x, y] of brutos) {
      if (pts.length >= quem.length * 2) break;
      if (perto.some(o => Math.hypot(o.x - x, o.y - y) < 16) || pts.some(o => Math.hypot(o.x - x, o.y - y) < 14)) continue;
      const v = { sala: r.sala, x, y, tipo: "ringue", olha: rumo(r.cx - x, r.cy - y), chave: y + 0.5, temp: true, dono: c.id };
      if ((!m.predio.livre || m.predio.livre(x, y)) && alcanca(m, v)) pts.push(v);
    }
    for (const o of quem) {
      if (!pts.length) break;
      const v = pts.reduce((x, y) => (Math.hypot(y.x - o.x, y.y - o.y) < Math.hypot(x.x - o.x, x.y - o.y) ? y : x));
      pts.splice(pts.indexOf(v), 1);
      irPara(m, o, { tipo: "vaga", vaga: v });
      o.pressa = calmo.matches ? 1 : PRESSA;   // movimento reduzido: ninguém corre
    }
  }

  const plateiaDe = (m, c) => m.lista.filter(o => !o.rota.length && o.lugar && o.lugar.vaga && o.lugar.vaga.tipo === "ringue" && o.lugar.vaga.dono === c.id);

  // greve (fatia 2): os participantes livres e no prédio nesta tela andam (sem correr) até pontos em volta do ringue e
  // sentam no chão, com plaquinha. Quem pega tarefa vai para a mesa pelo alvoDe de sempre; quem fica livre durante a
  // greve vem depois (a cada 1 s). No "ate", "Por hoje chega…"; atendida, o servidor tira a cena e o evento agradece.
  // Para o efeitos.js: m.cenaSocial = { id, tipo: "greve", fase ("chamado" ou "greve"), participantes, x, y, motivo, ate }
  // e b.placa (o texto) em quem está sentado. Sons: protesto (quando o primeiro senta) e atendida.
  const textoGreve = motivo => { const g = FRASES.social.greve, n = Number.isInteger(motivo) ? motivo : 0; return g[((n % g.length) + g.length) % g.length]; };
  const sentadoNaGreve = (b, c) => !b.rota.length && b.lugar && b.lugar.vaga && b.lugar.vaga.tipo === "greve" && b.lugar.vaga.dono === c.id;

  function cuidarDaGreve(m, dt, agora) {
    const c = m.cena;
    if (agora >= c.fim) {
      for (const b of m.lista) if (sentadoNaGreve(b, c) && Math.random() < 0.7) falar(b, sorteia(FRASES.social.greveFim), 3);
      encerrarCena(m); return;
    }
    if (!c.r && !(c.r = ringue(m))) { m.cenaSocial = null; return; }
    if ((c.prox -= dt) <= 0) { c.prox = 1; chamarGrevistas(m, c); }
    const vem = m.lista.filter(b => c.participantes.includes(b.id) && donoDe(b) === c.id);
    const sentados = vem.filter(b => sentadoNaGreve(b, c));
    for (const b of m.lista) b.placa = null;
    // o 1º sentado (na ordem dos participantes) sempre ergue o pedido do aviso; os outros, os pedidos seguintes
    sentados.sort((x, y) => c.participantes.indexOf(x.id) - c.participantes.indexOf(y.id)).forEach((b, k) => { b.placa = textoGreve(c.motivo + k); });
    if (sentados.length && c.fase === "chamado") { c.fase = "greve"; c.proxGrito = entre(1, 3); m.eventos.push({ nome: "protesto" }); }
    if (c.fase === "greve" && (c.proxGrito -= dt) <= 0) {
      c.proxGrito = entre(4, 8);
      const quem = sentados.filter(o => !o.fala);
      if (quem.length) falar(sorteia(quem), sorteia(FRASES.social.grito), 2.6);
    }
    if (!vem.length) { m.cenaSocial = null; return; }
    const pts = vem.map(b => (b.destino && b.destino.vaga) || b.lugar.vaga);
    const cs = m.cenaSocial && m.cenaSocial.id === c.id ? m.cenaSocial : (m.cenaSocial = { id: c.id, tipo: "greve" });
    cs.fase = c.fase; cs.participantes = vem.map(b => b.id); cs.motivo = c.motivo; cs.ate = c.fim;
    cs.x = pts.reduce((s, v) => s + v.x, 0) / pts.length; cs.y = pts.reduce((s, v) => s + v.y, 0) / pts.length;
  }

  // os participantes livres, parados e no prédio sentam em fileiras na frente do ringue (nunca entre a parede e as cordas:
  // ficariam escondidos e a plaquinha subiria no quadro), do meio para os lados, longe de quem já está por ali. Ninguém corre
  function chamarGrevistas(m, c) {
    const quem = m.lista.filter(o => c.participantes.includes(o.id) && donoDe(o) !== c.id && !o.trabalho && !o.reuniao
      && !o.rota.length && o.lugar && o.lugar.tipo !== "fora" && noPredio(o));
    if (quem.length) distribuir(m, quem, pontosNaFrente(m, c.r, quem.length, { tipo: "greve", dono: c.id }));
  }

  // até n vagas temporárias em fileiras na frente do ringue (do meio para os lados, 14 px entre elas), longe de quem já
  // está ou vai estar por ali; "modelo" vira os campos da vaga (tipo, dono, pose)
  function pontosNaFrente(m, r, n, modelo, evitar = []) {
    const s = r.sala, perto = [...m.lista.map(o => (o.destino && o.destino.vaga) || (o.lugar && o.lugar.vaga)).filter(v => v && v.sala === s),
      ...m.vagas.filter(v => v.ocupante && v.sala === s), ...evitar];
    const pr = m.predio.ringue, topo = pr ? pr.y + pr.h + 12 : Math.round(r.cy) + 30, pts = [];
    for (let fila = 0; fila < 4 && pts.length < n; fila++) for (let k = 0; k < 12 && pts.length < n; k++) {   // 0, +14, −14, +28, −28…
      const x = Math.round(r.cx + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 14), y = topo + fila * 14;
      if (!(x > s.px + 6 && x < s.px + s.pw - 6 && y > s.chao + 6 && y < s.py + s.ph - 4)) continue;
      if (perto.some(o => Math.hypot(o.x - x, o.y - y) < 14) || pts.some(o => Math.hypot(o.x - x, o.y - y) < 14)) continue;
      const v = { sala: s, x, y, olha: "baixo", chave: y + 0.5, temp: true, ...modelo };
      if ((!m.predio.livre || m.predio.livre(x, y)) && alcanca(m, v)) pts.push(v);
    }
    return pts;
  }

  // cada um vai para o ponto mais perto dele, sem correr
  function distribuir(m, quem, pts) {
    for (const o of quem) {
      if (!pts.length) break;
      const v = pts.reduce((x, y) => (Math.hypot(y.x - o.x, y.y - o.y) < Math.hypot(x.x - o.x, x.y - o.y) ? y : x));
      pts.splice(pts.indexOf(v), 1);
      irPara(m, o, { tipo: "vaga", vaga: v });
    }
  }

  // --- entrega do pedido (greve atendida): igual para todas as telas pelo evento "atendida" {motivo, participantes}; cada
  // tela encena com os próprios bonecos. Um entregador figurante (fora do m.lista) vem da rua com o item até a frente do
  // ringue (o motoboy da pizza para no balcão da recepção); a turma livre vai até lá (no café, em roda em volta das
  // garrafas), comemora, come, toma café ou cochila, e uns 20 s depois volta para o seu canto. Sem entregador (ar, faixa),
  // o pedido "chega" quando o primeiro da turma alcança o ponto. Quem trabalha ou espera não sai da mesa. Para o
  // efeitos.js: m.entrega = { id, motivo, pedido, item, faixa, fase ("chegando" ou "entregue"), x, y, entregador } ou null.
  // Sons: campainha e eba
  const ENTREGAS = {   // pedido (o texto da plaquinha) -> o que chega; o resto vira uma faixa "<pedido> aprovado!"
    "MAIS CAFÉ": { item: "cafe", entregador: true, roda: true, pose: "cafe" },
    "QUEREMOS PIZZA": { item: "pizza", entregador: true, recepcao: true, pose: "cafe" },
    "AR NO 23": { item: "ar", primeira: "Ahh, agora sim" }, "SEXTA LIVRE": { item: "faixa", faixa: "Sexta livre aprovada!", festa: true },
    "MENOS REUNIÃO": { item: "faixa", faixa: "Menos reunião aprovado!", festa: true }, "ABAIXO O BUG": { item: "faixa", faixa: "Bug esmagado!", festa: true },
    "PUFE JÁ!": { item: "pufe", entregador: true, festa: true }, "WI-FI DIGNO": { item: "roteador", entregador: true, festa: true },
    "BOLO NA SEXTA": { item: "bolo", entregador: true, pose: "cafe" }, "SONECA LIVRE": { item: "travesseiro", entregador: true, pose: "dormindo" },
  };
  const ENTREGA_CHEGAR = 40, ENTREGA_DURA = 20, ENTREGADOR_FICA = 3;
  const AP_ENTREGADOR = { color: "amber", eyes: "round", accessory: "cap" };

  function novaEntrega(m, ev, agora) {
    const r = ringue(m), pedido = textoGreve(ev.motivo), tipo = ENTREGAS[pedido] || { item: "faixa", faixa: pedido + " aprovado!", festa: true };
    if (!r) return;
    encerrarEntrega(m);
    const id = "entrega-" + ev.id, [ponto] = pontosNaFrente(m, r, 1, { tipo: "entrega", dono: id });
    if (!ponto) return;
    ponto.ocupante = "entregador";   // o lugar do item: ninguém da turma senta em cima
    const e = { id, motivo: ev.motivo, pedido, tipo, item: tipo.item, faixa: tipo.faixa || null, fase: "chegando", x: ponto.x, y: ponto.y, ponto,
      r, participantes: (Array.isArray(ev.participantes) ? ev.participantes : []).filter(x => typeof x === "string"), desde: agora, prox: 0, entregador: null };
    if (tipo.entregador) {   // da calçada, pela recepção e pelo corredor, como quem chega para trabalhar
      const p = m.predio, parada = (tipo.recepcao && balcao(m)) || ponto, rota = caminho(m, { tipo: "fora" }, { tipo: "vaga", vaga: parada });
      e.entregador = { id: "entregador", x: -24, y: p.entrada.calcadaY, rota, destino: { tipo: "vaga", vaga: parada }, parada, pose: "andando", olha: "dir",
        ap: AP_ENTREGADOR, semente: 7, sentado: false, chave: 0, passos: 0, carrega: true, fala: null, ate: 0 };
    }
    m.entrega = e;
  }

  function encerrarEntrega(m) { m.entrega = null; }

  // onde o motoboy espera: na frente do balcão da recepção (o ponto mais baixo em volta dele), olhando para o balcão
  function balcao(m) {
    const s = m.predio.salas.find(x => x.tipo === "recepcao");
    if (!s) return null;
    const pts = pontosEmVolta(m, s, s.px + s.pw / 2, s.chao + 34, 16, 14, "balcao").filter(v => alcanca(m, v));
    return pts.length ? pts.reduce((a, b) => (b.y > a.y ? b : a)) : null;
  }

  const naEntrega = (b, e) => !b.rota.length && b.lugar && b.lugar.vaga && b.lugar.vaga.dono === e.id;

  function cuidarDaEntrega(m, dt, agora) {
    const e = m.entrega;
    if (!e) return;
    const g = e.entregador;
    if (g) {   // o figurante anda com o mesmo passo dos agentes e fala pelo mesmo balão
      if (g.fala && agora > g.ate) g.fala = null;
      if (g.rota.length) andar(m, g, dt, agora);
      g.pose = g.rota.length ? "andando" : "parado"; g.chave = g.y + 0.5;
      if (!g.rota.length && e.fase === "chegando") entregar(m, e, agora);
      if (e.fase !== "chegando" && !g.rota.length && agora > e.entregueEm + ENTREGADOR_FICA && g.destino) {   // entregou: volta para a rua
        g.rota = caminho(m, { tipo: "vaga", vaga: g.parada }, { tipo: "fora" }); g.destino = null; g.olha = "esq";
      }
      if (!g.destino && !g.rota.length) e.entregador = null;   // sumiu na calçada
    }
    if (e.fase === "chegando" && !g && (m.lista.some(b => naEntrega(b, e)) || agora - e.desde > ENTREGA_CHEGAR)) entregar(m, e, agora);
    if (e.fase === "chegando" && g && agora - e.desde > ENTREGA_CHEGAR) { entregar(m, e, agora); e.entregador = null; }   // caminho travado: não espera para sempre
    if (e.fase === "fim") { if (!e.entregador) encerrarEntrega(m); return; }
    if (e.fase === "entregue" && agora > e.entregueEm + ENTREGA_DURA) {   // cada um volta para o seu canto (o decidir solta a vaga)
      e.fase = "fim"; e.ponto.ocupante = null;
      if (!e.entregador) encerrarEntrega(m);
      return;
    }
    if ((e.prox -= dt) <= 0) { e.prox = 1; chamarTurma(m, e); }
  }

  // a entrega chegou: campainha, o entregador anuncia, a turma comemora (ou come, toma café, cochila)
  function entregar(m, e, agora) {
    e.fase = "entregue"; e.entregueEm = agora;
    if (e.entregador) { e.entregador.carrega = false; e.entregador.fala = sorteia(FRASES.social.entrega.chegou); e.entregador.ate = agora + 3; }
    m.eventos.push({ nome: "campainha" });
    const turma = m.lista.filter(b => naEntrega(b, e) || (b.destino && b.destino.vaga && b.destino.vaga.dono === e.id));
    const frases = FRASES.social.entrega[e.item] || FRASES.social.entrega.faixa;
    turma.forEach((b, i) => { b.responde = { em: agora + 0.8 + i * 0.5, texto: (i === 0 && e.tipo.primeira) || sorteia(frases), aceno: !e.tipo.pose }; });
    if (e.tipo.festa) for (const b of turma) b.festa = agora + 5;
    if (turma.length) m.eventos.push({ nome: "eba" });
  }

  // os participantes livres, parados e no prédio vão até a entrega: em fileiras em volta do item ou, no café, em roda
  function chamarTurma(m, e) {
    const quem = m.lista.filter(o => e.participantes.includes(o.id) && donoDe(o) !== e.id && !o.trabalho && !o.reuniao
      && !o.rota.length && o.lugar && o.lugar.tipo !== "fora" && noPredio(o));
    if (!quem.length) return;
    const modelo = { tipo: "entrega", dono: e.id, pose: e.tipo.pose };
    distribuir(m, quem, e.tipo.roda ? rodaDaEntrega(m, e, quem.length, modelo) : pontosNaFrente(m, e.r, quem.length, modelo, [e.ponto]));
  }

  // roda de café em volta das garrafas: pontos na elipse, 14 px entre eles, longe de quem já está ou vai estar por ali
  function rodaDaEntrega(m, e, n, modelo) {
    const s = e.ponto.sala, perto = [e.ponto, ...m.lista.map(o => (o.destino && o.destino.vaga) || (o.lugar && o.lugar.vaga)).filter(v => v && v.sala === s),
      ...m.vagas.filter(v => v.ocupante && v.sala === s)], pts = [];
    for (const v of pontosEmVolta(m, s, e.ponto.x, e.ponto.y, 30, 18, "entrega", perto)) {
      if (pts.length >= n) break;
      if (!pts.some(o => Math.hypot(o.x - v.x, o.y - v.y) < 14) && alcanca(m, v)) pts.push(Object.assign(v, modelo));
    }
    return pts;
  }

  function cuidarDaCena(m, dt, agora) {
    const c = m.cena;
    if (!c || c.fase === "fim") { m.cenaSocial = null; return; }
    if (c.tipo === "greve") { cuidarDaGreve(m, dt, agora); return; }
    if (agora >= c.fim + RESULTADO) { encerrarCena(m); return; }
    const a = m.bonecos.get(c.a), b = m.bonecos.get(c.b);
    if (c.fase === "espera") {   // só encena com os dois livres e no prédio nesta tela; ninguém é teletransportado
      if (agora >= c.fim - CHEGAR_ATE) { encerrarCena(m); return; }
      // pronto: parado num lugar ou andando no corredor (de lá a rota até o ringue é a de sempre); quem está numa sala
      // termina o trecho, que é curto. Sem isso, quem cruzava o prédio largo só parava depois da hora da briga
      const pronto = l => (!l.rota.length && !!l.lugar) || (!l.lugar && l.rota.length > 0 && Math.abs(l.y - m.predio.corredorY) < 0.5);
      if (m.fora || !livreSocial(a) || !livreSocial(b) || !pronto(a) || !pronto(b)) return;
      if (!chamar(m, c, a, b, agora)) { encerrarCena(m); return; }
      c.fase = "chamado";
    }
    for (const l of [a, b]) if (!l || l.trabalho) {   // o trabalho real manda: a cena termina nesta tela
      if (l) falar(l, FRASES.social.trabalho, 3);
      encerrarCena(m); return;
    }
    if (c.fase !== "resultado" && agora < c.fim && (c.proxPlateia -= dt) <= 0) { c.proxPlateia = 1; chamarPlateia(m, c, agora); }
    const chegou = l => !l.rota.length && l.lugar && l.lugar.vaga && l.lugar.vaga.tipo === "luta" && l.lugar.vaga.dono === c.id;
    if (c.fase === "chamado" && agora >= c.inicio && chegou(a) && chegou(b)) {
      c.fase = "luta"; c.proxSoco = 0; c.proxGrito = entre(1, 2);
      m.eventos.push({ nome: "torcida" });
    }
    if (c.fase === "luta" && agora < c.fim) {
      if ((c.proxSoco -= dt) <= 0) { c.proxSoco = entre(0.35, 0.8); m.eventos.push({ nome: "soco" }); }
      if ((c.proxGrito -= dt) <= 0) {
        c.proxGrito = entre(2, 3.5);
        const quem = plateiaDe(m, c).filter(o => !o.fala);
        if (quem.length) falar(sorteia(quem), sorteia(FRASES.social.luta), 2.4);
      }
    }
    if (c.fase !== "resultado" && agora >= c.fim) {   // quem não chegou vê o resultado de onde estiver
      c.fase = "resultado";
      const ganhou = c.vencedor === a.id ? a : b, perdeu = ganhou === a ? b : a, ate = c.fim + RESULTADO;
      ganhou.festa = ate; perdeu.tonto = ate;
      falar(ganhou, sorteia(FRASES.social.vitoria), 3);
      perdeu.responde = { em: agora + 1.4, texto: sorteia(FRASES.social.tonto) };
      m.eventos.push({ nome: "vitoria" });
      let som = true;
      for (const o of plateiaDe(m, c)) if (Math.random() < 0.9) {
        o.responde = { em: agora + entre(0.3, 1.1), texto: sorteia(FRASES.social.final), aceno: true, som: som ? "aplauso" : undefined }; som = false;
      }
    }
    const ate = c.fase === "chamado" ? c.inicio : c.fase === "luta" ? c.fim : c.fim + RESULTADO;
    const cs = m.cenaSocial && m.cenaSocial.id === c.id ? m.cenaSocial : (m.cenaSocial = { id: c.id, tipo: "briga", a: c.a, b: c.b, vencedor: c.vencedor });
    cs.x = c.cx; cs.y = c.cy; cs.fase = c.fase; cs.ate = ate;
  }

  // evento do servidor: café junto e fofoca no bebedouro (vaga irmã), os outros num balão onde estão. Sem os envolvidos
  // livres e no prédio, é ignorado. "atendida": os grevistas desta tela agradecem de onde estiverem (quem trabalha, não)
  function encenarEvento(m, ev, agora) {
    if (ev.tipo === "atendida") {
      const ps = (Array.isArray(ev.participantes) ? ev.participantes : []).map(id => m.bonecos.get(id)).filter(o => o && !o.trabalho && noPredio(o));
      ps.forEach((o, i) => { o.responde = { em: agora + 0.3 + i * 0.4, texto: sorteia(FRASES.social.atendida), aceno: true }; });
      if (ps.length) m.eventos.push({ nome: "atendida" });
      if (Number.isInteger(ev.motivo)) novaEntrega(m, ev, agora);   // e o pedido chega
      return;
    }
    const a = m.bonecos.get(ev.a), falas = Object.hasOwn(FRASES.social, ev.tipo) && FRASES.social[ev.tipo];
    if (!Array.isArray(falas) || !a || !livreSocial(a) || naCena(m, a)) return;
    if (ev.tipo === "reclamacao" || ev.tipo === "sugestao") {   // balão de um só, onde ele estiver
      falar(a, sorteia(falas), 3.5); m.eventos.push({ nome: "conversa", voz: a.handle });
      return;
    }
    const b = m.bonecos.get(ev.b);
    if (!Array.isArray(falas[0]) || !b || a === b || !livreSocial(b) || naCena(m, b)) return;
    const [fala, volta] = sorteia(falas);
    falar(a, fala, 3); m.eventos.push({ nome: "conversa", voz: a.handle });
    const parados = [a, b].every(o => !o.rota.length && o.lugar && !(o.lugar.vaga && o.lugar.vaga.temp));
    if ((ev.tipo === "cafe" || ev.tipo === "fofoca") && parados) {   // a fofoca é no bebedouro: café, lanche ou papo, o mais perto
      const serve = ev.tipo === "cafe" ? x => x.tipo === "cafe" : x => BEBIDA.includes(x.tipo);
      const v = m.vagas.filter(x => serve(x) && !x.ocupante && !x.fechada && vagaIrma(m, x)).sort((x, y) => Math.hypot(x.x - a.x, x.y - a.y) - Math.hypot(y.x - a.x, y.y - a.y))[0];
      const irma = v && vagaIrma(m, v);
      if (irma) {
        falar(b, volta, 3);
        irPara(m, a, { tipo: "vaga", vaga: v }); irPara(m, b, { tipo: "vaga", vaga: irma });
        a.parceiro = b.id; b.parceiro = a.id; a.vez = 0; b.vez = 1;   // chegam e conversam, como a dupla do café
        return;
      }
    }
    b.responde = { em: agora + 1.6, texto: volta };
  }

  // --- interface do brincar.js (Front): objeto clicado no mapa e festa geral (Konami) --------
  // Só quem está livre reage; quem trabalha ou espera você não sai da mesa.
  const ALVO_CLIQUE = { cafe: v => v.tipo === "cafe", tv: v => v.tipo === "tv", arcade: v => v.tipo === "arcade", jukebox: v => v.tipo === "musica" && v.jukebox };
  const salaEm = (m, x, y) => m.predio.salas.find(s => x >= s.px && x <= s.px + s.pw && y >= s.py && y <= s.py + s.ph)
    || m.predio.baixo.find(s => x >= s.px && x <= s.px + s.pw && y >= s.py && y <= s.py + s.ph) || null;

  function objetoClicado(m, alvo) {
    const { tipo, x, y } = alvo || {};
    if (!m || typeof tipo !== "string" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const agora = performance.now() / 1000, sala = (alvo && alvo.sala) || salaEm(m, x, y);
    const nota = b => Math.hypot(b.x - x, b.y - y) + (sala && b.lugar.vaga.sala !== sala ? 400 : 0);
    const perto = m.lista.filter(b => !b.trabalho && !b.reuniao && !b.grupo && !b.parceiro && !b.rota.length && b.lugar && b.lugar.tipo === "vaga"
      && !b.lugar.vaga.temp && !(b.violao > agora)).sort((a, b) => nota(a) - nota(b));
    if (Object.hasOwn(ALVO_CLIQUE, tipo)) {   // só as chaves próprias: "constructor", "toString"... são tipo desconhecido
      const v = m.vagas.filter(v => ALVO_CLIQUE[tipo](v) && !v.ocupante && !v.fechada).sort((a, c) => Math.hypot(a.x - x, a.y - y) - Math.hypot(c.x - x, c.y - y))[0];
      if (v && perto.length) irPara(m, perto[0], { tipo: "vaga", vaga: v });
      return;
    }
    if (tipo === "gato") { verGato(m, agora); return; }
    if (tipo === "sino") {   // até 3 livres comemoram; quem está por perto (menos quem espera você) aplaude
      const festa = perto.slice(0, 3);
      for (const b of festa) b.festa = agora + 2.6;
      if (festa[0]) falar(festa[0], sorteia(FRASES.objeto.sino), 3);
      let som = true;
      for (const o of m.lista) if (!festa.includes(o) && !esperando(o) && o.lugar && o.lugar.tipo !== "fora" && Math.hypot(o.x - x, o.y - y) < 260) {
        o.responde = { em: agora + entre(0.4, 1.2), texto: sorteia(FRASES.aplauso), aceno: true, som: som ? "aplauso" : undefined }; som = false;
      }
      return;
    }
    if (tipo === "aquario") {   // alguém vai olhar de perto, num ponto livre e alcançável na frente
      const s = sala || salaEm(m, x, y + 8);
      if (!s || !perto.length) return;
      for (const dx of [0, -12, 12]) {
        const v = { sala: s, x: Math.round(x + dx), y: Math.round(Math.min(y + 8, s.py + s.ph - 6)), tipo: "aquario", olha: "cima", temp: true };
        v.chave = v.y + 0.5;
        if ((!m.predio.livre || m.predio.livre(v.x, v.y)) && alcanca(m, v)) { irPara(m, perto[0], { tipo: "vaga", vaga: v }); return; }
      }
      return;
    }
    const frases = Object.hasOwn(FRASES.objeto, tipo) && FRASES.objeto[tipo];   // lousa, quadro de avisos, relógio, luminária, planta: um comentário
    if (frases && perto.length && Math.hypot(perto[0].x - x, perto[0].y - y) < 260) { falar(perto[0], sorteia(frases), 3); m.eventos.push({ nome: "conversa", voz: perto[0].handle }); }
  }

  function festaGeral(m, seg) {
    if (!m) return;
    const agora = performance.now() / 1000, dur = Math.min(Math.max(Number(seg) || 8, 1), 30);
    for (const b of m.lista) {
      if (esperando(b) || (!b.lugar && !b.rota.length)) continue;   // quem espera você fica como está
      if (b.lugar && (b.lugar.tipo === "mesa" || (b.lugar.vaga && b.lugar.vaga.senta))) b.festa = agora + Math.min(dur, 3);   // comemora sem levantar
      else b.danca = agora + dur;
    }
  }

  // quem joga sozinho no fliperama/videogame faz barulhinho de jogo (e às vezes bate o recorde)
  function jogosSozinho(m, dt) {
    if ((m.proxJogo -= dt) > 0) return;
    m.proxJogo = entre(1.2, 2.2);
    for (const b of m.lista) {   // dardos e basquete sozinho: um arremesso a cada poucos segundos
      const v = !b.rota.length && b.lugar && b.lugar.vaga;
      if (!v || !ARREMESSO.has(v.tipo) || b.parceiro || performance.now() / 1000 < (b.proxArremesso || 0)) continue;
      const agora = performance.now() / 1000, acerta = Math.random() < 0.5;
      b.proxArremesso = agora + entre(3.5, 6); b.arremesso = agora + 0.8;
      if (!b.fala || Math.random() < 0.5) falar(b, sorteia(FRASES[v.tipo][acerta ? "acerto" : "erro"]), 2.2);
      m.eventos.push({ nome: v.tipo === "dardos" ? "dardo" : "cesta", acerto: acerta });
    }
    const jogando = m.lista.filter(b => !b.rota.length && b.lugar && b.lugar.vaga && ["arcade", "videogame", "pc"].includes(b.lugar.vaga.tipo));
    if (!jogando.length) return;
    m.eventos.push({ nome: "jogo_arcade" });
    const b = sorteia(jogando);
    if (!b.parceiro && !b.fala && Math.random() < 0.06) { b.festa = performance.now() / 1000 + 1.6; falar(b, sorteia(FRASES.recorde), 2.4); m.eventos.push({ nome: "vitoria" }); }
  }

  // papo solto: alguém livre comenta a atividade e um vizinho responde
  function papo(m, dt, agora) {
    if ((m.proxPapo -= dt) > 0) return;
    m.proxPapo = entre(5, 11);
    const livres = m.lista.filter(b => !b.rota.length && b.lugar && b.lugar.tipo === "vaga" && !b.lugar.vaga.temp && !b.fala && !b.grupo);
    if (!livres.length) return;
    const a = sorteia(livres), tipo = a.lugar.vaga.tipo;
    const festa = window.Festas && Festas.ativa(), mo = m.mo;
    falar(a, mo && mo.nome === "daily" && tipo === "reuniao" ? sorteia(FRASES.daily)
      : festa && Math.random() < 0.35 ? sorteia(festa.falas) : sorteia(FRASES.atividade[tipo] || FRASES.atividade.papo), 4);
    m.eventos.push(tipo === "arcade" || tipo === "videogame" ? { nome: "jogo_arcade" } : { nome: "conversa", voz: a.handle });
    const perto = livres.filter(o => o !== a && Math.hypot(o.x - a.x, o.y - a.y) < 90);
    if (perto.length && Math.random() < 0.7) sorteia(perto).responde = { em: agora + 1.8, texto: sorteia(FRASES.respostas) };
  }

  // de vez em quando alguém na mesa solta um balão genérico do que faz (pela função, sem conteúdo)
  function comentarTrabalho(m, dt) {
    if ((m.proxTrabalho -= dt) > 0) return;
    m.proxTrabalho = entre(14, 30);
    const naMesa = m.lista.filter(b => b.lugar && b.lugar.tipo === "mesa" && b.trabalho && !b.fala);
    if (!naMesa.length) return;
    const b = sorteia(naMesa);
    if (b.trabalho.status === "waiting_approval") falar(b, FRASES.estado.aindaAprovacao, 5);
    else if (b.trabalho.status === "waiting_input") falar(b, FRASES.estado.aindaPergunta, 5);
    else falar(b, sorteia(FRASES.trabalho[b.papel] || FRASES.trabalho.geral), 4);
  }

  // --- pessoas da equipe: quem está com o escritório aberto neste andar (presenca.py) --------------------------
  // Figurantes, como o entregador: fora do m.bonecos, da vida social, das mesas e das vagas (não tiram o lugar de
  // ninguém). Este arquivo é o único dono do polling do GET /api/ao-vivo: a cada resposta dispara o evento "aovivo"
  // (o chat da sala lê as mensagens dele) e, quando a minha sala muda, o "minha-sala". O meu boneco anda pelo clique e
  // manda ao servidor só o destino (POST /api/presenca, no máximo 2 por segundo); os outros andam até o destino deles
  // com o mesmo caminho dos agentes. Fica fora do mundo (m) porque o app.js remonta o mundo quando os times mudam.
  // O meu nome e boneco são os do servidor (fonte única, os mesmos que os outros veem): o /api/perfil, relido a cada
  // PERFIL_A_CADA ms (mudou no "Meu perfil", o mapa acompanha), ou a minha entrada no /api/ao-vivo, se vier.
  const AO_VIVO_VISIVEL = 1500, AO_VIVO_ESCONDIDO = 10000, ENVIO_MIN = 500, RENOVAR = 20000, PERFIL_A_CADA = 15000, COORD_MAX = 8192;
  const vivo = { ger: 0, ligado: false, lido: false, andar: null, seq: 0, falhas: 0, timer: 0, envio: 0, enviado: -1e9, perfilEm: -1e9,
    invisivel: () => true, perfil: null, m: null, eu: null, avisada: null,   // avisada: a última sala do evento "minha-sala"
    pessoas: new Map() };   // pessoas: os outros, por usuário

  // liga (ou religa, ao trocar de andar) o polling; null desliga. invisivel(): a TV e quem desligou "Aparecer" só leem
  function aoVivo(opcoes) {
    vivo.ger++; clearTimeout(vivo.timer); clearTimeout(vivo.envio); vivo.envio = 0;
    if (vivo.eu) { vivo.eu = null; avisarSala(null); }
    vivo.pessoas.clear(); vivo.seq = 0; vivo.falhas = 0; vivo.avisada = null; vivo.lido = false; vivo.ligado = !!opcoes;
    if (!opcoes) return;
    vivo.andar = Andar.atual; vivo.invisivel = opcoes.invisivel || (() => false);
    lerPerfil(vivo.ger);
    lerAoVivo(vivo.ger);
  }
  function lerPerfil(ger) {
    vivo.perfilEm = performance.now();
    fetch(Andar.com("api/perfil", vivo.andar), { cache: "no-store", credentials: "same-origin" })
      .then(r => (r.ok ? r.json() : null)).then(p => {
        if (ger !== vivo.ger || !p || typeof p.usuario !== "string") return;   // prévia (sem conta) ou outro andar: sem o meu boneco
        meuPerfil(p.usuario, p.nome, p.aparencia || p.avatar);   // aparencia: a efetiva (a salva ou o padrão do servidor)
      }).catch(() => {});
  }
  function meuPerfil(usuario, nome, ap) {
    vivo.perfil = { usuario, nome: nomeDe(nome, usuario), ap: apDe(ap, usuario) };
    if (vivo.eu) { vivo.eu.nome = `${vivo.perfil.nome} (você)`; vivo.eu.ap = vivo.perfil.ap; }
  }
  const nomeDe = (nome, usuario) => String(typeof nome === "string" && nome.trim() ? nome : usuario).slice(0, 40);
  // servidor antigo, sem a aparência efetiva: o padrão do front (o mesmo do "Meu perfil")
  const apDe = (ap, usuario) => (ap && typeof ap === "object" && typeof ap.color === "string" ? ap : Avatar.padrao(usuario));
  const coord = v => Math.max(0, Math.min(COORD_MAX, Math.round(v)));

  async function lerAoVivo(ger) {
    try {
      const url = `api/ao-vivo?desde=${vivo.seq}${vivo.invisivel() ? "&invisivel=1" : ""}`;
      const r = await fetch(Andar.com(url, vivo.andar), { cache: "no-store", credentials: "same-origin" });
      if (ger !== vivo.ger) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (ger !== vivo.ger) return;
      if (!d || !Number.isInteger(d.seq) || !Array.isArray(d.pessoas)) throw new Error("resposta inválida");
      vivo.falhas = 0; vivo.seq = d.seq; vivo.lido = true;
      receber(d.pessoas);
      if (performance.now() - vivo.perfilEm >= PERFIL_A_CADA) lerPerfil(ger);
      window.dispatchEvent(new CustomEvent("aovivo", { detail: d }));
    } catch (e) {
      if (ger !== vivo.ger) return;
      vivo.falhas++;
    }
    const base = document.hidden ? AO_VIVO_ESCONDIDO : AO_VIVO_VISIVEL;   // 429, queda ou servidor antigo: espaça
    vivo.timer = setTimeout(() => lerAoVivo(ger), vivo.falhas ? Math.min(60000, base * 2 ** Math.min(vivo.falhas, 5)) : base);
  }
  document.addEventListener("visibilitychange", () => {   // voltou para a aba: lê já, sem esperar os 10 s
    if (document.hidden || !vivo.ligado || vivo.falhas) return;
    clearTimeout(vivo.timer); lerAoVivo(vivo.ger);
  });

  function receber(lista) {
    const vistos = new Set(), m = vivo.m;
    for (const it of lista.slice(0, 64)) {
      if (!it || typeof it.usuario !== "string" || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
      const alvo = Array.isArray(it.destino) && it.destino.length === 2 && it.destino.every(Number.isFinite) ? it.destino : [it.x, it.y];
      if (vivo.perfil && it.usuario === vivo.perfil.usuario) { meuPerfil(it.usuario, it.nome, it.aparencia); continue; }   // eu (outra aba)
      vistos.add(it.usuario);
      let p = vivo.pessoas.get(it.usuario);
      if (!p) { p = novaPessoa(it.usuario, it.x, it.y); vivo.pessoas.set(it.usuario, p); }
      p.nome = nomeDe(it.nome, it.usuario); p.ap = apDe(it.aparencia, it.usuario);
      p.parado = DIRECOES.has(it.olha) ? it.olha : "baixo";
      if (p.alvo && p.alvo[0] === alvo[0] && p.alvo[1] === alvo[1]) continue;
      p.alvo = alvo;   // destino novo: anda até lá (sem caminho, aparece direto)
      p.rota = (m && rotaAte(m, [p.x, p.y], alvo)) || [];
      if (!p.rota.length) { p.x = alvo[0]; p.y = alvo[1]; }
    }
    for (const u of [...vivo.pessoas.keys()]) if (!vistos.has(u)) vivo.pessoas.delete(u);   // fechou o escritório (TTL) ou trocou de andar
  }
  const DIRECOES = new Set(["baixo", "cima", "esq", "dir"]);
  const novaPessoa = (id, x, y) => ({ id: "pessoa:" + id, nome: "", ap: null, x, y, rota: [], alvo: null, sala: "", pose: "parado",
    olha: "baixo", parado: "baixo", passos: 0, pausa: 0, semente: semente(id) });
  const semente = txt => { let h = 7; for (const ch of txt) h = (h * 31 + ch.charCodeAt(0)) % 997; return h; };

  // de a até b, com o caminho dos agentes: dentro da sala, porta, corredor, porta e dentro da outra sala
  function rotaAte(m, a, b) {
    const sa = salaEm(m, a[0], a[1]), sb = salaEm(m, b[0], b[1]), cy = m.predio.corredorY;
    if (sa && sa === sb) return rotaNaSala(m, sa, a, b);
    const ida = sa ? rotaDaSala(m, sa, a) : [[a[0], cy]];
    if (!sb) return [...ida, [b[0], cy], [b[0], b[1]]];
    const e = portaPerto(m, sb, b[0]), dentro = rotaNaSala(m, sb, e.dentro, b);
    return dentro && [...ida, ...[...e.fora].reverse(), e.dentro, ...dentro];
  }
  // o ponto de chão livre mais perto do clique, numa sala ou no corredor; fora disso (rua, telhado), nenhum
  function pontoDoClique(m, x, y) {
    const s = salaEm(m, x, y), p = m.predio;
    if (!s) {
      const r = p.predioRet, topo = p.corredorTopo;
      return x >= r.x + 16 && x <= r.x + r.w - 16 && y >= topo && y <= topo + p.corredorAlt ? [x, Math.max(topo + 8, Math.min(topo + p.corredorAlt - 4, y))] : null;
    }
    const g = grade(m, s), i0 = Math.floor((x - g.x0) / GRADE), j0 = Math.floor((y - g.y0) / GRADE);
    let melhor = null, dm = 1e9;
    for (let j = Math.max(0, j0 - 6); j <= Math.min(g.lins - 1, j0 + 6); j++)
      for (let i = Math.max(0, i0 - 6); i <= Math.min(g.cols - 1, i0 + 6); i++) {
        const d = (i - i0) ** 2 + (j - j0) ** 2;
        if (g.livre[j * g.cols + i] && d < dm) { dm = d; melhor = [g.x0 + i * GRADE + GRADE / 2, g.y0 + j * GRADE + GRADE / 2]; }
      }
    return melhor;
  }

  // o clique no chão do mapa (app.js): o meu boneco vai até lá. Devolve true quando andou
  function irAte(m, p) {
    const eu = vivo.eu;
    if (!eu || m !== vivo.m || !p) return false;
    const alvo = pontoDoClique(m, p.x, p.y), rota = alvo && rotaAte(m, [eu.x, eu.y], alvo);
    if (!rota || !rota.length) return false;
    eu.rota = rota;
    enviarPresenca();
    return true;
  }

  // entra pela rua até um canto livre da recepção
  function nascer(m) {
    const { nome, ap } = vivo.perfil, e = m.predio.entrada, cy = m.predio.corredorY;
    const recepcao = m.predio.salas.find(s => s.tipo === "recepcao"), alvo = recepcao && pontoDeVisita(m, recepcao);
    vivo.eu = { ...novaPessoa("eu", e.x - 22, e.calcadaY), id: "eu", nome: `${nome} (você)`, ap, eu: true, salaNome: "Corredor",
      rota: alvo ? [[e.x - 22, cy], [e.x, cy], ...alvo.r] : [[e.x - 22, cy], [e.x, cy]] };
    enviarPresenca();
  }

  // "minha-sala" {sala, nome, andar, seq}: só quando o servidor aceitou a sala nova (é ele quem decide a sala do chat).
  // sala null: o meu boneco saiu (outro andar, TV, "Aparecer" desligado). seq: o do POST que mudou a sala (sem ele, o da
  // última leitura); o chat ignora mensagens de seq menor, que só podem ser da sala de antes (um GET atrasado)
  function avisarSala(sala, nome = null, seq = vivo.seq) {
    if (sala === vivo.avisada) return;
    vivo.avisada = sala;
    window.dispatchEvent(new CustomEvent("minha-sala", { detail: { sala, nome: sala === null ? null : nome, andar: vivo.andar, seq } }));
  }

  // POST /api/presenca com a posição e o destino do meu boneco: no máximo 1 a cada ENVIO_MIN ms (o que chega no meio
  // espera e sai com o estado mais novo). Falhou (429, queda): tenta de novo em 2 s
  function enviarPresenca() {
    if (!vivo.eu || vivo.envio) return;
    const falta = vivo.enviado + ENVIO_MIN - performance.now();
    if (falta > 0) { vivo.envio = setTimeout(() => { vivo.envio = 0; enviarPresenca(); }, falta); return; }
    const eu = vivo.eu, fim = eu.rota.length ? eu.rota[eu.rota.length - 1] : null;
    vivo.enviado = performance.now();
    const corpo = { x: coord(eu.x), y: coord(eu.y), destino: fim && [coord(fim[0]), coord(fim[1])], sala: eu.sala, olha: eu.olha };
    const ger = vivo.ger, nome = eu.salaNome, falhou = () => {
      if (ger === vivo.ger && vivo.eu && !vivo.envio) vivo.envio = setTimeout(() => { vivo.envio = 0; enviarPresenca(); }, 2000);
    };
    fetch(Andar.com("api/presenca", vivo.andar), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo) }).then(async r => {
      if (!r.ok) return falhou();
      const d = await r.json().catch(() => null);
      if (ger === vivo.ger && vivo.eu === eu) avisarSala(corpo.sala, nome, d && Number.isInteger(d.seq) ? d.seq : vivo.seq);
    }).catch(falhou);
  }

  // a cada quadro (Vida.passo): os outros e o meu boneco andam; a minha sala é a do chão onde piso
  function passoPessoas(m, dt, agora) {
    if (vivo.m !== m) { // o app.js remontou o prédio: quem andava chega direto, no mundo novo
      if (vivo.m) for (const p of [...vivo.pessoas.values(), ...(vivo.eu ? [vivo.eu] : [])]) {
        const fim = p.rota.length ? p.rota[p.rota.length - 1] : null;
        if (fim) { p.x = fim[0]; p.y = fim[1]; p.rota = []; }
      }
      vivo.m = m;
    }
    if (!vivo.ligado) return;
    for (const p of vivo.pessoas.values()) andarPessoa(m, p, dt, agora);
    if (vivo.eu && vivo.invisivel()) { vivo.eu = null; avisarSala(null); }   // desligou "Aparecer" (a marca some no servidor pelo TTL)
    if (!vivo.eu && vivo.perfil && !vivo.invisivel()) nascer(m);
    const eu = vivo.eu;
    if (!eu) return;
    const andava = eu.rota.length > 0;
    andarPessoa(m, eu, dt, agora);
    const s = salaEm(m, eu.x, eu.y), sala = s && typeof s.chave === "string" ? s.chave : "";
    if (sala !== eu.sala) { eu.sala = sala; eu.salaNome = s ? s.nome : "Corredor"; enviarPresenca(); }
    else if ((andava && !eu.rota.length) || performance.now() - vivo.enviado > RENOVAR) enviarPresenca();   // chegou, ou renova
  }
  function andarPessoa(m, p, dt, agora) {
    if (p.rota.length) andar(m, p, dt, agora);
    if (!p.rota.length && !p.eu) p.olha = p.parado;   // parado: olha para onde a pessoa olha na tela dela
    p.pose = p.rota.length ? "andando" : "parado"; p.chave = p.y + 0.5;
  }
  // quem desenhar (app.js): os outros e eu, fora quem ainda está na rua, fora da tela
  const pessoas = () => [...vivo.pessoas.values(), ...(vivo.eu ? [vivo.eu] : [])].filter(p => p.x > -20);
  // quantos outros estão neste andar agora (a linha "N pessoas olhando"); null antes da 1ª leitura ou desligado
  const olhando = () => (vivo.ligado && vivo.lido ? vivo.pessoas.size : null);

  // um ponto de chão livre na sala, longe das vagas dos agentes e com caminho até a porta
  function pontoDeVisita(m, s) {
    const g = grade(m, s);
    for (let i = 0; i < 30; i++) {
      const c = Math.floor(Math.random() * g.cols * g.lins);
      if (!g.livre[c]) continue;
      const p = [g.x0 + (c % g.cols) * GRADE + GRADE / 2, g.y0 + Math.floor(c / g.cols) * GRADE + GRADE / 2];
      if (m.vagas.some(q => Math.hypot(q.x - p[0], q.y - p[1]) < 14)) continue;
      const e = portaPerto(m, s, p[0]), r = rotaNaSala(m, s, e.dentro, p);
      if (r) return { p, r: [...[...e.fora].reverse(), e.dentro, ...r] };
    }
    return null;
  }
  function rotaDaSala(m, s, p) { const e = portaPerto(m, s, p[0]); return [...(rotaNaSala(m, s, p, e.dentro) || [e.dentro]), ...e.fora]; }

  function digitando(m) {
    let n = 0;
    for (const b of m.lista) if (b.pose === "digitando") n++;
    return n;
  }

  return { criarMundo, sincronizar, passo, digitando, momento, objetoClicado, festaGeral, social, aoVivo, irAte, pessoas, olhando, textoGreve, FRASES };
})();

window.Vida = Vida;
