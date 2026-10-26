/*
 * Scene scripts — one handler per mission state. Each handler re-renders its
 * scene from saved flags on entry, so Back always lands on a consistent
 * checkpoint and committed one-attempt answers are shown, never erased.
 * Every await goes through `seq`, so a Back press cancels cleanly.
 */
(function (ATG) {
  'use strict';

  var D = ATG.DATA;

  ATG.initScenes = function (G) {
    var M = G.machine, A = G.audio, K = G.krish, F = M.flags, $ = G.$;
    var TOK = D.IMAGES.tokens;

    /* ---------- characters ---------- */
    var P = {
      pod: G.makePlayer('blip', 'blipPod', 300),
      mini: G.makePlayer('blip', 'blipMini', 190),
      byte: G.makePlayer('byte', 'byteMount', 380),
      repair: G.makePlayer('blip', 'repairBlip', 230),
      ruleBlip: G.makePlayer('blip', 'ruleBlip', 250),
      ruleByte: G.makePlayer('byte', 'ruleByte', 290),
      dot: G.makePlayer('dot', 'dotMount', 330),
      castBlip: G.makePlayer('blip', 'castBlip', 250),
      castDot: G.makePlayer('dot', 'castDot', 240),
      castByte: G.makePlayer('byte', 'castByte', 300)
    };
    Object.keys(P).forEach(function (k) { P[k].play('off'); });

    var labPhrase = new G.Phrase($('labPhrase'), { pips: D.trials.length });
    var bytePhrase = new G.Phrase($('bytePhrase'));
    var repairPhrase = new G.Phrase($('repairPhrase'));

    function hud(on) { $('hud').hidden = !on; $('rail').hidden = !on; }

    function tokenImg(word, cls) {
      var img = G.el('img', cls || 'token');
      img.src = TOK[word];
      img.alt = '';
      img.draggable = false;
      return img;
    }
    function chip(word, cls) {
      var c = G.el('span', 'chip ' + (cls || ''));
      c.dataset.word = word;
      if (TOK[word]) c.appendChild(tokenImg(word, 'chip__token'));
      c.appendChild(G.text('span', 'chip__word', word));
      return c;
    }
    var norm = G.norm;

    /*
     * Answer options are shuffled once per session and saved in flags, so Back
     * shows the same layout. The correct option sits in a different position on
     * each of the three questions, so "always pick the top one" never works.
     */
    function shuffle(list) {
      var a = list.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1)), t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    }
    var OPTION_SETS = { phone: D.phone.options, cause: D.cause.options, repair: D.repair.cartridges, rule: D.rule.options };
    function ordered(key) {
      if (!F.optionOrder) {
        var slots = shuffle([0, 1, 2]);
        F.optionOrder = {};
        Object.keys(OPTION_SETS).forEach(function (k, n) {
          var opts = OPTION_SETS[k];
          var list = shuffle(opts.filter(function (o) { return !o.correct; }));
          list.splice(slots[n % 3], 0, correctOf(opts));
          F.optionOrder[k] = list.map(function (o) { return o.id; });
        });
      }
      return F.optionOrder[key].map(function (id) {
        return OPTION_SETS[key].filter(function (o) { return o.id === id; })[0];
      });
    }
    function correctOf(opts) { return opts.filter(function (o) { return o.correct; })[0]; }
    function correctBtn(btns, opts) {
      var id = correctOf(opts).id;
      return btns.filter(function (b) { return b.dataset.id === id; })[0];
    }

    // Focus the question group, never an option: a focus ring on one answer
    // would single it out, and Enter would pick it.
    function focusGroup(el) {
      el.tabIndex = -1;
      G.focus(el);
    }

    /* ======================================================================
       LAB helpers
       ====================================================================== */
    function setStoryFrame(key, index, total) {
      var story = $('storySequence');
      story.dataset.frame = key;
      story.querySelectorAll('[data-story-key]').forEach(function (scene) {
        scene.classList.toggle('is-active', scene.dataset.storyKey === key);
      });
      var pips = story.querySelector('.stakes-story__pips');
      if (pips.children.length !== total) {
        G.clear(pips);
        for (var p = 0; p < total; p++) pips.appendChild(G.el('i'));
      }
      Array.prototype.forEach.call(pips.children, function (pip, i) {
        pip.classList.toggle('is-active', i === index);
        pip.classList.toggle('is-done', i < index);
      });
    }

    function hideStorySequence() {
      var story = $('storySequence');
      story.classList.remove('is-on', 'is-leaving');
      story.hidden = true;
    }

    async function openStorySequence(seq, key, index, total) {
      var story = $('storySequence');
      story.hidden = false;
      story.classList.remove('is-leaving');
      setStoryFrame(key, index, total);
      await seq.run(G.nextFrame());
      story.classList.add('is-on');
    }

    function closeStorySequence() {
      var story = $('storySequence');
      story.classList.remove('is-on');
      story.classList.add('is-leaving');
      setTimeout(hideStorySequence, G.dur(420));
    }

    async function playStakesStory(seq) {
      await openStorySequence(seq, 'stakes-school', 0, 3);

      // Timed to the shipped 10-second VO: school launch, strange suggestions,
      // then the tonight-or-power-down consequence.
      var timers = [
        setTimeout(function () { if (seq.alive()) setStoryFrame('stakes-strange', 1, 3); }, 3400),
        setTimeout(function () { if (seq.alive()) setStoryFrame('stakes-night', 2, 3); }, 5700)
      ];
      try {
        await G.krishSay(seq, 'k_stakes', 'serious');
      } finally {
        timers.forEach(clearTimeout);
        closeStorySequence();
      }
    }

    // Only the phone takeaway and the bridge are narrated at the end.
    async function playFinaleStory(seq) {
      await openStorySequence(seq, 'finale-phone', 0, 2);
      try {
        await G.krishSay(seq, 'k_takeaway', 'point');
        setStoryFrame('finale-team', 1, 2);
        await seq.wait(280);
        await G.krishSay(seq, 'k_bridge', 'happy');
      } finally {
        closeStorySequence();
      }
    }

    function resetLab(opts) {
      opts = opts || {};
      hideStorySequence();
      var pod = $('pod');
      endWake();
      resetPhone(!!opts.phone);
      pod.className = 'pod' + (opts.sealed ? ' is-sealed' : ' is-revealed');
      $('console').className = 'console';
      $('evidence').className = 'evidence';
      $('causeQ').className = 'question';
      G.clear($('labBeams'));
      G.clear($('choices'));
      G.clear($('pathways'));
      G.clear($('tray'));
      G.clear($('evidenceRows'));
      G.clear($('causeOptions'));
      showSuggestRow(null);
      $('causePrompt').textContent = '';
      $('causeNote').textContent = 'Any guess is okay.';
      $('choices').className = 'choices';
      $('predictionInstruction').hidden = true;
      $('predictionPrompt').textContent = 'Which word do you think Blip will choose?';
      $('predictionNote').textContent = 'Any prediction is okay.';
      labPhrase.set('');
      labPhrase.el.classList.remove('is-live');
      labPhrase.setPip(-1);
    }

    /* Unscored pick among options: the chosen one locks, the rest dim. */
    function pickOne(seq, btns) {
      return seq.until(function (resolve) {
        var taken = false;
        btns.forEach(function (b) { b.onclick = function () { if (taken || b.disabled) return; taken = true; resolve(b); }; });
      }).then(function (b) {
        G.hints.clear();
        btns.forEach(function (x) { x.disabled = true; x.onclick = null; x.classList.add(x === b ? 'is-locked' : 'is-dim'); });
        A.sfx('choice_lock', 0.5);
        return b;
      });
    }
    function renderGuess(box, key, cls, locked) {
      G.clear(box);
      return ordered(key).map(function (o, k) {
        var b = G.button(o.label, 'option ' + cls);
        b.dataset.id = o.id;
        b.style.setProperty('--i', k);
        if (locked) { b.disabled = true; b.classList.add(o.id === locked ? 'is-locked' : 'is-dim'); }
        box.appendChild(b);
        return b;
      });
    }

    /* ======================================================================
       PHONE — a phone keyboard shows what autocomplete is before Blip.
       ====================================================================== */
    var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    var PHONE_TASK = { x: 1500, y: 270 }; // the open area right of the phone
    var phone = { typed: 0, stop: null };

    function resetPhone(show) {
      if (phone.stop) phone.stop();
      var el = $('phone');
      el.hidden = !show;
      el.className = 'phone';
      phone.typed = 0;
      $('phoneTyped').textContent = '';
      G.clear($('phoneSuggest'));
      var keys = G.clear($('phoneKeys'));
      KEY_ROWS.concat([' ']).forEach(function (row) {
        var r = G.el('div', 'phone__row');
        row.split('').forEach(function (ch) {
          var k = G.el('button', 'phone__key' + (ch === ' ' ? ' phone__key--space' : ''));
          k.type = 'button';
          k.dataset.key = ch;
          k.tabIndex = -1;
          k.disabled = true;
          if (ch === ' ') k.setAttribute('aria-label', 'space'); else k.textContent = ch;
          r.appendChild(k);
        });
        keys.appendChild(r);
      });
      $('phoneQ').className = 'question question--phone';
      G.clear($('phoneOptions'));
      $('phonePrompt').textContent = '';
    }

    // The key for word i's first letter glows; it is the one tab stop.
    function glowAt(i) {
      var w = D.phone.words[i];
      var ch = w ? w[0].toLowerCase() : null, target = null;
      $('phoneKeys').querySelectorAll('.phone__key').forEach(function (k) {
        var on = k.dataset.key === ch;
        k.classList.remove('is-urge');
        k.classList.toggle('is-next', on);
        k.tabIndex = on ? 0 : -1;
        if (on) target = k;
      });
      return target;
    }

    // live: tappable suggestions; otherwise a passing preview while typing.
    function showSuggest(list, live) {
      var box = G.clear($('phoneSuggest'));
      box.classList.toggle('is-live', !!live);
      list.forEach(function (w, i) {
        var b = G.el(live ? 'button' : 'span', 'phone__word');
        if (live) { b.type = 'button'; b.dataset.word = w; b.style.setProperty('--i', i); }
        b.textContent = w;
        box.appendChild(b);
      });
      if (!live) box.setAttribute('aria-hidden', 'true'); else box.removeAttribute('aria-hidden');
      return Array.prototype.slice.call(box.children);
    }

    /* Each key press types the next word of the message. Physical keys work too. */
    /*
     * Only the highlighted key types: it adds the next word of the message.
     * Any other key shakes the keyboard and makes the highlighted key glow
     * harder. Physical keys work the same way.
     */
    function typePhone(seq) {
      var box = $('phoneKeys');
      var keys = Array.prototype.slice.call(box.querySelectorAll('.phone__key'));
      var lit = 0; // the word whose key is glowing
      keys.forEach(function (k) { k.disabled = false; });
      $('phone').classList.add('is-typing');
      showSuggest(D.phone.along[0], false);
      G.focus(glowAt(0));
      function litKey() { return box.querySelector('.phone__key.is-next'); }
      function setHint() { G.hints.setContext({ line: 'k_type_hint', run: function () { G.pulse(litKey()); } }); }
      setHint();
      G.task(D.tasks.type, PHONE_TASK);
      return seq.until(function (resolve) {
        var busy = false, queued = 0, misses = 0;
        function wrong(k) {
          misses += 1;
          A.sfx('wrong_soft', 0.2);
          [box, litKey()].forEach(function (el, i) {
            if (!el) return;
            var cls = i ? 'is-urge' : 'is-shake';
            el.classList.remove(cls);
            void el.offsetWidth;
            el.classList.add(cls);
          });
          if (k) { k.classList.remove('is-tap'); void k.offsetWidth; k.classList.add('is-tap'); }
          if (misses === 1 || misses % 4 === 0) K.say('k_type_hint', 'point');
        }
        function type() {
          busy = true;
          var word = D.phone.words[phone.typed];
          var el = $('phoneTyped'), base = el.textContent + (phone.typed ? ' ' : ''), n = 0;
          var t = setInterval(function () {
            n += 1;
            el.textContent = base + word.slice(0, n);
            if (n < word.length) return;
            clearInterval(t);
            phone.typed += 1;
            busy = false;
            if (phone.typed >= D.phone.words.length) { finish(); return; }
            showSuggest(D.phone.along[phone.typed], false);
            if (queued > 0) { queued -= 1; type(); }
          }, G.dur(45));
        }
        function press(k) {
          if (!seq.alive() || lit >= D.phone.words.length) return;
          if (!k || !k.classList.contains('is-next')) { wrong(k); return; }
          G.hints.clear();
          A.sfx('button_press', 0.22);
          k.classList.remove('is-tap', 'is-urge');
          void k.offsetWidth;
          k.classList.add('is-tap');
          // The glow moves on at once, so a quick next tap is kept, never dropped.
          lit += 1;
          if (lit < D.phone.words.length) G.focus(glowAt(lit));
          else glowAt(-1);
          setHint();
          if (busy) queued += 1; else type();
        }
        function onClick(e) { var k = e.target.closest('.phone__key'); if (k && !k.disabled) press(k); }
        function onKey(e) {
          if (e.metaKey || e.ctrlKey || e.altKey || G.isInfoOpen() || !/^[a-z ]$/i.test(e.key)) return;
          var onKeyBtn = document.activeElement && document.activeElement.classList.contains('phone__key');
          if (e.key === ' ' && onKeyBtn) return; // the focused key's own click handles Space
          e.preventDefault();
          press(box.querySelector('.phone__key[data-key="' + e.key.toLowerCase() + '"]'));
        }
        function detach() {
          box.removeEventListener('click', onClick);
          window.removeEventListener('keydown', onKey);
          phone.stop = null;
        }
        function finish() {
          detach();
          keys.forEach(function (k) { k.disabled = true; k.tabIndex = -1; k.classList.remove('is-next', 'is-urge'); });
          $('phone').classList.remove('is-typing');
          $('phone').classList.add('is-done');
          G.task(null);
          resolve();
        }
        phone.stop = detach;
        box.addEventListener('click', onClick);
        window.addEventListener('keydown', onKey);
      });
    }

    function pickSuggestion(seq) {
      var btns = showSuggest(D.phone.suggestions, true);
      $('phone').classList.add('is-suggesting');
      focusGroup($('phoneSuggest'));
      G.hints.setContext({ line: 'k_hint_suggest', run: function () { btns.forEach(function (b) { G.pulse(b); }); } });
      G.task(D.tasks.suggest, PHONE_TASK);
      return seq.until(function (resolve) {
        var taken = false;
        btns.forEach(function (b) { b.onclick = function () { if (taken) return; taken = true; resolve(b); }; });
      }).then(function (b) {
        G.hints.clear();
        G.task(null);
        showPicked(b.dataset.word);
        A.sfx('choice_lock', 0.45);
        F.phonePick = b.dataset.word;
        G.announce('You tapped ' + b.dataset.word + '.');
      });
    }
    function showPicked(word) {
      $('phoneTyped').textContent = D.phone.words.join(' ') + ' ' + word;
      $('phone').classList.remove('is-suggesting');
      Array.prototype.forEach.call($('phoneSuggest').children, function (x) {
        x.disabled = true;
        x.classList.add(x.dataset.word === word ? 'is-picked' : 'is-dim');
      });
    }
    function showPhoneQ(locked) {
      $('phonePrompt').textContent = D.phone.prompt;
      $('phoneOptions').setAttribute('aria-label', D.phone.prompt);
      var btns = renderGuess($('phoneOptions'), 'phone', 'option--guess', locked);
      $('phoneQ').classList.add('is-on');
      return btns;
    }

    /*
     * First interaction: the learner taps the glowing orb in the pod to wake
     * Blip. It is a real button, so Enter/Space work; it is disabled otherwise.
     */
    var wake = null;
    function endWake() {
      var orb = $('podOrb');
      if (wake) orb.removeEventListener('click', wake);
      wake = null;
      orb.disabled = true;
      $('pod').classList.remove('is-waiting');
    }
    function wakePod(seq) {
      var orb = $('podOrb');
      endWake();
      orb.disabled = false;
      $('pod').classList.add('is-waiting');
      G.focus(orb);
      G.hints.setContext({ line: 'k_pod_hint', run: function () { G.pulse(orb); } });
      G.task(D.tasks.wake, { x: 340, y: 610 }); // just under the pod
      return seq.until(function (resolve) {
        wake = function () {
          if (!seq.alive()) { endWake(); return; }
          endWake();
          G.hints.clear();
          G.task(null);
          A.sfx('button_press', 0.45);
          resolve();
        };
        orb.addEventListener('click', wake);
      });
    }

    function renderTray(n) {
      var tray = G.clear($('tray'));
      for (var i = 0; i < D.trials.length; i++) {
        var li = G.el('li', 'tray__slot');
        if (i < n) { li.appendChild(chip(D.trials[i].result, 'chip--tray')); li.classList.add('is-filled'); }
        tray.appendChild(li);
      }
    }

    function blipBeam(svg, toEl, cls) {
      return G.beam(svg, G.point($('blipPod'), 0.5, 0.42), G.point(toEl, 0.5, 0.5), cls || 'beam--blip', { bend: -0.12 });
    }

    /* Blip "thinks": pod pulses, a beam carries data to the phrase slot. */
    function processBlip(phrase, extra) {
      var pod = $('pod');
      pod.classList.add('is-processing');
      phrase.processing(true);
      A.sfx('prediction_process', 0.5);
      var beam = blipBeam($('labBeams'), phrase.slot);
      if (extra) extra();
      return G.wait(1150).then(function () {
        pod.classList.remove('is-processing');
        beam.classList.add('is-fading');
        setTimeout(function () { beam.remove(); }, 600);
      });
    }

    /* ======================================================================
       TITLE
       ====================================================================== */
    M.register('TITLE', function (seq) {
      hud(false);
      K.setMode('hidden', 'left', { instant: true });
      document.querySelector('.scene--title').classList.remove('is-launching');
      // The generated key-art logo is decorative; the same mission name remains
      // available as real HTML for assistive technology.
      var title = G.clear($('titleName'));
      var logo = document.createElement('img');
      logo.className = 'title__logo';
      logo.src = 'assets/images/ui/logo_autocomplete_trap.webp';
      logo.alt = '';
      logo.draggable = false;
      title.appendChild(logo);
      title.appendChild(G.text('span', 'sr-only', D.title));
      G.showScene('title', 'title', 'instant').then(function () { G.bgLayer().classList.add('is-dormant'); });
      var btn = $('startBtn');
      // Start stays hidden and disabled until the preloader has every asset.
      ATG.preload.ready.then(function () { btn.disabled = false; });
      return seq.until(function (resolve) {
        btn.addEventListener('click', function onStart() {
          if (btn.disabled || !ATG.preload.done) return;
          btn.disabled = true; // double-Start guard
          btn.removeEventListener('click', onStart);
          A.unlock();          // inside the gesture: unlocks audio and starts BGM
          A.sfx('button_press', 0.5);
          resolve();
        });
      }).then(function () { M.next(); });
    });

    /* ======================================================================
       KRISH_INTRO — lab powers up, Krish arrives beside a phone.
       ====================================================================== */
    M.register('KRISH_INTRO', async function (seq) {
      M.lock();
      G.preloadAll();
      A.preloadLines(['k_greet', 'k_stakes', 'k_intro', 'k_type_hint', 'k_phone_pick', 'k_phone_ask', 'k_phone_ack', 'k_blip_intro', 'k_pod_hint', 'blip_hello', 'k_stakes', 'k_prediction_setup']);
      document.querySelector('.scene--title').classList.add('is-launching');
      await G.wait(650);
      $('titleName').textContent = ''; // the mission name never persists past the title state
      resetLab({ sealed: true, phone: true });
      await G.setBg('lab', { cls: 'is-dim', ms: 900 });
      G.showScene('lab', 'lab', 'instant');
      hud(true);
      G.startTimer();
      G.progress.setCurrent(0);
      await G.nextFrame();
      G.bgLayer().classList.remove('is-dim');
      $('conduits').classList.add('is-live');
      A.sfx('memory_open', 0.45);
      await seq.wait(700);
      M.unlock();
      K.rest('idle');
      await seq.run(K.enter('guide', 'right', 'right'));
      // Krish says hello, then the stakes land before the learner is asked to do anything.
      await G.krishSay(seq, 'k_greet', 'talk');
      await playStakesStory(seq);
      await seq.wait(300);
      $('phone').classList.add('is-on');
      await seq.wait(400);
      // The keys unlock while Krish is still talking, so the first tap comes early.
      K.say('k_intro', 'talk');
      await seq.wait(1200);
      M.next();
    });

    /* ======================================================================
       PHONE_HOOK — type "I want to eat a", tap a suggestion, guess where
       suggestions come from (unscored).
       ====================================================================== */
    M.register('PHONE_HOOK', async function (seq, ctx) {
      if (ctx.rerender) {
        M.lock();
        resetLab({ sealed: true, phone: true });
        await G.showScene('lab', 'lab', 'fade');
        $('phone').classList.add('is-on');
        M.unlock();
      }
      if (F.phoneDone) {
        // Review after Back: the message, the tapped suggestion and the guess stay as they were.
        K.setMode('companion', 'left');
        K.rest('idle');
        $('phone').classList.add('is-done');
        showSuggest(D.phone.suggestions, true);
        showPicked(F.phonePick);
        showPhoneQ(F.phoneGuess);
        await G.cta(seq, $('phoneCta'), 'Continue');
        M.next();
        return;
      }
      K.setMode('guide', 'right');
      await typePhone(seq);
      K.rest('idle');
      await seq.wait(300);
      // Listen before the line starts so a quick tap still counts.
      var picked = pickSuggestion(seq);
      K.say('k_phone_pick', 'point');
      await picked;
      if (A.currentLine && A.currentLine.id === 'k_phone_pick') A.stopVoice();
      await seq.wait(600);
      K.setMode('companion', 'left');
      await G.krishSay(seq, 'k_phone_ask', 'think');
      var btns = showPhoneQ(null);
      focusGroup($('phoneOptions'));
      G.hints.setContext({ line: 'k_hint_phone_guess', run: function () { btns.forEach(function (b) { G.pulse(b); }); } });
      var b = await pickOne(seq, btns);
      F.phoneGuess = b.dataset.id;
      G.announce('Your guess: ' + b.textContent + '.');
      await G.krishSay(seq, 'k_phone_ack', 'encourage');
      F.phoneDone = true;
      await seq.wait(300);
      M.next();
    });

    /* ======================================================================
       BLIP_BOOT — Blip is "a tiny version of this". The learner taps the
       sealed pod, Blip boots and speaks, then the stakes and the test.
       ====================================================================== */
    M.register('BLIP_BOOT', async function (seq, ctx) {
      if (ctx.rerender) {
        M.lock();
        resetLab({ sealed: true });
        await G.showScene('lab', 'lab', 'fade');
        M.unlock();
      }
      $('phoneQ').classList.remove('is-on');
      K.setMode('guide', 'right');
      $('console').className = 'console';
      P.pod.play('off');
      K.rest('point');
      // The phone stays in view while Krish names Blip as a tiny version of it.
      if (!ctx.rerender) await G.krishSay(seq, 'k_blip_intro', 'point');
      // One focus for the action: the phone leaves and Krish walks over to point at the pod.
      if (!$('phone').hidden) {
        $('phone').classList.add('is-leaving');
        setTimeout(function () { if (seq.alive()) $('phone').hidden = true; }, G.dur(500));
      }
      K.setPose('enter');
      await seq.run(K.setMode('guide', 'pod', { duration: 900 }));
      K.rest('point');
      var woken = wakePod(seq);
      if (ctx.rerender) K.say('k_pod_hint', 'point');
      await woken;
      if (A.currentLine && A.currentLine.id === 'k_pod_hint') A.stopVoice(); // tap cuts the reminder short
      K.rest('idle');
      K.setMode('guide', 'right'); // clears the floor for Blip's line
      $('pod').classList.remove('is-sealed');
      $('pod').classList.add('is-revealed');
      A.sfx('memory_open', 0.3);
      await seq.wait(450);
      A.sfx('character_boot', 0.55);
      $('pod').classList.add('is-booting');
      await seq.run(G.withBusy(P.pod.play('boot')));
      $('pod').classList.remove('is-booting');
      A.preloadLines(['k_sentence_1', 'k_predict_ask', 'k_options_1', 'k_sentence_2', 'k_options_2', 'k_react_reasonable', 'k_react_hmm', 'k_react_again', 'blip_tada', 'blip_hmm', 'blip_oops', 'k_predict_hint']);
      await G.charSay(seq, 'blip_hello', P.pod, 'talk');
      await seq.wait(300);
      // The stakes already played before the phone (KRISH_INTRO): problem first.
      K.setMode('companion', 'left');
      await seq.wait(400);
      await G.krishSay(seq, 'k_prediction_setup', 'talk');
      $('console').classList.add('is-on');
      A.sfx('memory_open', 0.25);
      labPhrase.setPip(0);
      await seq.wait(400);
      await G.cta(seq, $('labCta'), 'Try It');
      M.next();
    });

    /* ======================================================================
       PREDICTION_RUN — three trials through one reusable machine.
       ====================================================================== */
    /*
     * Krish reads the options ("Pizza... sandwich... or burger?") and each
     * button appears as its word starts, using cues from js/vo-cues.js. The
     * clock follows the voice; without audio it falls back to wall time.
     * Returns a stop function that shows any options still hidden.
     */
    function revealOptions(seq, btns, lineId) {
      var cues = (ATG.VO_CUES || {})[lineId] || btns.map(function (b, k) { return k * 0.9; });
      var shown = 0, t0 = performance.now(), heard = false, raf = 0;
      function show(n, quiet) {
        while (shown < Math.min(n, btns.length)) {
          var b = btns[shown++];
          b.classList.add('is-shown');
          b.removeAttribute('tabindex');
          if (!quiet) A.sfx('button_hover', 0.2);
        }
      }
      function tick() {
        if (!seq.alive()) return;
        var v = A.voice, sec;
        if (A.currentLine && A.currentLine.id === lineId && v && !v.paused && v.currentTime > 0) { heard = true; sec = v.currentTime; }
        else if (!heard) sec = (performance.now() - t0) / 1000;
        if (sec != null) show(cues.filter(function (c) { return sec >= c - 0.05; }).length);
        if (shown < btns.length) raf = requestAnimationFrame(tick);
      }
      btns.forEach(function (b) { b.tabIndex = -1; });
      K.say(lineId, 'talk').then(function () { show(btns.length); });
      raf = requestAnimationFrame(tick);
      return function stop() {
        cancelAnimationFrame(raf);
        if (A.currentLine && A.currentLine.id === lineId) A.stopVoice();
        show(btns.length, true);
      };
    }

    async function runTrial(seq, i) {
      var t = D.trials[i];
      var choices = $('choices');
      var instruction = $('predictionInstruction');
      instruction.hidden = false;
      $('predictionPrompt').textContent = 'Which word do you think Blip will choose?';
      $('predictionNote').textContent = 'Any prediction is okay.';
      labPhrase.setPip(i);
      G.clear(choices);
      choices.classList.remove('is-on');
      choices.classList.add('is-staged');
      if (i + 1 < D.trials.length) A.preloadLines(['k_sentence_' + (i + 2), 'k_options_' + (i + 2)]);
      // Krish reads the sentence while it types in.
      await seq.run(Promise.all([labPhrase.set(t.prompt, { type: true }), K.say('k_sentence_' + (i + 1), 'talk')]));
      if (i === 0) await G.krishSay(seq, 'k_predict_ask', 'talk');
      var btns = t.options.map(function (w, k) {
        var b = G.button(w, 'choice');
        b.dataset.word = w;
        b.style.setProperty('--i', k);
        b.setAttribute('aria-pressed', 'false');
        choices.appendChild(b);
        return b;
      });
      choices.setAttribute('aria-label', labPhrase.text() + ' — your prediction');
      // Listen immediately so a quick first tap during the entrance still counts.
      var picked = seq.until(function (resolve) {
        var taken = false;
        btns.forEach(function (b) {
          b.addEventListener('click', function () {
            if (taken) return; // duplicate submit guard
            taken = true;
            resolve(b);
          });
        });
      });
      await G.nextFrame();
      choices.classList.add('is-on');
      var stopReveal = revealOptions(seq, btns, 'k_options_' + (i + 1));
      // Private nudge after two different guesses: point at Blip's earlier
      // answers (the evidence), never at the word Blip is about to pick.
      if (F.predictionMisses >= 2) G.pulse($('tray'), 'is-hinted');
      focusGroup(choices);
      G.hints.setContext({
        line: 'k_predict_hint', pose: 'encourage',
        run: function () { btns.forEach(function (b) { G.pulse(b); }); }
      });
      var pick = await picked;
      stopReveal();
      G.hints.clear();
      btns.forEach(function (b) {
        b.disabled = true;
        b.classList.add(b === pick ? 'is-locked' : 'is-dim');
      });
      pick.setAttribute('aria-pressed', 'true');
      A.sfx('choice_lock', 0.5);
      $('predictionPrompt').textContent = 'Your prediction: ' + pick.dataset.word;
      $('predictionNote').textContent = 'Now watch what Blip chooses.';
      G.announce('You predicted ' + pick.dataset.word + '. Blip is thinking.');

      await seq.run(G.withBusy(processBlip(labPhrase)));

      labPhrase.fill(t.result, 'is-blip');
      A.sfx('prediction_reveal', 0.55);
      var blipBtn = btns.filter(function (b) { return b.dataset.word === t.result; })[0];
      if (blipBtn) blipBtn.classList.add('is-blip-pick');
      if (blipBtn === pick) pick.classList.add('is-match');
      else F.predictionMisses += 1;
      $('predictionPrompt').textContent = 'Blip chose: ' + t.result;
      $('predictionNote').textContent = 'Your prediction: ' + pick.dataset.word + '.';
      G.announce('Blip predicted ' + t.result + '.');
      P.pod.play(t.blip);
      await seq.wait(250);
      if (t.blipLine) await G.charSay(seq, t.blipLine, null);
      await G.krishSay(seq, t.krish, t.krishPose);

      var slot = $('tray').children[i];
      await seq.run(G.withBusy(G.fly(labPhrase.slot, slot, chip(t.result, 'chip--tray'), { arc: -30, ms: 620 })));
      slot.appendChild(chip(t.result, 'chip--tray'));
      slot.classList.add('is-filled', 'is-new');
      A.sfx('data_collect', 0.3);
      F.trialIndex = i + 1;
      await seq.wait(420);
      choices.classList.remove('is-on');
      await seq.wait(320);
    }

    M.register('PREDICTION_RUN', async function (seq) {
      var n = D.trials.length;
      K.setMode('companion', 'left');
      K.rest('idle');
      var con = $('console');
      con.classList.add('is-on', 'is-run');
      if (F.trialsDone) {
        // Review after Back: the experiment already ran; nothing is re-scored.
        $('predictionInstruction').hidden = true;
        renderTray(n);
        labPhrase.set(D.trials[n - 1].prompt);
        labPhrase.fill(D.trials[n - 1].result, 'is-blip');
        labPhrase.setPip(n);
        await G.cta(seq, $('labCta'), 'Continue');
        M.next();
        return;
      }
      renderTray(0);
      F.trialIndex = 0;
      for (var i = 0; i < n; i++) await runTrial(seq, i);
      labPhrase.setPip(n);
      F.trialsDone = true;
      await seq.wait(400);
      $('predictionInstruction').hidden = true;
      M.next();
    });

    /* ======================================================================
       CAUSE_GUESS — Blip's finished sentences become evidence, then one
       unscored guess about the cause. It comes back in Blip's memory.
       ====================================================================== */
    function buildEvidence() {
      var box = G.clear($('evidenceRows'));
      return D.trials.map(function (t, i) {
        var row = G.el('div', 'ev-row');
        row.setAttribute('role', 'listitem');
        row.setAttribute('aria-label', t.prompt.replace('___', t.result));
        row.style.setProperty('--i', i);
        row.appendChild(G.text('span', 'ev-row__text', t.prompt.split('___')[0].trim()));
        var slot = G.el('span', 'ev-row__slot');
        slot.appendChild(chip(t.result, 'chip--ev'));
        row.appendChild(slot);
        box.appendChild(row);
        return slot;
      });
    }

    function markCorrect(b, revealed) {
      b.classList.remove('is-dim');
      b.classList.add('is-correct');
      if (revealed) b.classList.add('is-revealed');
      b.insertAdjacentHTML('beforeend', '<span class="mark mark--ok" aria-hidden="true"></span>');
    }

    function showCauseQ(locked) {
      $('causePrompt').textContent = D.cause.prompt;
      $('causeOptions').setAttribute('aria-label', D.cause.prompt);
      if (locked) $('causeNote').textContent = 'Your guess is saved. Let’s test it.';
      var btns = renderGuess($('causeOptions'), 'cause', 'option--guess', locked);
      $('causeQ').classList.add('is-on');
      return btns;
    }

    M.register('CAUSE_GUESS', async function (seq, ctx) {
      M.lock();
      if (ctx.rerender) {
        resetLab({ sealed: false });
        P.pod.play('idle');
        await G.showScene('lab', 'lab', 'fade');
      }
      var trayChips = ctx.rerender ? [] : Array.prototype.map.call($('tray').children, function (li) { return li.firstChild; }).filter(Boolean);
      var slots = buildEvidence();
      var ev = $('evidence');
      ev.classList.add('is-on');
      if (trayChips.length === D.trials.length) {
        ev.classList.add('is-arriving');
        await G.nextFrame();
        var flights = trayChips.map(function (c, i) {
          return G.wait(i * 90).then(function () {
            return G.fly(c, slots[i], chip(D.trials[i].result, 'chip--ev chip--flying'), { ms: 720, arc: -60 });
          });
        });
        $('console').classList.remove('is-on');
        await G.withBusy(Promise.all(flights));
        ev.classList.remove('is-arriving');
      } else {
        $('console').classList.remove('is-on');
      }
      M.unlock();
      A.preloadLines(['k_cause_prompt', 'k_cause_idle', 'k_cause_saved', 'k_pattern_stakes']);

      if (F.causeGuess) {
        K.setMode('companion', 'left');
        showCauseQ(F.causeGuess);
        await G.cta(seq, $('causeCta'), 'Continue');
        M.next();
        return;
      }

      P.pod.play('confused');
      K.setMode('guide', 'right');
      K.rest('think');
      await seq.wait(600);
      await G.krishSay(seq, 'k_cause_prompt', 'think');
      K.rest('idle');
      K.setMode('companion', 'left');
      await seq.wait(300);
      var btns = showCauseQ(null);
      focusGroup($('causeOptions'));
      G.hints.setContext({ line: 'k_cause_idle', run: function () { btns.forEach(function (b) { G.pulse(b); }); } });
      var b = await pickOne(seq, btns);
      F.causeGuess = b.dataset.id;
      $('causeNote').textContent = 'Your guess is saved. Let’s test it.';
      G.announce('Your guess: ' + b.textContent + '.');
      G.progress.complete(0);
      await G.krishSay(seq, 'k_cause_saved', 'encourage');
      // Stakes beat: tie the pattern back to the children who will use Blip.
      P.pod.play('awkward');
      await G.krishSay(seq, 'k_pattern_stakes', 'serious');
      await seq.wait(250);
      M.next();
    });

    /* ======================================================================
       MEMORY_DIVE — Krish scans Blip; the camera follows a pulse inside.
       ====================================================================== */
    M.register('MEMORY_DIVE', async function (seq) {
      M.lock();
      K.setMode('companion', 'left');
      resetLab({ sealed: false });
      P.pod.play('idle');
      G.particleTint = '120, 230, 255';
      await G.showScene('lab', 'lab', 'fade');
      M.unlock();
      A.preloadLines(['k_memory_instruction', 'k_memory_after', 'k_memory_miss', 'k_guess_right', 'k_guess_other', 'k_memory_complete']);
      // Straight in: Krish's last line already said "Now let's find out why."
      $('pod').classList.add('is-scanning');
      A.sfx('memory_open', 0.5);
      await seq.wait(450);
      var orb = G.el('div', 'pulse-orb');
      await seq.run(G.withBusy(G.flyNode(orb, { x: 928, y: 720, w: 64, h: 64 }, { x: 303, y: 300, w: 64, h: 64 }, { ms: 750, arc: -140, scale: 1 })));
      $('pod').classList.add('is-flare');
      A.sfx('prediction_reveal', 0.4);
      await seq.wait(300);
      M.lock();
      K.setMode('companion', 'left');
      K.rest('idle');
      resetMemory();
      G.diveFocus = { x: 335, y: 330 };
      await G.showScene('memory', 'memory', 'dive');
      $('pod').classList.remove('is-scanning', 'is-flare');
      M.unlock();
      M.next();
    });

    /* ======================================================================
       MEMORY_SCAN — for each answer, find the words Blip looked up, then
       the word that came right after them.
       ====================================================================== */
    var memory = { active: false, resolve: null, step: 'phrase', row: 0, misses: 0, afterSaid: false, words: [], strips: [] };

    /* Where `key` sits in a list of word strips: the matched words and the word after. */
    function locate(strips, key) {
      for (var s = 0; s < strips.length; s++) {
        var ws = strips[s];
        for (var j = 0; j + key.length < ws.length; j++) {
          if (key.every(function (k, n) { return ws[j + n].dataset.word === k; })) return { pair: ws.slice(j, j + key.length), next: ws[j + key.length] };
        }
      }
      return null;
    }
    function rowTarget(i) { return locate(memory.strips, G.keyOf(D.trials[i].prompt)); }
    function saidRows() { return $('saidList').children; }

    function setRow(i) {
      Array.prototype.forEach.call(saidRows(), function (r, k) {
        r.classList.toggle('is-done', k < F.memoryFound);
        r.classList.toggle('is-current', k === i && memory.active);
      });
    }

    function resetMemory() {
      var strips = G.clear($('strips'));
      G.clear($('memoryBeams'));
      memory.active = false;
      memory.step = 'phrase';
      memory.row = 0;
      memory.misses = 0;
      memory.afterSaid = false;
      memory.words = [];
      memory.strips = [];
      $('guessCard').hidden = true;
      $('guessCard').className = 'guess-card';
      var said = G.clear($('saidList'));
      D.trials.forEach(function (t, i) {
        var row = G.el('div', 'said-row');
        row.style.setProperty('--i', i);
        row.setAttribute('aria-label', t.prompt.replace('___', t.result));
        var ph = G.el('span', 'said-row__phrase');
        G.Phrase.markKey(ph, t.prompt.split('___')[0].trim(), D.keyWords);
        row.appendChild(ph);
        var out = G.el('span', 'said-row__out');
        out.appendChild(G.el('span', 'said-row__arrow'));
        out.appendChild(chip(t.result, 'chip--said'));
        row.appendChild(out);
        said.appendChild(row);
      });
      var list = D.blipMemory.slice();
      if (F.repairResolved) list.push(correctOf(D.repair.cartridges).label);
      list.forEach(function (sentence, si) {
        var added = si >= D.blipMemory.length;
        var strip = G.el('div', 'strip' + (added ? ' strip--added' : ''));
        strip.style.setProperty('--i', si);
        strip.setAttribute('role', 'group');
        strip.setAttribute('aria-label', sentence);
        var ws = [];
        sentence.split(' ').forEach(function (w) {
          var b = G.el('button', 'mword');
          b.type = 'button';
          b.textContent = w;
          b.dataset.word = norm(w);
          b.tabIndex = -1;
          if (added) b.disabled = true;
          strip.appendChild(b);
          ws.push(b);
          if (!added) memory.words.push(b);
        });
        if (!added) memory.strips.push(ws);
        strips.appendChild(strip);
      });
      if (memory.words[0]) memory.words[0].tabIndex = 0;
      $('bank').classList.remove('is-complete', 'is-active');
    }

    function setMemoryHint() {
      var key = G.keyOf(D.trials[memory.row].prompt).join(' ');
      G.task(G.taskText(memory.step === 'phrase' ? 'memoryFind' : 'memoryNext', { key: key }), { x: 1188, y: 740 });
      G.hints.setContext({
        line: memory.step === 'phrase' ? 'k_hint_mem_find' : 'k_hint_mem_next',
        run: function () {
          var tgt = rowTarget(memory.row);
          G.pulse(saidRows()[memory.row]);
          if (memory.step === 'phrase') tgt.pair.forEach(function (w) { G.pulse(w, 'is-shimmer'); });
          else G.pulse(tgt.next, 'is-shimmer');
        }
      });
    }

    function softMiss(btn) {
      btn.classList.remove('is-miss');
      void btn.offsetWidth;
      btn.classList.add('is-miss');
      A.sfx('wrong_soft', 0.16);
    }

    /* Show a completed row: the looked-up words boxed, the next word lit, a link to Blip's answer. */
    function settleRow(i, animate) {
      var tgt = rowTarget(i), row = saidRows()[i];
      tgt.pair.forEach(function (w) { w.classList.add('is-key'); });
      tgt.next.classList.add('is-found');
      var beam = G.beam($('memoryBeams'), G.point(tgt.next.parentNode, 0, 0.5), G.point(row, 1, 0.5), 'beam--link', { bend: 0.08 });
      if (!animate) beam.classList.add('is-instant', 'is-settled');
      else setTimeout(function () { beam.classList.add('is-settled'); }, 900);
      row.classList.add('is-done');
    }

    function onWord(btn) {
      if (!memory.active || btn.disabled) return;
      var tgt = rowTarget(memory.row);
      if (memory.step === 'phrase') {
        if (tgt.pair.indexOf(btn) < 0) {
          softMiss(btn);
          // Tapping every word is not searching: point back at the glowing words.
          memory.misses += 1;
          if (memory.misses === 1 || memory.misses % 3 === 1) G.pulse(saidRows()[memory.row]);
          if (memory.misses === 1 || memory.misses === 4) K.say('k_memory_miss', 'point');
          return;
        }
        tgt.pair.forEach(function (w) { w.classList.add('is-key'); });
        A.sfx('choice_lock', 0.4);
        memory.step = 'next';
        memory.misses = 0;
        G.announce('Found ' + tgt.pair.map(function (w) { return w.textContent; }).join(' ') + '. Now tap the word right after.');
        if (!memory.afterSaid) { memory.afterSaid = true; K.say('k_memory_after', 'point'); }
        setMemoryHint();
        return;
      }
      if (btn !== tgt.next) {
        if (tgt.pair.indexOf(btn) < 0) softMiss(btn);
        memory.misses += 1;
        if (memory.misses === 2) G.pulse(tgt.next, 'is-shimmer');
        return;
      }
      // The word right after: it flies to Blip's answer on the left.
      memory.active = false;
      var i = memory.row, row = saidRows()[i];
      btn.classList.add('is-found');
      A.sfx('choice_lock', 0.35);
      var flyer = G.el('span', 'flyer-wrap');
      if (TOK[btn.dataset.word]) flyer.appendChild(tokenImg(btn.dataset.word, 'flyer-token'));
      else flyer.appendChild(G.text('span', 'flyer-word', btn.dataset.word));
      var target = row.querySelector('.chip--said');
      G.withBusy(G.flyNode(flyer, G.rect(btn), G.rect(target), { ms: 680, arc: -90 })).then(function () {
        settleRow(i, true);
        A.sfx('data_collect', 0.5);
        var r = G.rect(target);
        G.burst(r.cx, r.cy, { radius: 90, count: 4 });
        F.memoryFound = i + 1;
        G.announce('Blip saw ' + btn.dataset.word + ' right after those words. ' + F.memoryFound + ' of ' + D.trials.length + '.');
        if (F.memoryFound >= D.trials.length) {
          setRow(-1);
          var done = memory.resolve;
          memory.resolve = null;
          if (done) done();
          return;
        }
        memory.row = F.memoryFound;
        memory.step = 'phrase';
        memory.misses = 0;
        memory.active = true;
        setRow(memory.row);
        setMemoryHint();
      });
    }

    // One tab stop for the memory strips; arrows move between words.
    $('strips').addEventListener('keydown', function (e) {
      var i = memory.words.indexOf(document.activeElement);
      if (i < 0) return;
      var next = null;
      if (e.key === 'ArrowRight') next = memory.words[i + 1];
      if (e.key === 'ArrowLeft') next = memory.words[i - 1];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var strip = document.activeElement.parentNode;
        var sib = e.key === 'ArrowDown' ? strip.nextElementSibling : strip.previousElementSibling;
        if (sib && sib.firstChild && !sib.firstChild.disabled) next = sib.firstChild;
      }
      if (next) {
        e.preventDefault();
        memory.words.forEach(function (b) { b.tabIndex = -1; });
        next.tabIndex = 0;
        next.focus();
      }
    });
    $('strips').addEventListener('click', function (e) {
      var b = e.target.closest('.mword');
      if (b) onWord(b);
    });

    /* The cause guess from the lab comes back once the evidence is found. */
    function showGuessCard() {
      var opt = D.cause.options.filter(function (o) { return o.id === F.causeGuess; })[0];
      if (!opt) return;
      $('guessText').textContent = '“' + opt.label + '”';
      $('guessResult').textContent = opt.correct ? D.cause.confirmed : D.cause.other;
      var card = $('guessCard');
      card.className = 'guess-card ' + (opt.correct ? 'is-right' : 'is-other');
      card.hidden = false;
    }

    M.register('MEMORY_SCAN', async function (seq, ctx) {
      if (ctx.rerender) {
        M.lock();
        resetMemory();
        await G.showScene('memory', 'memory', 'fade');
        M.unlock();
      }
      K.setMode('companion', 'left');
      K.rest('idle');
      if (F.memoryDone) {
        D.trials.forEach(function (t, i) { settleRow(i, false); });
        $('bank').classList.add('is-complete');
        showGuessCard();
        await G.cta(seq, $('memoryCta'), 'Continue');
        M.next();
        return;
      }
      F.memoryFound = 0;
      // "Find the glowing words": light the first row's boxed words in Blip said
      // while Krish says it, so the line points at the panel, not at the memory.
      var firstRow = saidRows()[0];
      firstRow.classList.add('is-current', 'is-pointing');
      try { await G.krishSay(seq, 'k_memory_instruction', 'talk'); }
      finally { firstRow.classList.remove('is-pointing'); }
      memory.active = true;
      $('bank').classList.add('is-active');
      setRow(0);
      G.focus(memory.words[0]);
      setMemoryHint();
      await seq.until(function (resolve) { memory.resolve = resolve; });
      G.hints.clear();
      G.task(null);
      $('bank').classList.remove('is-active');
      $('bank').classList.add('is-complete');
      await seq.wait(600);
      showGuessCard();
      A.sfx('memory_open', 0.3);
      var guessOpt = D.cause.options.filter(function (o) { return o.id === F.causeGuess; })[0];
      if (guessOpt) await G.krishSay(seq, guessOpt.correct ? 'k_guess_right' : 'k_guess_other', guessOpt.correct ? 'happy' : 'think');
      K.rest('happy');
      await G.krishSay(seq, 'k_memory_complete', 'happy');
      K.rest('idle');
      F.memoryDone = true;
      G.progress.complete(1);
      await G.cta(seq, $('memoryCta'), 'Continue');
      M.next();
    });

    /* ======================================================================
       REPAIR_BAY — insert one data cartridge into Blip's memory.
       ====================================================================== */
    var repair = { pending: null, carts: [] };

    function resetRepair() {
      repairPhrase.set(D.repair.prompt, { key: D.keyWords });
      var want = G.clear($('repairWant'));
      want.appendChild(chip(D.repair.desired, 'chip--want'));
      G.clear($('repairBeams'));
      $('rack').className = 'rack';
      $('dockPort').className = 'dock-port';
      var toks = G.clear($('rackTokens'));
      suggestWords().forEach(function (w) {
        var t = G.el('span', 'rack__token' + (w === D.repair.desired ? ' is-missing' : ''));
        t.dataset.word = w;
        t.appendChild(tokenImg(w, 'rack__img'));
        toks.appendChild(t);
      });
      var ul = G.clear($('rackStrips'));
      D.blipMemory.forEach(function (s) { ul.appendChild(G.text('li', 'rack__strip', s)); });
      var empty = G.el('li', 'rack__strip rack__strip--empty');
      empty.setAttribute('aria-hidden', 'true');
      ul.appendChild(empty);
      var box = G.clear($('cartridges'));
      box.setAttribute('aria-label', 'Data cartridges');
      repair.carts = ordered('repair').map(function (c, i) {
        var b = G.el('button', 'cartridge');
        b.type = 'button';
        b.dataset.id = c.id;
        b.style.setProperty('--i', i);
        b.innerHTML = '<span class="cartridge__shell" aria-hidden="true"><span class="cartridge__pins"></span><span class="cartridge__led"></span></span>';
        b.appendChild(G.text('span', 'cartridge__label', c.label));
        b.setAttribute('aria-label', 'Add memory: ' + c.label);
        b.disabled = true;
        box.appendChild(b);
        if (F.repairRejected.indexOf(c.id) >= 0) markRetryCart(b);
        return b;
      });
      P.repair.play('idle');
    }
    function markRetryCart(b) {
      b.classList.add('is-rejected');
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      b.insertAdjacentHTML('beforeend', '<span class="mark mark--miss" aria-hidden="true"></span>');
    }

    function flyCart(cart, back) {
      var shell = cart.cloneNode(true);
      shell.classList.add('cartridge--flyer');
      var a = G.rect(cart), port = G.rect($('dockPort'));
      var b = { x: port.cx - a.w * 0.3, y: port.cy - a.h * 0.3, w: a.w * 0.6, h: a.h * 0.6 };
      cart.classList.add('is-away');
      return G.flyNode(shell, a, b, { ms: 620, arc: -110, scale: 0.6, keep: back }).then(function (node) {
        if (!back) return;
        $('dockPort').classList.add('is-reject');
        A.sfx('cartridge_eject', 0.5);
        return G.wait(380).then(function () {
          node.getAnimations && node.getAnimations().forEach(function (an) { an.cancel(); });
          return G.flyNode(node, b, a, { ms: 560, arc: -60, scale: 1 / 0.6 });
        }).then(function () {
          $('dockPort').classList.remove('is-reject');
          cart.classList.remove('is-away');
        });
      });
    }

    function insertCart(cart) {
      return flyCart(cart, false).then(function () {
        cart.classList.add('is-inserted');
        $('dockPort').classList.add('is-accept');
        A.sfx('cartridge_insert', 0.6);
      });
    }

    /* Blip's memory visibly changes: core opens, a new strip joins, pizza activates. */
    function applyRepair(instant) {
      var rack = $('rack');
      var ul = $('rackStrips');
      var empty = ul.querySelector('.rack__strip--empty');
      if (empty) empty.remove();
      var li = G.text('li', 'rack__strip rack__strip--new', correctOf(D.repair.cartridges).label);
      ul.appendChild(li);
      rack.classList.add('is-open', 'is-updated');
      if (instant) rack.classList.add('is-instant');
      var pizza = $('rackTokens').querySelector('[data-word="' + D.repair.desired + '"]');
      pizza.classList.remove('is-missing');
      pizza.classList.add('is-active');
      $('repairWant').classList.add('is-lit');
      if (!instant) {
        A.sfx('memory_open', 0.45);
        return G.wait(700).then(function () {
          G.beam($('repairBeams'), G.point(li, 0, 0.5), G.point(repairPhrase.slot, 0.5, 1), 'beam--gold', { bend: -0.25 });
          A.sfx('logic_link', 0.4);
          return G.wait(900);
        });
      }
      G.beam($('repairBeams'), G.point(li, 0, 0.5), G.point(repairPhrase.slot, 0.5, 1), 'beam--gold', { bend: -0.25 });
      return Promise.resolve();
    }

    function bindCarts(onPick) {
      repair.carts.forEach(function (b) {
        if (b.classList.contains('is-rejected')) return;
        b.disabled = false;
        b.onclick = function () {
          if (b.dataset.suppressClick) { delete b.dataset.suppressClick; return; }
          if (b.disabled) return;
          onPick(b);
        };
        // Drag is optional; tapping a cartridge is the primary action.
        b.onpointerdown = function (e) {
          if (b.disabled || e.button > 0) return;
          var sx = e.clientX, sy = e.clientY, moved = false;
          try { b.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
          b.onpointermove = function (ev) {
            var dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (!moved && Math.hypot(dx, dy) > 10) { moved = true; b.classList.add('is-dragging'); }
            if (moved) b.style.translate = (dx / G.view.scale) + 'px ' + (dy / G.view.scale) + 'px';
          };
          b.onpointerup = b.onpointercancel = function (ev) {
            b.onpointermove = b.onpointerup = b.onpointercancel = null;
            b.classList.remove('is-dragging');
            if (!moved) return;
            b.dataset.suppressClick = '1';
            var r = $('dockPort').getBoundingClientRect(), pad = 90 * G.view.scale;
            var hit = ev.clientX > r.left - pad && ev.clientX < r.right + pad && ev.clientY > r.top - pad && ev.clientY < r.bottom + pad;
            b.style.translate = '';
            if (hit && !b.disabled) onPick(b);
          };
        };
      });
    }
    function lockCarts() { repair.carts.forEach(function (b) { b.disabled = true; b.onclick = null; b.onpointerdown = null; }); }

    M.register('REPAIR_BAY', async function (seq, ctx) {
      M.lock();
      K.setMode('companion', 'left');
      resetRepair();
      await G.showScene('repair', 'repair', ctx.rerender ? 'fade' : 'surface');
      M.unlock();
      A.preloadLines(['k_repair_setup', 'k_repair_goal', 'k_repair_idle', 'k_repair_no_phrase', 'k_repair_wrong_word', 'k_repair_correct', 'k_repair_reveal', 'k_retest']);
      K.rest('idle');
      if (F.repairResolved) {
        var a = correctBtn(repair.carts, D.repair.cartridges);
        a.classList.add('is-inserted');
        $('dockPort').classList.add('is-accept');
        await applyRepair(true);
        await G.cta(seq, $('repairCta'), 'Continue');
        M.next();
        return;
      }
      await G.krishSay(seq, 'k_repair_setup', 'talk');
      await G.krishSay(seq, 'k_repair_goal', 'think');
      var chosenCorrect = false;
      G.task(G.taskText('repair', { word: D.repair.desired, key: G.keyOf(D.repair.prompt).join(' ') }), { x: 960, y: 862 });
      while (true) {
        G.hints.setContext({
          line: 'k_repair_idle', pose: 'think',
          run: function () { G.pulse($('repairPhrase')); }
        });
        var cart = await seq.until(function (resolve) {
          var taken = false;
          bindCarts(function (b) { if (taken) return; taken = true; resolve(b); });
          focusGroup($('cartridges'));
        });
        lockCarts();
        G.hints.clear();
        var def = D.repair.cartridges.filter(function (c) { return c.id === cart.dataset.id; })[0];
        if (def.correct) {
          await seq.run(G.withBusy(insertCart(cart)));
          chosenCorrect = true;
          break;
        }
        F.repairMisses += 1;
        F.repairRejected.push(def.id);
        A.sfx('wrong_soft', 0.35);
        await seq.run(G.withBusy(flyCart(cart, true)));
        markRetryCart(cart);
        if (F.repairMisses === 1) {
          // Say why this memory fails (wrong word, or the word not after "eat a"), never which one works.
          K.rest('encourage');
          await G.krishSay(seq, def.line, 'encourage');
          K.rest('idle');
        } else {
          // Guided resolution — never trap the learner.
          var correct = correctBtn(repair.carts, D.repair.cartridges);
          correct.classList.add('is-revealed');
          await G.krishSay(seq, 'k_repair_reveal', 'point');
          await seq.run(G.withBusy(insertCart(correct)));
          break;
        }
      }
      G.task(null);
      await seq.run(G.withBusy(applyRepair(false)));
      G.announce('Blip’s memory now has five sentences, including: ' + correctOf(D.repair.cartridges).label);
      P.repair.play('confident');
      if (chosenCorrect) {
        A.sfx('correct', 0.5);
        K.rest('happy');
        await G.krishSay(seq, 'k_repair_correct', 'happy');
        K.rest('idle');
      }
      F.repairResolved = true;
      await seq.wait(600);
      M.next();
    });

    /* ======================================================================
       RETEST — same machine, same phrase, changed data.
       ====================================================================== */
    /* Every word `sentences` show right after `key`, in order: the rule the mission teaches. */
    function seenAfter(sentences, key) {
      var out = [];
      sentences.forEach(function (s) {
        var ws = s.split(/\s+/).map(norm);
        for (var j = 0; j + key.length < ws.length; j++) {
          if (key.every(function (k, n) { return ws[j + n] === k; }) && out.indexOf(ws[j + key.length]) < 0) out.push(ws[j + key.length]);
        }
      });
      return out;
    }
    function repairedMemory() { return D.blipMemory.concat([correctOf(D.repair.cartridges).label]); }
    // The words Blip can suggest at all: every answer from the tests, plus the new one.
    function suggestWords() {
      var out = [];
      D.trials.forEach(function (t) { if (out.indexOf(t.result) < 0) out.push(t.result); });
      out.push(D.repair.desired);
      return out;
    }

    function buildPathways() {
      var box = G.clear($('pathways'));
      suggestWords().forEach(function (w) {
        var n = G.el('span', 'pathway' + (w === D.repair.desired ? ' pathway--new' : ''));
        n.dataset.word = w;
        n.appendChild(tokenImg(w, 'pathway__token'));
        box.appendChild(n);
      });
    }
    // hot: the words whose pathways light (the words Blip has seen after the phrase).
    function drawPathways(hot) {
      hot = hot || [];
      var svg = $('labBeams');
      svg.querySelectorAll('.beam--path').forEach(function (b) { b.remove(); });
      Array.prototype.forEach.call($('pathways').children, function (n) {
        var isHot = hot.indexOf(n.dataset.word) >= 0;
        G.beam(svg, G.point(n, 0.5, 0.05), G.point(labPhrase.slot, 0.5, 0.95), 'beam--path' + (isHot ? ' is-hot' : ''), { bend: 0 });
        n.classList.toggle('is-hot', isHot);
      });
    }

    /* The words Blip can suggest after this phrase, like a phone's suggestion bar. */
    function showSuggestRow(words, fresh) {
      var row = G.clear($('suggestRow'));
      row.classList.toggle('is-on', !!words);
      if (!words) return;
      row.appendChild(G.text('span', 'suggest-row__head', 'Blip can suggest:'));
      words.forEach(function (w, i) {
        var c = chip(w, 'chip--suggest' + (w === fresh ? ' is-new' : ''));
        c.style.setProperty('--i', i);
        row.appendChild(c);
      });
      // More than one seen word: say plainly that Blip picked one of them.
      if (words.length > 1 && fresh) row.appendChild(G.text('span', 'suggest-row__note', 'Both are possible now. This time Blip picked ' + fresh + '.'));
    }

    M.register('RETEST', async function (seq) {
      M.lock();
      K.setMode('companion', 'left');
      resetLab({ sealed: false });
      P.pod.play('idle');
      var con = $('console');
      con.classList.add('is-on', 'is-retest');
      labPhrase.set(D.repair.prompt, { key: D.keyWords });
      buildPathways();
      await G.showScene('lab', 'lab', 'fade');
      M.unlock();
      A.preloadLines(['blip_pizza', 'k_retest_result', 'k_retest_pick', 'k_retest_old', 'k_retest_limit', 'k_byte_intro', 'byte_hello']);
      K.rest('idle');
      drawPathways();
      var now = seenAfter(repairedMemory(), G.keyOf(D.repair.prompt));
      if (F.retestDone) {
        labPhrase.fill(D.repair.desired, 'is-blip is-new');
        drawPathways(now);
        showSuggestRow(now, D.repair.desired);
        $('pathways').classList.add('is-compare');
        await G.cta(seq, $('labCta'), 'Continue');
        M.next();
        return;
      }
      await seq.wait(400);
      await G.krishSay(seq, 'k_retest', 'talk');
      await G.cta(seq, $('labCta'), 'Run', { icon: 'run', aria: 'Run Blip' });
      await seq.run(G.withBusy(processBlip(labPhrase, function () { drawPathways(now); })));
      labPhrase.fill(D.repair.desired, 'is-blip is-new');
      showSuggestRow(now, D.repair.desired);
      A.sfx('correct', 0.55);
      var r = G.rect(labPhrase.slot);
      G.burst(r.cx, r.cy, { radius: 150 });
      G.announce('Blip can now suggest ' + now.join(' or ') + '.');
      P.pod.play('celebrate');
      await G.charSay(seq, 'blip_pizza', null);
      await seq.wait(500);
      K.rest('happy');
      await G.krishSay(seq, 'k_retest_result', 'happy');
      await G.krishSay(seq, 'k_retest_pick', 'talk');
      $('pathways').classList.add('is-compare');
      // Evidence before the claim: an old phrase still gives its old answer.
      var old = D.trials[1];
      var oldNow = seenAfter(repairedMemory(), G.keyOf(old.prompt));
      K.rest('idle');
      await G.krishSay(seq, 'k_retest_old', 'talk');
      drawPathways();
      showSuggestRow(null);
      await seq.run(labPhrase.set(old.prompt, { type: true, key: D.keyWords }));
      await G.cta(seq, $('labCta'), 'Run', { icon: 'run', aria: 'Run Blip' });
      await seq.run(G.withBusy(processBlip(labPhrase, function () { drawPathways(oldNow); })));
      labPhrase.fill(old.result, 'is-blip');
      showSuggestRow(oldNow);
      A.sfx('prediction_reveal', 0.5);
      G.announce('Blip predicted ' + old.result + ' again.');
      P.pod.play('awkward');
      await seq.wait(500);
      K.rest('think');
      await G.krishSay(seq, 'k_retest_limit', 'think');
      K.rest('idle');
      F.retestDone = true;
      G.progress.complete(2);
      await seq.wait(800);
      M.next();
    });

    /* ======================================================================
       BYTE — a short comparison: the same rule with much more writing seen.
       ====================================================================== */
    function renderTiny(el) {
      G.clear(el);
      el.appendChild(G.el('span', 'tiny-memory__head', '<i></i><i></i><i></i><b>Blip’s memory</b>'));
      repairedMemory().forEach(function (s, i) {
        el.appendChild(G.text('span', 'tiny-memory__row' + (i === D.blipMemory.length ? ' is-new' : ''), s));
      });
    }

    /* Byte's base: many abstract shelves of flowing data — never readable messages. */
    function renderBase(root, shelves) {
      var stack = G.clear(root.querySelector('.base__stack'));
      for (var i = 0; i < shelves; i++) {
        var s = G.el('div', 'shelf');
        s.style.setProperty('--d', (8 + (i * 37) % 9) + 's');
        s.style.setProperty('--o', (i % 3) * 0.12);
        s.style.setProperty('--i', i);
        s.appendChild(G.el('div', 'shelf__flow'));
        s.appendChild(G.el('div', 'shelf__nodes'));
        s.appendChild(G.el('i', 'shelf__led'));
        stack.appendChild(s);
      }
    }

    function resetVault() {
      renderTiny($('tinyMemory'));
      var base = $('byteBase');
      base.className = 'base';
      renderBase(base, 11);
      G.clear($('vaultBeams'));
      $('byteConsole').className = 'byte-console';
      bytePhrase.set('');
      bytePhrase.el.classList.remove('is-live');
      hideByteGuess();
    }

    /* Unscored guess before each Byte run, like the Blip trials. */
    function byteGuess(seq, d, i) {
      var box = G.clear($('byteChoices'));
      $('byteAskPrompt').textContent = 'What will Byte say?';
      $('byteAskNote').textContent = 'Any guess is okay.';
      $('byteAsk').hidden = false;
      var btns = d.options.map(function (w, k) {
        var b = G.button(w, 'choice');
        b.dataset.word = w;
        b.style.setProperty('--i', k);
        box.appendChild(b);
        return b;
      });
      box.setAttribute('aria-label', bytePhrase.text() + ' \u2014 your guess');
      box.classList.add('is-on');
      focusGroup(box);
      G.hints.setContext({ line: 'k_hint_byte_guess', run: function () { btns.forEach(function (b) { G.pulse(b); }); } });
      var picked = pickOne(seq, btns);
      K.say(i ? 'k_byte_guess_2' : 'k_byte_guess', 'think'); // the choices wait (voice lock) until Krish asks
      return picked.then(function (b) {
        $('byteAskPrompt').textContent = 'Your guess: ' + b.dataset.word;
        $('byteAskNote').textContent = 'Now press Run.';
        G.announce('Your guess: ' + b.dataset.word + '.');
        return b;
      });
    }
    function showByteResult(d, guess) {
      var hit = Array.prototype.filter.call($('byteChoices').children, function (b) { return b.dataset.word === d.result; })[0];
      if (hit) { hit.classList.remove('is-dim'); hit.classList.add('is-byte-pick'); }
      if (hit === guess) guess.classList.add('is-match');
      $('byteAskPrompt').textContent = 'Byte chose: ' + d.result;
      $('byteAskNote').textContent = 'Your guess: ' + guess.dataset.word + '.';
    }
    function hideByteGuess() {
      $('byteAsk').hidden = true;
      $('byteChoices').classList.remove('is-on');
      G.clear($('byteChoices'));
    }

    function processByte() {
      var base = $('byteBase');
      var svg = $('vaultBeams');
      P.byte.play('process');
      base.classList.add('is-streaming');
      bytePhrase.processing(true);
      A.sfx('prediction_process', 0.45);
      var b1 = G.beam(svg, G.point(base.querySelector('.base__stack'), 0.1, 0.45), G.point($('byteMount'), 0.55, 0.45), 'beam--byte', { bend: 0.1 });
      return G.wait(550).then(function () {
        var b2 = G.beam(svg, G.point($('byteMount'), 0.5, 0.3), G.point(bytePhrase.slot, 0.5, 0.6), 'beam--byte', { bend: -0.1 });
        return G.wait(750).then(function () {
          base.classList.remove('is-streaming');
          [b1, b2].forEach(function (b) { b.classList.add('is-fading'); setTimeout(function () { b.remove(); }, 600); });
          P.byte.play('idle');
        });
      });
    }

    M.register('BYTE_ARRIVAL', async function (seq) {
      M.lock();
      K.setMode('companion', 'left');
      resetVault();
      P.mini.play('idle');
      P.byte.play('off');
      G.particleTint = '140, 210, 255';
      await G.showScene('vault', 'vault', 'expand');
      M.unlock();
      A.preloadLines(['k_byte_guess', 'k_byte_guess_2', 'k_hint_byte_guess', 'k_byte_run', 'k_byte_summary', 'k_rule_prompt', 'k_rule_hint']);
      K.rest('idle');
      K.setMode('guide', 470);
      await seq.wait(600);
      await G.krishSay(seq, 'k_byte_intro', 'pointRight');
      $('byteBase').classList.add('is-built');
      A.sfx('character_boot', 0.45);
      await seq.wait(300);
      await seq.run(G.withBusy(P.byte.play('enter')));
      await G.charSay(seq, 'byte_hello', P.byte, 'talk');
      M.next();
    });

    M.register('BYTE_DEMO', async function (seq, ctx) {
      var demos = D.byteDemos;
      if (ctx.rerender) {
        M.lock();
        resetVault();
        $('byteBase').classList.add('is-built');
        P.mini.play('idle');
        P.byte.play('idle');
        G.particleTint = '140, 210, 255';
        await G.showScene('vault', 'vault', 'fade');
        M.unlock();
      }
      K.setMode('companion', 'left');
      K.rest('idle');
      $('byteConsole').classList.add('is-on');
      if (F.byteDemoDone) {
        var last = demos[demos.length - 1];
        bytePhrase.set(last.prompt, { key: D.keyWords });
        bytePhrase.fill(last.result, 'is-byte');
        await G.cta(seq, $('byteCta'), 'Continue');
        M.next();
        return;
      }
      await seq.wait(400);
      for (var i = 0; i < demos.length; i++) {
        var d = demos[i];
        hideByteGuess();
        await seq.run(bytePhrase.set(d.prompt, { type: true, key: D.keyWords }));
        var guess = await byteGuess(seq, d, i);
        if (i === 0) await G.krishSay(seq, 'k_byte_run', 'talk');
        await G.cta(seq, $('byteCta'), 'Run', { icon: 'run', aria: 'Run Byte' });
        await seq.run(G.withBusy(processByte()));
        bytePhrase.fill(d.result, 'is-byte');
        showByteResult(d, guess);
        A.sfx('prediction_reveal', 0.5);
        G.announce('Byte predicted ' + d.result + '.');
        P.byte.play('acknowledge');
        await seq.wait(1800);
      }
      hideByteGuess();
      await G.krishSay(seq, 'k_byte_summary', 'talk');
      F.byteDemoDone = true;
      await seq.wait(400);
      M.next();
    });

    /* ======================================================================
       RULE_FORGE — one rule that fits both Blip and Byte. Single attempt.
       ====================================================================== */
    function resetRule() {
      renderTiny($('ruleTiny'));
      var base = $('ruleBase');
      base.className = 'base base--mini is-built';
      renderBase(base, 9);
      G.clear($('ruleBeams'));
      G.clear($('ruleBlipEvidence'));
      G.clear($('ruleByteEvidence'));
      $('ruleBlipSide').className = 'side side--blip';
      $('ruleByteSide').className = 'side side--byte';
      $('socket').className = 'socket';
      G.clear($('socketSlot'));
      $('ruleQ').className = 'question question--rule';
      $('rulePrompt').textContent = D.rule.prompt;
      var box = G.clear($('ruleOptions'));
      box.setAttribute('aria-label', D.rule.prompt);
      ordered('rule').forEach(function (o, k) {
        var b = G.button(o.label, 'option option--slab');
        b.dataset.id = o.id;
        b.style.setProperty('--i', k);
        b.disabled = true;
        box.appendChild(b);
      });
      P.ruleBlip.play('idle');
      P.ruleByte.play('idle');
    }

    function showRuleEvidence(opt, instant) {
      var blipSide = $('ruleBlipSide'), byteSide = $('ruleByteSide');
      var svg = G.clear($('ruleBeams'));
      var from = G.point($('socket'), 0.5, 0.4);
      var toBlip = G.point($('ruleTiny'), 1, 0.5), toByte = G.point($('ruleBase'), 0, 0.55);
      if (opt.correct) {
        G.beam(svg, from, toBlip, 'beam--ok', { bend: 0.12 });
        G.beam(svg, from, toByte, 'beam--ok', { bend: -0.12 });
        blipSide.classList.add('is-linked');
        byteSide.classList.add('is-linked');
      } else {
        G.beam(svg, from, { x: (from.x + toBlip.x) / 2, y: (from.y + toBlip.y) / 2 - 30 }, 'beam--broken', { bend: 0.1 });
        G.beam(svg, from, { x: (from.x + toByte.x) / 2, y: (from.y + toByte.y) / 2 - 30 }, 'beam--broken', { bend: -0.1 });
        if (opt.id === 'typed') {
          var ev = G.clear($('ruleByteEvidence'));
          D.byteDemos.map(function (d) { return d.result; }).forEach(function (w, i) { var c = chip(w, 'chip--evidence-tag'); c.style.setProperty('--i', i); ev.appendChild(c); });
          byteSide.classList.add('is-evidence');
        } else {
          var ev2 = G.clear($('ruleBlipEvidence'));
          var tag = G.el('span', 'evidence-tag');
          // "My pet is a" -> sandwich: seen after the words, not understood.
          tag.appendChild(G.text('span', 'evidence-tag__phrase', D.trials[1].prompt.replace(' ___', '')));
          tag.appendChild(chip(D.trials[1].result, 'chip--inline'));
          ev2.appendChild(tag);
          blipSide.classList.add('is-evidence');
        }
      }
      if (instant) svg.querySelectorAll('.beam').forEach(function (b) { b.classList.add('is-instant'); });
    }

    /*
     * After a miss, the learner places the rule that fits, so the chamber never
     * ends on a wrong rule. The first answer stays committed (F.ruleAnswer);
     * the evidence tag that disproved it stays on screen as the reason.
     */
    async function placeCorrectRule(seq, btns) {
      var good = correctBtn(btns, D.rule.options), right = correctOf(D.rule.options);
      $('socket').classList.remove('is-lit');
      G.clear($('socketSlot'));
      G.clear($('ruleBeams'));
      G.task('Tap the rule that fits both.', { x: 960, y: 838 });
      good.disabled = false;
      G.focus(good);
      G.hints.setContext({ line: 'k_hint_rule_place', run: function () { G.pulse(good); } });
      K.say('k_rule_place', 'point'); // the rule waits (voice lock) until Krish has asked
      await seq.until(function (resolve) {
        good.onclick = function () { if (good.disabled) return; good.disabled = true; good.onclick = null; resolve(); };
      });
      G.hints.clear();
      G.task(null);
      A.sfx('choice_lock', 0.5);
      await seq.run(G.withBusy((async function () {
        await G.fly(good, $('socketSlot'), G.text('span', 'socket-flyer', right.label), { ms: 700, arc: -40, scale: 0.55, fade: true });
        $('socket').classList.add('is-lit');
        $('socketSlot').textContent = right.label;
        A.sfx('logic_link', 0.55);
        await G.wait(300);
        showRuleEvidence(right, false);
        await G.wait(900);
      })()));
      F.ruleFixed = true;
      A.sfx('correct', 0.5);
      P.ruleBlip.play('confident');
      P.ruleByte.play('acknowledge');
      K.rest('happy');
      await G.krishSay(seq, 'k_rule_correct', 'happy');
      K.rest('idle');
    }

    M.register('RULE_FORGE', async function (seq) {
      M.lock();
      K.setMode('companion', 'left');
      resetRule();
      G.particleTint = '170, 220, 255';
      await G.showScene('logic', 'logic', 'fade');
      M.unlock();
      A.preloadLines(['k_rule_correct', 'k_rule_typed', 'k_rule_meaning', 'k_rule_place', 'k_hint_rule_place', 'k_rule_hint', 'k_dot_intro', 'dot_hello']);
      var btns = Array.prototype.slice.call($('ruleOptions').children);
      if (F.ruleAnswer) {
        // Review: the committed answer stays locked.
        var chosen = D.rule.options.filter(function (o) { return o.id === F.ruleAnswer; })[0];
        $('ruleQ').classList.add('is-on');
        btns.forEach(function (b) {
          var o = D.rule.options.filter(function (x) { return x.id === b.dataset.id; })[0];
          if (o.id === chosen.id) b.classList.add('is-locked');
          if (o.correct) markCorrect(b, !chosen.correct); else if (o.id !== chosen.id) b.classList.add('is-dim');
          if (o.id === chosen.id && !o.correct) b.classList.add('is-soft-miss');
        });
        $('socket').classList.add('is-lit');
        $('socketSlot').textContent = chosen.label;
        showRuleEvidence(chosen, true);
        if (!chosen.correct) {
          if (F.ruleFixed) {
            $('socketSlot').textContent = correctOf(D.rule.options).label;
            showRuleEvidence(correctOf(D.rule.options), true);
          } else {
            await placeCorrectRule(seq, btns);
          }
        }
        await G.cta(seq, $('ruleCta'), 'Continue');
        M.next();
        return;
      }
      K.setMode('guide', 780);
      K.rest('idle');
      await seq.wait(700);
      await G.krishSay(seq, 'k_rule_prompt', 'talk');
      K.setMode('companion', 'left');
      await seq.wait(300);
      $('ruleQ').classList.add('is-on');
      // Listen before enabling, so a quick first click always counts.
      var picked = seq.until(function (resolve) {
        var taken = false;
        btns.forEach(function (x) { x.onclick = function () { if (taken) return; taken = true; resolve(x); }; });
      });
      btns.forEach(function (b) { b.disabled = false; });
      await seq.wait(300);
      focusGroup($('ruleOptions'));
      G.hints.setContext({
        line: 'k_rule_hint', pose: 'think',
        run: function () {
          G.pulse($('ruleBlipSide'));
          G.pulse($('ruleByteSide'));
        }
      });
      var b = await picked;
      var opt = D.rule.options.filter(function (o) { return o.id === b.dataset.id; })[0];
      F.ruleAnswer = opt.id; // committed immediately: single attempt
      G.hints.clear();
      btns.forEach(function (x) { x.disabled = true; x.classList.add(x === b ? 'is-locked' : 'is-dim'); });
      A.sfx('choice_lock', 0.5);
      await seq.run(G.withBusy((async function () {
        var label = G.text('span', 'socket-flyer', opt.label);
        await G.fly(b, $('socketSlot'), label, { ms: 700, arc: -40, scale: 0.55, fade: true });
        $('socket').classList.add('is-lit');
        $('socketSlot').textContent = opt.label;
        A.sfx('logic_link', 0.55);
        await G.wait(300);
        showRuleEvidence(opt, false);
        await G.wait(900);
      })()));
      G.progress.complete(3);
      if (opt.correct) {
        markCorrect(b, false);
        A.sfx('correct', 0.5);
        P.ruleBlip.play('confident');
        P.ruleByte.play('acknowledge');
        K.rest('happy');
      } else {
        b.classList.add('is-soft-miss');
        A.sfx('wrong_soft', 0.35);
        markCorrect(correctBtn(btns, D.rule.options), true);
        P.ruleBlip.play('confused');
        K.rest('encourage');
      }
      await G.krishSay(seq, opt.line, opt.correct ? 'happy' : 'encourage');
      K.rest('idle');
      if (!opt.correct) await placeCorrectRule(seq, btns);
      await G.cta(seq, $('ruleCta'), 'Continue');
      M.next();
    });

    /* ======================================================================
       DOT — independent transfer check. No answer-directed hints.
       ====================================================================== */
    var dotStrips = [];
    function dotLead(it) { return 'Can Dot suggest “' + it.target + '” after:'; }
    function dotKey(it) { return G.keyOf(it.phrase.replace(/[“”?]/g, '')); }
    function dotQuote(it) { return '“' + dotKey(it).join(' ') + '”'; }
    function dotAfter(it) { return seenAfter(D.dot.memory, dotKey(it)); }

    function resetDot() {
      var strips = G.clear($('dotStrips'));
      dotStrips = [];
      D.dot.memory.forEach(function (s) {
        var row = G.el('p', 'dstrip'), ws = [];
        s.split(' ').forEach(function (w, i) {
          if (i) row.appendChild(document.createTextNode(' '));
          var span = G.text('span', 'dword', w);
          span.dataset.word = norm(w);
          row.appendChild(span);
          ws.push(span);
        });
        dotStrips.push(ws);
        strips.appendChild(row);
      });
      $('dotMemory').className = 'dot-memory';
      $('seek').className = 'seek';
      $('seekWord').textContent = '';
      $('seekResult').textContent = '';
      $('dotQ').className = 'question question--dot';
      G.clear($('dotReview'));
      $('dotReview').className = 'dot-review';
      var pips = G.clear($('dotPips'));
      D.dot.items.forEach(function () { pips.appendChild(G.el('i')); });
      var box = G.clear($('dotOptions'));
      ['yes', 'no'].forEach(function (v) {
        var b = G.button(v.toUpperCase(), 'option option--yn');
        b.dataset.v = v;
        b.disabled = true;
        box.appendChild(b);
      });
      showDotItem(Math.min(F.dotAnswers.length, D.dot.items.length - 1));
    }

    function showDotItem(i) {
      var it = D.dot.items[i];
      $('dotLead').textContent = dotLead(it);
      $('dotPhrase').textContent = it.phrase;
      $('dotOptions').setAttribute('aria-label', dotLead(it) + ' ' + it.phrase);
      Array.prototype.forEach.call($('dotOptions').children, function (b) { b.classList.remove('is-locked', 'is-dim'); });
      updateDotPips(i);
      var q = $('dotQ');
      q.classList.remove('is-next');
      void q.offsetWidth;
      q.classList.add('is-next');
    }
    function updateDotPips(current) {
      Array.prototype.forEach.call($('dotPips').children, function (p, k) {
        p.className = k < F.dotAnswers.length ? 'is-done' : k === current ? 'is-current' : '';
      });
    }

    // One evidence row per question: the asked word, what Dot has seen after those words, the committed answer.
    function buildDotReview() {
      var list = G.clear($('dotReview'));
      D.dot.items.forEach(function (it, i) {
        var said = F.dotAnswers[i], right = said === it.answer, after = dotAfter(it);
        var row = G.el('div', 'review-row ' + (right ? 'is-right' : 'is-miss'));
        row.setAttribute('role', 'listitem');
        row.setAttribute('aria-label', it.target + ' after ' + dotKey(it).join(' ') + ': Dot has seen ' + (after.join(' ') || 'nothing') + ' after those words. You said ' + said + (right ? '. Correct.' : '. The answer is ' + it.answer + '.'));
        row.appendChild(G.text('span', 'review-row__word', it.target));
        var found = G.el('span', 'review-row__found' + (after.indexOf(it.target) >= 0 ? '' : ' is-none'));
        found.setAttribute('aria-hidden', 'true');
        found.appendChild(G.el('span', 'review-row__lens'));
        found.appendChild(G.text('span', 'review-row__key', dotQuote(it)));
        found.appendChild(G.el('span', 'review-row__arrow'));
        found.appendChild(G.text('span', 'review-row__seen', after.join(', ') || 'nothing'));
        row.appendChild(found);
        var ans = G.text('span', 'review-row__answer', said.toUpperCase());
        ans.setAttribute('aria-hidden', 'true');
        ans.insertAdjacentHTML('beforeend', '<span class="mark ' + (right ? 'mark--ok' : 'mark--miss') + '"></span>');
        row.appendChild(ans);
        if (!right) {
          var fix = G.text('span', 'review-row__fix', it.answer.toUpperCase());
          fix.setAttribute('aria-hidden', 'true');
          row.appendChild(fix);
        }
        list.appendChild(row);
      });
    }

    function clearDotLights() {
      $('dotMemory').querySelectorAll('.dword').forEach(function (w) { w.classList.remove('is-key', 'is-match'); });
    }
    function lightDot(it) {
      var at = locate(dotStrips, dotKey(it));
      if (!at) return null;
      at.pair.forEach(function (w) { w.classList.add('is-key'); });
      at.next.classList.add('is-match');
      return at;
    }

    /* For each question, find its last words in Dot's memory and show the word after them. */
    function dotEvidence(instant) {
      var mem = $('dotMemory');
      var seek = $('seek');
      var items = D.dot.items;
      buildDotReview();
      var rows = $('dotReview').children;
      $('dotReview').classList.add('is-on');
      function settle(it, i) {
        var after = dotAfter(it);
        seek.classList.remove('is-matched', 'is-unmatched');
        seek.classList.add(after.length ? 'is-matched' : 'is-unmatched');
        $('seekResult').textContent = after.join(', ') || 'nothing';
        rows[i].classList.add('is-shown');
      }
      function finish() {
        mem.classList.remove('is-scanning');
        mem.classList.add('is-scanned');
        seek.classList.remove('is-on'); // the review rows now hold every result
        clearDotLights();
        items.forEach(lightDot);
      }
      seek.classList.add('is-on');
      if (instant) {
        items.forEach(function (it, i) { $('seekWord').textContent = dotQuote(it); settle(it, i); });
        finish();
        return Promise.resolve();
      }
      return items.reduce(function (p, it, i) {
        return p.then(function () {
          $('seekWord').textContent = dotQuote(it);
          $('seekResult').textContent = '';
          seek.classList.remove('is-matched', 'is-unmatched');
          clearDotLights();
          mem.classList.add('is-scanning');
          A.sfx('prediction_process', 0.4);
          return G.wait(800);
        }).then(function () {
          mem.classList.remove('is-scanning');
          var at = lightDot(it);
          A.sfx(at ? 'data_collect' : 'wrong_soft', at ? 0.35 : 0.25);
          settle(it, i);
          return G.wait(1100);
        });
      }, G.wait(300)).then(function () {
        finish();
        G.announce(items.map(function (it) {
          var after = dotAfter(it);
          return 'After ' + dotKey(it).join(' ') + ', Dot has seen ' + (after.join(' ') || 'nothing') + '.';
        }).join(' '));
        return G.wait(500);
      });
    }

    M.register('DOT_ARRIVAL', async function (seq) {
      M.lock();
      K.setMode('companion', 'left');
      resetDot();
      P.dot.play('off');
      G.particleTint = '225, 160, 255';
      await G.showScene('dot', 'dot', 'hue');
      M.unlock();
      A.preloadLines(['k_dot_commit'].concat(D.dot.items.map(function (it) { return it.line; }), ['k_dot_correct', 'k_dot_incorrect', 'k_takeaway', 'k_bridge', 'blip_yay']));
      K.setMode('guide', 'right');
      K.rest('idle');
      await seq.wait(500);
      await G.krishSay(seq, 'k_dot_intro', 'point');
      A.sfx('character_boot', 0.45);
      await seq.run(G.withBusy(P.dot.play('enter')));
      await G.charSay(seq, 'dot_hello', P.dot, 'react', false);
      $('dotMemory').classList.add('is-on');
      A.sfx('memory_open', 0.3);
      K.setMode('companion', 'left');
      await seq.wait(900);
      M.next();
    });

    M.register('DOT_CHALLENGE', async function (seq, ctx) {
      if (ctx.rerender) {
        M.lock();
        resetDot();
        P.dot.play('idle');
        await G.showScene('dot', 'dot', 'fade');
        $('dotMemory').classList.add('is-on');
        M.unlock();
      }
      var btns = Array.prototype.slice.call($('dotOptions').children);
      var items = D.dot.items;
      if (F.dotAnswer) {
        K.setMode('companion', 'left');
        updateDotPips(-1);
        await dotEvidence(true);
        await G.cta(seq, $('dotCta'), 'Continue');
        M.next();
        return;
      }
      K.setMode('companion', 'left');
      K.rest('idle');
      G.hints.clear(); // no answer-directed hint before the learner commits
      await seq.wait(400);
      if (!F.dotAnswers.length) await G.krishSay(seq, 'k_dot_commit', 'encourage');
      await seq.run(K.setMode('focus'));
      P.dot.play('think');
      // Resumes at the first unanswered item after Back; committed answers stay.
      for (var i = F.dotAnswers.length; i < items.length; i++) {
        showDotItem(i);
        $('dotQ').classList.add('is-on');
        await G.krishSay(seq, items[i].line, 'talk');
        btns.forEach(function (b) { b.disabled = false; });
        focusGroup($('dotOptions'));
        var b = await seq.until(function (resolve) {
          var taken = false;
          btns.forEach(function (x) { x.onclick = function () { if (taken) return; taken = true; resolve(x); }; });
        });
        F.dotAnswers.push(b.dataset.v); // one attempt, committed
        btns.forEach(function (x) { x.disabled = true; x.onclick = null; x.classList.add(x === b ? 'is-locked' : 'is-dim'); });
        updateDotPips(-1);
        A.sfx('choice_lock', 0.5);
        G.announce('Answer locked: ' + b.dataset.v + '.');
        await seq.wait(700);
      }
      F.dotAnswer = F.dotAnswers.join(',');
      $('dotQ').classList.remove('is-on');
      await seq.wait(450);
      await seq.run(G.withBusy(dotEvidence(false)));
      G.progress.complete(4);
      K.setMode('companion', 'left');
      await seq.wait(500);
      var right = items.every(function (it, k) { return F.dotAnswers[k] === it.answer; });
      K.rest(right ? 'happy' : 'encourage');
      if (right) A.sfx('correct', 0.5);
      P.dot.play('react');
      await G.krishSay(seq, right ? 'k_dot_correct' : 'k_dot_incorrect', right ? 'happy' : 'encourage');
      K.rest('idle');
      await G.cta(seq, $('dotCta'), 'Continue');
      M.next();
    });

    /* ======================================================================
       COMPLETE — powered lab, the whole team together, then the recap:
       What I did -> What I discovered -> What I learned.
       ====================================================================== */
    /* One card with all three parts: What I did -> What I discovered -> What I learned. */
    function buildRecap() {
      var box = G.clear($('recap'));
      var total = D.dot.items.length;
      var right = D.dot.items.filter(function (it, k) { return F.dotAnswers[k] === it.answer; }).length;
      return D.complete.recap.map(function (card, i) {
        var p = G.el('section', 'recap__panel recap__panel--' + card.id);
        p.setAttribute('aria-label', card.title);
        var head = G.el('div', 'recap__head');
        head.appendChild(G.text('span', 'recap__num', String(i + 1)));
        head.appendChild(G.text('h3', 'recap__title', card.title));
        p.appendChild(head);
        var ul = G.el('ul', 'recap__lines');
        card.lines.forEach(function (ln) {
          ul.appendChild(G.text('li', null, ln.replace('{right}', right).replace('{total}', total)));
        });
        p.appendChild(ul);
        box.appendChild(p);
        return p;
      });
    }

    /* The three parts appear one after another, then the whole recap is announced. */
    async function showRecap(seq) {
      var panels = buildRecap();
      $('recap').hidden = false;
      var RECAP_LINES = ['k_recap_did', 'k_recap_discovered', 'k_recap_learned'];
      for (var k = 0; k < panels.length; k++) {
        await seq.wait(k ? 300 : 250);
        panels[k].classList.add('is-shown');
        A.sfx('progress_node', 0.3);
        if (RECAP_LINES[k]) await G.krishSay(seq, RECAP_LINES[k], k === 2 ? 'happy' : 'talk');
      }
      G.announce(D.complete.recap.map(function (card, k) {
        return card.title + ': ' + Array.prototype.map.call(panels[k].querySelectorAll('li'), function (li) { return li.textContent; }).join(' ');
      }).join(' '));
      await seq.wait(500);
    }

    M.register('COMPLETE', async function (seq) {
      M.lock();
      hideStorySequence();
      K.setMode('companion', 'left');
      $('finaleHeadline').textContent = D.complete.headline;
      G.clear($('recap'));
      $('recap').hidden = true;
      document.querySelector('.finale').classList.remove('is-on');
      ['castBlip', 'castDot', 'castByte'].forEach(function (k) { P[k].play('off'); });
      G.particleTint = '255, 220, 150';
      await G.showScene('complete', 'complete', 'fade');
      M.unlock();
      K.rest('celebrate');
      K.setMode('guide', 780);
      A.sfx('completion_sting', 0.6);
      P.castByte.play('enter');
      P.castDot.play('enter');
      P.castBlip.play('boot');
      await seq.wait(500);
      document.querySelector('.finale').classList.add('is-on');
      G.burst(960, 470, { count: 8, radius: 280, cls: 'fxburst--big' });
      await seq.wait(900);
      P.castBlip.play('celebrate');
      await G.charSay(seq, 'blip_yay', null);
      K.rest('idle');
      // One cinematic popup for the phone takeaway and the bridge.
      await playFinaleStory(seq);
      // Krish steps to the side so the recap has the centre of the room.
      K.rest('happy');
      await seq.run(K.setMode('companion', 1520));
      await showRecap(seq);
      await G.cta(seq, $('finaleCta'), 'Finish', { cls: 'btn--xl' });
      F.finished = true;
      G.stopTimer();
      A.fadeOutBgm(2400);
      K.rest('celebrate');
      P.castBlip.play('celebrate');
      P.castByte.play('acknowledge');
      P.castDot.play('react');
      G.burst(960, 330, { count: 8, radius: 220 });
      document.documentElement.classList.add('is-finished');
      G.announce('Mission complete.');
      G.updateBack();
      try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'mission-complete' }, '*'); } catch (e) { /* embedded hosts only */ }
    });

    /*
     * QA only: ?dev=STATE jumps there after Start (audio still unlocks via the
     * real gesture). Prerequisite flags are filled as if earlier work was done.
     */
    // Only on local copies (file:// or localhost), never on a public host.
    var devHost = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var devTarget = devHost && (location.search.match(/[?&]dev=([A-Z_]+)/) || [])[1];
    if (devTarget && ATG.STATES.indexOf(devTarget) > 1) {
      ATG.DEV = true;
      M.register('KRISH_INTRO', (function (orig) {
        return function (seq, ctx) {
          var order = ATG.STATES, idx = order.indexOf(devTarget);
          var at = function (s) { return idx > order.indexOf(s); };
          if (at('PHONE_HOOK')) { F.phoneDone = true; F.phonePick = D.phone.suggestions[0]; F.phoneGuess = D.phone.options[0].id; }
          if (at('PREDICTION_RUN')) { F.trialsDone = true; F.trialIndex = D.trials.length; }
          if (at('CAUSE_GUESS')) { F.causeGuess = D.cause.options[0].id; G.progress.complete(0); }
          if (at('MEMORY_SCAN')) { F.memoryDone = true; F.memoryFound = D.trials.length; G.progress.complete(1); }
          if (at('REPAIR_BAY')) F.repairResolved = true;
          if (at('RETEST')) { F.retestDone = true; G.progress.complete(2); }
          if (at('BYTE_DEMO')) F.byteDemoDone = true;
          if (at('RULE_FORGE')) { F.ruleAnswer = 'seen'; G.progress.complete(3); }
          if (at('DOT_CHALLENGE')) { F.dotAnswers = D.dot.items.map(function (it) { return it.answer; }); F.dotAnswer = F.dotAnswers.join(','); G.progress.complete(4); }
          $('titleName').textContent = '';
          hud(true);
          G.startTimer();
          K.setMode('companion', 'left', { instant: true });
          if (idx <= order.indexOf('PHONE_HOOK')) return orig(seq, ctx);
          M.state = null;
          G.scene = 'title';
          M.go(devTarget, 'dev');
        };
      })(M.handlers.KRISH_INTRO));
    }

    // After Finish there is no way back into the mission.
    var baseBack = M.backTarget.bind(M);
    M.backTarget = function () { return F.finished ? null : baseBack(); };
  };
})(window.ATG = window.ATG || {});
