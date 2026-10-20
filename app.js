/* Placar Disputa Elsys — lógica do placar, cadastro e ranking.
   Jogadores e partidas ficam num banco Supabase compartilhado: quem abre o site vê os mesmos
   jogadores e o mesmo ranking. A partida em andamento (os pontos) fica só no aparelho que está marcando. */
(function () {
  'use strict';

  /* Endereço do banco e chave pública (publishable). A chave só permite o que as regras do banco liberam:
     ver jogadores e partidas, cadastrar jogador, registrar partida e tirar jogador da lista. */
  var DB_URL = 'https://idpwiefikugfqumjpfpa.supabase.co';
  var DB_KEY = 'sb_publishable_Cx_TgsTk8eKstxL6_PGg6Q_8eAmeBve';
  var REFRESH_MS = 8000;

  var st = {
    tab: 'partida',
    players: [],       // jogadores ativos [{id, name}]
    names: {},         // id -> nome, inclusive de quem saiu da lista (para o histórico)
    matches: [],       // partidas encerradas, mais recentes primeiro
    loaded: false, netErr: false, busy: false,
    draft: '', msg: '', delArm: null,
    picked: [], firstPick: 1,
    playing: false, m1: null, m2: null, hist: [], g1: 0, g2: 0, first: 1, pts1: 0, pts2: 0, quitArm: false,
    saveErr: ''
  };

  function set(patch) {
    for (var k in patch) st[k] = patch[k];
    render();
  }

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
        throw err;
      });
    });
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
      var names = {}, players = [];
      res[0].forEach(function (j) {
        names[j.id] = j.nome;
        if (j.ativo) players.push({ id: j.id, name: j.nome });
      });
      var active = {};
      players.forEach(function (p) { active[p.id] = true; });
      st.names = names; st.players = players; st.matches = res[1];
      st.picked = st.picked.filter(function (id) { return active[id]; });
      if (st.delArm && !active[st.delArm]) st.delArm = null;
      render();
    }).catch(function () {
      if (!st.netErr || !st.loaded) { st.netErr = true; st.loaded = true; render(); }
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
  function nameOf(id) {
    return st.names[id] || '---';
  }

  /* ---------- estado derivado da partida ---------- */
  function game() {
    var hist = st.hist;
    var s1 = hist.filter(function (x) { return x === 1; }).length;
    var s2 = hist.length - s1;
    var wins = function (a, b) { return a >= 11 && a - b >= 2; };
    var w = wins(s1, s2) ? 1 : (wins(s2, s1) ? 2 : 0);
    var gp1 = st.g1 + (w === 1 ? 1 : 0);
    var gp2 = st.g2 + (w === 2 ? 1 : 0);
    var champ = gp1 >= 2 ? 1 : (gp2 >= 2 ? 2 : 0);
    var server = hist.length ? hist[hist.length - 1] : st.first;
    var name1 = nameOf(st.m1), name2 = nameOf(st.m2);
    return { s1: s1, s2: s2, w: w, gp1: gp1, gp2: gp2, champ: champ, server: server, name1: name1, name2: name2,
             wName: w === 1 ? name1 : name2 };
  }

  function dropLast(p) {
    var i = st.hist.lastIndexOf(p);
    if (i < 0) return st.hist;
    return st.hist.slice(0, i).concat(st.hist.slice(i + 1));
  }

  function finishMatch(g) {
    if (st.busy) return;
    set({ busy: true, saveErr: '' });
    api('partidas', {
      method: 'POST', prefer: 'return=minimal',
      body: { jogador_a: st.m1, jogador_b: st.m2, jogos_a: g.gp1, jogos_b: g.gp2,
              pontos_a: st.pts1 + g.s1, pontos_b: st.pts2 + g.s2 }
    }).then(function () {
      st.busy = false;
      set({ playing: false, hist: [], g1: 0, g2: 0, pts1: 0, pts2: 0, picked: [], firstPick: 1,
            tab: 'ranking', quitArm: false });
      refresh();
    }).catch(function () {
      set({ busy: false, saveErr: 'Não deu para salvar. Confira a internet e toque de novo.' });
    });
  }

  /* ---------- telas ---------- */
  function tabs() {
    function t(id, label) {
      return '<button class="tab' + (st.tab === id ? ' on' : '') + '" type="button" data-act="tab" data-v="' + id + '">' + label + '</button>';
    }
    var bar = '<nav class="tabs" aria-label="Seções do placar">' + t('partida', 'PARTIDA') + t('jogadores', 'JOGADORES') + t('ranking', 'RANKING') + '</nav>';
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
    h += '<button class="btn go start" type="button" data-act="start"' + (p.length !== 2 ? ' disabled' : '') + '>INICIAR</button>';
    return h + '</section>';
  }

  function serveTag() {
    return '<div class="blink serve"><svg viewBox="0 0 6 6" shape-rendering="crispEdges" aria-hidden="true"><path fill="#f4f7ff" d="M1 0h4v1h-4zM0 1h6v4h-6zM1 5h4v1h-4z"/></svg>SAQUE</div>';
  }

  function playerCard(n, name, score, gp, serving, lock) {
    var pips = [0, 1].map(function (i) { return '<div class="pip' + (i < gp ? ' on' : '') + '"></div>'; }).join('');
    return '<div class="box player">' +
      '<div class="tag">' + n + 'P</div>' +
      '<div class="nm">' + esc(name) + '</div>' +
      '<div class="score-row">' +
        '<div class="rgb glow digits">' + pad(score) + '</div>' +
        '<button class="btn big minus" type="button" aria-label="Tirar ponto do ' + n + 'P" data-act="sub" data-v="' + n + '">-</button>' +
        '<button class="btn big plus" type="button" aria-label="Ponto para o ' + n + 'P" data-act="add" data-v="' + n + '"' + (lock ? ' disabled' : '') + '>+</button>' +
      '</div>' +
      '<div class="meta">' +
        '<div class="games"><span class="vt">JOGOS</span>' + pips + '</div>' +
        '<div class="serve-slot">' + (serving ? serveTag() : '') + '</div>' +
      '</div>' +
      '</div>';
  }

  function viewBoard() {
    var g = game();
    var hi = Math.max(g.s1, g.s2), lo = Math.min(g.s1, g.s2);
    var title = 'EM JOGO', sub = 'Saque: ' + (g.server === 1 ? g.name1 : g.name2);
    if (g.w && g.champ) { title = 'FIM DA DISPUTA'; sub = g.wName + ' venceu por ' + g.gp1 + ' a ' + g.gp2; }
    else if (g.w) { title = 'FIM DE JOGO'; sub = g.wName + ' venceu ' + hi + ' a ' + lo; }
    else if (g.s1 >= 10 && g.s2 >= 10 && g.s1 === g.s2) { title = 'IGUALDADE'; sub = 'Quem abrir 2 pontos vence'; }
    else if (g.s1 >= 10 && g.s1 > g.s2) { title = 'PONTO DE JOGO'; sub = 'Vantagem: ' + g.name1; }
    else if (g.s2 >= 10 && g.s2 > g.s1) { title = 'PONTO DE JOGO'; sub = 'Vantagem: ' + g.name2; }

    var h = '<section><div class="board">';
    h += playerCard(1, g.name1, g.s1, g.gp1, !g.w && g.server === 1, !!g.w);
    h += '<div class="vs" aria-hidden="true">VS</div>';
    h += playerCard(2, g.name2, g.s2, g.gp2, !g.w && g.server === 2, !!g.w);
    if (g.w) {
      h += '<div class="banner">' +
        '<div class="kicker">' + (g.champ ? 'CAMPEÃO DA DISPUTA' : 'VENCEDOR DO JOGO') + '</div>' +
        '<div class="rgb glow who">' + esc(g.wName) + '</div>' +
        '<div class="score">' + (g.champ ? ('JOGOS ' + g.gp1 + ' x ' + g.gp2) : (pad(g.s1) + ' x ' + pad(g.s2))) + '</div>' +
        '<div class="row center">' +
          '<button class="btn ghost" type="button" data-act="undo">DESFAZER</button>' +
          '<button class="btn go" type="button" data-act="banner"' + (st.busy ? ' disabled' : '') + '>' + (g.champ ? (st.busy ? 'SALVANDO...' : 'SALVAR NO RANKING') : 'PRÓXIMO JOGO') + '</button>' +
        '</div>' + (st.saveErr ? '<div class="err">' + esc(st.saveErr) + '</div>' : '') + '</div>';
    }
    h += '</div>';
    h += '<div class="bottom-bar">' +
      '<div class="status"><div class="k">STATUS</div><div class="t">' + esc(title) + '</div><div class="s">' + esc(sub) + '</div></div>' +
      '<div class="row center actions">' +
        '<button class="btn ghost" type="button" data-act="resetPoints">ZERAR PONTOS</button>' +
        '<button class="btn ghost' + (st.quitArm ? ' warn' : '') + '" type="button" data-act="quit">' + (st.quitArm ? 'CONFIRMAR?' : 'ENCERRAR') + '</button>' +
      '</div></div>';
    return h + '</section>';
  }

  function viewJogadores() {
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
      var locked = st.playing && (p.id === st.m1 || p.id === st.m2);
      h += '<div class="box person"><span class="nm">' + esc(p.name) + '</span>' +
        '<button class="btn ghost x' + (armed ? ' warn' : '') + '" type="button" aria-label="Remover ' + esc(p.name) + '" data-act="del" data-v="' + p.id + '"' + (locked ? ' disabled' : '') + '>' + (armed ? 'REMOVER?' : 'X') + '</button>' +
        '</div>';
    });
    h += '</div>';
    if (!st.loaded) h += '<div class="note dim blink">Carregando jogadores...</div>';
    else if (!st.players.length) h += '<div class="note dim">Ninguém cadastrado ainda. Digite um apelido acima.</div>';
    h += '<div class="legend">Todo mundo que abre o placar vê esta lista. Remover tira o jogador da lista e do ranking para todos; as partidas dele continuam no histórico.</div>';
    return h + '</section>';
  }

  function viewRanking() {
    var all = stats();
    var rows = st.players.map(function (p) {
      var s = Object.assign({ v: 0, d: 0, gp: 0, gc: 0, pts: 0 }, all[p.id]);
      return { name: p.name, v: s.v, d: s.d, sj: s.gp - s.gc, pts: s.pts };
    });
    rows.sort(function (x, y) { return (y.v - x.v) || (y.sj - x.sj) || (y.pts - x.pts) || x.name.localeCompare(y.name); });

    var h = '<section><div class="rank-layout"><div class="stack">';
    h += '<div class="box rank-box">' +
      '<div class="rk head"><span>#</span><span>JOGADOR</span><span class="r">V</span><span class="r">D</span><span class="r">SJ</span><span class="r">PTS</span></div>';
    rows.forEach(function (r, i) {
      var top = i === 0 && (r.v > 0 || r.pts > 0);
      h += '<div class="rk line' + (top ? ' top' : '') + '"><span>' + (i + 1) + 'º</span><span class="n">' + esc(r.name) + '</span>' +
        '<span class="r">' + r.v + '</span><span class="r">' + r.d + '</span>' +
        '<span class="r">' + (r.sj > 0 ? '+' + r.sj : r.sj) + '</span><span class="r">' + r.pts + '</span></div>';
    });
    if (!st.loaded) h += '<div class="note dim blink" style="padding: var(--gap)">Carregando ranking...</div>';
    else if (!rows.length) h += '<div class="note dim" style="padding: var(--gap)">Cadastre jogadores para montar o ranking.</div>';
    h += '</div>';
    h += '<div class="legend">V vitórias · D derrotas · SJ saldo de jogos · PTS pontos feitos</div></div>';
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
    else body = st.playing ? viewBoard() : viewSetup();
    // a lista se atualiza sozinha; quem está digitando um apelido não perde o que digitou
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
    var g = game();

    switch (act) {
      case 'tab':
        set({ tab: v, delArm: null, quitArm: false });
        break;
      case 'pick': {
        var id = Number(v), cur = st.picked.slice(), i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1);
        else if (cur.length < 2) cur.push(id);
        else cur[1] = id;
        set({ picked: cur });
        break;
      }
      case 'fp':
        set({ firstPick: Number(v) });
        break;
      case 'start':
        if (st.picked.length !== 2) return;
        set({ playing: true, m1: st.picked[0], m2: st.picked[1], first: st.firstPick,
              hist: [], g1: 0, g2: 0, pts1: 0, pts2: 0, quitArm: false });
        break;
      case 'add':
        if (!g.w) set({ hist: st.hist.concat([Number(v)]), quitArm: false });
        break;
      case 'sub':
        set({ hist: dropLast(Number(v)) });
        break;
      case 'undo':
        set({ hist: st.hist.slice(0, -1) });
        break;
      case 'banner':
        if (g.champ) finishMatch(g);
        else set({ hist: [], g1: g.gp1, g2: g.gp2, pts1: st.pts1 + g.s1, pts2: st.pts2 + g.s2, first: g.w });
        break;
      case 'resetPoints':
        set({ hist: [] });
        break;
      case 'quit':
        if (!st.quitArm) set({ quitArm: true });
        else set({ playing: false, hist: [], g1: 0, g2: 0, pts1: 0, pts2: 0, quitArm: false });
        break;
      case 'del': {
        var pid = Number(v);
        if (st.delArm !== pid) { set({ delArm: pid }); break; }
        set({ busy: true, delArm: null });
        api('rpc/remover_jogador', { method: 'POST', body: { p_id: pid } })
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

  render();
  refresh();
  setInterval(function () { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
