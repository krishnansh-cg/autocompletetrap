/*
 * Game core — arena scaling, backgrounds, scene/camera transitions, HUD,
 * captions, timer, particles and shared visual helpers used by scenes.js.
 */
(function (ATG) {
  'use strict';

  var D = ATG.DATA;
  var $ = function (id) { return document.getElementById(id); };
  var W = 1920, H = 1080;

  var rmQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  ATG.reducedMotion = !!rmQuery.matches;
  function applyMotionPref() {
    ATG.reducedMotion = !!rmQuery.matches;
    document.documentElement.classList.toggle('reduced-motion', ATG.reducedMotion);
  }
  applyMotionPref();
  if (rmQuery.addEventListener) rmQuery.addEventListener('change', applyMotionPref);

  var G = ATG.game = {
    view: { scale: 1, left: 0, top: 0 },
    busyCount: 0,
    scene: null,
    bgKey: null,
    players: {}
  };

  /* ---------- small DOM helpers ---------- */
  G.$ = $;
  G.el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  G.text = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  G.clear = function (e) { while (e.firstChild) e.removeChild(e.firstChild); return e; };
  G.announce = function (msg) {
    var live = $('live');
    live.textContent = '';
    setTimeout(function () { live.textContent = msg; }, 60);
  };
  G.dur = function (ms) { return ATG.reducedMotion ? Math.min(ms, 240) : ms; };
  // Two frames, with a timer fallback so hidden tabs never stall the flow.
  G.nextFrame = function () {
    return new Promise(function (r) {
      var done = false;
      function fin() { if (!done) { done = true; r(); } }
      requestAnimationFrame(function () { requestAnimationFrame(fin); });
      setTimeout(fin, 60);
    });
  };
  G.busy = function () { return G.busyCount > 0; };
  G.withBusy = function (promise) {
    G.busyCount += 1;
    return Promise.resolve(promise).then(function (v) { G.busyCount = Math.max(0, G.busyCount - 1); return v; },
      function (e) { G.busyCount = Math.max(0, G.busyCount - 1); throw e; });
  };

  /* ---------- arena scaling (fixed 16:9, no scroll, no distortion) ---------- */
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var scale = Math.min(vw / W, vh / H);
    var left = (vw - W * scale) / 2, top = (vh - H * scale) / 2;
    G.view = { scale: scale, left: left, top: top };
    $('arena').style.transform = 'translate(' + left + 'px,' + top + 'px) scale(' + scale + ')';
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(document.documentElement);

  /* Element rect in design coordinates. */
  G.rect = function (el) {
    var r = el.getBoundingClientRect();
    var v = G.view;
    return { x: (r.left - v.left) / v.scale, y: (r.top - v.top) / v.scale, w: r.width / v.scale, h: r.height / v.scale,
      cx: (r.left + r.width / 2 - v.left) / v.scale, cy: (r.top + r.height / 2 - v.top) / v.scale };
  };

  /* ---------- image preloading ---------- */
  var imgCache = {};
  G.preloadImage = function (src) {
    if (imgCache[src]) return imgCache[src];
    imgCache[src] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        if (!img.decode) { resolve(); return; }
        img.decode().then(resolve, resolve);
        setTimeout(resolve, 400); // decode can defer in background tabs
      };
      img.onerror = function () { console.warn('[assets] failed to load ' + src); resolve(); };
      img.src = src;
    });
    return imgCache[src];
  };
  G.preloadAll = function () {
    var list = [];
    Object.keys(D.BACKGROUNDS).forEach(function (k) { list.push(D.BACKGROUNDS[k]); });
    Object.keys(D.SPRITES).forEach(function (k) { list.push(D.SPRITES[k].sheet); });
    ['tokens', 'props', 'story', 'fx'].forEach(function (g) { Object.keys(D.IMAGES[g]).forEach(function (k) { list.push(D.IMAGES[g][k]); }); });
    // Sequential-ish: backgrounds first, in mission order.
    return list.reduce(function (p, src, i) { return i < 4 ? p.then(function () { return G.preloadImage(src); }) : p.then(function () { G.preloadImage(src); }); }, Promise.resolve());
  };

  /* ---------- backgrounds ---------- */
  var bgFront = 0;
  G.setBg = function (key, opts) {
    opts = opts || {};
    var src = D.BACKGROUNDS[key];
    var layers = [$('bgA'), $('bgB')];
    $('backdrop').style.backgroundImage = 'url("' + src + '")';
    if (G.bgKey === key && !opts.force) return Promise.resolve();
    G.bgKey = key;
    var next = layers[1 - bgFront], cur = layers[bgFront];
    return G.preloadImage(src).then(function () {
      next.style.backgroundImage = 'url("' + src + '")';
      next.className = 'bg__layer' + (opts.cls ? ' ' + opts.cls : '');
      if (opts.instant) {
        next.classList.add('is-front', 'is-instant');
        cur.classList.remove('is-front');
        bgFront = 1 - bgFront;
        return G.nextFrame().then(function () { next.classList.remove('is-instant'); });
      }
      next.classList.add('is-front');
      cur.classList.remove('is-front');
      bgFront = 1 - bgFront;
      return new Promise(function (r) { setTimeout(r, G.dur(opts.ms || 700)); });
    });
  };
  G.bgLayer = function () { return [$('bgA'), $('bgB')][bgFront]; };

  /* ---------- scenes & camera ---------- */
  G.sceneEl = function (name) { return document.querySelector('.scene[data-scene="' + name + '"]'); };

  function activate(name) {
    document.querySelectorAll('.scene').forEach(function (s) {
      var on = s.dataset.scene === name;
      s.classList.toggle('is-active', on);
      if (on) s.removeAttribute('inert'); else s.setAttribute('inert', '');
    });
    G.scene = name;
    $('arena').dataset.scene = name;
  }

  /**
   * Switch scene + background with a story-appropriate camera move.
   * style: fade | expand | dive | surface | hue | instant
   */
  G.showScene = function (name, bg, style) {
    style = style || 'fade';
    var world = $('world');
    var flash = $('flash');
    if (G.scene === name && G.bgKey === bg) return Promise.resolve();
    if (style === 'instant' || !G.scene) {
      return G.setBg(bg, { instant: true }).then(function () { activate(name); });
    }
    if (ATG.reducedMotion) style = 'fade';

    if (style === 'dive') {
      // Camera follows the data pulse into Blip's core.
      var focus = G.diveFocus || { x: 335, y: 330 };
      world.style.transformOrigin = focus.x + 'px ' + focus.y + 'px';
      world.classList.add('cam-dive');
      flash.className = 'flash flash--dive';
      return wait(1050).then(function () {
        world.classList.remove('cam-dive');
        world.classList.add('cam-arrive');
        return G.setBg(bg, { instant: true });
      }).then(function () {
        activate(name);
        world.style.transformOrigin = '50% 50%';
        return G.nextFrame();
      }).then(function () {
        world.classList.remove('cam-arrive');
        flash.className = 'flash flash--out';
        return wait(900);
      }).then(function () { flash.className = 'flash'; });
    }
    if (style === 'surface') {
      world.classList.add('cam-surface');
      flash.className = 'flash flash--soft';
      return wait(650).then(function () { return G.setBg(bg, { instant: true }); }).then(function () {
        activate(name);
        world.classList.remove('cam-surface');
        world.classList.add('cam-settle');
        return G.nextFrame();
      }).then(function () {
        world.classList.remove('cam-settle');
        flash.className = 'flash flash--out';
        return wait(800);
      }).then(function () { flash.className = 'flash'; });
    }
    if (style === 'expand') {
      // The room opens outward to reveal Byte's much larger space.
      world.classList.add('cam-pull');
      return wait(520).then(function () {
        activate(name);
        world.classList.remove('cam-pull');
        world.classList.add('cam-open');
        return G.setBg(bg, { ms: 900 });
      }).then(function () {
        return G.nextFrame();
      }).then(function () {
        world.classList.remove('cam-open');
        return wait(700);
      });
    }
    if (style === 'hue') {
      flash.className = 'flash flash--hue';
      return wait(420).then(function () {
        activate(name);
        return G.setBg(bg, { ms: 700 });
      }).then(function () { flash.className = 'flash flash--out'; return wait(600); })
        .then(function () { flash.className = 'flash'; });
    }
    // fade
    var cur = G.sceneEl(G.scene);
    if (cur) cur.classList.add('is-leaving');
    return G.setBg(bg, { ms: 650 }).then(function () {
      if (cur) cur.classList.remove('is-leaving');
      activate(name);
      return wait(250);
    });
  };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, G.dur(ms)); }); }
  G.wait = wait;

  /* ---------- flying objects, beams and bursts ---------- */
  G.overlay = null;

  /* Animate `node` from rect a to rect b (design coords). */
  G.flyNode = function (node, a, b, opts) {
    opts = opts || {};
    var o = G.overlay;
    node.classList.add('flyer');
    node.style.left = a.x + 'px';
    node.style.top = a.y + 'px';
    node.style.width = a.w + 'px';
    node.style.height = a.h + 'px';
    o.appendChild(node);
    var dx = b.x + b.w / 2 - (a.x + a.w / 2);
    var dy = b.y + b.h / 2 - (a.y + a.h / 2);
    var s = opts.scale != null ? opts.scale : Math.min(b.w / a.w, b.h / a.h);
    var lift = opts.arc != null ? opts.arc : -80;
    var ms = G.dur(opts.ms || 700);
    if (!node.animate) { node.remove(); return Promise.resolve(); }
    var frames = ATG.reducedMotion
      ? [{ opacity: 1, transform: 'translate(0,0)' }, { opacity: 0, transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')' }]
      : [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 + lift) + 'px) scale(' + ((1 + s) / 2 * 1.08) + ')', opacity: 1, offset: 0.55 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')', opacity: opts.fade ? 0 : 1 }
      ];
    var anim = node.animate(frames, { duration: ms, easing: 'cubic-bezier(.5,0,.25,1)', fill: 'forwards' });
    return new Promise(function (resolve) {
      var done = false;
      function fin() { if (done) return; done = true; if (!opts.keep) node.remove(); resolve(node); }
      anim.onfinish = fin;
      setTimeout(fin, ms + 400);
    });
  };
  G.fly = function (fromEl, toEl, node, opts) { return G.flyNode(node || fromEl.cloneNode(true), G.rect(fromEl), G.rect(toEl), opts); };

  /* Curved energy beam between two design points inside an SVG layer. */
  G.beam = function (svg, a, b, cls, opts) {
    opts = opts || {};
    var ns = 'http://www.w3.org/2000/svg';
    var bend = opts.bend != null ? opts.bend : -0.18;
    var mx = (a.x + b.x) / 2 + (b.y - a.y) * bend;
    var my = (a.y + b.y) / 2 - (b.x - a.x) * bend;
    var d = 'M ' + a.x + ' ' + a.y + ' Q ' + mx + ' ' + my + ' ' + b.x + ' ' + b.y;
    var g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'beam ' + (cls || ''));
    var glow = document.createElementNS(ns, 'path');
    glow.setAttribute('d', d);
    glow.setAttribute('class', 'beam__glow');
    var core = document.createElementNS(ns, 'path');
    core.setAttribute('d', d);
    core.setAttribute('class', 'beam__core');
    var flow = document.createElementNS(ns, 'path');
    flow.setAttribute('d', d);
    flow.setAttribute('class', 'beam__flow');
    g.appendChild(glow); g.appendChild(core); g.appendChild(flow);
    svg.appendChild(g);
    var len = 1200;
    try { len = core.getTotalLength(); } catch (e) { /* noop */ }
    g.style.setProperty('--len', Math.ceil(len));
    requestAnimationFrame(function () { g.classList.add('is-drawn'); });
    return g;
  };
  G.point = function (el, fx, fy) {
    var r = G.rect(el);
    return { x: r.x + r.w * (fx == null ? 0.5 : fx), y: r.y + r.h * (fy == null ? 0.5 : fy) };
  };

  /* Success burst: ring + a few shards. Reduced motion: a soft glow only. */
  G.burst = function (x, y, opts) {
    opts = opts || {};
    var o = G.overlay;
    var wrap = G.el('div', 'fxburst' + (opts.cls ? ' ' + opts.cls : ''));
    wrap.style.left = x + 'px';
    wrap.style.top = y + 'px';
    var ring = G.el('img', 'fxburst__ring');
    ring.src = D.IMAGES.fx.ring;
    ring.alt = '';
    wrap.appendChild(ring);
    if (!ATG.reducedMotion) {
      var n = opts.count || 6;
      for (var i = 0; i < n; i++) {
        var s = G.el('img', 'fxburst__shard');
        s.src = i % 2 ? D.IMAGES.fx.shard1 : D.IMAGES.fx.shard2;
        s.alt = '';
        var ang = (i / n) * Math.PI * 2 + 0.3;
        var dist = (opts.radius || 150) * (0.75 + (i % 3) * 0.15);
        s.style.setProperty('--tx', Math.cos(ang) * dist + 'px');
        s.style.setProperty('--ty', Math.sin(ang) * dist + 'px');
        s.style.setProperty('--r', (ang * 57) + 'deg');
        wrap.appendChild(s);
      }
    }
    o.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 1500);
  };

  /* ---------- phrase panel (shared by every prediction machine) ---------- */
  function Phrase(el, opts) {
    opts = opts || {};
    this.el = el;
    G.clear(el);
    this.pips = null;
    if (opts.pips) {
      this.pips = G.el('div', 'phrase__pips');
      this.pips.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < opts.pips; i++) this.pips.appendChild(G.el('i'));
      el.appendChild(this.pips);
    }
    this.line = G.el('p', 'phrase__text');
    this.before = G.el('span', 'phrase__before');
    this.slot = G.el('span', 'phrase__slot');
    this.word = G.el('span', 'phrase__word');
    this.scan = G.el('span', 'phrase__scan');
    this.scan.setAttribute('aria-hidden', 'true');
    this.slot.appendChild(this.word);
    this.slot.appendChild(this.scan);
    this.after = G.el('span', 'phrase__after');
    this.line.appendChild(this.before);
    this.line.appendChild(this.slot);
    this.line.appendChild(this.after);
    el.appendChild(this.line);
  }
  Phrase.prototype.set = function (prompt, opts) {
    opts = opts || {};
    var parts = prompt.split('___');
    this.word.textContent = '';
    this.slot.className = 'phrase__slot';
    this.slot.setAttribute('aria-label', 'blank');
    this.after.textContent = parts[1] || '';
    this.el.classList.add('is-live');
    var before = this.before, full = parts[0].replace(/\s+$/, '');
    // opts.key: box the last N words, the words the system looks up.
    function mark() { if (opts.key) Phrase.markKey(before, full, opts.key); }
    if (!opts.type || ATG.reducedMotion) { before.textContent = full; mark(); return Promise.resolve(); }
    before.textContent = '';
    var i = 0;
    return new Promise(function (resolve) {
      var t = setInterval(function () {
        i += 1;
        before.textContent = full.slice(0, i);
        if (i >= full.length) { clearInterval(t); mark(); resolve(); }
      }, 26);
    });
  };
  /* Render `text` into el with its last n words wrapped in a key box. */
  Phrase.markKey = function (el, text, n) {
    var words = text.split(/\s+/);
    var head = words.slice(0, -n).join(' '), key = words.slice(-n).join(' ');
    G.clear(el);
    if (head) el.appendChild(document.createTextNode(head + ' '));
    el.appendChild(G.text('span', 'phrase__key', key));
  };
  /* The last n words before the blank, normalised: "I want to eat a ___" -> ["eat", "a"]. */
  G.keyOf = function (prompt, n) {
    return prompt.split('___')[0].trim().split(/\s+/).slice(-(n || D.keyWords)).map(G.norm);
  };
  G.norm = function (w) { return w.toLowerCase().replace(/[^a-z']/g, ''); };
  Phrase.prototype.processing = function (on) { this.slot.classList.toggle('is-processing', on); };
  Phrase.prototype.fill = function (word, cls) {
    this.slot.classList.remove('is-processing');
    this.word.textContent = word;
    this.slot.className = 'phrase__slot is-filled' + (cls ? ' ' + cls : '');
    this.slot.removeAttribute('aria-label');
  };
  Phrase.prototype.setPip = function (i) {
    if (!this.pips) return;
    var pips = this.pips.children;
    for (var k = 0; k < pips.length; k++) {
      pips[k].className = k < i ? 'is-done' : k === i ? 'is-current' : '';
    }
  };
  Phrase.prototype.text = function () {
    return (this.before.textContent + ' ' + (this.word.textContent || '___') + ' ' + this.after.textContent).replace(/\s+/g, ' ').trim();
  };
  G.Phrase = Phrase;

  /* ---------- buttons ---------- */
  G.button = function (label, cls, attrs) {
    var b = G.el('button', 'btn ' + (cls || ''));
    b.type = 'button';
    var span = G.text('span', 'btn__label', label);
    b.appendChild(span);
    if (attrs) Object.keys(attrs).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    b.addEventListener('pointerenter', function () { if (!b.disabled) G.audio.sfx('button_hover', 0.18); });
    return b;
  };

  /* Show a single CTA in `dock`; resolves once when pressed. */
  G.cta = function (seq, dock, label, opts) {
    opts = opts || {};
    G.clear(dock);
    var b = G.button(label, 'btn--primary ' + (opts.cls || 'btn--lg'));
    if (opts.icon) b.insertAdjacentHTML('afterbegin', '<span class="btn__icon btn__icon--' + opts.icon + '" aria-hidden="true"></span>');
    if (opts.aria) b.setAttribute('aria-label', opts.aria);
    dock.appendChild(b);
    dock.classList.add('is-on');
    if (opts.focus !== false) G.focus(b);
    if (opts.hint !== false) G.hints.setContext({ line: ctaHintLine(label, opts.aria), run: function () { G.pulse(b); } });
    return seq.until(function (resolve) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        b.disabled = true;
        b.classList.add('is-pressed');
        G.audio.sfx('button_press', 0.45);
        G.hints.clear();
        setTimeout(function () { dock.classList.remove('is-on'); }, 120);
        setTimeout(function () { if (b.parentNode === dock) G.clear(dock); }, 420);
        resolve();
      });
    });
  };

  /* Spoken one-sentence hint for a single-button step (its text is the bubble). */
  function ctaHintLine(label, aria) {
    var who = /^Run (\w+)/.exec(aria || '');
    if (who) return who[1] === 'Byte' ? 'k_hint_run_byte' : 'k_hint_run_blip';
    return { 'Try It': 'k_hint_try', 'Finish': 'k_hint_finish' }[label] || 'k_hint_continue';
  }

  G.focus = function (el) {
    if (!el) return;
    requestAnimationFrame(function () { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } });
  };
  /*
   * Draw attention to an element. The default hint ring uses the Web
   * Animations API so it layers over (never replaces) CSS entrance motion.
   */
  G.pulse = function (el, cls) {
    if (!el) return;
    if (!cls && el.animate) {
      var ring = '0 0 0 5px rgba(255, 214, 110, .95), 0 0 44px rgba(255, 194, 74, .7)';
      var calm = '0 0 0 0 rgba(255, 214, 110, 0), 0 0 0 rgba(255, 194, 74, 0)';
      var frames = ATG.reducedMotion
        ? [{ boxShadow: ring }, { boxShadow: ring }]
        : [{ boxShadow: calm, transform: 'scale(1)' }, { boxShadow: ring, transform: 'scale(1.04)', offset: 0.45 }, { boxShadow: calm, transform: 'scale(1)' }];
      el.animate(frames, { duration: ATG.reducedMotion ? 2200 : 1250, iterations: ATG.reducedMotion ? 1 : 2, easing: 'ease-in-out', composite: 'replace' });
      G.audio.sfx('hint', 0.3);
      return;
    }
    cls = cls || 'is-hinted';
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    if (cls !== 'is-nudge') G.audio.sfx('hint', 0.3);
    setTimeout(function () { el.classList.remove(cls); }, 2600);
  };

  /* ---------- characters ---------- */
  G.makePlayer = function (id, mountId, size) {
    var p = new ATG.SpritePlayer($(mountId), D.SPRITES[id], { width: size, height: size });
    G.players[mountId] = p;
    return p;
  };

  /* Character line (Blip/Byte/Dot) with its talk animation. */
  G.charSay = function (seq, lineId, player, talk, after) {
    return seq.run(G.audio.say(lineId, {
      onStart: function () { if (player && talk) player.play(talk); },
      onEnd: function () { if (player && after !== false) player.play(after || 'idle'); }
    }));
  };
  G.krishSay = function (seq, lineId, pose) { return seq.run(G.krish.say(lineId, pose)); };

  /* ---------- dialogue focus mode ---------- */
  /*
   * While a character speaks, the background dims and blurs, the HUD steps
   * back, and the line sits in a speech bubble whose tail points at the
   * speaker. Hint lines (spoken without a caption) never trigger it.
   */
  var SPEAKER_MOUNTS = {
    blip: ['blipPod', 'blipMini', 'repairBlip', 'ruleBlip', 'castBlip'],
    byte: ['byteMount', 'ruleByte', 'castByte'],
    dot: ['dotMount', 'castDot']
  };
  var speakingEl = null;

  function speakerMount(who) {
    var scene = G.sceneEl(G.scene), ids = SPEAKER_MOUNTS[who] || [];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el && scene && scene.contains(el) && el.getBoundingClientRect().width > 0) return el;
    }
    return null;
  }

  /* Place the bubble beside a speaker on the floor (side tail), or under a raised one (top tail). */
  var BUBBLE_GAP = 26, EDGE = 40;
  function placeBubble(who) {
    var box = $('captionBox');
    var story = !$('storySequence').hidden;
    var r = story ? null : who === 'krish' ? G.krish.box() : (speakerMount(who) ? G.rect(speakerMount(who)) : null);
    var bw = box.offsetWidth, left = (W - bw) / 2, tail = 'none', tailX = bw / 2;
    if (r) {
      if (r.y + r.h > 860) {
        // Standing on the floor: sit beside the speaker, tail pointing at them.
        var onLeft = r.cx < W / 2;
        var l = onLeft ? r.x + r.w + BUBBLE_GAP : r.x - BUBBLE_GAP - bw;
        if (l >= EDGE && l + bw <= W - EDGE) { left = l; tail = onLeft ? 'left' : 'right'; }
      } else {
        // Raised (a robot in its pod or on a pedestal): tail points up at it.
        left = Math.max(EDGE, Math.min(W - EDGE - bw, r.cx - bw / 2));
        tail = 'up';
        tailX = Math.max(190, Math.min(bw - 48, r.cx - left)); // clear of the name tab
      }
    }
    box.style.left = left + 'px';
    box.style.setProperty('--tail-x', tailX + 'px');
    box.dataset.tail = tail;
  }

  function Dialogue() {
    var arena = $('arena'), offTimer = null;
    G.audio.on('caption', function (d) {
      clearTimeout(offTimer);
      arena.classList.add('is-dialogue');
      if (speakingEl) speakingEl.classList.remove('is-speaking');
      speakingEl = d.speaker === 'krish' ? null : speakerMount(d.speaker);
      if (speakingEl) speakingEl.classList.add('is-speaking');
    });
    G.audio.on('captionEnd', function () {
      if (speakingEl) { speakingEl.classList.remove('is-speaking'); speakingEl = null; }
      // A short grace period, so back-to-back lines do not flicker the background.
      offTimer = setTimeout(function () { arena.classList.remove('is-dialogue'); }, 380);
    });
  }

  /* ---------- voice lock ---------- */
  /*
   * While any voice line plays (Krish, Blip, Byte, Dot, spoken hints), nothing
   * in the play area responds: no taps, clicks, drags or keys. Still live: the
   * HUD (back, sound menu, info, timer), the info dialog, the caption bubble
   * (tap to skip the line), and Tab / Escape / browser shortcuts.
   */
  var VOICE_LIVE = ['hud', 'infoModal', 'captions'];
  var VOICE_LIVE_KEYS = /^(Tab|Escape|F\d+)$/;
  function VoiceLock() {
    var arena = $('arena');
    G.audio.on('speak', function () { arena.classList.add('is-voice-locked'); });
    G.audio.on('speakEnd', function () { if (!G.audio.speaking) arena.classList.remove('is-voice-locked'); });
    function live(t) {
      return VOICE_LIVE.some(function (id) { var el = $(id); return el && t instanceof Node && el.contains(t); });
    }
    ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'touchstart', 'keydown', 'keyup'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (!G.audio.speaking || live(e.target)) return;
        if (type.indexOf('key') === 0 && (VOICE_LIVE_KEYS.test(e.key) || e.metaKey || e.ctrlKey || e.altKey)) return;
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
      }, { capture: true, passive: false });
    });
  }

  /* ---------- action instruction ---------- */
  /*
   * One short, verb-first line that stays on screen while an action is live.
   * Narrative stays in dialogue; the action lives here, so it is still there
   * after the voice line ends or with captions off. at: { x, y } in design px
   * (x is the centre). G.task(null) hides it.
   */
  var taskTimer = null;
  G.task = function (text, at) {
    var el = $('task');
    clearTimeout(taskTimer);
    if (!text) {
      el.classList.remove('is-on');
      taskTimer = setTimeout(function () { el.hidden = true; }, 260);
      return;
    }
    $('taskText').textContent = text;
    if (at) { el.style.left = at.x + 'px'; el.style.top = at.y + 'px'; }
    var fresh = el.hidden;
    el.hidden = false;
    if (fresh) { void el.offsetWidth; }
    el.classList.add('is-on');
  };
  /* Fill {key}/{word} placeholders in a task template from data.js. */
  G.taskText = function (id, vals) {
    return D.tasks[id].replace(/\{(\w+)\}/g, function (m, k) { return vals && vals[k] != null ? vals[k] : m; });
  };

  /* ---------- captions (max two lines, synced to VO) ---------- */
  function Captions() {
    var box = $('captionBox'), text = $('captionText'), speaker = $('captionSpeaker');
    var chunks = [], idx = -1, raf = null, start = 0, readMs = 0, hideTimer = null;
    var NAMES = { blip: 'Blip', byte: 'Byte', dot: 'Dot', krish: 'Krish' };
    function split(t) {
      if (t.length <= 150) return [t];
      var parts = t.match(/[^.!?]+[.!?]+["'’”]*\s*/g) || [t];
      var out = [], cur = '';
      parts.forEach(function (p) { if ((cur + p).length > 150 && cur) { out.push(cur.trim()); cur = p; } else cur += p; });
      if (cur.trim()) out.push(cur.trim());
      return out;
    }
    function frame() {
      var v = G.audio.voice, k;
      if (v && isFinite(v.duration) && v.duration > 0 && !v.paused) k = v.currentTime / v.duration;
      else k = (performance.now() - start) / readMs;
      var total = chunks.join(' ').length, acc = 0, want = 0;
      for (var i = 0; i < chunks.length; i++) { acc += chunks[i].length + 1; if (k * total < acc) { want = i; break; } want = i; }
      if (want !== idx) { idx = want; text.textContent = chunks[idx]; placeBubble(box.dataset.speaker); }
      raf = requestAnimationFrame(frame);
    }
    G.audio.on('caption', function (d) {
      clearTimeout(hideTimer);
      cancelAnimationFrame(raf);
      chunks = split(d.text);
      idx = 0;
      text.textContent = chunks[0];
      speaker.textContent = NAMES[d.speaker] || '';
      box.dataset.speaker = d.speaker;
      placeBubble(d.speaker);
      box.classList.add('is-on');
      start = performance.now();
      readMs = Math.max(1100, d.text.split(/\s+/).length * 330 + 500);
      if (chunks.length > 1) raf = requestAnimationFrame(frame);
    });
    G.audio.on('captionEnd', function () {
      cancelAnimationFrame(raf);
      hideTimer = setTimeout(function () { box.classList.remove('is-on'); }, 260);
    });
    function applyToggle(on) {
      document.documentElement.classList.toggle('captions-off', !on);
      var btn = $('captionsBtn');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      $('captionsLabel').textContent = on ? 'Hide Captions' : 'Show Captions';
    }
    G.audio.on('captions', applyToggle);
    applyToggle(G.audio.captionsOn);
    $('captionBox').addEventListener('click', function () { G.audio.stopVoice(); });
  }

  /* ---------- HUD ---------- */
  // Progressive mission timer (Figma HUD): counts up from the first lab screen, stops at Finish.
  var timer = { start: 0, id: null };
  G.startTimer = function () {
    if (timer.id) return;
    timer.start = performance.now();
    timer.id = setInterval(function () {
      var s = Math.floor((performance.now() - timer.start) / 1000);
      $('timer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 500);
  };
  G.stopTimer = function () { clearInterval(timer.id); };
  /* HUD dropdowns (sound / captions) — SKAI menu pattern. */
  var openMenu = null;
  function setMenu(btn, menu, open, viaKeyboard) {
    if (open && openMenu && openMenu.menu !== menu) setMenu(openMenu.btn, openMenu.menu, false);
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('is-open', open);
    openMenu = open ? { btn: btn, menu: menu } : null;
    if (open && viaKeyboard) G.focus(menu.querySelector('.menu__item'));
  }
  G.closeMenus = function () { if (openMenu) setMenu(openMenu.btn, openMenu.menu, false); };

  /* Info dialog — overall information about the mission (SKAI modal). */
  var TIP_ICONS = {
    tap: '<path d="M12 15V7.5a2 2 0 0 1 4 0V14"/><path d="M16 13.5a2 2 0 0 1 4 0V15a2 2 0 0 1 4 0v4.5A7.5 7.5 0 0 1 16.5 27h-1a7 7 0 0 1-5.6-2.8L6.5 19.6a2 2 0 0 1 3-2.6L12 19"/>',
    key: '<rect x="4" y="9" width="24" height="15" rx="3"/><path d="M9 14h2M14 14h2M19 14h2M10 19h12"/>',
    hint: '<path d="M16 5a7.5 7.5 0 0 0-4.5 13.5c.8.6 1.2 1.5 1.2 2.5v1h6.6v-1c0-1 .4-1.9 1.2-2.5A7.5 7.5 0 0 0 16 5z"/><path d="M13 26h6M14 29h4"/>',
    sound: '<path class="fill" d="M5 12h5l7-6v20l-7-6H5z"/><path d="M21 11.5a6 6 0 0 1 0 9M24.5 8a11 11 0 0 1 0 16"/>',
    back: '<path d="M19 6h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-6"/><path d="M14 10l-7 6 7 6"/><path d="M7 16h14"/>'
  };
  var info = { open: false, lastFocus: null };
  function renderInfo() {
    var I = D.info, body = $('infoBody');
    var html = '<h2 class="info__title" id="infoTitle"></h2><p class="info__intro"></p>' +
      '<div class="info__cols"><ol class="info__steps"></ol><ul class="info__tips"></ul></div>' +
      '<p class="info__meta"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="17" r="10"/><path d="M16 11v6l4 3M13 4h6"/></svg><span></span></p>';
    body.innerHTML = html;
    body.querySelector('.info__title').textContent = I.title;
    body.querySelector('.info__intro').textContent = I.intro;
    body.querySelector('.info__meta span').textContent = I.duration;
    var ol = body.querySelector('.info__steps');
    I.steps.forEach(function (st, i) {
      var li = G.el('li', 'step');
      li.appendChild(G.text('span', 'step__num', String(i + 1)));
      var t = G.el('span', 'step__text');
      t.appendChild(G.text('strong', null, st.title));
      t.appendChild(G.text('span', null, st.text));
      li.appendChild(t);
      ol.appendChild(li);
    });
    var ul = body.querySelector('.info__tips');
    I.tips.forEach(function (tip) {
      var li = G.el('li', 'tip');
      li.appendChild(G.el('span', 'tip__icon', '<svg viewBox="0 0 32 32" aria-hidden="true">' + TIP_ICONS[tip.icon] + '</svg>'));
      li.appendChild(G.text('span', 'tip__text', tip.text));
      ul.appendChild(li);
    });
  }
  function setInfo(open) {
    if (open === info.open) return;
    info.open = open;
    var modal = $('infoModal');
    ['world', 'hud', 'rail', 'krish', 'beacon', 'hintBubble', 'captions'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
    if (open) {
      G.closeMenus();
      info.lastFocus = document.activeElement;
      G.busyCount += 1;          // hints stay quiet while reading
      G.audio.pauseVoice();
      G.audio.sfx('memory_open', 0.3);
      modal.hidden = false;
      G.focus($('infoClose'));
    } else {
      modal.hidden = true;
      G.busyCount = Math.max(0, G.busyCount - 1);
      G.audio.resumeVoice();
      G.audio.sfx('button_press', 0.3);
      if (info.lastFocus && info.lastFocus.focus) { try { info.lastFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ } }
    }
  }
  G.isInfoOpen = function () { return info.open; };

  function wireHud() {
    renderInfo();
    $('infoBtn').addEventListener('click', function () { setInfo(true); });
    $('infoClose').addEventListener('click', function () { setInfo(false); });
    $('infoScrim').addEventListener('click', function () { setInfo(false); });
    $('infoModal').addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { e.preventDefault(); $('infoClose').focus(); } // single control: keep focus inside
    });

    [['soundBtn', 'soundMenu']].forEach(function (pair) {
      var btn = $(pair[0]), menu = $(pair[1]);
      btn.addEventListener('click', function (e) {
        G.audio.sfx('button_press', 0.3);
        setMenu(btn, menu, menu.hidden, e.detail === 0);
      });
    });
    document.addEventListener('pointerdown', function (e) {
      if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.btn.contains(e.target)) G.closeMenus();
    }, true);

    $('replayBtn').addEventListener('click', function () {
      G.audio.sfx('button_press', 0.3);
      G.closeMenus();
      var p = G.audio.replay();
      if (!p) { G.pulse($('soundBtn'), 'is-nudge'); }
    });
    $('captionsBtn').addEventListener('click', function () { G.audio.setCaptions(!G.audio.captionsOn); G.closeMenus(); });
    function applyMute(m) {
      $('muteBtn').setAttribute('aria-pressed', m ? 'true' : 'false');
      $('muteLabel').textContent = m ? 'Unmute All Sounds' : 'Mute All Sounds';
      $('soundBtn').classList.toggle('is-muted', m);
      $('soundBtn').setAttribute('aria-label', m ? 'Sound options (sound is off)' : 'Sound options');
    }
    $('muteBtn').addEventListener('click', function () { G.audio.setMuted(!G.audio.muted); G.closeMenus(); });
    G.audio.on('mute', applyMute);
    applyMute(G.audio.muted);

    $('backBtn').addEventListener('click', function () {
      var target = G.machine.backTarget();
      if (!target || G.machine.locked) { G.pulse($('backBtn'), 'is-nudge'); return; }
      G.audio.sfx('button_press', 0.35);
      G.resetTransient();
      G.machine.go(target, 'back');
    });
    setInterval(updateBack, 300);

    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (info.open) { e.preventDefault(); setInfo(false); return; }
      if (openMenu) { e.preventDefault(); var b = openMenu.btn; G.closeMenus(); b.focus(); return; }
      if (G.audio.speaking) { e.preventDefault(); G.audio.stopVoice(); }
    });
  }
  function updateBack() {
    var ok = !!G.machine.backTarget() && !G.machine.locked;
    var b = $('backBtn');
    b.disabled = !ok;
    b.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }
  G.updateBack = updateBack;

  /* Clear per-state transient visuals (used by Back). */
  G.resetTransient = function () {
    G.hints.clear();
    G.audio.stopVoice();
    if (G.overlay) G.clear(G.overlay);
    document.querySelectorAll('.cta-dock').forEach(function (d) { G.clear(d); d.classList.remove('is-on'); });
  };

  /* ---------- ambient particles (limited, paused when hidden) ---------- */
  function Particles(canvas) {
    var ctx = canvas.getContext('2d');
    var parts = [];
    var n = ATG.reducedMotion ? 8 : 26;
    for (var i = 0; i < n; i++) parts.push(spawn(true));
    function spawn(initial) {
      return { x: Math.random() * 960, y: initial ? Math.random() * 540 : 560, r: 0.6 + Math.random() * 1.8,
        vy: -(0.08 + Math.random() * 0.25), vx: (Math.random() - 0.5) * 0.08, a: 0.25 + Math.random() * 0.5, t: Math.random() * 6 };
    }
    var last = 0;
    G.particleTint = '120, 230, 255';
    function draw(now) {
      requestAnimationFrame(draw);
      if (document.hidden || now - last < 33) return;
      last = now;
      ctx.clearRect(0, 0, 960, 540);
      var speed = ATG.reducedMotion ? 0.25 : 1;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.t += 0.03;
        p.x += p.vx * speed; p.y += p.vy * speed;
        if (p.y < -10) parts[i] = p = spawn(false);
        var a = p.a * (0.6 + 0.4 * Math.sin(p.t));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + G.particleTint + ',' + a.toFixed(3) + ')';
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    requestAnimationFrame(draw);
  }

  /* ---------- boot ---------- */
  function boot() {
    layout();
    G.overlay = G.el('div', 'overlay');
    G.overlay.setAttribute('aria-hidden', 'true');
    $('world').appendChild(G.overlay);

    G.machine = new ATG.StateMachine();
    G.audio = new ATG.AudioManager(D);
    G.krish = new ATG.KrishController($('krish'), D, G.audio);
    G.progress = new ATG.ProgressManager($('rail'), G.audio);
    G.input = new ATG.InputManager(G);
    G.hints = new ATG.HintManager({
      audio: G.audio, machine: G.machine, krish: G.krish, beacon: $('beacon'), bubble: $('hintBubble'), lines: D.LINES,
      isBusy: G.busy,
      onShow: function () { G.audio.sfx('hint', 0.28); }
    });
    Captions();
    Dialogue();
    VoiceLock();
    wireHud();
    G.machine.onChange(function (to) {
      G.task(null); // every state sets its own instruction; Back never leaves a stale one
      document.documentElement.dataset.state = to.toLowerCase();
      updateBack();
    });
    Particles($('fx'));
    ATG.preload.ready.then(function () { G.krish.preload(); }); // poses are local by then

    if (ATG.initScenes) ATG.initScenes(G);
    G.machine.go('TITLE', 'start');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.ATG = window.ATG || {});
