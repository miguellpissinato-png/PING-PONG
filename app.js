/* Placar Disputa Elsys — lógica do placar, cadastro e ranking.
   Os dados (jogadores, ranking, histórico) ficam no localStorage do navegador. */
(function () {
  'use strict';

  var KEY = 'disputa-elsys-v1';

  function sampleData() {
    return {
      players: [{ id: 1, name: 'RAIO' }, { id: 2, name: 'TROVÃO' }, { id: 3, name: 'FAÍSCA' }, { id: 4, name: 'COMETA' }],
      stats: {
        1: { v: 3, d: 1, gp: 6, gc: 3, pts: 98 },
        2: { v: 2, d: 1, gp: 5, gc: 3, pts: 84 },
        3: { v: 1, d: 2, gp: 3, gc: 5, pts: 70 },
        4: { v: 0, d: 2, gp: 1, gc: 4, pts: 41 }
      },
      history: [
        { a: 'RAIO', ga: 2, b: 'FAÍSCA', gb: 1 },
        { a: 'TROVÃO', ga: 2, b: 'COMETA', gb: 0 },
        { a: 'RAIO', ga: 2, b: 'TROVÃO', gb: 1 }
      ],
      nextId: 5,
      sample: true
    };
  }

  var saved = null;
  try { var raw = localStorage.getItem(KEY); if (raw) saved = JSON.parse(raw); } catch (e) { saved = null; }
  var base = (saved && Array.isArray(saved.players)) ? saved : sampleData();

  var st = {
    tab: 'partida',
    players: base.players, stats: base.stats || {}, history: base.history || [],
    nextId: base.nextId || 1, sample: !!base.sample,
    draft: '', msg: '', delArm: null, resetArm: false,
    picked: [], firstPick: 1,
    playing: false, m1: null, m2: null, hist: [], g1: 0, g2: 0, first: 1, pts1: 0, pts2: 0, quitArm: false
  };

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        players: st.players, stats: st.stats, history: st.history, nextId: st.nextId, sample: st.sample
      }));
    } catch (e) { /* armazenamento indisponível: segue só em memória */ }
  }

  function set(patch) {
    for (var k in patch) st[k] = patch[k];
    save();
    render();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function nameOf(id) {
    for (var i = 0; i < st.players.length; i++) if (st.players[i].id === id) return st.players[i].name;
    return '---';
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
    var stats = Object.assign({}, st.stats);
    var blank = { v: 0, d: 0, gp: 0, gc: 0, pts: 0 };
    var a = Object.assign({}, blank, stats[st.m1]);
    var b = Object.assign({}, blank, stats[st.m2]);
    a.gp += g.gp1; a.gc += g.gp2; a.pts += st.pts1 + g.s1;
    b.gp += g.gp2; b.gc += g.gp1; b.pts += st.pts2 + g.s2;
    if (g.champ === 1) { a.v += 1; b.d += 1; } else { b.v += 1; a.d += 1; }
    stats[st.m1] = a; stats[st.m2] = b;
    var entry = g.champ === 1
      ? { a: g.name1, ga: g.gp1, b: g.name2, gb: g.gp2 }
      : { a: g.name2, ga: g.gp2, b: g.name1, gb: g.gp1 };
    set({
      stats: stats, history: [entry].concat(st.history).slice(0, 5),
      playing: false, hist: [], g1: 0, g2: 0, pts1: 0, pts2: 0, picked: [], firstPick: 1,
      tab: 'ranking', quitArm: false
    });
  }

  /* ---------- telas ---------- */
  function tabs() {
    function t(id, label) {
      return '<button class="tab' + (st.tab === id ? ' on' : '') + '" type="button" data-act="tab" data-v="' + id + '">' + label + '</button>';
    }
    return '<nav class="tabs" aria-label="Seções do placar">' + t('partida', 'PARTIDA') + t('jogadores', 'JOGADORES') + t('ranking', 'RANKING') + '</nav>';
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
    if (st.players.length) {
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
          '<button class="btn go" type="button" data-act="banner">' + (g.champ ? 'SALVAR NO RANKING' : 'PRÓXIMO JOGO') + '</button>' +
        '</div></div>';
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
      '<button class="btn go" type="submit">ADICIONAR</button></div>' +
      '<div id="msg" class="err">' + esc(st.msg) + '</div>' +
      '</form>';
    if (st.sample) {
      h += '<div class="box sample-box"><div class="note">Jogadores e ranking atuais são exemplos.</div>' +
        '<button class="btn ghost" type="button" data-act="clearSample">APAGAR</button></div>';
    }
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
    if (!st.players.length) h += '<div class="note dim">Ninguém cadastrado ainda. Digite um apelido acima.</div>';
    return h + '</section>';
  }

  function viewRanking() {
    var rows = st.players.map(function (p) {
      var s = Object.assign({ v: 0, d: 0, gp: 0, gc: 0, pts: 0 }, st.stats[p.id]);
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
    if (!rows.length) h += '<div class="note dim" style="padding: var(--gap)">Cadastre jogadores para montar o ranking.</div>';
    h += '</div>';
    h += '<div class="legend">V vitórias · D derrotas · SJ saldo de jogos · PTS pontos feitos</div></div>';
    h += '<div class="stack"><div class="lbl">ÚLTIMAS PARTIDAS</div>';
    st.history.forEach(function (m) {
      h += '<div class="note">' + esc(m.a + '  ' + m.ga + ' x ' + m.gb + '  ' + m.b) + '</div>';
    });
    if (!st.history.length) h += '<div class="note dim">Nenhuma partida registrada.</div>';
    h += '</div></div><div class="grow"></div>';
    h += '<div class="row center"><button class="btn ghost' + (st.resetArm ? ' warn' : '') + '" type="button" data-act="resetRank">' +
      (st.resetArm ? 'CONFIRMAR ZERAR?' : 'ZERAR RANKING') + '</button></div>';
    return h + '</section>';
  }

  var view = document.getElementById('view');
  var tabbar = document.getElementById('tabbar');

  function render() {
    var body;
    if (st.tab === 'jogadores') body = viewJogadores();
    else if (st.tab === 'ranking') body = viewRanking();
    else body = st.playing ? viewBoard() : viewSetup();
    tabbar.innerHTML = tabs();
    view.innerHTML = body;
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
        set({ tab: v, delArm: null, resetArm: false, quitArm: false });
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
        set({
          players: st.players.filter(function (x) { return x.id !== pid; }),
          picked: st.picked.filter(function (x) { return x !== pid; }),
          delArm: null
        });
        break;
      }
      case 'clearSample':
        set({ players: [], stats: {}, history: [], nextId: 1, sample: false, picked: [], delArm: null });
        break;
      case 'resetRank':
        if (!st.resetArm) set({ resetArm: true });
        else set({ stats: {}, history: [], resetArm: false });
        break;
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
    var nm = (st.draft || '').trim();
    if (!nm) { set({ msg: 'Digite um apelido.' }); }
    else if (st.players.some(function (p) { return p.name === nm; })) { set({ msg: nm + ' já está na lista.' }); }
    else { set({ players: st.players.concat([{ id: st.nextId, name: nm }]), nextId: st.nextId + 1, draft: '', msg: '' }); }
    var inp = document.getElementById('novoJogador');
    if (inp) inp.focus();
  });

  render();
})();
