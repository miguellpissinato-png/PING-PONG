/* Placar Disputa Elsys — placar, ranking, histórico de confrontos, partida ao vivo e jogo rápido.
   Ninguém precisa de senha para jogar; só os admins entram com apelido + PIN.
   Jogo rápido: em vez de marcar ponto a ponto, escolhe os dois jogadores e quem venceu.
   Jogadores, partidas e a partida em andamento ficam num banco Supabase compartilhado.
   Só existe uma partida ao vivo por vez: quem a iniciou marca os pontos e todo mundo
   que abre o site acompanha o mesmo placar em tempo real. */
(function () {
  'use strict';

  /* Endereço do banco e chaves públicas. As chaves só permitem o que as regras do banco liberam:
     ver jogadores, partidas e a partida ao vivo, cadastrar e tirar jogador da lista, e mexer na
     partida ao vivo pelas funções do banco (marcar pontos exige a chave do aparelho que iniciou). */
  var DB_URL = 'https://idpwiefikugfqumjpfpa.supabase.co';
  var DB_KEY = 'sb_publishable_Cx_TgsTk8eKstxL6_PGg6Q_8eAmeBve';
  var DB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkcHdpZWZpa3VnZnF1bWpwZnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MTM2NzQsImV4cCI6MjEwODA4OTY3NH0.PmOOIktDQJgPF_b84mh8EZ4WwK36422v8G8BZnMc8pg';
  var OWNER_KEY = 'disputa-elsys-dono';        // chave deste aparelho para a partida que ele iniciou
  var SESSION_KEY = 'disputa-elsys-sessao';     // login deste aparelho
  var STALE_MS = 20 * 60 * 1000;                // partida sem ponto há 20 min pode ser liberada
  var HEARTBEAT_MS = 4 * 60 * 1000;             // quem marca avisa o banco que a partida segue viva
  var DOUBLE_TAP_MS = 320;                      // dois toques no mesmo placar dentro deste tempo tiram 1 ponto
  var TUTORIAL_KEY = 'disputa-elsys-tutorial-v3'; // este aparelho já viu o tutorial (com o jogo rápido)
  var TUTORIAL_OLD = 'disputa-elsys-tutorial-v2'; // tutorial antigo: quem já viu recebe só a novidade
  var EU_KEY = 'disputa-elsys-eu';              // jogador que a pessoa marcou como "este sou eu" neste aparelho
  var REGRA_KEY = 'disputa-elsys-regras';       // últimas regras escolhidas neste aparelho
  var MODO_KEY = 'disputa-elsys-modo';          // último tipo de partida usado neste aparelho: 'pontos' ou 'rapido'
  var UNDO_MS = 2 * 60 * 1000;                  // jogo rápido registrado pode ser desfeito neste prazo (no aparelho que registrou)

  var st = {
    tab: 'partida',
    players: [], names: {}, matches: [],
    seenMatches: null,   // ids de partidas já conhecidas (null até a primeira carga)
    winFlash: null,      // { match, winner, loser, until } — destaque do vencedor recém-salvo
    loaded: false, netErr: false, busy: false,
    // ninguém precisa entrar para jogar. "me" é só o login de admin (apelido + PIN), usado no painel.
    me: null, authNome: '', authPin: '', authErr: '', authBusy: false,
    eu: null,            // jogador marcado como "este sou eu" neste aparelho (sem senha)
    jog: null,           // jogador aberto na aba Jogadores
    novo: false, novoNome: '', novoErr: '', histFiltro: '',
    picked: [], firstPick: 1, startErr: '',
    // tipo de partida: 'pontos' (marcada ponto a ponto, ao vivo) ou 'rapido' (só escolhe quem venceu)
    modo: 'pontos', vencedor: 0,
    rapidoFeito: null,   // { id, chave, winner, loser, until } — jogo rápido que este aparelho acabou de registrar
    rapidoArm: false,    // DESFAZER do jogo rápido pedindo confirmação
    rankMsg: null,       // { text, until } — aviso curto no topo do ranking
    onbNovo: false,      // tutorial aberto só para mostrar a novidade (jogo rápido)
    // regras da próxima partida (escolhidas antes de INICIAR; o aparelho lembra as últimas usadas)
    regra: null, regraTxt: null, regraAberta: false,
    live: null,          // partida ao vivo vinda do banco (ou null)
    rt: false,           // tempo real conectado
    // partida que ESTE aparelho está marcando
    playing: false, m1: null, m2: null, hist: [], g1: 0, g2: 0, first: 1, pts1: 0, pts2: 0,
    mregra: null,        // regras da partida que este aparelho está marcando
    quitArm: false, saveErr: '', syncErr: '',
    tapFx: null,         // { v, text, minus, until } — +1 / −1 que aparece no placar tocado
    onb: null,           // passo do tutorial aberto (ou null)
    // painel admin (só para quem tem papel 'dono' ou 'admin')
    adm: null,           // { papel, partidas, jogadores: [...] } vindo do banco
    admBusy: false, admErr: '', admMsg: '', admSel: null, admArm: '',
    admForm: '', admFormVal: ''   // formulário aberto no painel: 'ren' (apelido), 'pin' ou 'pinAdmin' (PIN para virar admin)
  };

  function set(patch) {
    for (var k in patch) st[k] = patch[k];
    render();
  }

  /* ---------- banco ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = { apikey: DB_KEY, 'Content-Type': 'application/json' };
    if (opts.prefer) headers.Prefer = opts.prefer;
    return fetch(DB_URL + '/rest/v1/' + path, {
      method: opts.method || 'GET', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.ok) return r.status === 204 ? null : r.text().then(function (t) { return t ? JSON.parse(t) : null; });
      return r.text().then(function (t) {
        var err = new Error('HTTP ' + r.status); err.status = r.status;
        try { err.body = JSON.parse(t); } catch (e) { err.body = t; }
        err.code = err.body && err.body.message;
        throw err;
      });
    });
  }
  function rpc(fn, args) { return api('rpc/' + fn, { method: 'POST', body: args }); }

  /* Converte um horário do banco em microssegundos desde 1970. O banco e o tempo real mandam formatos
     como "2026-10-20T18:16:00.775056+00:00" e "2026-10-20 18:16:00.775056+00"; o Safari não lê
     todos com Date.parse, então a leitura é feita aqui. */
  function tsMicros(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(String(s || '').trim());
    if (!m) return NaN;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    var frac = ((m[7] || '') + '000000').slice(0, 6);
    var off = 0, z = m[8];
    if (z && z.toUpperCase() !== 'Z') {
      var sign = z[0] === '-' ? -1 : 1, d = z.slice(1).replace(':', '');
      off = sign * (parseInt(d.slice(0, 2), 10) * 60 + (parseInt(d.slice(2, 4), 10) || 0));
    }
    return (ms - off * 60000) * 1000 + parseInt(frac, 10);
  }

  var memToken = null;
  function loadToken() {
    try { var t = localStorage.getItem(SESSION_KEY); if (t) return t; } catch (e) {}
    return memToken;
  }
  function saveToken(t) {
    memToken = t || null;
    try { if (t) localStorage.setItem(SESSION_KEY, t); else localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* "Este sou eu": guardado só neste aparelho, sem senha. Serve para destacar a pessoa no ranking. */
  function loadEu() {
    try { var v = Number(localStorage.getItem(EU_KEY)); return v || null; } catch (e) { return null; }
  }
  function saveEu(id) {
    try { if (id) localStorage.setItem(EU_KEY, String(id)); else localStorage.removeItem(EU_KEY); } catch (e) {}
    set({ eu: id || null });
  }

  /* ---------- regras da partida ----------
     Cada partida tem as próprias regras, escolhidas por quem inicia. Nada é fixo no sistema:
     pontos  pontos para vencer um jogo (qualquer número a partir de 1)
     vantagem  true = empatou perto do fim, vence quem abrir 2 pontos; false = quem chegar primeiro vence
     direto  vitória direta: quem fizer esse número de pontos antes de o adversário marcar vence na hora (0 = desligada)
     jogos  jogos que é preciso vencer para levar a partida (1 = jogo único, 2 = melhor de 3...) */
  var REGRA_PADRAO = { pontos: 11, vantagem: true, direto: false, diretoN: 3, jogos: 2 };
  function loadRegra() {
    var r = Object.assign({}, REGRA_PADRAO);
    try {
      var s = JSON.parse(localStorage.getItem(REGRA_KEY) || 'null');
      if (s) {
        if (s.pontos >= 1) r.pontos = Math.floor(s.pontos);
        if (typeof s.vantagem === 'boolean') r.vantagem = s.vantagem;
        if (typeof s.direto === 'boolean') r.direto = s.direto;
        if (s.diretoN >= 1) r.diretoN = Math.floor(s.diretoN);
        if (s.jogos >= 1) r.jogos = Math.floor(s.jogos);
      }
    } catch (e) {}
    return r;
  }
  function saveRegra() {
    try { localStorage.setItem(REGRA_KEY, JSON.stringify(st.regra)); } catch (e) {}
  }
  function regraTexto(r) { return { pontos: String(r.pontos), diretoN: String(r.diretoN) }; }
  // regras da partida a partir das escolhas na tela de preparação
  function regraDoEditor() {
    var r = st.regra;
    return { pontos: r.pontos, vantagem: r.vantagem, direto: r.direto ? r.diretoN : 0, jogos: r.jogos };
  }
  // regras de uma partida vinda do banco (as antigas não têm regra: 11 pontos, vantagem de 2, melhor de 3)
  function regraDe(row) {
    return {
      pontos: row && row.regra_pontos >= 1 ? row.regra_pontos : 11,
      vantagem: !(row && row.regra_vantagem === false),
      direto: row && row.regra_direto >= 1 ? row.regra_direto : 0,
      jogos: row && row.regra_jogos >= 1 ? row.regra_jogos : 2
    };
  }
  function jogosTexto(j) { return j === 1 ? 'JOGO ÚNICO' : 'MELHOR DE ' + (2 * j - 1); }
  function regraResumo(r) {
    var p = [(r.pontos === 1 ? '1 PONTO' : r.pontos + ' PONTOS')];
    p.push(r.vantagem ? 'VANTAGEM DE 2' : 'SEM VANTAGEM');
    if (r.direto) p.push('DIRETO EM ' + r.direto);
    p.push(jogosTexto(r.jogos));
    return p.join(' · ');
  }
  // placar de uma partida salva: jogo único mostra os pontos; mais de um jogo mostra os jogos
  function placar(m) {
    return regraDe(m).jogos === 1 ? [m.pontos_a, m.pontos_b] : [m.jogos_a, m.jogos_b];
  }
  // como a vitória aparece nas frases: "por 3 x 1" ou, no jogo rápido (sem pontos), "no jogo rápido"
  function comoVenceu(m) {
    if (m.rapido) return 'no jogo rápido';
    var pl = placar(m), aWon = m.jogos_a > m.jogos_b;
    return 'por ' + (aWon ? pl[0] + ' x ' + pl[1] : pl[1] + ' x ' + pl[0]);
  }

  /* Tipo de partida: COM PONTOS (marcada ponto a ponto) ou JOGO RÁPIDO (só o vencedor). O aparelho lembra o último. */
  function loadModo() {
    try { return localStorage.getItem(MODO_KEY) === 'rapido' ? 'rapido' : 'pontos'; } catch (e) { return 'pontos'; }
  }
  function saveModo(m) {
    try { localStorage.setItem(MODO_KEY, m); } catch (e) {}
  }

  /* Login de admin guardado neste aparelho. Só vale para quem é dono ou admin. */
  function checkSession() {
    var t = loadToken();
    if (!t) { st.me = null; render(); return Promise.resolve(); }
    return rpc('meu_perfil', { p_token: t }).then(function (r) {
      if (r && r.ok && r.papel) {
        st.me = { id: r.id, nome: r.nome, papel: r.papel };
        render();
        return;
      }
      // login antigo de quem não é admin (de quando todo mundo entrava com PIN): sai
      saveToken(null);
      if (r && r.ok) rpc('sair', { p_token: t }).catch(function () {});
      set({ me: null, adm: null });
    }).catch(function () {
      setTimeout(checkSession, 4000);
    });
  }

  var AUTH_MSG = {
    apelido_invalido: 'Digite um apelido de 1 a 10 letras.',
    pin_invalido: 'O PIN precisa ter 4 números.',
    apelido_em_uso: 'Esse apelido já está na lista.',
    apelido_nao_encontrado: 'Não achamos esse apelido.',
    sem_pin: 'Esse jogador não tem PIN de admin.',
    nao_admin: 'Esse jogador não é admin do placar.',
    pin_incorreto: 'PIN errado.',
    bloqueado: 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.'
  };

  /* Área admin: apelido + PIN. Quem não é admin não entra. */
  function doAuth() {
    if (st.authBusy) return;
    var nome = (st.authNome || '').trim().toUpperCase().slice(0, 10);
    var pin = st.authPin || '';
    if (!nome) { set({ authErr: AUTH_MSG.apelido_invalido }); return; }
    if (!/^[0-9]{4}$/.test(pin)) { set({ authErr: AUTH_MSG.pin_invalido }); return; }
    set({ authBusy: true, authErr: '' });
    rpc('entrar', { p_nome: nome, p_pin: pin }).then(function (r) {
      if (!(r && r.ok)) {
        var msg = AUTH_MSG[r && r.erro] || 'Não deu certo. Tente de novo.';
        if (r && r.erro === 'pin_incorreto' && r.restantes) msg += ' Restam ' + r.restantes + ' tentativa' + (r.restantes > 1 ? 's' : '') + '.';
        if (r && r.erro === 'bloqueado' && r.segundos) msg = 'Muitas tentativas erradas. Tente de novo em ' + Math.ceil(r.segundos / 60) + ' min.';
        set({ authBusy: false, authErr: msg, authPin: '' });
        return;
      }
      return rpc('meu_perfil', { p_token: r.token }).then(function (p) {
        if (!(p && p.ok && p.papel)) {
          rpc('sair', { p_token: r.token }).catch(function () {});
          set({ authBusy: false, authErr: AUTH_MSG.nao_admin, authPin: '' });
          return;
        }
        saveToken(r.token);
        st.me = { id: p.id, nome: p.nome, papel: p.papel };
        set({ authBusy: false, authPin: '', authNome: '', authErr: '', tab: 'admin', admErr: '', admMsg: '', admSel: null });
        loadAdmin();
      });
    }).catch(function () {
      set({ authBusy: false, authErr: 'Sem conexão. Confira a internet e tente de novo.' });
    });
  }

  function logout() {
    var t = loadToken();
    saveToken(null);
    if (t) rpc('sair', { p_token: t }).catch(function () {});
    set({ me: null, tab: 'jogadores', jog: null, adm: null, admErr: '', admMsg: '', admSel: null, admArm: '', admForm: '' });
  }

  /* Novo jogador: só o apelido, sem PIN. Entra direto numa vaga livre da mesa. */
  function addPlayer() {
    if (st.busy) return;
    var nome = (st.novoNome || '').trim().toUpperCase().slice(0, 10);
    if (!nome) { set({ novoErr: AUTH_MSG.apelido_invalido }); return; }
    set({ busy: true, novoErr: '' });
    rpc('criar_jogador', { p_nome: nome }).then(function (r) {
      st.busy = false;
      if (!(r && r.ok)) { set({ novoErr: AUTH_MSG[r && r.erro] || 'Não deu certo. Tente de novo.' }); return; }
      set({ novo: false, novoNome: '', novoErr: '' });
      refresh().then(function () {
        if (!st.live && !st.playing && st.picked.length < 2 && st.picked.indexOf(r.id) < 0) set({ picked: st.picked.concat([r.id]), vencedor: 0 });
      });
    }).catch(function () {
      set({ busy: false, novoErr: 'Sem conexão. Confira a internet e tente de novo.' });
    });
  }

  var memOwner = null;
  function loadOwner() {
    try { var o = JSON.parse(localStorage.getItem(OWNER_KEY) || 'null'); if (o && o.chave) return o; } catch (e) {}
    return memOwner;
  }
  function saveOwner(o) {
    memOwner = o || null;
    try { if (o) localStorage.setItem(OWNER_KEY, JSON.stringify(o)); else localStorage.removeItem(OWNER_KEY); } catch (e) {}
  }
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID() + '-' + crypto.randomUUID();
    var s = ''; for (var i = 0; i < 48; i++) s += Math.floor(Math.random() * 16).toString(16); return s;
  }

  var lastSnapshot = '';
  function refresh() {
    return Promise.all([
      api('jogadores?select=id,nome,ativo&order=nome.asc'),
      api('partidas?select=id,jogador_a,jogador_b,jogos_a,jogos_b,pontos_a,pontos_b,regra_pontos,regra_vantagem,regra_direto,regra_jogos,rapido,criado_em&order=criado_em.desc&limit=5000')
    ]).then(function (res) {
      var snap = JSON.stringify(res);
      var wasErr = st.netErr;
      st.loaded = true; st.netErr = false;
      if (snap === lastSnapshot && !wasErr) return;
      lastSnapshot = snap;
      var names = {}, players = [], active = {};
      res[0].forEach(function (j) {
        names[j.id] = j.nome;
        if (j.ativo) { players.push({ id: j.id, name: j.nome }); active[j.id] = true; }
      });
      st.names = names; st.players = players; st.matches = res[1];
      noticeNewMatch(res[1]);
      // partida desfeita (jogo rápido) ou apagada: tira o destaque e o DESFAZER dela
      var existe = {}; res[1].forEach(function (m) { existe[m.id] = true; });
      if (st.winFlash && !existe[st.winFlash.match]) st.winFlash = null;
      if (st.rapidoFeito && !existe[st.rapidoFeito.id]) { st.rapidoFeito = null; st.rapidoArm = false; }
      st.picked = st.picked.filter(function (id) { return active[id]; });
      if (st.delArm && !active[st.delArm]) st.delArm = null;
      if (st.tab === 'admin') loadAdmin();
      render();
    }).catch(function () {
      if (!st.netErr || !st.loaded) { st.netErr = true; st.loaded = true; render(); }
    });
  }

  /* Quando aparece uma partida salva que este aparelho ainda não conhecia, o vencedor ganha destaque
     no ranking e quem estava acompanhando a partida é levado para a aba Ranking. */
  var FLASH_MS = 15000;
  function noticeNewMatch(matches) {
    if (st.seenMatches === null) {
      st.seenMatches = {};
      matches.forEach(function (m) { st.seenMatches[m.id] = true; });
      return;
    }
    var fresh = matches.filter(function (m) { return !st.seenMatches[m.id]; });
    fresh.forEach(function (m) { st.seenMatches[m.id] = true; });
    if (!fresh.length) return;
    var m = fresh[0]; // mais recente primeiro
    var aWon = m.jogos_a > m.jogos_b;
    st.winFlash = { match: m.id, winner: aWon ? m.jogador_a : m.jogador_b, loser: aWon ? m.jogador_b : m.jogador_a,
                    como: comoVenceu(m), until: Date.now() + FLASH_MS };
    if (st.tab === 'partida' && !st.playing) st.tab = 'ranking';
    setTimeout(function () { if (st.winFlash && Date.now() >= st.winFlash.until) { st.winFlash = null; render(); } }, FLASH_MS + 50);
  }

  /* Recebe a linha da partida ao vivo (do banco ou do tempo real) e decide o que este aparelho mostra. */
  var lastLive = '';
  function applyLive(row) {
    var live = row && row.ativa ? row : null;
    var owner = loadOwner();
    var mine = !!(live && owner && tsMicros(owner.iniciada_em) === tsMicros(live.iniciada_em));

    if (live && mine && !st.playing) {
      // este aparelho iniciou a partida (por exemplo, a página foi recarregada): retoma o controle
      st.playing = true;
      st.m1 = live.jogador_a; st.m2 = live.jogador_b; st.hist = (live.pontos || []).slice();
      st.g1 = live.jogos_a; st.g2 = live.jogos_b; st.pts1 = live.pts_a; st.pts2 = live.pts_b; st.first = live.primeiro;
      st.mregra = regraDe(live);
    }
    if (st.playing && !mine) {
      // a partida foi encerrada ou liberada em outro lugar
      st.playing = false; st.hist = []; st.quitArm = false; st.syncErr = '';
    }
    if (!live && owner) saveOwner(null);

    var snap = JSON.stringify([live, mine]);
    st.live = live;
    if (snap !== lastLive) { lastLive = snap; render(); }
  }

  function refreshLive() {
    return api('partida_ao_vivo?select=*&id=eq.1').then(function (rows) {
      st.netErr = false;
      applyLive(rows && rows[0]);
    }).catch(function () {
      if (!st.netErr) { st.netErr = true; render(); }
    });
  }

  /* Quem marca envia o placar a cada ponto. Envia sempre o estado mais recente, um envio por vez. */
  var pushing = false, pushAgain = false;
  function push() {
    var owner = loadOwner();
    if (!st.playing || !owner) return;
    if (pushing) { pushAgain = true; return; }
    pushing = true; pushAgain = false;
    rpc('atualizar_partida', {
      p_chave: owner.chave, p_pontos: st.hist, p_jogos_a: st.g1, p_jogos_b: st.g2,
      p_pts_a: st.pts1, p_pts_b: st.pts2, p_primeiro: st.first
    }).then(function () {
      pushing = false;
      if (st.syncErr) set({ syncErr: '' });
      if (pushAgain) push();
    }).catch(function (err) {
      pushing = false;
      if (err.code === 'sem_permissao' || err.code === 'partida_encerrada') {
        saveOwner(null);
        set({ playing: false, hist: [], syncErr: '' });
        refreshLive();
        return;
      }
      set({ syncErr: 'Sem conexão: os outros ainda não viram este ponto. Tentando de novo...' });
      setTimeout(push, 3000);
    });
  }

  function stats() {
    var out = {};
    function get(id) { return out[id] || (out[id] = { v: 0, d: 0, gp: 0, gc: 0, pts: 0 }); }
    st.matches.forEach(function (m) {
      var a = get(m.jogador_a), b = get(m.jogador_b);
      a.gp += m.jogos_a; a.gc += m.jogos_b; a.pts += m.pontos_a;
      b.gp += m.jogos_b; b.gc += m.jogos_a; b.pts += m.pontos_b;
      if (m.jogos_a > m.jogos_b) { a.v += 1; b.d += 1; } else { b.v += 1; a.d += 1; }
    });
    return out;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function nameOf(id) { return st.names[id] || '---'; }

  /* ---------- estado derivado da partida ---------- */
  // fonte: a partida que este aparelho marca, ou a partida ao vivo de outro aparelho
  function source() {
    if (st.playing) return { hist: st.hist, g1: st.g1, g2: st.g2, first: st.first, m1: st.m1, m2: st.m2, pts1: st.pts1, pts2: st.pts2,
                             regra: st.mregra || regraDe(st.live) };
    var l = st.live;
    return { hist: l.pontos || [], g1: l.jogos_a, g2: l.jogos_b, first: l.primeiro, m1: l.jogador_a, m2: l.jogador_b, pts1: l.pts_a, pts2: l.pts_b,
             regra: regraDe(l) };
  }

  function game(src) {
    src = src || source();
    var hist = src.hist;
    var s1 = hist.filter(function (x) { return x === 1; }).length;
    var s2 = hist.length - s1;
    var r = src.regra || regraDe(null);
    // vence o jogo: vitória direta (adversário zerado) ou chegou aos pontos (com vantagem de 2, se a regra pedir)
    var wins = function (a, b) {
      return (r.direto > 0 && a >= r.direto && b === 0) || (a >= r.pontos && (!r.vantagem || a - b >= 2));
    };
    var w = wins(s1, s2) ? 1 : (wins(s2, s1) ? 2 : 0);
    var gp1 = src.g1 + (w === 1 ? 1 : 0);
    var gp2 = src.g2 + (w === 2 ? 1 : 0);
    var champ = gp1 >= r.jogos ? 1 : (gp2 >= r.jogos ? 2 : 0);
    var server = hist.length ? hist[hist.length - 1] : src.first;
    var name1 = nameOf(src.m1), name2 = nameOf(src.m2);
    return { s1: s1, s2: s2, w: w, gp1: gp1, gp2: gp2, champ: champ, server: server, name1: name1, name2: name2,
             wName: w === 1 ? name1 : name2, pts1: src.pts1, pts2: src.pts2, jogo: src.g1 + src.g2 + 1,
             regra: r, wins: wins };
  }

  function dropLast(p) {
    var i = st.hist.lastIndexOf(p);
    if (i < 0) return st.hist;
    return st.hist.slice(0, i).concat(st.hist.slice(i + 1));
  }

  /* ---------- iniciar e encerrar ---------- */
  function startMatch() {
    if (st.busy || st.picked.length !== 2) return;
    var chave = newKey();
    var a = st.picked[0], b = st.picked[1], first = st.firstPick;
    var t = st.regraTxt;
    if (!(parseInt(t.pontos, 10) >= 1)) { set({ regraAberta: true, startErr: 'Diga quantos pontos vencem o jogo.' }); return; }
    if (st.regra.direto && !(parseInt(t.diretoN, 10) >= 1)) { set({ regraAberta: true, startErr: 'Diga quantos pontos dão a vitória direta.' }); return; }
    var regra = regraDoEditor();
    set({ busy: true, startErr: '' });
    rpc('iniciar_partida_regras', { p_jogador_a: a, p_jogador_b: b, p_primeiro: first, p_chave: chave,
                             p_regra_pontos: regra.pontos, p_regra_vantagem: regra.vantagem,
                             p_regra_direto: regra.direto || null, p_regra_jogos: regra.jogos })
      .then(function (inicio) {
        saveOwner({ chave: chave, iniciada_em: inicio });
        st.busy = false;
        st.playing = true; st.m1 = a; st.m2 = b; st.first = first;
        st.hist = []; st.g1 = 0; st.g2 = 0; st.pts1 = 0; st.pts2 = 0; st.quitArm = false; st.saveErr = ''; st.syncErr = '';
        st.picked = []; st.firstPick = 1; st.mregra = regra; st.regraAberta = false;
        applyLive({ id: 1, ativa: true, jogador_a: a, jogador_b: b, primeiro: first, pontos: [], jogos_a: 0, jogos_b: 0,
                    pts_a: 0, pts_b: 0, iniciada_em: inicio, atualizada_em: new Date().toISOString(),
                    regra_pontos: regra.pontos, regra_vantagem: regra.vantagem, regra_direto: regra.direto || null, regra_jogos: regra.jogos });
        render();
        refreshLive();
      })
      .catch(function (err) {
        var msg = err.code === 'partida_em_andamento' ? 'Alguém acabou de iniciar uma partida. Acompanhe ao vivo.'
          : err.code === 'jogador_invalido' ? 'Um dos jogadores saiu da lista. Escolha de novo.'
          : err.code === 'regra_invalida' ? 'Confira as regras: pontos e jogos precisam ser 1 ou mais.'
          : 'Não deu para iniciar. Confira a internet e tente de novo.';
        set({ busy: false, startErr: msg });
        refreshLive(); refresh();
      });
  }

  function endMatch(salvar, g) {
    var owner = loadOwner();
    if (st.busy || !owner) return;
    set({ busy: true, saveErr: '' });
    rpc('encerrar_partida', {
      p_chave: owner.chave, p_salvar: salvar,
      p_jogos_a: salvar ? g.gp1 : 0, p_jogos_b: salvar ? g.gp2 : 0,
      p_pontos_a: salvar ? st.pts1 + g.s1 : 0, p_pontos_b: salvar ? st.pts2 + g.s2 : 0
    }).then(function () {
      saveOwner(null);
      st.busy = false;
      set({ playing: false, hist: [], g1: 0, g2: 0, pts1: 0, pts2: 0, quitArm: false, live: null,
            tab: salvar ? 'ranking' : 'partida' });
      refresh(); refreshLive();
    }).catch(function (err) {
      if (err.code === 'sem_permissao' || err.code === 'partida_encerrada') {
        saveOwner(null);
        st.busy = false;
        set({ playing: false, hist: [], quitArm: false });
        refreshLive();
        return;
      }
      set({ busy: false, saveErr: 'Não deu para ' + (salvar ? 'salvar' : 'encerrar') + '. Confira a internet e toque de novo.' });
    });
  }

  /* ---------- jogo rápido ----------
     Sem marcar pontos: escolhe os dois jogadores, toca no lado de quem venceu e registra.
     A vitória entra direto no ranking. Este aparelho pode desfazer o registro por 2 minutos. */
  var QUICK_MSG = {
    em_partida: 'Um desses jogadores está na partida ao vivo. Espere ela acabar.',
    jogador_invalido: 'Um dos jogadores saiu da lista. Escolha de novo.',
    repetida: 'Essa vitória acabou de ser registrada. Confira no ranking.',
    vencedor_invalido: 'Toque no lado da mesa de quem venceu.'
  };
  function registerQuick() {
    if (st.busy || st.picked.length !== 2) return;
    if (st.vencedor !== 1 && st.vencedor !== 2) { set({ startErr: QUICK_MSG.vencedor_invalido }); return; }
    var a = st.picked[0], b = st.picked[1], v = st.vencedor, chave = newKey();
    set({ busy: true, startErr: '' });
    rpc('registrar_jogo_rapido', { p_jogador_a: a, p_jogador_b: b, p_vencedor: v, p_chave: chave })
      .then(function (id) {
        st.busy = false;
        st.rapidoFeito = { id: Number(id), chave: chave, a: a, b: b, winner: v === 1 ? a : b, loser: v === 1 ? b : a, until: Date.now() + UNDO_MS };
        st.rapidoArm = false;
        setTimeout(function () {
          if (st.rapidoFeito && Date.now() >= st.rapidoFeito.until) { st.rapidoFeito = null; st.rapidoArm = false; render(); }
        }, UNDO_MS + 100);
        set({ picked: [], vencedor: 0, firstPick: 1, novo: false, tab: 'ranking' });
        view.scrollTop = 0;
        refresh();
      })
      .catch(function (err) {
        var faltaNoBanco = err.status === 404 && err.body && err.body.code === 'PGRST202';
        set({ busy: false, startErr: faltaNoBanco ? 'O jogo rápido ainda não está ativo no banco.'
          : (QUICK_MSG[err.code] || 'Não deu para registrar. Confira a internet e tente de novo.') });
        refresh(); refreshLive();
      });
  }

  function undoQuick() {
    var f = st.rapidoFeito;
    if (st.busy || !f) return;
    if (!st.rapidoArm) { set({ rapidoArm: true }); return; }
    set({ busy: true, rapidoArm: false });
    rpc('desfazer_jogo_rapido', { p_id: f.id, p_chave: f.chave }).then(function () {
      st.busy = false;
      if (st.winFlash && st.winFlash.match === f.id) st.winFlash = null;
      // volta para a mesa com os mesmos jogadores, para registrar de novo se foi engano
      var ativos = st.players.filter(function (p) { return p.id === f.a || p.id === f.b; }).length === 2;
      set({ rapidoFeito: null, tab: 'partida', modo: 'rapido', vencedor: 0,
            picked: ativos && !st.live ? [f.a, f.b] : [], startErr: '' });
      refresh();
    }).catch(function (err) {
      st.busy = false;
      if (err.code === 'tempo_esgotado' || err.code === 'sem_permissao') st.rapidoFeito = null;
      alertRanking(err.code === 'tempo_esgotado' ? 'Passaram os 2 minutos: agora só um admin apaga essa partida.'
        : err.code === 'sem_permissao' ? 'Essa partida não pode mais ser desfeita por aqui. Peça a um admin.'
        : 'Sem conexão. Confira a internet e toque de novo em DESFAZER.');
    });
  }
  // aviso curto no topo do ranking
  function alertRanking(msg) {
    st.rankMsg = { text: msg, until: Date.now() + 8000 };
    render();
    setTimeout(function () { if (st.rankMsg && Date.now() >= st.rankMsg.until) { st.rankMsg = null; render(); } }, 8100);
  }

  /* ---------- telas ---------- */
  function liveBadge() {
    if (!st.live) return '';
    var g = game();
    return '<button class="live" type="button" data-act="tab" data-v="partida" aria-label="Ver partida ao vivo">' +
      '<span class="dot" aria-hidden="true"></span><span class="lv">AO VIVO</span>' +
      '<span class="vt lv-score">' + esc(g.name1) + ' ' + pad(g.s1) + ' x ' + pad(g.s2) + ' ' + esc(g.name2) + '</span></button>';
  }

  function tabs() {
    function t(id, label) {
      var on = st.tab === id || (id === 'jogadores' && st.tab === 'admin');
      return '<button class="tab' + (on ? ' on' : '') + '" type="button" data-act="tab" data-v="' + id + '">' + label + '</button>';
    }
    var bar = '<nav class="tabs" aria-label="Seções do placar">' + t('partida', 'PARTIDA') + t('ranking', 'RANKING') + t('historico', 'HISTÓRICO') + t('jogadores', 'JOGADORES') + '</nav>';
    if (st.tab !== 'partida') bar += liveBadge();
    if (st.netErr) bar += '<div class="net" role="status">SEM CONEXÃO COM O PLACAR ONLINE · TENTANDO DE NOVO</div>';
    return bar;
  }

  /* ---------- escolha dos jogadores: a mesa de preparação ----------
     O topo é a mesa da partida, vazia. Quem é escolhido aparece no seu lado da mesa
     (1P em cima, com a raquete vermelha; 2P embaixo, com a preta). Com os dois escolhidos,
     tocar num lado da mesa define quem saca primeiro: a bolinha vai para aquele lado. */
  /* Com pontos, tocar num lado escolhe quem saca primeiro. No jogo rápido, escolhe quem venceu. */
  function prepSide(n, id, next) {
    var pronto = st.picked.length === 2, rapido = st.modo === 'rapido';
    var marcado = pronto && (rapido ? st.vencedor === n : st.firstPick === n);
    var tag = '<span class="prep-tag p' + n + '">' + n + 'P</span>';
    var ball = marcado && !rapido ? '<svg class="bola-saque bounce" viewBox="0 0 6 6" shape-rendering="crispEdges" aria-hidden="true">' +
      '<path fill="#f4f7ff" d="M1 0h4v1h-4zM0 1h6v4h-6zM1 5h4v1h-4z"/><path fill="#b9c6f2" d="M4 4h1v1h-1zM1 4h1v1h-1z"/></svg>' : '';
    if (!id) {
      return '<div class="prep-lado vazio' + (next ? ' proximo' : '') + '"><div class="vaga">' + tag +
        '<span class="' + (next ? 'blink ' : '') + 'prep-msg">' + (next ? 'TOQUE NUM NOME' : '---') + '</span></div></div>';
    }
    var dica = rapido ? 'toque se venceu' : 'toque para sacar';
    var inner = tag + '<span class="prep-nm">' + esc(nameOf(id)) + '</span>' +
      (marcado ? (rapido ? winTag() : serveTag('SACA PRIMEIRO')) : (pronto ? '<span class="prep-msg">' + dica + '</span>' : '')) + ball;
    if (!pronto) return '<div class="prep-lado">' + inner + '</div>';
    var cls = 'prep-lado tap' + (rapido ? ' escolhe-vencedor' : '') + (rapido && marcado ? ' venceu' : '') + (rapido && st.vencedor && !marcado ? ' perdeu' : '');
    var label = esc(nameOf(id)) + (rapido ? (marcado ? ' venceu' : ': toque se venceu') : (marcado ? ' saca primeiro' : ': toque para sacar primeiro'));
    return '<button class="' + cls + '" type="button" data-act="' + (rapido ? 'vence' : 'fp') + '" data-v="' + n + '" aria-pressed="' + marcado + '"' +
      ' aria-label="' + label + '">' + inner + '</button>';
  }

  // selo verde do vencedor no jogo rápido, com um troféu em pixel
  function winTag() {
    return '<span class="win-chip"><svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">' +
      '<path fill="#050a1c" d="M1 0h6v1h-6zM0 1h1v2h-1zM7 1h1v2h-1zM1 1h6v3h-6zM1 3h1v1h-1zM2 4h4v1h-4zM3 5h2v1h-2zM2 6h4v2h-4z"/></svg>VENCEU</span>';
  }

  // COM PONTOS ou JOGO RÁPIDO, no topo da aba Partida
  function modoToggle() {
    var rapido = st.modo === 'rapido';
    function b(v, on, label) {
      return '<button class="opt modo-opt' + (on ? ' on' : '') + '" type="button" data-act="modo" data-v="' + v + '" aria-pressed="' + on + '">' + label + '</button>';
    }
    return '<div class="row modo" role="group" aria-label="Tipo de partida">' + b('pontos', !rapido, 'COM PONTOS') + b('rapido', rapido, 'JOGO RÁPIDO') + '</div>';
  }

  function viewSetup() {
    var p = st.picked, rapido = st.modo === 'rapido';
    var h = '<section>';
    h += modoToggle();
    h += '<div class="board mesa prep' + (rapido ? ' rapido' : '') + '">' +
      '<div class="mesa-linha" aria-hidden="true"></div>' +
      prepSide(1, p[0], p.length === 0) +
      '<div class="rede" aria-hidden="true"></div>' +
      prepSide(2, p[1], p.length === 1) +
      tablePaddle('r1' + (p[0] ? '' : ' apagada'), '#060a1d', '#e8283a', '#ff8f97') +
      tablePaddle('r2' + (p[1] ? '' : ' apagada'), '#c9d4ff', '#1b1f2e', '#4a5275') +
      '</div>';
    if (!st.loaded) {
      h += '<div class="note dim blink">Carregando jogadores...</div>';
    } else if (st.players.length) {
      var dica = p.length < 2 ? 'Toque em 2 jogadores. O primeiro vira o 1P.'
        : !rapido ? 'Toque no lado da mesa de quem vai sacar primeiro.'
        : st.vencedor ? 'Confira e toque em REGISTRAR VITÓRIA.' : 'Toque no lado da mesa de quem venceu.';
      h += '<div class="note prep-dica">' + dica + '</div>';
      h += '<div class="scroll roster">';
      st.players.forEach(function (pl) {
        var at = p.indexOf(pl.id);
        var badge = at === 0 ? '1P' : (at === 1 ? '2P' : '');
        var paddle = at === 0 ? ['#060a1d', '#e8283a'] : at === 1 ? ['#060a1d', '#1b1f2e'] : ['#2b47b8', '#0b1640'];
        h += '<button class="opt chip' + (at >= 0 ? ' on' : '') + '" type="button" data-act="pick" data-v="' + pl.id + '">' +
          '<svg class="chip-rq" viewBox="0 0 14 20" shape-rendering="crispEdges" aria-hidden="true">' +
            '<path fill="' + paddle[0] + '" d="' + PADDLE_SHAPE + '"/><path fill="' + paddle[1] + '" d="' + PADDLE_FACE + '"/>' +
            '<path fill="#e0a868" d="M6 13h2v6h-2z"/></svg>' +
          '<span class="nm">' + esc(pl.name) + '</span><span class="badge">' + badge + '</span></button>';
      });
      if (!st.novo) h += '<button class="opt chip novo-chip" type="button" data-act="novoAbrir"><span class="nm">+ NOVO JOGADOR</span></button>';
      h += '</div>';
      if (st.novo) h += novoForm();
    } else {
      h += '<div class="box empty-box"><div class="msg">NENHUM JOGADOR AINDA</div>' +
        '<div class="note">Digite o apelido de quem vai jogar. Não precisa de senha.</div></div>' + novoForm(true);
    }
    h += '<div class="grow"></div>';
    if (rapido) {
      h += '<div class="box regras rapido-info"><span class="lbl">JOGO RÁPIDO</span>' +
        '<div class="regras-resumo">SEM PLACAR · SÓ QUEM VENCEU · VALE 1 VITÓRIA NO RANKING</div></div>';
      if (st.startErr) h += '<div class="err" role="alert">' + esc(st.startErr) + '</div>';
      h += '<div class="legend">A vitória entra direto no ranking. Errou? Este aparelho pode desfazer por 2 minutos.</div>';
      h += '<button class="btn go start" type="button" data-act="rapido"' + (p.length !== 2 || !st.vencedor || st.busy ? ' disabled' : '') + '>' +
        (st.busy ? 'REGISTRANDO...' : 'REGISTRAR VITÓRIA') + '</button>';
      return h + '</section>';
    }
    h += regrasBox();
    if (st.startErr) h += '<div class="err" role="alert">' + esc(st.startErr) + '</div>';
    h += '<div class="legend">Ao iniciar, a partida fica ao vivo para todo mundo e só este aparelho marca os pontos.</div>';
    h += '<button class="btn go start" type="button" data-act="start"' + (p.length !== 2 || st.busy ? ' disabled' : '') + '>' + (st.busy ? 'INICIANDO...' : 'INICIAR') + '</button>';
    return h + '</section>';
  }

  /* ---------- regras da partida, antes de INICIAR ----------
     Fechado: uma linha com o resumo e o botão MUDAR. Aberto: cada regra com os seus controles. */
  function stepper(k, label, valueHtml, minus) {
    return '<div class="stepper">' +
      '<button class="btn ghost x" type="button" data-act="rgMenos" data-v="' + k + '" aria-label="Menos: ' + label + '"' + (minus ? '' : ' disabled') + '>-</button>' +
      valueHtml +
      '<button class="btn ghost x" type="button" data-act="rgMais" data-v="' + k + '" aria-label="Mais: ' + label + '">+</button></div>';
  }
  function numField(k, label) {
    return '<input id="rg-' + k + '" class="field rg-num" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ' +
      'aria-label="' + label + '" value="' + esc(st.regraTxt[k]) + '">';
  }
  function choice(act, v, on, label) {
    return '<button class="opt rg-opt' + (on ? ' on' : '') + '" type="button" data-act="' + act + '" data-v="' + v + '" aria-pressed="' + on + '">' + label + '</button>';
  }
  function regrasBox() {
    var r = st.regra, aberta = st.regraAberta;
    var h = '<div class="box regras' + (aberta ? ' aberta' : '') + '">' +
      '<div class="regras-top"><span class="lbl">REGRAS DA PARTIDA</span>' +
      '<button class="btn ghost rg-mudar" type="button" data-act="rgAbrir" aria-expanded="' + aberta + '">' + (aberta ? 'PRONTO' : 'MUDAR') + '</button></div>' +
      '<div class="regras-resumo">' + esc(regraResumo(regraDoEditor())) + '</div>';
    if (!aberta) return h + '</div>';
    h += '<div class="rg-linha"><span class="lbl">PONTOS PARA VENCER O JOGO</span>' +
      stepper('pontos', 'pontos para vencer', numField('pontos', 'Pontos para vencer o jogo'), r.pontos > 1) + '</div>';
    h += '<div class="rg-linha"><span class="lbl">NO EMPATE PERTO DO FIM</span><div class="row rg-opts">' +
      choice('rgVant', '1', r.vantagem, 'VANTAGEM DE 2') + choice('rgVant', '0', !r.vantagem, 'QUEM CHEGAR VENCE') + '</div></div>';
    h += '<div class="rg-linha"><span class="lbl">VITÓRIA DIRETA</span><div class="row rg-opts">' +
      choice('rgDireto', '0', !r.direto, 'NÃO') + choice('rgDireto', '1', r.direto, 'SIM') + '</div>';
    if (r.direto) {
      h += stepper('diretoN', 'pontos da vitória direta', numField('diretoN', 'Pontos seguidos para a vitória direta'), r.diretoN > 1) +
        '<div class="legend">Quem fizer ' + esc(st.regraTxt.diretoN || '?') + ' ponto' + (r.diretoN === 1 ? '' : 's') + ' antes de o adversário marcar o primeiro vence na hora. ' +
        'Se o adversário pontuar, o jogo vai até ' + esc(st.regraTxt.pontos || '?') + '.</div>';
    }
    h += '</div>';
    h += '<div class="rg-linha"><span class="lbl">JOGOS</span>' +
      stepper('jogos', 'jogos', '<output class="rg-val" aria-live="polite">' + jogosTexto(r.jogos) + '</output>', r.jogos > 1) + '</div>';
    h += '<div class="legend">Este aparelho lembra as últimas regras usadas.</div>';
    return h + '</div>';
  }
  function mudaRegra(k, delta) {
    var r = st.regra;
    if (k === 'jogos') r.jogos = Math.max(1, r.jogos + delta);
    else {
      var atual = parseInt(st.regraTxt[k], 10) || r[k];
      r[k] = Math.max(1, atual + delta);
      st.regraTxt[k] = String(r[k]);
    }
    saveRegra();
    set({ startErr: '' });
  }

  // cadastro rápido: só o apelido
  function novoForm(sozinho) {
    return '<form id="novoForm" class="box novo-form" novalidate>' +
      '<label class="lbl" for="novoNome">NOVO JOGADOR</label>' +
      '<div class="row"><input id="novoNome" class="field" type="text" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="APELIDO" value="' + esc(st.novoNome) + '">' +
      '<button class="btn go" type="submit"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? '...' : 'ADICIONAR') + '</button></div>' +
      '<div id="novoErr" class="err" role="alert">' + esc(st.novoErr) + '</div>' +
      (sozinho ? '' : '<div class="row"><button class="btn ghost" type="button" data-act="novoCancelar">CANCELAR</button></div>') +
      '</form>';
  }

  function serveTag(label) {
    return '<span class="blink serve-chip"><svg viewBox="0 0 6 6" shape-rendering="crispEdges" aria-hidden="true"><path fill="#050a1c" d="M1 0h4v1h-4zM0 1h6v4h-6zM1 5h4v1h-4z"/></svg>' + (label || 'SAQUE') + '</span>';
  }

  /* raquetes de enfeite em volta da mesa: vermelha do lado do 1P, preta do lado do 2P */
  var PADDLE_SHAPE = 'M4 0h6v1h-6zM2 1h10v1h-10zM1 2h12v2h-12zM0 4h14v6h-14zM1 10h12v2h-12zM2 12h10v1h-10zM5 13h4v7h-4z';
  var PADDLE_FACE = 'M4 1h6v1h-6zM2 2h10v2h-10zM1 4h12v6h-12zM2 10h10v1h-10zM4 11h6v1h-6z';
  var PADDLE_SHINE = 'M4 2h2v1h-2zM3 3h2v1h-2zM2 4h1v2h-1z';
  function tablePaddle(cls, rim, face, shine) {
    return '<svg class="rq ' + cls + '" viewBox="0 0 14 20" shape-rendering="crispEdges" aria-hidden="true">' +
      '<path fill="' + rim + '" d="' + PADDLE_SHAPE + '"/><path fill="' + face + '" d="' + PADDLE_FACE + '"/>' +
      '<path fill="' + shine + '" d="' + PADDLE_SHINE + '"/><path fill="#e0a868" d="M6 13h2v6h-2z"/></svg>';
  }

  function playerCard(n, name, score, gp, serving, lock, control, jogos) {
    // bolinhas de jogos vencidos: só quando a partida tem mais de um jogo
    var pips = '';
    for (var i = 0; i < jogos; i++) pips += '<div class="pip' + (i < gp ? ' on' : '') + '"></div>';
    var inner =
      '<div class="tag">' + n + 'P' + (control ? ' · 1 TOQUE +1 · 2 TOQUES −1' : '') + '</div>' +
      '<div class="nm-row"><span class="nm">' + esc(name) + '</span>' + (serving ? serveTag() : '') + '</div>' +
      '<div class="score-row"><div class="rgb glow digits">' + pad(score) + '</div></div>' +
      (jogos > 1 ? '<div class="meta"><div class="games"><span class="vt">JOGOS</span>' + pips + '</div></div>' : '');
    var fx = st.tapFx && st.tapFx.v === n && Date.now() < st.tapFx.until
      ? '<span class="tap-fx' + (st.tapFx.minus ? ' minus' : '') + '" aria-hidden="true">' + st.tapFx.text + '</span>' : '';
    if (!control) return '<div class="box player p' + n + '">' + inner + '</div>';
    return '<button class="box player tap p' + n + '" type="button" data-act="add" data-v="' + n + '"' + (lock ? ' disabled' : '') +
      ' aria-label="' + esc(name) + ', ' + score + ' pontos. Um toque marca ponto, dois toques tiram um ponto.">' + inner + fx + '</button>';
  }

  function viewBoard() {
    var control = st.playing;
    var g = game(), r = g.regra;
    var hi = Math.max(g.s1, g.s2), lo = Math.min(g.s1, g.s2);
    var title = 'EM JOGO', sub = 'Saque: ' + (g.server === 1 ? g.name1 : g.name2);
    var lider = g.s1 > g.s2 ? g.name1 : g.name2, atras = g.s1 > g.s2 ? g.name2 : g.name1;
    if (g.s1 !== g.s2) {
      var diff = Math.abs(g.s1 - g.s2);
      sub = lider + ' lidera · ' + diff + ' ponto' + (diff > 1 ? 's' : '') + ' à frente';
      // vitória direta ainda possível: o adversário não marcou nenhum ponto
      if (r.direto && lo === 0 && r.direto < r.pontos) {
        var falta = r.direto - hi;
        sub = lider + ' vence direto com mais ' + falta + ' ponto' + (falta > 1 ? 's' : '') + ' se ' + atras + ' não pontuar';
      }
    } else if (g.s1 > 0) sub = 'Empate em ' + g.s1 + ' · saque: ' + (g.server === 1 ? g.name1 : g.name2);
    var gp1 = !g.w && g.wins(g.s1 + 1, g.s2), gp2 = !g.w && g.wins(g.s2 + 1, g.s1);
    if (g.w && g.champ) {
      title = 'FIM DA DISPUTA';
      sub = g.wName + ' venceu ' + (r.jogos === 1 ? hi + ' a ' + lo : 'por ' + Math.max(g.gp1, g.gp2) + ' a ' + Math.min(g.gp1, g.gp2));
    }
    else if (g.w) { title = 'FIM DE JOGO'; sub = g.wName + ' venceu ' + hi + ' a ' + lo; }
    else if (gp1 && gp2) { title = 'PONTO DECISIVO'; sub = 'Quem fizer o próximo ponto vence'; }
    else if (r.vantagem && g.s1 === g.s2 && g.s1 >= r.pontos - 1 && g.s1 > 0) { title = 'IGUALDADE'; sub = 'Quem abrir 2 pontos vence'; }
    else if (gp1) { title = 'PONTO DE JOGO'; sub = 'Vantagem: ' + g.name1; }
    else if (gp2) { title = 'PONTO DE JOGO'; sub = 'Vantagem: ' + g.name2; }

    var stale = !control && st.live && (Date.now() - tsMicros(st.live.atualizada_em) / 1000 > STALE_MS);
    var h = '<section>';
    h += '<div class="live-head"><span class="dot" aria-hidden="true"></span><span class="lv">AO VIVO</span>' +
      '<span class="vt jogo-n">' + (r.jogos > 1 ? 'JOGO ' + Math.min(g.jogo, 2 * r.jogos - 1) + ' · ' : '') + esc(regraResumo(r)) + '</span>' +
      '<span class="vt who-marks">' + (control ? '1 toque no placar = ponto · 2 toques rápidos = tira ponto' : 'Só quem iniciou a partida marca os pontos') + '</span></div>';
    h += '<div class="board mesa">';
    h += '<div class="mesa-linha" aria-hidden="true"></div>';
    h += playerCard(1, g.name1, g.s1, g.gp1, !g.w && g.server === 1, !!g.w, control, r.jogos);
    h += '<div class="rede" aria-hidden="true"></div>';
    h += playerCard(2, g.name2, g.s2, g.gp2, !g.w && g.server === 2, !!g.w, control, r.jogos);
    h += tablePaddle('r1', '#060a1d', '#e8283a', '#ff8f97') + tablePaddle('r2', '#c9d4ff', '#1b1f2e', '#4a5275');
    if (g.w) {
      h += '<div class="banner">' +
        '<div class="kicker">' + (g.champ ? 'CAMPEÃO DA DISPUTA' : 'VENCEDOR DO JOGO') + '</div>' +
        '<div class="rgb glow who">' + esc(g.wName) + '</div>' +
        '<div class="score">' + (g.champ && r.jogos > 1 ? ('JOGOS ' + g.gp1 + ' x ' + g.gp2) : (pad(g.s1) + ' x ' + pad(g.s2))) + '</div>';
      if (control) {
        h += '<div class="row center">' +
            '<button class="btn ghost" type="button" data-act="undo">DESFAZER</button>' +
            '<button class="btn go" type="button" data-act="banner"' + (st.busy ? ' disabled' : '') + '>' + (g.champ ? (st.busy ? 'SALVANDO...' : 'SALVAR NO RANKING') : 'PRÓXIMO JOGO') + '</button>' +
          '</div>' + (st.saveErr ? '<div class="err">' + esc(st.saveErr) + '</div>' : '');
      } else {
        h += '<div class="note dim blink">' + (g.champ ? 'Aguardando salvar no ranking...' : 'Aguardando o próximo jogo...') + '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    h += '<div class="bottom-bar">' +
      '<div class="status"><div class="k">STATUS</div><div class="t">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div></div>';
    if (control) {
      h += '<div class="row center actions">' +
        '<button class="btn ghost" type="button" data-act="undo"' + (st.hist.length ? '' : ' disabled') + '>DESFAZER PONTO</button>' +
        '<button class="btn ghost' + (st.quitArm ? ' warn' : '') + '" type="button" data-act="quit"' + (st.busy ? ' disabled' : '') + '>' + (st.quitArm ? 'CONFIRMAR?' : 'ENCERRAR') + '</button>' +
        '</div>';
    } else if (stale) {
      h += '<div class="row center actions"><button class="btn ghost warn" type="button" data-act="release">LIBERAR PLACAR</button></div>';
    }
    h += '</div>';
    if (st.syncErr) h += '<div class="err" role="alert">' + esc(st.syncErr) + '</div>';
    if (stale) h += '<div class="legend">Ninguém marca ponto há mais de 20 minutos. Libere o placar para iniciar outra partida.</div>';
    return h + '</section>';
  }

  /* ---------- tutorial ----------
     Aparece uma vez em cada aparelho. Dá para abrir de novo na aba Jogadores, em COMO FUNCIONA. */
  function tutorialSeen(key) {
    try { return localStorage.getItem(key || TUTORIAL_KEY) === '1'; } catch (e) { return true; }
  }
  /* Primeira vez no aparelho: tutorial inteiro. Quem já tinha visto o tutorial antigo vê só a novidade (jogo rápido). */
  function maybeTutorial() {
    if (st.onb !== null || tutorialSeen()) return;
    if (tutorialSeen(TUTORIAL_OLD)) { st.onb = stepIndex('rapido'); st.onbNovo = true; }
    else st.onb = 0;
  }
  function stepIndex(id) {
    var steps = tutorialSteps();
    for (var i = 0; i < steps.length; i++) if (steps[i].id === id) return i;
    return 0;
  }
  function closeTutorial() {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch (e) {}
    set({ onb: null, onbNovo: false });
  }

  // desenhos do tutorial (pixel art + mini telas)
  var ART = {
    hand: '<svg class="ob-hand-svg" viewBox="0 0 11 14" shape-rendering="crispEdges" aria-hidden="true">' +
      '<path fill="#f4f7ff" d="M4 1h3v1h-3zM4 2h3v1h-3zM4 3h3v1h-3zM4 4h3v1h-3zM4 5h3v1h-3zM8 5h2v1h-2zM1 6h2v1h-2zM4 6h6v1h-6zM1 7h9v1h-9zM1 8h8v1h-8zM2 9h7v1h-7zM2 10h6v1h-6zM3 11h4v1h-4zM3 12h4v1h-4z"/>' +
      '<path fill="#9fb0e6" d="M9 8h1v1h-1zM9 9h1v1h-1zM8 10h1v1h-1zM7 11h1v1h-1zM7 12h1v1h-1z"/>' +
      '<path fill="#060a1d" d="M4 0h3v1h-3zM3 1h1v1h-1zM7 1h1v1h-1zM3 2h1v1h-1zM7 2h1v1h-1zM3 3h1v1h-1zM7 3h1v1h-1zM3 4h1v1h-1zM7 4h3v1h-3zM1 5h3v1h-3zM7 5h1v1h-1zM10 5h1v1h-1zM0 6h1v1h-1zM3 6h1v1h-1zM10 6h1v1h-1zM0 7h1v1h-1zM10 7h1v1h-1zM0 8h1v1h-1zM10 8h1v1h-1zM1 9h1v1h-1zM10 9h1v1h-1zM1 10h1v1h-1zM9 10h1v1h-1zM2 11h1v1h-1zM8 11h1v1h-1zM2 12h1v1h-1zM8 12h1v1h-1zM2 13h7v1h-7z"/></svg>',
    paddle: '<svg class="ob-paddle" viewBox="0 0 14 20" shape-rendering="crispEdges" aria-hidden="true"><use href="#paddle"></use></svg>'
  };
  // mão tocando: n = 1 ou 2 toques
  function obTap(n) {
    return '<span class="ob-tap ob-tap' + n + '" aria-hidden="true"><span class="ob-ripple"></span>' + ART.hand +
      '<span class="ob-times">' + n + '×</span></span>';
  }
  function obCard(tag, name, score, extra) {
    return '<div class="ob-card' + (extra && extra.indexOf('ob-tap') >= 0 ? ' has-tap' : '') + '">' + '<div class="ob-tag">' + tag + '</div><div class="ob-name">' + name + '</div>' +
      '<div class="ob-digits">' + score + '</div>' + (extra || '') + '</div>';
  }
  function obBoard(c1, c2) { return '<div class="ob-board">' + c1 + '<div class="ob-vs">VS</div>' + c2 + '</div>'; }

  function tutorialSteps() {
    var me = st.eu && st.names[st.eu] ? esc(st.names[st.eu]) : 'VOCÊ';
    return [
      { title: 'BEM-VINDO À DISPUTA!',
        art: '<div class="ob-hero">' + ART.paddle + '<span class="ob-ball bounce"></span>' + '<svg class="ob-paddle flip" viewBox="0 0 14 20" shape-rendering="crispEdges" aria-hidden="true"><use href="#paddle"></use></svg></div>',
        text: 'Este é o placar de ping-pong da Elsys. Em poucos passos você aprende a marcar pontos, acompanhar jogos ao vivo e subir no ranking.' },
      { title: 'AS 4 ABAS',
        art: '<div class="ob-tabs-art">' +
          '<div class="ob-tabrow"><span class="on">PARTIDA</span><span>RANKING</span><span>HISTÓRICO</span><span>JOGADORES</span></div>' +
          '<ul class="ob-list">' +
            '<li><b>PARTIDA</b> iniciar e acompanhar jogos</li>' +
            '<li><b>RANKING</b> quem tem mais vitórias</li>' +
            '<li><b>HISTÓRICO</b> quem ganha de quem</li>' +
            '<li><b>JOGADORES</b> os números de cada um</li></ul></div>',
        text: 'Tudo fica nessas quatro abas, no topo da tela. Toque em uma para trocar.' },
      { title: 'INICIAR UMA PARTIDA',
        art: '<div class="ob-setup">' +
          '<div class="ob-chips"><span class="ob-chip on">RAIO <i>1P</i></span><span class="ob-chip on">TROVÃO <i>2P</i></span>' +
          '<span class="ob-chip">FAÍSCA</span><span class="ob-chip">COMETA</span></div>' +
          '<div class="ob-start">INICIAR' + obTap(1) + '</div></div>',
        text: 'Na aba Partida, deixe em COM PONTOS, toque nos 2 jogadores, toque no lado da mesa de quem saca primeiro, confira as REGRAS DA PARTIDA e toque em INICIAR. Seu nome não está na lista? Toque em + NOVO JOGADOR: é só o apelido, sem senha.' },
      { id: 'rapido', title: 'JOGO RÁPIDO',
        art: '<div class="ob-setup">' +
          '<div class="ob-modo"><span>COM PONTOS</span><span class="on">JOGO RÁPIDO</span></div>' +
          '<div class="ob-quick">' +
            '<div class="ob-qside win"><span class="ob-qwin">VENCEU</span><span>RAIO</span>' + obTap(1) + '</div>' +
            '<div class="ob-qnet"></div>' +
            '<div class="ob-qside"><span>TROVÃO</span></div></div>' +
          '<div class="ob-start">REGISTRAR VITÓRIA</div></div>',
        text: 'Não quer marcar ponto a ponto? Na aba Partida, toque em JOGO RÁPIDO, escolha os 2 jogadores, toque no lado da mesa de quem venceu e em REGISTRAR VITÓRIA. A vitória vai direto para o ranking. Errou? Dá para desfazer por 2 minutos.' },
      { title: '1 TOQUE = PONTO',
        art: obBoard(obCard('1P', 'RAIO', '06', obTap(1) + '<span class="ob-fx plus">+1</span>'), obCard('2P', 'TROVÃO', '04')),
        text: 'Durante o jogo, toque uma vez no placar de quem fez o ponto. Aparece um +1 verde.' },
      { title: '2 TOQUES = TIRA PONTO',
        art: obBoard(obCard('1P', 'RAIO', '05', obTap(2) + '<span class="ob-fx minus">−1</span>'), obCard('2P', 'TROVÃO', '04')),
        text: 'Marcou para a pessoa errada? Toque duas vezes rápido no mesmo placar e 1 ponto sai dele. Aparece um −1 vermelho.' },
      { title: 'TODO MUNDO VÊ AO VIVO',
        art: '<div class="ob-live"><div class="ob-livehead"><span class="dot"></span><span class="lv">AO VIVO</span></div>' +
          obBoard(obCard('1P', 'RAIO', '09'), obCard('2P', 'TROVÃO', '07')) + '</div>',
        text: 'Quem não está marcando acompanha o placar em tempo real, em qualquer celular ou TV. Enquanto uma partida está ao vivo, ninguém inicia outra.' },
      { title: 'FIM DE JOGO E RANKING',
        art: '<div class="ob-rank">' +
          '<div class="ob-save">SALVAR NO RANKING' + obTap(1) + '</div>' +
          '<div class="ob-rkrow won"><span>1º</span><span class="n">RAIO</span><span class="pts"><i>+1</i> 5</span></div>' +
          '<div class="ob-rkrow"><span>2º</span><span class="n">TROVÃO</span><span class="pts">4</span></div>' +
          '<div class="ob-rkrow"><span>3º</span><span class="n">FAÍSCA</span><span class="pts">2</span></div></div>',
        text: 'Cada partida tem as regras que vocês escolherem: até quantos pontos, vantagem de 2 no empate, vitória direta e quantos jogos. Quando acabar, toque em SALVAR NO RANKING. Cada vitória vale 1 ponto e todo mundo vê na hora.' },
      { title: 'HISTÓRICO E JOGADORES',
        art: '<div class="ob-hp">' +
          '<div class="ob-pair"><span class="lead">RAIO</span><span class="sc">3 x 1</span><span>TROVÃO</span></div>' +
          '<div class="ob-tiles"><div><b>12</b><span>PARTIDAS</span></div><div><b class="win">8</b><span>VITÓRIAS</span></div><div><b>4</b><span>DERROTAS</span></div></div>' +
          '<div class="ob-me">' + me + '</div></div>',
        text: 'No Histórico você vê quem ganha de quem. Em Jogadores, toque num nome para ver os números e os confrontos dele, e marque ESTE SOU EU para se destacar no ranking. Para rever este tutorial, toque em COMO FUNCIONA na aba Jogadores.' }
    ];
  }

  function viewTutorial() {
    var steps = tutorialSteps();
    var i = Math.max(0, Math.min(st.onb, steps.length - 1)), stp = steps[i], last = i === steps.length - 1;
    if (st.onbNovo) {
      // quem já conhecia o placar vê só a novidade
      return '<div class="ob-backdrop">' +
        '<div class="box ob" role="dialog" aria-modal="true" aria-labelledby="obTitle">' +
          '<div class="ob-top"><span class="lbl ob-novo blink">NOVIDADE NO PLACAR</span></div>' +
          '<h2 id="obTitle" class="ob-title rgb glow">' + stp.title + '</h2>' +
          '<div class="ob-art">' + stp.art + '</div>' +
          '<p class="ob-text">' + stp.text + '</p>' +
          '<div class="ob-nav">' +
            '<button class="btn ghost" type="button" data-act="onbOpen">VER TUDO</button>' +
            '<button class="btn go ob-next" type="button" data-act="onbDone">ENTENDI!</button>' +
          '</div>' +
        '</div></div>';
    }
    var dots = steps.map(function (x, k) {
      return '<button class="ob-dot' + (k === i ? ' on' : '') + '" type="button" data-act="onbGo" data-v="' + k + '" aria-label="Passo ' + (k + 1) + '"' + (k === i ? ' aria-current="step"' : '') + '></button>';
    }).join('');
    return '<div class="ob-backdrop">' +
      '<div class="box ob" role="dialog" aria-modal="true" aria-labelledby="obTitle">' +
        '<div class="ob-top"><span class="lbl">PASSO ' + (i + 1) + ' DE ' + steps.length + '</span>' +
          (last ? '' : '<button class="link ob-skip" type="button" data-act="onbSkip">PULAR</button>') + '</div>' +
        '<h2 id="obTitle" class="ob-title rgb glow">' + stp.title + '</h2>' +
        '<div class="ob-art">' + stp.art + '</div>' +
        '<p class="ob-text">' + stp.text + '</p>' +
        '<div class="ob-dots">' + dots + '</div>' +
        '<div class="ob-nav">' +
          (i > 0 ? '<button class="btn ghost" type="button" data-act="onbPrev">VOLTAR</button>' : '<span></span>') +
          '<button class="btn go ob-next" type="button" data-act="' + (last ? 'onbDone' : 'onbNext') + '">' + (last ? 'VAMOS JOGAR!' : 'PRÓXIMO') + '</button>' +
        '</div>' +
      '</div></div>';
  }

  /* ---------- números de cada jogador e confrontos ---------- */
  function rankRows() {
    var all = stats();
    var rows = st.players.map(function (p) {
      var s = Object.assign({ v: 0, d: 0, gp: 0, gc: 0, pts: 0 }, all[p.id]);
      return { id: p.id, name: p.name, rank: s.v, j: s.v + s.d, d: s.d, sj: s.gp - s.gc, feitos: s.pts };
    });
    rows.sort(function (x, y) { return (y.rank - x.rank) || (y.sj - x.sj) || (y.feitos - x.feitos) || x.name.localeCompare(y.name); });
    return rows;
  }

  // confrontos: uma linha por dupla que já se enfrentou
  function pairs() {
    var map = {};
    st.matches.forEach(function (m) {
      var lo = Math.min(m.jogador_a, m.jogador_b), hi = Math.max(m.jogador_a, m.jogador_b), k = lo + '-' + hi;
      var p = map[k] || (map[k] = { a: lo, b: hi, winsA: 0, winsB: 0, count: 0, last: m.criado_em, matches: [] });
      var winner = m.jogos_a > m.jogos_b ? m.jogador_a : m.jogador_b;
      if (winner === lo) p.winsA += 1; else p.winsB += 1;
      p.count += 1; p.matches.push(m);
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (x, y) { return tsMicros(y.last) - tsMicros(x.last); }); // st.matches vem do mais recente
  }

  function fmtWhen(s) {
    var us = tsMicros(s);
    if (isNaN(us)) return '';
    var d = new Date(us / 1000);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function totalWins(id) { var s = stats()[id]; return s ? s.v : 0; }

  // linha "A  3 x 1  B" com o líder em destaque
  function vsRow(aName, aWins, bName, bWins, big) {
    return '<div class="vsrow' + (big ? ' big' : '') + '">' +
      '<span class="n left' + (aWins > bWins ? ' lead' : (aWins < bWins ? ' trail' : '')) + '">' + esc(aName) + '</span>' +
      '<span class="sc rgb">' + aWins + ' x ' + bWins + '</span>' +
      '<span class="n right' + (bWins > aWins ? ' lead' : (bWins < aWins ? ' trail' : '')) + '">' + esc(bName) + '</span></div>';
  }

  /* ---------- aba Jogadores: todo mundo, sem login ---------- */
  function viewJogadores() {
    if (st.jog && st.names[st.jog] && st.players.some(function (p) { return p.id === st.jog; })) return viewJogador(st.jog);
    var rows = rankRows();
    var h = '<section>';
    if (st.eu && st.players.some(function (p) { return p.id === st.eu; })) {
      h += '<button class="box eu-card" type="button" data-act="jog" data-v="' + st.eu + '">' +
        '<span class="lbl">VOCÊ NESTE APARELHO</span><span class="eu-nm rgb glow">' + esc(st.names[st.eu]) + '</span>' +
        '<span class="legend">Toque para ver seus números</span></button>';
    }
    h += '<div class="lbl">JOGADORES · ' + rows.length + '</div>';
    h += '<div class="roster jog-list">';
    rows.forEach(function (r, i) {
      h += '<button class="opt chip' + (r.id === st.eu ? ' eu' : '') + '" type="button" data-act="jog" data-v="' + r.id + '">' +
        '<span class="pos">' + (r.j ? (i + 1) + 'º' : '—') + '</span><span class="nm">' + esc(r.name) + '</span>' +
        '<span class="badge">' + r.rank + ' V</span></button>';
    });
    h += '</div>';
    if (!st.loaded) h += '<div class="note dim blink">Carregando jogadores...</div>';
    else if (!rows.length) h += '<div class="note dim">Ninguém cadastrado ainda. Na aba Partida, toque em + NOVO JOGADOR.</div>';
    else h += '<div class="legend">Toque num nome para ver as partidas e os confrontos dele. Novo jogador entra pela aba Partida.</div>';
    h += '<div class="grow"></div><div class="row center">' +
      '<button class="btn ghost" type="button" data-act="onbOpen">COMO FUNCIONA</button>' +
      '<button class="btn ghost" type="button" data-act="tab" data-v="admin">' + (st.me ? 'PAINEL ADMIN' : 'ÁREA ADMIN') + '</button></div>';
    return h + '</section>';
  }

  /* números, confrontos e últimas partidas de um jogador */
  function viewJogador(id) {
    var nome = nameOf(id), souEu = st.eu === id;
    var rows = rankRows();
    var pos = 0, mine = { rank: 0, j: 0, d: 0 };
    rows.forEach(function (r, i) { if (r.id === id) { pos = i + 1; mine = r; } });
    var h = '<section>';
    h += '<div class="row adm-top"><button class="btn ghost" type="button" data-act="jogVoltar">VOLTAR</button>' +
      '<div class="lbl">JOGADOR</div></div>';
    h += '<div class="box profile-head">' +
      '<div class="profile-name rgb glow">' + esc(nome) + '</div>' +
      (souEu ? '<div class="row center"><span class="eu-tag">ESTE É VOCÊ</span>' +
                 '<button class="btn ghost" type="button" data-act="naoSouEu">NÃO SOU EU</button></div>'
             : '<button class="btn ghost" type="button" data-act="souEu" data-v="' + id + '">ESTE SOU EU</button>') +
      '</div>';
    h += '<div class="tiles">' +
      '<div class="box tile"><div class="num">' + mine.j + '</div><div class="lbl">PARTIDAS</div></div>' +
      '<div class="box tile"><div class="num win">' + mine.rank + '</div><div class="lbl">VITÓRIAS</div></div>' +
      '<div class="box tile"><div class="num">' + mine.d + '</div><div class="lbl">DERROTAS</div></div>' +
      '<div class="box tile"><div class="num">' + (mine.j ? pos + 'º' : '—') + '</div><div class="lbl">NO RANKING</div></div>' +
      '</div>';

    var myPairs = pairs().filter(function (p) { return p.a === id || p.b === id; });
    h += '<div class="two-col"><div class="stack"><div class="lbl">CONFRONTOS · CONTRA CADA UM</div>';
    myPairs.forEach(function (p) {
      var first = p.a === id;
      var opp = first ? p.b : p.a, myW = first ? p.winsA : p.winsB, opW = first ? p.winsB : p.winsA;
      h += '<div class="box pair">' + vsRow(nome, myW, nameOf(opp), opW) +
        '<div class="pair-meta">' + p.count + ' partida' + (p.count > 1 ? 's' : '') + ' entre eles</div></div>';
    });
    if (!myPairs.length) h += '<div class="note dim">Ainda sem partidas. Os confrontos aparecem aqui depois do primeiro jogo.</div>';
    h += '</div>';

    var myMatches = st.matches.filter(function (m) { return m.jogador_a === id || m.jogador_b === id; }).slice(0, 10);
    h += '<div class="stack"><div class="lbl">ÚLTIMAS PARTIDAS</div>';
    myMatches.forEach(function (m) {
      var meA = m.jogador_a === id, pl = placar(m);
      var myG = meA ? pl[0] : pl[1], opG = meA ? pl[1] : pl[0], opp = meA ? m.jogador_b : m.jogador_a;
      var won = meA ? m.jogos_a > m.jogos_b : m.jogos_b > m.jogos_a;
      h += '<div class="match-line"><span class="res ' + (won ? 'w' : 'l') + '">' + (won ? 'VENCEU' : 'PERDEU') + '</span>' +
        '<span class="vt">' + (m.rapido ? 'jogo rápido' : myG + ' x ' + opG) + ' contra ' + esc(nameOf(opp)) + '</span>' +
        '<span class="vt when">' + fmtWhen(m.criado_em) + '</span></div>';
    });
    if (!myMatches.length) h += '<div class="note dim">Nenhuma partida ainda.</div>';
    h += '</div></div>';
    if (!souEu) h += '<div class="legend">ESTE SOU EU fica guardado só neste aparelho e destaca você no ranking. Não precisa de senha.</div>';
    return h + '</section>';
  }

  /* ---------- área admin: o único lugar com PIN ---------- */
  function viewAdminLogin() {
    var h = '<section>';
    h += '<div class="row adm-top"><button class="btn ghost" type="button" data-act="tab" data-v="jogadores">VOLTAR</button>' +
      '<div class="lbl">ÁREA ADMIN</div></div>';
    h += '<div class="welcome-side"><form id="authForm" class="box auth-form" novalidate>' +
      '<div class="note">Só para os admins do placar. Para jogar não precisa entrar.</div>' +
      '<label class="lbl" for="authNome">APELIDO</label>' +
      '<input id="authNome" class="field" type="text" maxlength="10" autocomplete="username" autocapitalize="characters" spellcheck="false" value="' + esc(st.authNome) + '">' +
      '<label class="lbl" for="authPin">PIN · 4 NÚMEROS</label>' +
      '<input id="authPin" class="field pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="current-password" placeholder="••••" value="' + esc(st.authPin) + '">' +
      '<div id="authErr" class="err" role="alert">' + esc(st.authErr) + '</div>' +
      '<button class="btn go start" type="submit"' + (st.authBusy ? ' disabled' : '') + '>' + (st.authBusy ? 'AGUARDE...' : 'ENTRAR') + '</button>' +
      '</form></div>';
    return h + '</section>';
  }

  /* ---------- histórico público de confrontos ---------- */
  function viewHistorico() {
    var filtro = Number(st.histFiltro) || 0;
    var list = pairs().filter(function (p) { return !filtro || p.a === filtro || p.b === filtro; });
    var h = '<section>';
    h += '<div class="filter"><label class="lbl" for="histFiltro">VER CONFRONTOS DE</label>' +
      '<select id="histFiltro" class="field select"><option value="">TODOS OS JOGADORES</option>';
    st.players.forEach(function (p) {
      h += '<option value="' + p.id + '"' + (filtro === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="pairs">';
    list.forEach(function (p) {
      // com filtro, o jogador escolhido fica sempre à esquerda
      var swap = filtro && p.b === filtro;
      var a = swap ? p.b : p.a, b = swap ? p.a : p.b, wa = swap ? p.winsB : p.winsA, wb = swap ? p.winsA : p.winsB;
      var ta = totalWins(a), tb = totalWins(b);
      h += '<div class="box pair">' + vsRow(nameOf(a), wa, nameOf(b), wb, true) +
        '<div class="pair-meta">' + p.count + ' partida' + (p.count > 1 ? 's' : '') + ' entre eles · última ' + fmtWhen(p.last) + '</div>' +
        '<div class="pair-total">Ranking geral: <span class="' + (ta > tb ? 'lead' : '') + '">' + esc(nameOf(a)) + ' ' + ta + ' PTS</span> · ' +
          '<span class="' + (tb > ta ? 'lead' : '') + '">' + esc(nameOf(b)) + ' ' + tb + ' PTS</span></div>' +
        '</div>';
    });
    h += '</div>';
    if (!st.loaded) h += '<div class="note dim blink">Carregando histórico...</div>';
    else if (!list.length) h += '<div class="note dim">' + (filtro ? 'Esse jogador ainda não jogou nenhuma partida.' : 'Nenhuma partida registrada ainda.') + '</div>';
    h += '<div class="legend">O placar grande mostra quantas partidas cada um venceu contra o outro. PTS no ranking geral = vitórias contra todos (1 ponto por vitória).</div>';
    return h + '</section>';
  }

  /* ---------- painel admin ----------
     dono (BUMBLEBEE): apaga histórico, muda apelidos, exclui jogadores, escolhe admins e define o PIN deles.
     admin: apaga histórico, muda apelidos e exclui jogadores, mas não mexe no dono nem em outros admins.
     O banco confere tudo de novo; a tela só esconde o que a pessoa não pode fazer. */
  var ADM_MSG = {
    sem_permissao: 'Você não tem permissão para isso.',
    proprio_perfil: 'Isso não pode ser feito no seu próprio perfil.',
    alvo_protegido: 'Esse jogador é admin. Só o dono mexe nele.',
    em_partida: 'Esse jogador está numa partida ao vivo. Espere a partida acabar.',
    nao_encontrado: 'Jogador não encontrado. A lista foi atualizada.',
    sem_pin: 'Defina um PIN para ele antes de torná-lo admin.',
    apelido_invalido: 'Digite um apelido de 1 a 10 letras.',
    apelido_em_uso: 'Esse apelido já está na lista.',
    pin_invalido: 'O PIN precisa ter 4 números.'
  };

  var admLoading = false;
  function loadAdmin() {
    if (admLoading || !st.me || !st.me.papel) return Promise.resolve();
    admLoading = true;
    return rpc('admin_painel', { p_token: loadToken() }).then(function (r) {
      admLoading = false;
      if (r && r.ok) {
        st.adm = r;
        if (st.admSel && !r.jogadores.some(function (j) { return j.id === st.admSel; })) { st.admSel = null; st.admForm = ''; }
        render();
      }
    }).catch(function (err) {
      admLoading = false;
      admFail(err);
    });
  }

  function admFail(err) {
    if (err.code === 'sem_sessao') { logout(); return; }
    if (err.code === 'sem_permissao') {
      // pode ter perdido o acesso de admin enquanto estava no painel: confere de novo
      set({ admBusy: false, admArm: '', admMsg: '', admErr: ADM_MSG.sem_permissao });
      checkSession();
      return;
    }
    var faltaNoBanco = err.status === 404 && err.body && err.body.code === 'PGRST202';
    set({ admBusy: false, admArm: '', admMsg: '',
          admErr: faltaNoBanco ? 'Essa ação ainda não está ativa no banco.' : (ADM_MSG[err.code] || 'Não deu certo. Confira a internet e tente de novo.') });
    loadAdmin();
  }

  // roda uma ou mais funções do banco em sequência; para na primeira que falhar
  function admRun(calls, okMsg) {
    if (st.admBusy) return;
    var token = loadToken();
    set({ admBusy: true, admErr: '', admMsg: '', admArm: '' });
    calls.reduce(function (prev, c) {
      return prev.then(function () { var args = c[1]; args.p_token = token; return rpc(c[0], args); });
    }, Promise.resolve()).then(function () {
      st.admBusy = false; st.admMsg = okMsg; st.admForm = ''; st.admFormVal = '';
      refresh();
      loadAdmin();
      render();
    }).catch(admFail);
  }

  // o que quem está logado pode fazer com este jogador
  function admCan(j) {
    var eu = st.me, souDono = eu.papel === 'dono';
    var protegido = j.id === eu.id || j.papel === 'dono' || (j.papel === 'admin' && !souDono);
    var podeAdmin = souDono && j.id !== eu.id && j.papel !== 'dono';
    return {
      apagar: j.partidas > 0,
      renomear: !protegido || j.id === eu.id,
      excluir: !protegido,
      darAdmin: podeAdmin && !j.papel,
      tirarAdmin: podeAdmin && j.papel === 'admin',
      pin: podeAdmin && j.papel === 'admin'
    };
  }

  function admBtn(acao, id, label, warn) {
    var key = acao + ':' + id;
    var armed = warn && st.admArm === key;
    return '<button class="btn ghost' + (armed ? ' warn' : '') + '" type="button" data-act="admDo" data-v="' + key + '"' +
      (st.admBusy ? ' disabled' : '') + '>' + (armed ? 'CONFIRMAR?' : label) + '</button>';
  }

  // formulário dentro do jogador aberto: novo apelido ou PIN
  function admFormHtml(j) {
    var ren = st.admForm === 'ren';
    var label = ren ? 'NOVO APELIDO' : (st.admForm === 'pinAdmin' ? 'PIN DE 4 NÚMEROS PARA ' + esc(j.nome) + ' ENTRAR NA ÁREA ADMIN' : 'NOVO PIN DE ' + esc(j.nome));
    return '<form id="admForm" class="add-form adm-actions" novalidate>' +
      '<label class="lbl" for="admFormVal">' + label + '</label>' +
      '<div class="row"><input id="admFormVal" class="field' + (ren ? '' : ' pin') + '" ' +
        (ren ? 'type="text" maxlength="10" autocapitalize="characters"' : 'type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"') +
        ' spellcheck="false" autocomplete="off" value="' + esc(st.admFormVal) + '">' +
      '<button class="btn go" type="submit"' + (st.admBusy ? ' disabled' : '') + '>' + (st.admForm === 'pinAdmin' ? 'TORNAR ADMIN' : 'SALVAR') + '</button></div>' +
      (ren ? '' : '<div class="legend">Passe o PIN para ele pessoalmente. Ele entra pela ÁREA ADMIN, na aba Jogadores.</div>') +
      '<div class="row"><button class="btn ghost" type="button" data-act="admFormCancel">CANCELAR</button></div></form>';
  }

  function viewAdmin() {
    var adm = st.adm, souDono = st.me.papel === 'dono';
    var h = '<section>';
    h += '<div class="row adm-top"><button class="btn ghost" type="button" data-act="tab" data-v="jogadores">VOLTAR</button>' +
      '<div class="lbl">PAINEL ADMIN · ' + (souDono ? 'DONO' : 'ADMIN') + ' · ' + esc(st.me.nome) + '</div></div>';
    if (st.admErr) h += '<div class="err" role="alert">' + esc(st.admErr) + '</div>';
    if (st.admMsg) h += '<div class="ok-msg" role="status">' + esc(st.admMsg) + '</div>';
    if (!adm) return h + '<div class="note dim blink">Carregando painel...</div></section>';

    h += '<div class="lbl">JOGADORES · ' + adm.jogadores.length + '</div><div class="adm-list">';
    adm.jogadores.forEach(function (j) {
      var open = st.admSel === j.id, can = admCan(j);
      var tags = '';
      if (j.papel === 'dono') tags += '<span class="tag-s dono">DONO</span>';
      else if (j.papel === 'admin') tags += '<span class="tag-s admin">ADMIN</span>';
      if (j.id === st.me.id) tags += '<span class="tag-s">VOCÊ</span>';
      if (j.papel && j.bloqueado) tags += '<span class="tag-s alert">PIN BLOQUEADO</span>';
      h += '<div class="box adm-item' + (open ? ' open' : '') + '">' +
        '<button class="adm-head" type="button" data-act="admSel" data-v="' + j.id + '" aria-expanded="' + open + '">' +
          '<span class="nm">' + esc(j.nome) + '</span><span class="adm-tags">' + tags + '</span>' +
          '<span class="cnt">' + j.partidas + ' partida' + (j.partidas === 1 ? '' : 's') + '</span>' +
          '<span class="adm-caret" aria-hidden="true">' + (open ? '−' : '+') + '</span></button>';
      if (open && st.admForm) {
        h += admFormHtml(j);
      } else if (open) {
        var acts = '';
        if (can.apagar) acts += admBtn('limpar', j.id, 'APAGAR PARTIDAS', true);
        if (can.renomear) acts += admBtn('ren', j.id, 'MUDAR APELIDO', false);
        if (can.darAdmin) acts += admBtn('darAdmin', j.id, 'TORNAR ADMIN', false);
        if (can.pin) acts += admBtn('pin', j.id, j.bloqueado ? 'DESBLOQUEAR / NOVO PIN' : 'NOVO PIN', false);
        if (can.tirarAdmin) acts += admBtn('tirarAdmin', j.id, 'TIRAR ADMIN', true);
        if (can.excluir) acts += admBtn('excluir', j.id, 'EXCLUIR JOGADOR', true);
        h += acts ? '<div class="row center adm-actions">' + acts + '</div>'
          : '<div class="note dim adm-actions">' + (j.papel === 'dono' ? 'Jogador do dono: ninguém mexe nele.' : 'Jogador admin: só o dono mexe nele.') + '</div>';
      }
      h += '</div>';
    });
    if (!adm.jogadores.length) h += '<div class="note dim">Nenhum jogador cadastrado.</div>';
    h += '</div>';

    h += '<div class="box adm-danger"><div class="lbl">HISTÓRICO GERAL</div>' +
      '<div class="note">' + adm.partidas + ' partida' + (adm.partidas === 1 ? '' : 's') + ' registrada' + (adm.partidas === 1 ? '' : 's') + '. Apagar zera o ranking e o histórico de todo mundo.</div>' +
      (adm.partidas ? admBtn('limparTudo', 0, 'APAGAR TODO O HISTÓRICO', true) : '') + '</div>';

    h += '<div class="legend">Toque num jogador para ver as ações. APAGAR PARTIDAS tira do histórico as partidas dele. ' +
      'EXCLUIR JOGADOR tira o nome da lista e do ranking; as partidas dele ficam no histórico. ' +
      (souDono ? 'Só você escolhe os admins: ao tornar alguém admin, você define o PIN que ele usa na ÁREA ADMIN. Admins não mexem em você nem em outros admins.'
               : 'Só o dono escolhe os admins.') + '</div>';
    h += '<div class="row center"><button class="btn ghost" type="button" data-act="logout">SAIR DA ÁREA ADMIN</button></div>';
    return h + '</section>';
  }

  function admDo(v) {
    var parts = v.split(':'), acao = parts[0], id = Number(parts[1]);
    var j = st.adm && st.adm.jogadores.filter(function (x) { return x.id === id; })[0];
    var nome = j ? j.nome : '';
    if (acao === 'ren') { set({ admForm: 'ren', admFormVal: nome, admErr: '', admMsg: '', admArm: '' }); focusAdmForm(true); return; }
    if (acao === 'pin') { set({ admForm: 'pin', admFormVal: '', admErr: '', admMsg: '', admArm: '' }); focusAdmForm(); return; }
    if (acao === 'darAdmin' && j && !j.tem_pin) { set({ admForm: 'pinAdmin', admFormVal: '', admErr: '', admMsg: '', admArm: '' }); focusAdmForm(); return; }
    var confirmar = acao !== 'darAdmin';
    if (confirmar && st.admArm !== v) { set({ admArm: v, admErr: '', admMsg: '' }); return; }
    switch (acao) {
      case 'limpar': admRun([['admin_limpar_historico', { p_id: id }]], 'Partidas de ' + nome + ' apagadas.'); break;
      case 'limparTudo': admRun([['admin_limpar_historico', { p_id: null }]], 'Histórico apagado.'); break;
      case 'excluir': admRun([['admin_excluir_perfil', { p_id: id }]], nome + ' saiu da lista.'); break;
      case 'darAdmin': admRun([['admin_definir_admin', { p_id: id, p_admin: true }]], nome + ' agora é admin. Ele entra pela ÁREA ADMIN com o PIN que já tem.'); break;
      case 'tirarAdmin': admRun([['admin_definir_admin', { p_id: id, p_admin: false }]], nome + ' não é mais admin.'); break;
    }
  }

  function focusAdmForm(select) {
    var el = document.getElementById('admFormVal');
    if (el) { el.focus(); if (select) try { el.select(); } catch (e) {} }
  }

  function submitAdmForm() {
    var id = st.admSel, val = (st.admFormVal || '').trim();
    var j = st.adm && st.adm.jogadores.filter(function (x) { return x.id === id; })[0];
    if (!j) return;
    if (st.admForm === 'ren') {
      var nome = val.toUpperCase().slice(0, 10);
      if (!nome) { set({ admErr: ADM_MSG.apelido_invalido }); return; }
      if (nome === j.nome) { set({ admForm: '' }); return; }
      admRun([['admin_renomear', { p_id: id, p_nome: nome }]], j.nome + ' agora é ' + nome + '.');
      return;
    }
    if (!/^[0-9]{4}$/.test(val)) { set({ admErr: ADM_MSG.pin_invalido }); return; }
    if (st.admForm === 'pinAdmin') {
      admRun([['admin_definir_pin', { p_id: id, p_pin: val }], ['admin_definir_admin', { p_id: id, p_admin: true }]],
        j.nome + ' agora é admin. Passe o PIN para ele.');
    } else {
      admRun([['admin_definir_pin', { p_id: id, p_pin: val }]], 'PIN de ' + j.nome + ' trocado.');
    }
  }

  function viewRanking() {
    var flash = st.winFlash && Date.now() < st.winFlash.until ? st.winFlash : null;
    var rows = rankRows(); // pontos no ranking: 1 por vitória

    var h = '<section>';
    if (flash) {
      h += '<div class="win-news" role="status"><span class="plus blink">+1</span>' +
        '<span>' + esc(nameOf(flash.winner)) + ' venceu ' + esc(nameOf(flash.loser)) + ' ' + esc(flash.como) + '</span></div>';
    }
    // jogo rápido que este aparelho acabou de registrar: dá para desfazer por 2 minutos
    var feito = st.rapidoFeito && Date.now() < st.rapidoFeito.until ? st.rapidoFeito : null;
    if (feito) {
      h += '<div class="box desfazer-rapido"><span class="vt">Registrou a vitória errada? Desfaça e registre de novo.</span>' +
        '<button class="btn ghost' + (st.rapidoArm ? ' warn' : '') + '" type="button" data-act="rapidoDesfazer"' + (st.busy ? ' disabled' : '') + '>' +
        (st.busy ? 'DESFAZENDO...' : (st.rapidoArm ? 'CONFIRMAR?' : 'DESFAZER')) + '</button></div>';
    }
    if (st.rankMsg && Date.now() < st.rankMsg.until) h += '<div class="err" role="alert">' + esc(st.rankMsg.text) + '</div>';
    h += '<div class="rank-layout"><div class="stack">';
    h += '<div class="box rank-box">' +
      '<div class="rk head"><span>#</span><span>JOGADOR</span><span class="r">PTS</span><span class="r">J</span><span class="r">D</span><span class="r">SJ</span></div>';
    rows.forEach(function (r, i) {
      var top = i === 0 && r.rank > 0;
      var won = flash && flash.winner === r.id;
      var isMe = st.eu === r.id;
      h += '<div class="rk line' + (top ? ' top' : '') + (won ? ' won' : '') + (isMe ? ' me' : '') + '"><span>' + (i + 1) + 'º</span><span class="n">' + esc(r.name) + '</span>' +
        '<span class="r pts">' + (won ? '<span class="plus blink">+1</span>' : '') + r.rank + '</span>' +
        '<span class="r">' + r.j + '</span><span class="r">' + r.d + '</span>' +
        '<span class="r">' + (r.sj > 0 ? '+' + r.sj : r.sj) + '</span></div>';
    });
    if (!st.loaded) h += '<div class="note dim blink" style="padding: var(--gap)">Carregando ranking...</div>';
    else if (!rows.length) h += '<div class="note dim" style="padding: var(--gap)">Cadastre jogadores para montar o ranking.</div>';
    h += '</div>';
    h += '<div class="legend">PTS 1 ponto por vitória · J partidas · D derrotas · SJ saldo de jogos (desempate) · jogo único mostra os pontos; mais de um jogo, os jogos · jogo rápido conta só a vitória</div></div>';
    h += '<div class="stack"><div class="lbl">ÚLTIMAS PARTIDAS</div>';
    st.matches.slice(0, 5).forEach(function (m) {
      var aWon = m.jogos_a > m.jogos_b, pl = placar(m);
      var line = m.rapido
        ? nameOf(aWon ? m.jogador_a : m.jogador_b) + ' venceu ' + nameOf(aWon ? m.jogador_b : m.jogador_a)
        : aWon
          ? nameOf(m.jogador_a) + '  ' + pl[0] + ' x ' + pl[1] + '  ' + nameOf(m.jogador_b)
          : nameOf(m.jogador_b) + '  ' + pl[1] + ' x ' + pl[0] + '  ' + nameOf(m.jogador_a);
      h += '<div class="note">' + esc(line) + (m.rapido ? ' <span class="rapido-tag">RÁPIDO</span>' : '') + '</div>';
    });
    if (st.loaded && !st.matches.length) h += '<div class="note dim">Nenhuma partida registrada.</div>';
    h += '</div></div><div class="grow"></div>';
    return h + '</section>';
  }

  var view = document.getElementById('view');
  var tabbar = document.getElementById('tabbar');
  var overlay = document.getElementById('overlay');
  var content = document.querySelector('.content');
  var footRegra = document.getElementById('footRegra');

  function render() {
    var body, bar = '';
    // ninguém precisa entrar: o site abre direto nas abas
    bar = tabs();
    if (st.tab === 'ranking') body = viewRanking();
    else if (st.tab === 'historico') body = viewHistorico();
    else if (st.tab === 'jogadores') body = viewJogadores();
    else if (st.tab === 'admin') body = st.me ? viewAdmin() : viewAdminLogin();
    else body = (st.playing || st.live) ? viewBoard() : viewSetup();
    // a tela se atualiza sozinha; quem está digitando não perde o texto nem o cursor
    var act = document.activeElement;
    var typingId = act && act.tagName === 'INPUT' && act.id ? act.id : null;
    var caret = null;
    try { caret = typingId ? act.selectionStart : null; } catch (e) {}
    var scroll = view.scrollTop;
    tabbar.innerHTML = bar;
    view.innerHTML = body;
    if (footRegra) footRegra.textContent = (st.playing || st.live) ? regraResumo(game().regra) : 'REGRAS ESCOLHIDAS A CADA PARTIDA';
    view.scrollTop = scroll;
    var tut = st.onb !== null;
    var hadTut = !!overlay.firstChild;
    overlay.innerHTML = tut ? viewTutorial() : '';
    content.inert = tut;
    if (tut) {
      if (!overlay.contains(document.activeElement)) { var nx = overlay.querySelector('.ob-next'); if (nx) nx.focus(); }
      return;
    }
    if (hadTut) { var tb = tabbar.querySelector('.tab.on'); if (tb) tb.focus(); }
    if (typingId) {
      var inp = document.getElementById(typingId);
      if (inp) { inp.focus(); try { if (caret !== null) inp.setSelectionRange(caret, caret); } catch (e) {} }
    }
  }

  /* ---------- toque no placar ----------
     1 toque = ponto para o jogador; 2 toques rápidos no mesmo placar = tira 1 ponto dele.
     O ponto só entra depois de DOUBLE_TAP_MS, para dar tempo de ver se veio um segundo toque. */
  var pendingTap = null;
  function showTapFx(v, text, minus) {
    st.tapFx = { v: v, text: text, minus: !!minus, until: Date.now() + 700 };
    setTimeout(function () { if (st.tapFx && Date.now() >= st.tapFx.until) { st.tapFx = null; render(); } }, 750);
  }
  function addPoint(v) {
    if (!st.playing || game().w) return;
    st.quitArm = false;
    st.hist = st.hist.concat([v]);
    showTapFx(v, '+1', false);
    render(); push();
  }
  function removePoint(v) {
    if (!st.playing) return;
    var before = st.hist.length;
    st.hist = dropLast(v);
    showTapFx(v, st.hist.length < before ? '−1' : '0', true);
    render(); push();
  }
  function tapScore(v, el) {
    if (el) { el.classList.remove('pressed'); void el.offsetWidth; el.classList.add('pressed'); }
    if (pendingTap && pendingTap.v === v) {          // segundo toque no mesmo placar
      clearTimeout(pendingTap.timer); pendingTap = null;
      removePoint(v);
      return;
    }
    if (pendingTap) { clearTimeout(pendingTap.timer); var prev = pendingTap.v; pendingTap = null; addPoint(prev); }
    pendingTap = { v: v, timer: setTimeout(function () { pendingTap = null; addPoint(v); }, DOUBLE_TAP_MS) };
  }

  /* ---------- ações ---------- */
  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var act = el.getAttribute('data-act');
    var v = el.getAttribute('data-v');
    var control = st.playing;
    var g = (st.playing || st.live) ? game() : null;

    switch (act) {
      case 'tab':
        if (v === 'admin') { st.admErr = ''; st.admMsg = ''; st.admSel = null; st.admForm = ''; st.authErr = ''; }
        set({ tab: v, quitArm: false, admArm: '', jog: v === 'jogadores' ? st.jog : null, novo: v === 'partida' ? st.novo : false });
        if (v === 'admin') loadAdmin();
        break;
      case 'admSel':
        set({ admSel: st.admSel === Number(v) ? null : Number(v), admArm: '', admErr: '', admMsg: '', admForm: '' });
        break;
      case 'admFormCancel':
        set({ admForm: '', admFormVal: '', admErr: '' });
        break;
      case 'jog':
        set({ jog: Number(v) });
        view.scrollTop = 0;
        break;
      case 'jogVoltar':
        set({ jog: null });
        break;
      case 'souEu':
        saveEu(Number(v));
        break;
      case 'naoSouEu':
        saveEu(null);
        break;
      case 'novoAbrir':
        set({ novo: true, novoErr: '' });
        var ni = document.getElementById('novoNome'); if (ni) ni.focus();
        break;
      case 'novoCancelar':
        set({ novo: false, novoNome: '', novoErr: '' });
        break;
      case 'admDo':
        admDo(v);
        break;
      case 'onbNext': set({ onb: st.onb + 1 }); focusNext(); break;
      case 'onbPrev': set({ onb: Math.max(0, st.onb - 1) }); focusNext(); break;
      case 'onbGo': set({ onb: Number(v) }); break;
      case 'onbSkip': case 'onbDone': closeTutorial(); break;
      case 'onbOpen': set({ onb: 0, onbNovo: false }); focusNext(); break;
      case 'logout':
        logout();
        break;
      case 'pick': {
        if (st.live) return;
        var id = Number(v), cur = st.picked.slice(), i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1);
        else if (cur.length < 2) cur.push(id);
        else cur[1] = id;
        // mudou quem está na mesa: o vencedor escolhido antes não vale mais
        set({ picked: cur, vencedor: 0, startErr: '' });
        break;
      }
      case 'fp':
        set({ firstPick: Number(v) });
        break;
      case 'modo':
        saveModo(v);
        set({ modo: v, vencedor: 0, startErr: '', regraAberta: false });
        break;
      case 'vence':
        set({ vencedor: st.vencedor === Number(v) ? 0 : Number(v), startErr: '' });
        break;
      case 'start':
        startMatch();
        break;
      case 'rapido':
        registerQuick();
        break;
      case 'rapidoDesfazer':
        undoQuick();
        break;
      case 'rgAbrir': {
        var abrindo = !st.regraAberta;
        set({ regraAberta: abrindo, regraTxt: abrindo ? st.regraTxt : regraTexto(st.regra) });
        // mostra as regras inteiras e o botão INICIAR logo abaixo
        var bx = view.querySelector(abrindo ? '.regras' : '.start');
        if (bx && bx.scrollIntoView) try { bx.scrollIntoView({ block: abrindo ? 'start' : 'end', behavior: 'smooth' }); } catch (e) { bx.scrollIntoView(); }
        break;
      }
      case 'rgMais': mudaRegra(v, 1); break;
      case 'rgMenos': mudaRegra(v, -1); break;
      case 'rgVant':
        st.regra.vantagem = v === '1'; saveRegra(); set({ startErr: '' });
        break;
      case 'rgDireto':
        st.regra.direto = v === '1'; saveRegra(); set({ startErr: '' });
        break;
      case 'add':
        if (!control || g.w) return;
        tapScore(Number(v), el);
        break;
      case 'sub':
        if (!control) return;
        set({ hist: dropLast(Number(v)) }); push();
        break;
      case 'undo':
        if (!control) return;
        set({ hist: st.hist.slice(0, -1) }); push();
        break;
      case 'banner':
        if (!control) return;
        if (g.champ) endMatch(true, g);
        else { set({ hist: [], g1: g.gp1, g2: g.gp2, pts1: st.pts1 + g.s1, pts2: st.pts2 + g.s2, first: g.w }); push(); }
        break;
      case 'resetPoints':
        if (!control) return;
        set({ hist: [] }); push();
        break;
      case 'quit':
        if (!control) return;
        if (!st.quitArm) set({ quitArm: true });
        else endMatch(false);
        break;
      case 'release':
        rpc('liberar_partida_parada', {}).then(refreshLive).catch(function () { refreshLive(); });
        break;
    }
  }
  view.addEventListener('click', onClick);
  overlay.addEventListener('click', onClick);
  function focusNext() { var nx = overlay.querySelector('.ob-next'); if (nx) nx.focus(); }
  overlay.addEventListener('keydown', function (e) {
    if (st.onb === null) return;
    var total = tutorialSteps().length;
    if (e.key === 'Escape') { e.preventDefault(); closeTutorial(); }
    else if (st.onbNovo) return;
    else if (e.key === 'ArrowRight' && st.onb < total - 1) { e.preventDefault(); set({ onb: st.onb + 1 }); focusNext(); }
    else if (e.key === 'ArrowLeft' && st.onb > 0) { e.preventDefault(); set({ onb: st.onb - 1 }); focusNext(); }
  });
  tabbar.addEventListener('click', onClick);

  view.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'authNome') { st.authNome = el.value.toUpperCase().slice(0, 10); clearMsg('authErr', 'authErr'); }
    else if (el.id === 'authPin') {
      var digits = el.value.replace(/\D/g, '').slice(0, 4);
      if (el.value !== digits) el.value = digits;
      st.authPin = digits; clearMsg('authErr', 'authErr');
    }
    else if (el.id === 'novoNome') { st.novoNome = el.value.toUpperCase().slice(0, 10); clearMsg('novoErr', 'novoErr'); }
    else if (el.id === 'rg-pontos' || el.id === 'rg-diretoN') {
      // só números; qualquer valor a partir de 1 vale
      var k = el.id.slice(3), dig = el.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 6);
      if (el.value !== dig) el.value = dig;
      st.regraTxt[k] = dig;
      if (parseInt(dig, 10) >= 1) { st.regra[k] = parseInt(dig, 10); saveRegra(); }
      var res = document.querySelector('.regras-resumo'); if (res) res.textContent = regraResumo(regraDoEditor());
    }
    else if (el.id === 'admFormVal') {
      if (st.admForm === 'ren') st.admFormVal = el.value.toUpperCase().slice(0, 10);
      else { var pin = el.value.replace(/\D/g, '').slice(0, 4); if (el.value !== pin) el.value = pin; st.admFormVal = pin; }
    }
  });
  function clearMsg(id, key) {
    if (!st[key]) return;
    st[key] = '';
    var m = document.getElementById(id); if (m) m.textContent = '';
  }
  view.addEventListener('change', function (e) {
    if (e.target.id === 'rg-pontos' || e.target.id === 'rg-diretoN') {
      // campo apagado volta para o último número válido
      var k = e.target.id.slice(3);
      if (!(parseInt(st.regraTxt[k], 10) >= 1)) { st.regraTxt[k] = String(st.regra[k]); }
      set({ startErr: '' });
    }
    if (e.target.id === 'histFiltro') set({ histFiltro: e.target.value });
  });

  view.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'authForm') doAuth();
    else if (e.target.id === 'novoForm') addPlayer();
    else if (e.target.id === 'admForm') submitAdmForm();
  });

  /* ---------- tempo real ---------- */
  // Com o tempo real ligado, o banco avisa na hora cada ponto marcado. Se ele cair, a tela consulta o banco a cada 2 segundos.
  function startRealtime() {
    if (!window.supabase || !window.supabase.createClient) return;
    try {
      var client = window.supabase.createClient(DB_URL, DB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      client.channel('placar-disputa-elsys')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'partida_ao_vivo' }, function (p) {
          if (p.new && p.new.id === 1) applyLive(p.new); else refreshLive();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jogadores' }, function () { refresh(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'partidas' }, function () { refresh(); })
        .subscribe(function (status) {
          var on = status === 'SUBSCRIBED';
          if (on && !st.rt) { refreshLive(); refresh(); }
          st.rt = on;
        });
    } catch (e) { st.rt = false; }
  }

  var tick = 0;
  setInterval(function () {
    if (document.hidden) return;
    tick += 1;
    if (!st.rt || tick % 10 === 0) refreshLive();        // 2 s sem tempo real, 20 s com
    if (tick % (st.rt ? 15 : 4) === 0) refresh();        // 8 s sem tempo real, 30 s com
    if (st.live && !st.playing) render.lazy();           // contador de partida parada
  }, 2000);
  render.lazy = (function () { var n = 0; return function () { if (++n % 15 === 0) render(); }; })();
  setInterval(function () { if (st.playing) push(); }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshLive(); refresh(); } });

  st.eu = loadEu();
  st.regra = loadRegra(); st.regraTxt = regraTexto(st.regra);
  st.modo = loadModo();
  maybeTutorial();
  render();
  checkSession();
  refresh();
  refreshLive();
  startRealtime();
})();
