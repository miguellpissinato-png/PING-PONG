/* Placar Disputa Elsys — lógica do placar, cadastro, ranking e partida ao vivo.
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
  var STALE_MS = 20 * 60 * 1000;                // partida sem ponto há 20 min pode ser liberada
  var HEARTBEAT_MS = 4 * 60 * 1000;             // quem marca avisa o banco que a partida segue viva

  var st = {
    tab: 'partida',
    players: [], names: {}, matches: [],
    seenMatches: null,   // ids de partidas já conhecidas (null até a primeira carga)
    winFlash: null,      // { match, winner, loser, until } — destaque do vencedor recém-salvo
    loaded: false, netErr: false, busy: false,
    draft: '', msg: '', delArm: null,
    picked: [], firstPick: 1, startErr: '',
    live: null,          // partida ao vivo vinda do banco (ou null)
    rt: false,           // tempo real conectado
    // partida que ESTE aparelho está marcando
    playing: false, m1: null, m2: null, hist: [], g1: 0, g2: 0, first: 1, pts1: 0, pts2: 0,
    quitArm: false, saveErr: '', syncErr: ''
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

  function loadOwner() {
    try { var o = JSON.parse(localStorage.getItem(OWNER_KEY) || 'null'); return o && o.chave ? o : null; } catch (e) { return null; }
  }
  function saveOwner(o) {
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
    var mine = !!(live && owner && Date.parse(owner.iniciada_em) === Date.parse(live.iniciada_em));

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
    rpc('iniciar_partida', { p_jogador_a: a, p_jogador_b: b, p_primeiro: first, p_chave: chave })
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
    var bar = '<nav class="tabs" aria-label="Seções do placar">' + t('partida', 'PARTIDA') + t('jogadores', 'JOGADORES') + t('ranking', 'RANKING') + '</nav>';
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
      h += '<div class="box empty-box"><div class="msg">NENHUM JOGADOR CADASTRADO</div>' +
        '<button class="btn go" type="button" data-act="tab" data-v="jogadores">CADASTRAR JOGADORES</button></div>';
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
    var row = control
      ? '<div class="score-row">' +
          '<div class="rgb glow digits">' + pad(score) + '</div>' +
          '<button class="btn big minus" type="button" aria-label="Tirar ponto do ' + n + 'P" data-act="sub" data-v="' + n + '">-</button>' +
          '<button class="btn big plus" type="button" aria-label="Ponto para o ' + n + 'P" data-act="add" data-v="' + n + '"' + (lock ? ' disabled' : '') + '>+</button>' +
        '</div>'
      : '<div class="score-row watch"><div class="rgb glow digits">' + pad(score) + '</div></div>';
    return '<div class="box player">' +
      '<div class="tag">' + n + 'P</div>' +
      '<div class="nm">' + esc(name) + '</div>' + row +
      '<div class="meta">' +
        '<div class="games"><span class="vt">JOGOS</span>' + pips + '</div>' +
        '<div class="serve-slot">' + (serving ? serveTag() : '') + '</div>' +
      '</div>' +
      '</div>';
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

    var stale = !control && st.live && (Date.now() - Date.parse(st.live.atualizada_em) > STALE_MS);
    var h = '<section>';
    h += '<div class="live-head"><span class="dot" aria-hidden="true"></span><span class="lv">AO VIVO</span>' +
      '<span class="vt who-marks">' + (control ? 'Você está marcando os pontos' : 'Só quem iniciou a partida marca os pontos') + '</span></div>';
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
        '<button class="btn ghost" type="button" data-act="resetPoints">ZERAR PONTOS</button>' +
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

  function viewJogadores() {
    var inLive = {};
    if (st.live) { inLive[st.live.jogador_a] = true; inLive[st.live.jogador_b] = true; }
    var h = '<section>';
    h += '<form id="addForm" class="add-form">' +
      '<label class="lbl" for="novoJogador">NOVO JOGADOR</label>' +
      '<div class="row"><input id="novoJogador" class="field" type="text" placeholder="APELIDO" maxlength="10" autocomplete="off" value="' + esc(st.draft) + '">' +
      '<button class="btn go" type="submit"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'SALVANDO' : 'ADICIONAR') + '</button></div>' +
      '<div id="msg" class="err">' + esc(st.msg) + '</div>' +
      '</form>';
    h += '<div class="lbl">CADASTRADOS · ' + st.players.length + '</div>';
    h += '<div class="people">';
    st.players.forEach(function (p) {
      var armed = st.delArm === p.id;
      var locked = !!inLive[p.id];
      h += '<div class="box person"><span class="nm">' + esc(p.name) + '</span>' +
        '<button class="btn ghost x' + (armed ? ' warn' : '') + '" type="button" aria-label="Remover ' + esc(p.name) + '" data-act="del" data-v="' + p.id + '"' + (locked ? ' disabled' : '') + '>' + (armed ? 'REMOVER?' : 'X') + '</button>' +
        '</div>';
    });
    h += '</div>';
    if (!st.loaded) h += '<div class="note dim blink">Carregando jogadores...</div>';
    else if (!st.players.length) h += '<div class="note dim">Ninguém cadastrado ainda. Digite um apelido acima.</div>';
    h += '<div class="legend">Todo mundo que abre o placar vê esta lista. Remover tira o jogador da lista e do ranking para todos; as partidas dele continuam no histórico. Quem está jogando ao vivo não pode ser removido.</div>';
    return h + '</section>';
  }

  function viewRanking() {
    var all = stats();
    var flash = st.winFlash && Date.now() < st.winFlash.until ? st.winFlash : null;
    var rows = st.players.map(function (p) {
      var s = Object.assign({ v: 0, d: 0, gp: 0, gc: 0, pts: 0 }, all[p.id]);
      // pontos no ranking: 1 por vitória
      return { id: p.id, name: p.name, rank: s.v, j: s.v + s.d, d: s.d, sj: s.gp - s.gc, feitos: s.pts };
    });
    rows.sort(function (x, y) { return (y.rank - x.rank) || (y.sj - x.sj) || (y.feitos - x.feitos) || x.name.localeCompare(y.name); });

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
      h += '<div class="rk line' + (top ? ' top' : '') + (won ? ' won' : '') + '"><span>' + (i + 1) + 'º</span><span class="n">' + esc(r.name) + '</span>' +
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

  function render() {
    var body;
    if (st.tab === 'jogadores') body = viewJogadores();
    else if (st.tab === 'ranking') body = viewRanking();
    else body = (st.playing || st.live) ? viewBoard() : viewSetup();
    // a tela se atualiza sozinha; quem está digitando um apelido não perde o que digitou
    var typing = document.activeElement && document.activeElement.id === 'novoJogador';
    var caret = typing ? document.activeElement.selectionStart : null;
    var scroll = view.scrollTop;
    tabbar.innerHTML = tabs();
    view.innerHTML = body;
    view.scrollTop = scroll;
    if (typing) {
      var inp = document.getElementById('novoJogador');
      if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch (e) {} }
    }
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
        set({ tab: v, delArm: null, quitArm: false });
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
        set({ hist: st.hist.concat([Number(v)]), quitArm: false }); push();
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
      case 'del': {
        var pid = Number(v);
        if (st.delArm !== pid) { set({ delArm: pid }); break; }
        set({ busy: true, delArm: null });
        rpc('remover_jogador', { p_id: pid })
          .then(function () { st.busy = false; return refresh(); })
          .catch(function () { set({ busy: false, msg: 'Não deu para remover. Confira a internet e tente de novo.' }); });
        break;
      }
    }
  }
  view.addEventListener('click', onClick);
  tabbar.addEventListener('click', onClick);

  view.addEventListener('input', function (e) {
    if (e.target.id !== 'novoJogador') return;
    st.draft = e.target.value.toUpperCase().slice(0, 10);
    var m = document.getElementById('msg');
    if (m) m.textContent = '';
    st.msg = '';
  });

  view.addEventListener('submit', function (e) {
    if (e.target.id !== 'addForm') return;
    e.preventDefault();
    if (st.busy) return;
    var nm = (st.draft || '').trim().toUpperCase().slice(0, 10);
    if (!nm) { set({ msg: 'Digite um apelido.' }); return; }
    if (st.players.some(function (p) { return p.name === nm; })) { set({ msg: nm + ' já está na lista.' }); return; }
    set({ busy: true, msg: '' });
    api('jogadores', { method: 'POST', prefer: 'return=minimal', body: { nome: nm } })
      .then(function () {
        st.busy = false; st.draft = '';
        return refresh().then(function () {
          render();
          var inp = document.getElementById('novoJogador');
          if (inp) inp.focus();
        });
      })
      .catch(function (err) {
        var dup = err && err.status === 409;
        set({ busy: false, msg: dup ? nm + ' já está na lista.' : 'Não deu para cadastrar. Confira a internet e tente de novo.' });
      });
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
  refresh();
  refreshLive();
  startRealtime();
})();
