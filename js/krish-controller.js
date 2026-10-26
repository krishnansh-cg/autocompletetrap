/*
 * KrishController — Krish is the mission guide and only narrator.
 *
 * Modes (Krish is one constant size in all of them, ~31% of frame height):
 *   guide      stands in the scene for intros, transitions and recaps
 *   companion  waits in a safe lower corner during ordinary play
 *   focus      steps out of the play area during unaided decisions
 *
 * Krish's approved art is static, so motion is refined pose switching
 * (double-buffered crossfade with preload, no blank frames), controlled
 * enter/exit moves and a subtle breathing loop — never distortion.
 */
(function (ATG) {
  'use strict';

  var BASE_H = 470;          // unscaled figure height in design px
  var BASE_W = 360;
  var KRISH_SCALE = 0.72;     // one size everywhere (~340px): Krish never grows or shrinks between modes
  var FLOOR = 1052;           // baseline for feet

  // Placement presets (left edge x in design px, for the scaled figure).
  var PLACES = {
    guide: { right: 1440, left: 150, center: 780, centerLeft: 560, pod: 560 },
    companion: { left: 28, right: 1540, centerLeft: 520 }
  };

  function KrishController(root, data, audio) {
    this.root = root;
    this.data = data;
    this.audio = audio;
    this.assets = data.KRISH_ASSETS;
    this.fallbacks = data.KRISH_FALLBACKS;
    this.available = {};
    this.mode = 'hidden';
    this.place = 'right';
    this.pose = 'idle';
    this.restPose = 'idle';
    this.front = 0;
    this.x = -600;
    this.scale = 1;

    root.classList.add('krish');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="krish__rig">' +
      '  <div class="krish__floor"></div>' +
      '  <div class="krish__talk-ring"></div>' +
      '  <div class="krish__body">' +
      '    <img class="krish__pose is-front" alt="" draggable="false">' +
      '    <img class="krish__pose" alt="" draggable="false">' +
      '  </div>' +
      '</div>';
    this.rig = root.querySelector('.krish__rig');
    this.imgs = root.querySelectorAll('.krish__pose');
    this.root.style.width = BASE_W + 'px';
    this.root.style.height = BASE_H + 'px';
    this._apply(true);
  }

  /* Preload every semantic pose; record which ones are really available. */
  KrishController.prototype.preload = function () {
    var self = this;
    var jobs = Object.keys(this.assets).map(function (pose) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          self.available[pose] = true;
          if (img.decode) { img.decode().then(resolve, resolve); setTimeout(resolve, 400); } else resolve();
        };
        img.onerror = function () {
          self.available[pose] = false;
          console.warn('[krish] optional pose "' + pose + '" missing; will fall back.');
          resolve();
        };
        img.src = self.assets[pose];
      });
    });
    return Promise.all(jobs).then(function () {
      self.imgs[0].src = self._resolve('idle');
    });
  };

  KrishController.prototype._resolve = function (pose) {
    if (this.available[pose] !== false && this.assets[pose]) return this.assets[pose];
    var chain = this.fallbacks[pose] || ['idle'];
    for (var i = 0; i < chain.length; i++) {
      if (this.available[chain[i]] !== false && this.assets[chain[i]]) return this.assets[chain[i]];
    }
    return this.assets.idle;
  };

  /* Crossfade to a pose. Unknown or missing poses fall back safely. */
  KrishController.prototype.setPose = function (pose) {
    if (!this.assets[pose] && !this.fallbacks[pose]) { console.warn('[krish] unknown pose ' + pose); pose = 'idle'; }
    if (pose === this.pose) return;
    this.pose = pose;
    var src = this._resolve(pose);
    var cur = this.imgs[this.front];
    if (cur.getAttribute('src') === src) return;
    var next = this.imgs[1 - this.front];
    next.src = src;
    cur.classList.remove('is-front');
    next.classList.add('is-front');
    this.front = 1 - this.front;
    this.root.dataset.pose = pose;
  };

  KrishController.prototype.rest = function (pose) {
    this.restPose = pose || 'idle';
    if (!this.audio.speaking || this.audio.currentLine && this.audio.currentLine.line.speaker !== 'krish') this.setPose(this.restPose);
  };

  /**
   * Move Krish. mode: guide | companion | focus | hidden.
   * place: preset name or explicit x. instant skips the transition.
   */
  KrishController.prototype.setMode = function (mode, place, opts) {
    opts = opts || {};
    this.mode = mode;
    if (place != null) this.place = place;
    this.root.dataset.mode = mode;
    return this._apply(!!opts.instant, opts.duration);
  };

  KrishController.prototype._target = function () {
    var mode = this.mode;
    var s = KRISH_SCALE;
    var presets = PLACES[mode === 'guide' ? 'guide' : 'companion'];
    var x = typeof this.place === 'number' ? this.place : (presets[this.place] != null ? presets[this.place] : presets.left != null ? presets.left : 40);
    // Guide places were laid out for a full-size figure: keep each one's centre.
    if (mode === 'guide') x += BASE_W * (1 - s) / 2;
    if (mode === 'focus') x = -BASE_W * s - 40;
    if (mode === 'hidden') x = this.place === 'right' ? 2000 : -BASE_W * s - 80;
    return { x: x, y: FLOOR - BASE_H * s, s: s };
  };

  KrishController.prototype._apply = function (instant, duration) {
    var t = this._target();
    var root = this.root;
    var ms = instant ? 0 : (duration || (ATG.reducedMotion ? 260 : 820));
    root.style.transitionDuration = ms + 'ms, ' + ms + 'ms';
    if (ATG.reducedMotion && !instant) root.classList.add('is-fading');
    root.style.transform = 'translate3d(' + t.x + 'px,' + t.y + 'px,0) scale(' + t.s + ')';
    root.style.opacity = this.mode === 'hidden' || this.mode === 'focus' ? '0' : '1';
    this.x = t.x;
    this.scale = t.s;
    return new Promise(function (resolve) { setTimeout(function () { root.classList.remove('is-fading'); resolve(); }, ms + 20); });
  };

  /* Walk in from off-frame using the approved walk pose, then settle. */
  KrishController.prototype.enter = function (mode, place, from) {
    var self = this;
    this.mode = 'hidden';
    this.place = from || 'right';
    this._apply(true);
    this.setPose('enter');
    return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); setTimeout(r, 60); })
      .then(function () { return self.setMode(mode, place, { duration: ATG.reducedMotion ? 260 : 1100 }); })
      .then(function () { self.setPose(self.restPose); });
  };

  /* The hint beacon's fixed spot: by the shoulder of Krish's usual bottom-left corner place. */
  KrishController.prototype.cornerPoint = function () {
    var s = KRISH_SCALE, x = PLACES.companion.left, y = FLOOR - BASE_H * s;
    return { x: x + BASE_W * s * 0.78, y: y + BASE_H * s * 0.06 };
  };

  /* Krish's settled box (target, not mid-move) in design px; null when off-frame. */
  KrishController.prototype.box = function () {
    var t = this._target();
    if (this.mode === 'focus' || this.mode === 'hidden') return null;
    return { x: t.x, y: t.y, w: BASE_W * t.s, h: BASE_H * t.s, cx: t.x + BASE_W * t.s / 2 };
  };

  /* Speak a Krish line with a pose; returns to the rest pose afterwards. */
  KrishController.prototype.say = function (id, pose, extra) {
    var self = this;
    return this.audio.say(id, {
      noCaption: !!(extra && extra.noCaption),
      onStart: function () { self.setPose(pose || 'talk'); self.root.classList.add('is-talking'); },
      onEnd: function () { self.root.classList.remove('is-talking'); self.setPose(self.restPose); }
    });
  };

  ATG.KrishController = KrishController;
})(window.ATG = window.ATG || {});
