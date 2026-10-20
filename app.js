/* Placar Disputa Elsys — perfis, placar, ranking, histórico de confrontos e partida ao vivo.
   Cada pessoa entra com o próprio perfil (apelido + PIN de 4 números).
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
  var TUTORIAL_KEY = 'disputa-elsys-tutorial-v1'; // perfis que já viram o tutorial neste aparelho

  var st = {
    tab: 'partida',
    players: [], names: {}, matches: [],
    seenMatches: null,   // ids de partidas já conhecidas (null até a primeira carga)
    winFlash: null,      // { match, winner, loser, until } — destaque do vencedor recém-salvo
    loaded: false, netErr: false, busy: false,
    // perfil
    me: null, authChecked: false, authMode: 'criar', authNome: '', authPin: '', authErr: '', authBusy: false,
    renaming: false, renameDraft: '', renameErr: '', histFiltro: '',
    picked: [], firstPick: 1, startErr: '',
    live: null,          // partida ao vivo vinda do banco (ou null)
    rt: false,           // tempo real conectado
    // partida que ESTE aparelho está marcando
    playing: false, m1: null, m2: null, hist: [], g1: 0, g2: 0, first: 1, pts1: 0, pts2: 0,
    quitArm: false, saveErr: '', syncErr: '',
    tapFx: null,         // { v, text, minus, until } — +1 / −1 que aparece no placar tocado
    onb: null            // passo do tutorial aberto (ou null)
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

  /* Confere se o login guardado neste aparelho ainda vale. */
  function checkSession() {
    var t = loadToken();
    if (!t) { set({ me: null, authChecked: true }); return Promise.resolve(); }
    return rpc('meu_perfil', { p_token: t }).then(function (r) {
      if (r && r.ok) { st.me = { id: r.id, nome: r.nome }; st.authChecked = true; maybeTutorial(); render(); }
      else { saveToken(null); set({ me: null, authChecked: true }); }
    }).catch(function () {
      // sem internet: mantém a pessoa na tela e tenta de novo depois
      set({ authChecked: true, netErr: true });
      setTimeout(checkSession, 4000);
    });
  }

  var AUTH_MSG = {
    apelido_invalido: 'Digite um apelido de 1 a 10 letras.',
    pin_invalido: 'O PIN precisa ter 4 números.',
    apelido_em_uso: 'Esse apelido já tem perfil. Se é você, toque em "Já tenho perfil".',
    apelido_nao_encontrado: 'Não achamos esse apelido. Confira ou crie um perfil.',
    sem_pin: 'Esse apelido ainda não tem PIN. Toque em "Criar perfil" para criar o seu.',
    pin_incorreto: 'PIN errado.',
    bloqueado: 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.'
  };

  function doAuth() {
    if (st.authBusy) return;
    var nome = (st.authNome || '').trim().toUpperCase().slice(0, 10);
    var pin = st.authPin || '';
    if (!nome) { set({ authErr: AUTH_MSG.apelido_invalido }); return; }
    if (!/^[0-9]{4}$/.test(pin)) { set({ authErr: AUTH_MSG.pin_invalido }); return; }
    set({ authBusy: true, authErr: '' });
    rpc(st.authMode === 'criar' ? 'criar_perfil' : 'entrar', { p_nome: nome, p_pin: pin }).then(function (r) {
      if (r && r.ok) {
        saveToken(r.token);
        st.me = { id: r.id, nome: r.nome };
        maybeTutorial();
        set({ authBusy: false, authPin: '', authNome: '', authErr: '', tab: 'partida' });
        refresh();
        return;
      }
      var msg = AUTH_MSG[r && r.erro] || 'Não deu certo. Tente de novo.';
      if (r && r.erro === 'pin_incorreto' && r.restantes) msg += ' Restam ' + r.restantes + ' tentativa' + (r.restantes > 1 ? 's' : '') + '.';
      if (r && r.erro === 'bloqueado' && r.segundos) msg = 'Muitas tentativas erradas. Tente de novo em ' + Math.ceil(r.segundos / 60) + ' min.';
      set({ authBusy: false, authErr: msg, authPin: '' });
    }).catch(function () {
      set({ authBusy: false, authErr: 'Sem conexão. Confira a internet e tente de novo.' });
    });
  }

  function logout() {
    var t = loadToken();
    saveToken(null);
    if (t) rpc('sair', { p_token: t }).catch(function () {});
    set({ me: null, tab: 'partida', authMode: 'entrar', renaming: false, picked: [], onb: null });
  }

  function doRename() {
    var nome = (st.renameDraft || '').trim().toUpperCase().slice(0, 10);
    if (!nome) { set({ renameErr: AUTH_MSG.apelido_invalido }); return; }
    if (st.me && nome === st.me.nome) { set({ renaming: false, renameErr: '' }); return; }
    set({ busy: true, renameErr: '' });
    rpc('renomear_perfil', { p_token: loadToken(), p_nome: nome }).then(function (r) {
      st.busy = false;
      if (r && r.ok) { set({ me: { id: r.id, nome: r.nome }, renaming: false }); refresh(); return; }
      if (r && r.erro === 'sem_sessao') { logout(); return; }
      set({ renameErr: r && r.erro === 'apelido_em_uso' ? 'Esse apelido já é de outra pessoa.' : (AUTH_MSG[r && r.erro] || 'Não deu certo. Tente de novo.') });
    }).catch(function () {
      set({ busy: false, renameErr: 'Sem conexão. Confira a internet e tente de novo.' });
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
      api('partidas?select=id,jogador_a,jogador_b,jogos_a,jogos_b,pontos_a,pontos_b,criado_em&order=criado_em.desc&limit=5000')
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
      st.picked = st.picked.filter(function (id) { return active[id]; });
      if (st.delArm && !active[st.delArm]) st.delArm = null;
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
                    score: aWon ? m.jogos_a + ' x ' + m.jogos_b : m.jogos_b + ' x ' + m.jogos_a, until: Date.now() + FLASH_MS };
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
    if (st.playing) return { hist: st.hist, g1: st.g1, g2: st.g2, first: st.first, m1: st.m1, m2: st.m2, pts1: st.pts1, pts2: st.pts2 };
    var l = st.live;
    return { hist: l.pontos || [], g1: l.jogos_a, g2: l.jogos_b, first: l.primeiro, m1: l.jogador_a, m2: l.jogador_b, pts1: l.pts_a, pts2: l.pts_b };
  }

  function game(src) {
    src = src || source();
    var hist = src.hist;
    var s1 = hist.filter(function (x) { return x === 1; }).length;
    var s2 = hist.length - s1;
    var wins = function (a, b) { return a >= 11 && a - b >= 2; };
    var w = wins(s1, s2) ? 1 : (wins(s2, s1) ? 2 : 0);
    var gp1 = src.g1 + (w === 1 ? 1 : 0);
    var gp2 = src.g2 + (w === 2 ? 1 : 0);
    var champ = gp1 >= 2 ? 1 : (gp2 >= 2 ? 2 : 0);
    var server = hist.length ? hist[hist.length - 1] : src.first;
    var name1 = nameOf(src.m1), name2 = nameOf(src.m2);
    return { s1: s1, s2: s2, w: w, gp1: gp1, gp2: gp2, champ: champ, server: server, name1: name1, name2: name2,
             wName: w === 1 ? name1 : name2, pts1: src.pts1, pts2: src.pts2 };
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
    set({ busy: true, startErr: '' });
    rpc('iniciar_partida_logado', { p_token: loadToken(), p_jogador_a: a, p_jogador_b: b, p_primeiro: first, p_chave: chave })
      .then(function (inicio) {
        saveOwner({ chave: chave, iniciada_em: inicio });
        st.busy = false;
        st.playing = true; st.m1 = a; st.m2 = b; st.first = first;
        st.hist = []; st.g1 = 0; st.g2 = 0; st.pts1 = 0; st.pts2 = 0; st.quitArm = false; st.saveErr = ''; st.syncErr = '';
        st.picked = []; st.firstPick = 1;
        applyLive({ id: 1, ativa: true, jogador_a: a, jogador_b: b, primeiro: first, pontos: [], jogos_a: 0, jogos_b: 0,
                    pts_a: 0, pts_b: 0, iniciada_em: inicio, atualizada_em: new Date().toISOString() });
        render();
        refreshLive();
      })
      .catch(function (err) {
        if (err.code === 'sem_sessao') { st.busy = false; logout(); return; }
        var msg = err.code === 'partida_em_andamento' ? 'Alguém acabou de iniciar uma partida. Acompanhe ao vivo.'
          : err.code === 'jogador_invalido' ? 'Um dos jogadores saiu da lista. Escolha de novo.'
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

  /* ---------- telas ---------- */
  function liveBadge() {
    if (!st.live) return '';
    var g = game({ hist: st.playing ? st.hist : (st.live.pontos || []), g1: st.playing ? st.g1 : st.live.jogos_a,
                   g2: st.playing ? st.g2 : st.live.jogos_b, first: st.live.primeiro, m1: st.live.jogador_a, m2: st.live.jogador_b });
    return '<button class="live" type="button" data-act="tab" data-v="partida" aria-label="Ver partida ao vivo">' +
      '<span class="dot" aria-hidden="true"></span><span class="lv">AO VIVO</span>' +
      '<span class="vt lv-score">' + esc(g.name1) + ' ' + pad(g.s1) + ' x ' + pad(g.s2) + ' ' + esc(g.name2) + '</span></button>';
  }

  function tabs() {
    function t(id, label) {
      return '<button class="tab' + (st.tab === id ? ' on' : '') + '" type="button" data-act="tab" data-v="' + id + '">' + label + '</button>';
    }
    var bar = '<nav class="tabs" aria-label="Seções do placar">' + t('partida', 'PARTIDA') + t('ranking', 'RANKING') + t('historico', 'HISTÓRICO') + t('perfil', 'PERFIL') + '</nav>';
    if (st.tab !== 'partida') bar += liveBadge();
    if (st.netErr) bar += '<div class="net" role="status">SEM CONEXÃO COM O PLACAR ONLINE · TENTANDO DE NOVO</div>';
    return bar;
  }

  function viewSetup() {
    var p = st.picked;
    var slot1 = p[0] ? nameOf(p[0]) : '---';
    var slot2 = p[1] ? nameOf(p[1]) : '---';
    var h = '<section>';
    h += '<div class="slots">' +
      '<div class="box slot"><div class="lbl">1P</div><div class="glow nm">' + esc(slot1) + '</div></div>' +
      '<div class="vs">VS</div>' +
      '<div class="box slot"><div class="lbl">2P</div><div class="glow nm">' + esc(slot2) + '</div></div>' +
      '</div>';
    if (!st.loaded) {
      h += '<div class="note dim blink">Carregando jogadores...</div>';
    } else if (st.players.length) {
      h += '<div class="note">Toque em 2 jogadores. O primeiro vira o 1P.</div>';
      h += '<div class="scroll roster">';
      st.players.forEach(function (pl) {
        var at = p.indexOf(pl.id);
        var badge = at === 0 ? '1P' : (at === 1 ? '2P' : '');
        h += '<button class="opt chip' + (at >= 0 ? ' on' : '') + '" type="button" data-act="pick" data-v="' + pl.id + '">' +
          '<span class="nm">' + esc(pl.name) + '</span><span class="badge">' + badge + '</span></button>';
      });
      h += '</div>';
    } else {
      h += '<div class="box empty-box"><div class="msg">NENHUM JOGADOR AINDA</div>' +
        '<div class="note">Cada jogador entra no site e cria o próprio perfil. Quem tem perfil aparece aqui.</div></div>';
    }
    if (p.length === 2) {
      h += '<div class="stack"><div class="lbl">QUEM SACA NO 1º PONTO</div><div class="row">' +
        '<button class="opt' + (st.firstPick === 1 ? ' on' : '') + '" type="button" data-act="fp" data-v="1">' + esc(slot1) + '</button>' +
        '<button class="opt' + (st.firstPick === 2 ? ' on' : '') + '" type="button" data-act="fp" data-v="2">' + esc(slot2) + '</button>' +
        '</div></div>';
    }
    h += '<div class="grow"></div>';
    if (st.startErr) h += '<div class="err" role="alert">' + esc(st.startErr) + '</div>';
    h += '<div class="legend">Ao iniciar, a partida fica ao vivo para todo mundo e só este aparelho marca os pontos.</div>';
    h += '<button class="btn go start" type="button" data-act="start"' + (p.length !== 2 || st.busy ? ' disabled' : '') + '>' + (st.busy ? 'INICIANDO...' : 'INICIAR') + '</button>';
    return h + '</section>';
  }

  function serveTag() {
    return '<div class="blink serve"><svg viewBox="0 0 6 6" shape-rendering="crispEdges" aria-hidden="true"><path fill="#f4f7ff" d="M1 0h4v1h-4zM0 1h6v4h-6zM1 5h4v1h-4z"/></svg>SAQUE</div>';
  }

  function playerCard(n, name, score, gp, serving, lock, control) {
    var pips = [0, 1].map(function (i) { return '<div class="pip' + (i < gp ? ' on' : '') + '"></div>'; }).join('');
    var inner =
      '<div class="tag">' + n + 'P' + (control ? ' · 1 TOQUE +1 · 2 TOQUES −1' : '') + '</div>' +
      '<div class="nm">' + esc(name) + '</div>' +
      '<div class="score-row"><div class="rgb glow digits">' + pad(score) + '</div></div>' +
      '<div class="meta">' +
        '<div class="games"><span class="vt">JOGOS</span>' + pips + '</div>' +
        '<div class="serve-slot">' + (serving ? serveTag() : '') + '</div>' +
      '</div>';
    var fx = st.tapFx && st.tapFx.v === n && Date.now() < st.tapFx.until
      ? '<span class="tap-fx' + (st.tapFx.minus ? ' minus' : '') + '" aria-hidden="true">' + st.tapFx.text + '</span>' : '';
    if (!control) return '<div class="box player">' + inner + '</div>';
    return '<button class="box player tap" type="button" data-act="add" data-v="' + n + '"' + (lock ? ' disabled' : '') +
      ' aria-label="' + esc(name) + ', ' + score + ' pontos. Um toque marca ponto, dois toques tiram um ponto.">' + inner + fx + '</button>';
  }

  function viewBoard() {
    var control = st.playing;
    var g = game();
    var hi = Math.max(g.s1, g.s2), lo = Math.min(g.s1, g.s2);
    var title = 'EM JOGO', sub = 'Saque: ' + (g.server === 1 ? g.name1 : g.name2);
    if (g.w && g.champ) { title = 'FIM DA DISPUTA'; sub = g.wName + ' venceu por ' + g.gp1 + ' a ' + g.gp2; }
    else if (g.w) { title = 'FIM DE JOGO'; sub = g.wName + ' venceu ' + hi + ' a ' + lo; }
    else if (g.s1 >= 10 && g.s2 >= 10 && g.s1 === g.s2) { title = 'IGUALDADE'; sub = 'Quem abrir 2 pontos vence'; }
    else if (g.s1 >= 10 && g.s1 > g.s2) { title = 'PONTO DE JOGO'; sub = 'Vantagem: ' + g.name1; }
    else if (g.s2 >= 10 && g.s2 > g.s1) { title = 'PONTO DE JOGO'; sub = 'Vantagem: ' + g.name2; }

    var stale = !control && st.live && (Date.now() - tsMicros(st.live.atualizada_em) / 1000 > STALE_MS);
    var h = '<section>';
    h += '<div class="live-head"><span class="dot" aria-hidden="true"></span><span class="lv">AO VIVO</span>' +
      '<span class="vt who-marks">' + (control ? '1 toque no placar = ponto · 2 toques rápidos = tira ponto' : 'Só quem iniciou a partida marca os pontos') + '</span></div>';
    h += '<div class="board">';
    h += playerCard(1, g.name1, g.s1, g.gp1, !g.w && g.server === 1, !!g.w, control);
    h += '<div class="vs" aria-hidden="true">VS</div>';
    h += playerCard(2, g.name2, g.s2, g.gp2, !g.w && g.server === 2, !!g.w, control);
    if (g.w) {
      h += '<div class="banner">' +
        '<div class="kicker">' + (g.champ ? 'CAMPEÃO DA DISPUTA' : 'VENCEDOR DO JOGO') + '</div>' +
        '<div class="rgb glow who">' + esc(g.wName) + '</div>' +
        '<div class="score">' + (g.champ ? ('JOGOS ' + g.gp1 + ' x ' + g.gp2) : (pad(g.s1) + ' x ' + pad(g.s2))) + '</div>';
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
     Aparece uma vez para cada perfil que entra neste aparelho (novo ou antigo).
     Dá para abrir de novo no Perfil, em COMO FUNCIONA. */
  function tutorialSeen(id) {
    try { return (JSON.parse(localStorage.getItem(TUTORIAL_KEY) || '[]')).indexOf(id) >= 0; } catch (e) { return false; }
  }
  function markTutorialSeen(id) {
    try {
      var l = JSON.parse(localStorage.getItem(TUTORIAL_KEY) || '[]');
      if (l.indexOf(id) < 0) l.push(id);
      localStorage.setItem(TUTORIAL_KEY, JSON.stringify(l));
    } catch (e) {}
  }
  function maybeTutorial() {
    if (st.me && st.onb === null && !tutorialSeen(st.me.id)) st.onb = 0;
  }
  function closeTutorial() {
    if (st.me) markTutorialSeen(st.me.id);
    set({ onb: null });
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
    var me = st.me ? esc(st.me.nome) : 'VOCÊ';
    return [
      { title: 'BEM-VINDO À DISPUTA!',
        art: '<div class="ob-hero">' + ART.paddle + '<span class="ob-ball bounce"></span>' + '<svg class="ob-paddle flip" viewBox="0 0 14 20" shape-rendering="crispEdges" aria-hidden="true"><use href="#paddle"></use></svg></div>',
        text: 'Este é o placar de ping-pong da Elsys. Em poucos passos você aprende a marcar pontos, acompanhar jogos ao vivo e subir no ranking.' },
      { title: 'AS 4 ABAS',
        art: '<div class="ob-tabs-art">' +
          '<div class="ob-tabrow"><span class="on">PARTIDA</span><span>RANKING</span><span>HISTÓRICO</span><span>PERFIL</span></div>' +
          '<ul class="ob-list">' +
            '<li><b>PARTIDA</b> iniciar e acompanhar jogos</li>' +
            '<li><b>RANKING</b> quem tem mais vitórias</li>' +
            '<li><b>HISTÓRICO</b> quem ganha de quem</li>' +
            '<li><b>PERFIL</b> seus números e seu apelido</li></ul></div>',
        text: 'Tudo fica nessas quatro abas, no topo da tela. Toque em uma para trocar.' },
      { title: 'INICIAR UMA PARTIDA',
        art: '<div class="ob-setup">' +
          '<div class="ob-chips"><span class="ob-chip on">RAIO <i>1P</i></span><span class="ob-chip on">TROVÃO <i>2P</i></span>' +
          '<span class="ob-chip">FAÍSCA</span><span class="ob-chip">COMETA</span></div>' +
          '<div class="ob-start">INICIAR' + obTap(1) + '</div></div>',
        text: 'Na aba Partida, toque nos 2 jogadores, escolha quem saca primeiro e toque em INICIAR. O seu aparelho vira o marcador dessa partida.' },
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
        text: 'A partida é melhor de 3 jogos de 11 pontos. Quando acabar, toque em SALVAR NO RANKING. Cada vitória vale 1 ponto e todo mundo vê na hora.' },
      { title: 'HISTÓRICO E PERFIL',
        art: '<div class="ob-hp">' +
          '<div class="ob-pair"><span class="lead">RAIO</span><span class="sc">3 x 1</span><span>TROVÃO</span></div>' +
          '<div class="ob-tiles"><div><b>12</b><span>PARTIDAS</span></div><div><b class="win">8</b><span>VITÓRIAS</span></div><div><b>4</b><span>DERROTAS</span></div></div>' +
          '<div class="ob-me">' + me + '</div></div>',
        text: 'No Histórico você vê quem ganha de quem. No Perfil ficam seus números, seus confrontos e a opção de mudar o apelido. Para rever este tutorial, toque em COMO FUNCIONA no Perfil.' }
    ];
  }

  function viewTutorial() {
    var steps = tutorialSteps();
    var i = Math.max(0, Math.min(st.onb, steps.length - 1)), stp = steps[i], last = i === steps.length - 1;
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

  /* ---------- boas-vindas: criar perfil ou entrar ---------- */
  function viewWelcome() {
    var criar = st.authMode === 'criar';
    var h = '<section class="welcome">';
    h += '<div class="welcome-hero">' +
      '<div class="kicker">BEM-VINDO À DISPUTA</div>' +
      '<h2 class="rgb glow welcome-title">VAMOS JOGAR?</h2>' +
      '<p class="note">' + (criar ? 'Crie seu perfil com o apelido que você usa na mesa e um PIN de 4 números.'
                                  : 'Entre com seu apelido e seu PIN de 4 números.') + '</p></div>';
    h += '<div class="welcome-side"><form id="authForm" class="box auth-form" novalidate>' +
      '<label class="lbl" for="authNome">APELIDO</label>' +
      '<input id="authNome" class="field" type="text" maxlength="10" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="EX: RAIO" value="' + esc(st.authNome) + '">' +
      '<label class="lbl" for="authPin">PIN · 4 NÚMEROS</label>' +
      '<input id="authPin" class="field pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="' + (criar ? 'new-password' : 'current-password') + '" placeholder="••••" value="' + esc(st.authPin) + '">' +
      '<div id="authErr" class="err" role="alert">' + esc(st.authErr) + '</div>' +
      '<button class="btn go start" type="submit"' + (st.authBusy ? ' disabled' : '') + '>' +
        (st.authBusy ? 'AGUARDE...' : (criar ? 'CRIAR PERFIL' : 'ENTRAR')) + '</button>' +
      '</form>';
    h += '<button class="link" type="button" data-act="authMode" data-v="' + (criar ? 'entrar' : 'criar') + '">' +
      (criar ? 'Já tenho perfil · <b>ENTRAR</b>' : 'Ainda não tenho perfil · <b>CRIAR PERFIL</b>') + '</button>';
    if (criar) h += '<div class="legend">Seu apelido aparece no ranking e no histórico. O PIN serve só para entrar no seu perfil; não use a senha de outro lugar.</div>';
    return h + '</div></section>';
  }

  /* ---------- perfil de quem está logado ---------- */
  function viewPerfil() {
    var me = st.me;
    var rows = rankRows();
    var pos = 0, mine = { rank: 0, j: 0, d: 0 };
    rows.forEach(function (r, i) { if (r.id === me.id) { pos = i + 1; mine = r; } });
    var h = '<section>';
    h += '<div class="box profile-head">';
    if (st.renaming) {
      h += '<form id="renameForm" class="add-form">' +
        '<label class="lbl" for="renameNome">NOVO APELIDO</label>' +
        '<div class="row"><input id="renameNome" class="field" type="text" maxlength="10" autocomplete="off" spellcheck="false" value="' + esc(st.renameDraft) + '">' +
        '<button class="btn go" type="submit"' + (st.busy ? ' disabled' : '') + '>SALVAR</button></div>' +
        '<div class="err" role="alert">' + esc(st.renameErr) + '</div>' +
        '<div class="row"><button class="btn ghost" type="button" data-act="renameCancel">CANCELAR</button></div></form>';
    } else {
      h += '<div class="lbl">SEU APELIDO</div>' +
        '<div class="profile-name rgb glow">' + esc(me.nome) + '</div>' +
        '<button class="btn ghost" type="button" data-act="renameOpen">MUDAR APELIDO</button>';
    }
    h += '</div>';
    h += '<div class="tiles">' +
      '<div class="box tile"><div class="num">' + mine.j + '</div><div class="lbl">PARTIDAS</div></div>' +
      '<div class="box tile"><div class="num win">' + mine.rank + '</div><div class="lbl">VITÓRIAS</div></div>' +
      '<div class="box tile"><div class="num">' + mine.d + '</div><div class="lbl">DERROTAS</div></div>' +
      '<div class="box tile"><div class="num">' + (mine.j ? pos + 'º' : '—') + '</div><div class="lbl">NO RANKING</div></div>' +
      '</div>';

    var myPairs = pairs().filter(function (p) { return p.a === me.id || p.b === me.id; });
    h += '<div class="two-col"><div class="stack"><div class="lbl">CONFRONTOS · VOCÊ CONTRA CADA UM</div>';
    myPairs.forEach(function (p) {
      var meFirst = p.a === me.id;
      var opp = meFirst ? p.b : p.a, myW = meFirst ? p.winsA : p.winsB, opW = meFirst ? p.winsB : p.winsA;
      h += '<div class="box pair">' + vsRow(me.nome, myW, nameOf(opp), opW) +
        '<div class="pair-meta">' + p.count + ' partida' + (p.count > 1 ? 's' : '') + ' entre vocês</div></div>';
    });
    if (!myPairs.length) h += '<div class="note dim">Você ainda não jogou nenhuma partida. Quando jogar, seus confrontos aparecem aqui.</div>';
    h += '</div>';

    var myMatches = st.matches.filter(function (m) { return m.jogador_a === me.id || m.jogador_b === me.id; }).slice(0, 10);
    h += '<div class="stack"><div class="lbl">SUAS ÚLTIMAS PARTIDAS</div>';
    myMatches.forEach(function (m) {
      var meA = m.jogador_a === me.id;
      var myG = meA ? m.jogos_a : m.jogos_b, opG = meA ? m.jogos_b : m.jogos_a, opp = meA ? m.jogador_b : m.jogador_a;
      var won = myG > opG;
      h += '<div class="match-line"><span class="res ' + (won ? 'w' : 'l') + '">' + (won ? 'VENCEU' : 'PERDEU') + '</span>' +
        '<span class="vt">' + myG + ' x ' + opG + ' contra ' + esc(nameOf(opp)) + '</span>' +
        '<span class="vt when">' + fmtWhen(m.criado_em) + '</span></div>';
    });
    if (!myMatches.length) h += '<div class="note dim">Nenhuma partida ainda.</div>';
    h += '</div></div>';
    h += '<div class="grow"></div><div class="row center">' +
      '<button class="btn ghost" type="button" data-act="onbOpen">COMO FUNCIONA</button>' +
      '<button class="btn ghost" type="button" data-act="logout">SAIR DESTE APARELHO</button></div>';
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

  function viewRanking() {
    var flash = st.winFlash && Date.now() < st.winFlash.until ? st.winFlash : null;
    var rows = rankRows(); // pontos no ranking: 1 por vitória

    var h = '<section>';
    if (flash) {
      h += '<div class="win-news" role="status"><span class="plus blink">+1</span>' +
        '<span>' + esc(nameOf(flash.winner)) + ' venceu ' + esc(nameOf(flash.loser)) + ' por ' + flash.score + '</span></div>';
    }
    h += '<div class="rank-layout"><div class="stack">';
    h += '<div class="box rank-box">' +
      '<div class="rk head"><span>#</span><span>JOGADOR</span><span class="r">PTS</span><span class="r">J</span><span class="r">D</span><span class="r">SJ</span></div>';
    rows.forEach(function (r, i) {
      var top = i === 0 && r.rank > 0;
      var won = flash && flash.winner === r.id;
      var isMe = st.me && st.me.id === r.id;
      h += '<div class="rk line' + (top ? ' top' : '') + (won ? ' won' : '') + (isMe ? ' me' : '') + '"><span>' + (i + 1) + 'º</span><span class="n">' + esc(r.name) + '</span>' +
        '<span class="r pts">' + (won ? '<span class="plus blink">+1</span>' : '') + r.rank + '</span>' +
        '<span class="r">' + r.j + '</span><span class="r">' + r.d + '</span>' +
        '<span class="r">' + (r.sj > 0 ? '+' + r.sj : r.sj) + '</span></div>';
    });
    if (!st.loaded) h += '<div class="note dim blink" style="padding: var(--gap)">Carregando ranking...</div>';
    else if (!rows.length) h += '<div class="note dim" style="padding: var(--gap)">Cadastre jogadores para montar o ranking.</div>';
    h += '</div>';
    h += '<div class="legend">PTS 1 ponto por vitória · J partidas · D derrotas · SJ saldo de jogos (desempate)</div></div>';
    h += '<div class="stack"><div class="lbl">ÚLTIMAS PARTIDAS</div>';
    st.matches.slice(0, 5).forEach(function (m) {
      var aWon = m.jogos_a > m.jogos_b;
      var line = aWon
        ? nameOf(m.jogador_a) + '  ' + m.jogos_a + ' x ' + m.jogos_b + '  ' + nameOf(m.jogador_b)
        : nameOf(m.jogador_b) + '  ' + m.jogos_b + ' x ' + m.jogos_a + '  ' + nameOf(m.jogador_a);
      h += '<div class="note">' + esc(line) + '</div>';
    });
    if (st.loaded && !st.matches.length) h += '<div class="note dim">Nenhuma partida registrada.</div>';
    h += '</div></div><div class="grow"></div>';
    return h + '</section>';
  }

  var view = document.getElementById('view');
  var tabbar = document.getElementById('tabbar');
  var overlay = document.getElementById('overlay');
  var content = document.querySelector('.content');

  function render() {
    var body, bar = '';
    if (!st.authChecked) body = '<section><div class="note dim blink">Carregando...</div></section>';
    else if (!st.me) body = viewWelcome();
    else {
      bar = tabs();
      if (st.tab === 'ranking') body = viewRanking();
      else if (st.tab === 'historico') body = viewHistorico();
      else if (st.tab === 'perfil') body = viewPerfil();
      else body = (st.playing || st.live) ? viewBoard() : viewSetup();
    }
    // a tela se atualiza sozinha; quem está digitando não perde o texto nem o cursor
    var act = document.activeElement;
    var typingId = act && act.tagName === 'INPUT' && act.id ? act.id : null;
    var caret = null;
    try { caret = typingId ? act.selectionStart : null; } catch (e) {}
    var scroll = view.scrollTop;
    tabbar.innerHTML = bar;
    view.innerHTML = body;
    view.scrollTop = scroll;
    var tut = st.me && st.onb !== null;
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
        set({ tab: v, quitArm: false, renaming: false });
        break;
      case 'onbNext': set({ onb: st.onb + 1 }); focusNext(); break;
      case 'onbPrev': set({ onb: Math.max(0, st.onb - 1) }); focusNext(); break;
      case 'onbGo': set({ onb: Number(v) }); break;
      case 'onbSkip': case 'onbDone': closeTutorial(); break;
      case 'onbOpen': set({ onb: 0 }); break;
      case 'authMode':
        set({ authMode: v, authErr: '', authPin: '' });
        break;
      case 'logout':
        logout();
        break;
      case 'renameOpen':
        set({ renaming: true, renameDraft: st.me ? st.me.nome : '', renameErr: '' });
        var ri = document.getElementById('renameNome'); if (ri) { ri.focus(); ri.select(); }
        break;
      case 'renameCancel':
        set({ renaming: false, renameErr: '' });
        break;
      case 'pick': {
        if (st.live) return;
        var id = Number(v), cur = st.picked.slice(), i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1);
        else if (cur.length < 2) cur.push(id);
        else cur[1] = id;
        set({ picked: cur, startErr: '' });
        break;
      }
      case 'fp':
        set({ firstPick: Number(v) });
        break;
      case 'start':
        startMatch();
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
    else if (el.id === 'renameNome') { st.renameDraft = el.value.toUpperCase().slice(0, 10); }
  });
  function clearMsg(id, key) {
    if (!st[key]) return;
    st[key] = '';
    var m = document.getElementById(id); if (m) m.textContent = '';
  }
  view.addEventListener('change', function (e) {
    if (e.target.id === 'histFiltro') set({ histFiltro: e.target.value });
  });

  view.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'authForm') doAuth();
    else if (e.target.id === 'renameForm') doRename();
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

  render();
  checkSession();
  refresh();
  refreshLive();
  startRealtime();
})();
