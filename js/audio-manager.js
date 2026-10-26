/*
 * AudioManager — local BGM, character VO, SFX, captions, replay, mute and
 * BGM ducking. Uses HTMLAudioElement so it also works from file://.
 * Missing or blocked audio never blocks the mission: every `say()` resolves,
 * falling back to a reading-time timer while the caption stays visible.
 * All audio is Ogg Opus: Chrome, Edge, Firefox and Safari 18.4+ (macOS/iOS).
 */
(function (ATG) {
  'use strict';

  var BGM_LEVEL = 0.34;
  var DUCK_RATIO = 0.25;      // BGM sits at 25% while anyone speaks
  var DUCK_MS = 300;
  var RESTORE_DELAY = 700;    // lines that follow each other keep the music down
  var RESTORE_MS = 900;
  var LOOP_XF = 0.3;          // seconds: the two BGM players crossfade at the loop point
  var GRACE_MS = 4000;        // watchdog: a line may run this long past its real duration

  /*
   * One-time fallback for audio swapped to a preloaded blob: URL: if the local
   * copy fails, go back to the file and resume playback when `resume()` says so.
   */
  function revertOnError(a, resume) {
    a.addEventListener('error', function onErr() {
      var orig = ATG.assetOrig && ATG.assetOrig(a.src);
      if (!orig) return;
      a.removeEventListener('error', onErr);
      a.src = orig;
      if (resume && resume()) { var p = a.play(); if (p && p.catch) p.catch(function () {}); }
    });
    return a;
  }

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable: settings simply don't persist */ }
    return null;
  }

  function AudioManager(data) {
    this.data = data;
    this.muted = store('atg.muted') === '1';
    this.captionsOn = store('atg.captions') !== '0';
    this.unlocked = false;
    this.speaking = false;
    this.currentLine = null;
    this.lastLine = null;
    this.bgm = null;          // the BGM player currently heard
    this._bgmPlayers = [];
    this._bgmLevel = 0;       // master BGM volume, ramped for ducking and fades
    this._restoreTimer = null;
    this.voice = new Audio();
    this.voice.preload = 'auto';
    this.sfxPool = {};
    this.listeners = {};
    this._ramp = null;
    this._voiceDone = null;
    this._fallbackTimer = null;
    this._voCache = {};
  }

  AudioManager.prototype.on = function (evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); };
  AudioManager.prototype.emit = function (evt, detail) { (this.listeners[evt] || []).forEach(function (fn) { fn(detail); }); };

  /* Must run inside the Start Mission gesture. */
  AudioManager.prototype.unlock = function () {
    if (this.unlocked) return;
    this.unlocked = true;
    var self = this;
    this._startBgm();
    this._rampBgm(BGM_LEVEL, 1800);
    // Prime the VO element inside the gesture so later playback is allowed.
    this.voice.muted = true;
    var v = this.voice.play();
    if (v && v.catch) v.catch(function () {});
    this.voice.pause();
    this.voice.muted = this.muted;
    this.data.AUDIO.sfx.forEach(function (id) { self._sfx(id); });
  };

  /* Preload VO for upcoming lines without blocking. */
  AudioManager.prototype.preloadLines = function (ids) {
    var self = this;
    ids.forEach(function (id) {
      var line = self.data.LINES[id];
      // Already a local blob: URL (preloaded behind the title bar): nothing to fetch.
      if (!line || self._voCache[id] || /^blob:/.test(line.src)) return;
      var a = new Audio();
      a.preload = 'auto';
      a.src = line.src;
      self._voCache[id] = a;
    });
  };

  AudioManager.prototype._sfx = function (id) {
    if (!this.sfxPool[id]) {
      var a = revertOnError(new Audio(ATG.asset('assets/audio/sfx/sfx_' + id + '.ogg')));
      a.preload = 'auto';
      this.sfxPool[id] = a;
    }
    return this.sfxPool[id];
  };

  AudioManager.prototype.sfx = function (id, volume) {
    if (!this.unlocked || this.muted) return;
    try {
      var base = this._sfx(id);
      var a = base.cloneNode();
      a.volume = volume == null ? 0.55 : volume;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* optional */ }
  };

  /*
   * Speak a line. Resolves when the line finishes, is skipped, or is
   * interrupted. `opts.onStart/onEnd` let character controllers animate talk.
   */
  AudioManager.prototype.say = function (id, opts) {
    opts = opts || {};
    var line = this.data.LINES[id];
    var self = this;
    this.stopVoice();
    if (!line) { console.warn('[audio] unknown line ' + id); return Promise.resolve(); }
    this.currentLine = { id: id, line: line, opts: opts };
    if (!opts.noReplay) this.lastLine = { id: id, opts: opts };
    this.speaking = true;
    if (!opts.noCaption) this.emit('caption', { id: id, speaker: line.speaker, text: line.text });
    this.emit('speak', { id: id, speaker: line.speaker });
    clearTimeout(this._restoreTimer);
    this._rampBgm(BGM_LEVEL * DUCK_RATIO, DUCK_MS);
    if (opts.onStart) opts.onStart(line);

    return new Promise(function (resolve) {
      var finished = false;
      function done() {
        if (finished) return;
        finished = true;
        clearTimeout(self._fallbackTimer);
        self.voice.onended = self.voice.onerror = self.voice.onloadedmetadata = null;
        self._voiceDone = null;
        self.speaking = false;
        self.currentLine = null;
        clearTimeout(self._restoreTimer);
        self._restoreTimer = setTimeout(function () {
          if (!self.speaking && !self._faded) self._rampBgm(BGM_LEVEL, RESTORE_MS);
        }, RESTORE_DELAY);
        self.emit('captionEnd', { id: id });
        self.emit('speakEnd', { id: id, speaker: line.speaker });
        if (opts.onEnd) opts.onEnd(line);
        resolve();
      }
      self._voiceDone = done;
      var readMs = Math.max(1100, line.text.split(/\s+/).length * 330 + 500);
      function fallback() {
        clearTimeout(self._fallbackTimer);
        self._fallbackTimer = setTimeout(done, readMs);
      }
      if (!self.unlocked) { fallback(); return; }
      var reverted = false;
      self.voice.onended = function () { setTimeout(done, 120); };
      self.voice.onerror = function () {
        var orig = !reverted && ATG.assetOrig && ATG.assetOrig(self.voice.src);
        if (orig) { // the preloaded copy failed: retry once from the file
          reverted = true;
          self.voice.src = orig;
          var q = self.voice.play();
          if (q && q.catch) q.catch(function () {});
          return;
        }
        console.warn('[audio] missing VO ' + line.src + ' — caption only.');
        fallback();
      };
      // Watchdog re-armed from the real duration, so a stalled line can never hold the mission.
      self.voice.onloadedmetadata = function () {
        if (finished || self._paused || !isFinite(self.voice.duration)) return;
        clearTimeout(self._fallbackTimer);
        self._fallbackTimer = setTimeout(done, self.voice.duration * 1000 + GRACE_MS);
      };
      self.voice.src = line.src;
      try { self.voice.volume = line.gain || 1; } catch (e) { /* read-only volume (iOS) */ }
      self.voice.muted = self.muted;
      self.voice.currentTime = 0;
      var p = self.voice.play();
      if (p && p.catch) p.catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.warn('[audio] VO blocked for ' + id + ' — caption only.');
        fallback();
      });
      // Safety net: never wait forever on a stalled file.
      self._fallbackTimer = setTimeout(done, readMs + 9000);
    });
  };

  /* Pause narration (e.g. while the info panel is open) without ending the line. */
  AudioManager.prototype.pauseVoice = function () {
    if (!this.speaking || this._paused) return;
    this._paused = true;
    clearTimeout(this._fallbackTimer);
    try { this.voice.pause(); } catch (e) { /* noop */ }
    this._rampBgm(BGM_LEVEL * 0.5, 300);
  };
  AudioManager.prototype.resumeVoice = function () {
    if (!this._paused) return;
    this._paused = false;
    if (!this.speaking) return;
    var self = this;
    var remaining = isFinite(this.voice.duration) ? (this.voice.duration - this.voice.currentTime) * 1000 : 3000;
    this._fallbackTimer = setTimeout(function () { if (self._voiceDone) self._voiceDone(); }, remaining + GRACE_MS);
    this._rampBgm(BGM_LEVEL * DUCK_RATIO, 300);
    var p = this.voice.play();
    if (p && p.catch) p.catch(function () { if (self._voiceDone) self._voiceDone(); });
  };

  /* Skip / interrupt the current line (resolves its promise). */
  AudioManager.prototype.stopVoice = function () {
    this._paused = false;
    try { this.voice.pause(); } catch (e) { /* noop */ }
    if (this._voiceDone) this._voiceDone();
  };

  AudioManager.prototype.replay = function () {
    if (!this.lastLine || this.speaking) return null;
    var o = this.lastLine.opts || {};
    return this.say(this.lastLine.id, { onStart: o.onStart, onEnd: o.onEnd });
  };

  AudioManager.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    store('atg.muted', this.muted ? '1' : '0');
    var m = this.muted;
    this._bgmPlayers.forEach(function (a) { a.muted = m; });
    this.voice.muted = this.muted;
    this.emit('mute', this.muted);
  };

  AudioManager.prototype.setCaptions = function (on) {
    this.captionsOn = !!on;
    store('atg.captions', this.captionsOn ? '1' : '0');
    this.emit('captions', this.captionsOn);
  };

  AudioManager.prototype.fadeOutBgm = function (ms) {
    this._faded = true;
    clearTimeout(this._restoreTimer);
    this._rampBgm(0, ms || 1500);
  };

  /*
   * Seamless BGM loop. The built-in `loop` leaves a small gap on MP3s, so two
   * players take turns: just before one ends, the other starts from the top
   * and they crossfade over LOOP_XF seconds.
   */
  AudioManager.prototype._startBgm = function () {
    var self = this;
    var src = this.data.AUDIO.bgm;
    this._bgmPlayers = [0, 1].map(function () {
      var a = revertOnError(new Audio(src), function () { return self.bgm === a; });
      a.preload = 'auto';
      a.muted = self.muted;
      a.volume = 0;
      a._xf = 0; // this player's share of the crossfade
      return a;
    });
    // Prime the second player inside the Start gesture so its later play() is allowed.
    var spare = this._bgmPlayers[1];
    spare.muted = true;
    var sp = spare.play();
    if (sp && sp.catch) sp.catch(function () {});
    spare.pause();
    spare.muted = this.muted;
    var cur = this._bgmPlayers[0];
    cur._xf = 1;
    this.bgm = cur;
    var p = cur.play();
    if (p && p.catch) p.catch(function () { console.warn('[audio] BGM unavailable; continuing silently.'); });
    var fading = false;
    this._bgmWatch = setInterval(function () {
      var a = self.bgm;
      if (fading || !isFinite(a.duration) || a.paused) return;
      if (a.duration - a.currentTime > LOOP_XF + 0.05) return;
      fading = true;
      var b = self._bgmPlayers[self._bgmPlayers[0] === a ? 1 : 0];
      b.currentTime = 0;
      b._xf = 0;
      var q = b.play();
      if (q && q.catch) q.catch(function () {});
      self.bgm = b;
      var t0 = performance.now();
      var step = setInterval(function () {
        var k = Math.min(1, (performance.now() - t0) / (LOOP_XF * 1000));
        b._xf = k;
        a._xf = 1 - k;
        self._applyBgm();
        if (k >= 1) { clearInterval(step); a.pause(); fading = false; }
      }, 30);
    }, 50);
  };

  AudioManager.prototype._applyBgm = function () {
    var level = this._bgmLevel;
    this._bgmPlayers.forEach(function (a) {
      try { a.volume = Math.max(0, Math.min(1, level * a._xf)); } catch (e) { /* read-only volume (iOS) */ }
    });
  };

  /* Ramp the master BGM level (ducking, restore, fades). Timer-based, so it never stalls. */
  AudioManager.prototype._rampBgm = function (target, ms) {
    if (!this._bgmPlayers.length) return;
    clearInterval(this._ramp);
    var start = this._bgmLevel;
    var t0 = performance.now();
    var self = this;
    function step() {
      var k = Math.min(1, (performance.now() - t0) / ms);
      var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      self._bgmLevel = start + (target - start) * e;
      self._applyBgm();
      if (k >= 1) clearInterval(self._ramp);
    }
    this._ramp = setInterval(step, 30);
    step();
  };

  ATG.store = store;
  ATG.AudioManager = AudioManager;
})(window.ATG = window.ATG || {});
