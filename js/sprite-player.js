/*
 * SpritePlayer — frame-stepped playback over a sprite sheet / pose atlas.
 *
 * Supports sheet dimensions, frame count, columns, fps, loop, one-shot,
 * completion callbacks (with a safety timeout) and automatic return to idle.
 * Each frame selects a sheet cell and may carry keyed offsets
 * (dx/dy in cell px, s scale, o opacity, b brightness), so a static pose atlas
 * can play authored multi-frame motion. Frames step at the authored fps rather
 * than tweening, which keeps character motion deliberate.
 */
(function (ATG) {
  'use strict';

  var active = new Set();
  var rafId = null;

  function tick(now) {
    active.forEach(function (p) { p._tick(now); });
    rafId = active.size ? requestAnimationFrame(tick) : null;
  }
  function schedule(p) {
    active.add(p);
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /**
   * @param {HTMLElement} el  container; the player renders a child element into it
   * @param {object} def      sprite definition from ATG.DATA.SPRITES
   * @param {object} opts     { width, height } display size in design px
   */
  function SpritePlayer(el, def, opts) {
    this.def = def;
    this.el = el;
    this.w = opts.width;
    this.h = opts.height;
    this.scale = this.w / def.frameWidth;
    var rows = Math.ceil(def.frameCount / def.columns);
    this.node = document.createElement('div');
    this.node.className = 'sprite';
    this.node.setAttribute('aria-hidden', 'true');
    var s = this.node.style;
    s.width = this.w + 'px';
    s.height = this.h + 'px';
    // The sheet arrives through the preloader (a local blob: URL once it has loaded).
    ATG.assetReady(def.sheet).then(function (url) { s.backgroundImage = 'url("' + url + '")'; });
    s.backgroundSize = (def.columns * this.w) + 'px ' + (rows * this.h) + 'px';
    el.appendChild(this.node);
    this.name = null;
    this.anim = null;
    this.frame = 0;
    this.last = 0;
    this.onComplete = null;
    this._safety = null;
    this._holdTimer = null;
    this._renderedKey = '';
  }

  SpritePlayer.prototype.has = function (name) { return !!this.def.animations[name]; };

  /**
   * Play an animation. Returns a promise resolved when a one-shot completes
   * (immediately for loops). Missing animations fall back to idle with a warning.
   */
  SpritePlayer.prototype.play = function (name, options) {
    options = options || {};
    var anim = this.def.animations[name];
    if (!anim) {
      console.warn('[sprite] missing animation "' + name + '"; using idle.');
      name = 'idle';
      anim = this.def.animations.idle;
    }
    this._finish(false);
    this.name = name;
    this.anim = anim;
    this.frame = 0;
    this.last = 0;
    var self = this;
    var loop = options.loop != null ? options.loop : anim.loop;
    this.loop = loop;
    this.returnTo = options.returnTo || anim.next || null;
    var reduced = ATG.reducedMotion;

    if (reduced) {
      // Reduced motion: show the key pose of the state, no stepping loops.
      var key = anim.frames[anim.frames.length - 1];
      if (name === 'off') key = anim.frames[0];
      this._render(loop ? { c: anim.frames[0].c, o: anim.frames[0].o } : { c: key.c, o: key.o });
      if (loop) return Promise.resolve();
      return new Promise(function (resolve) {
        self.onComplete = resolve;
        self._holdTimer = setTimeout(function () { self._complete(); }, Math.min(700, (anim.hold || 300) + 200));
      });
    }

    this._render(anim.frames[0]);
    schedule(this);
    if (loop) return Promise.resolve();
    return new Promise(function (resolve) {
      self.onComplete = resolve;
      var duration = (anim.frames.length / anim.fps) * 1000 + (anim.hold || 0);
      self._safety = setTimeout(function () { self._complete(); }, duration + 600);
    });
  };

  SpritePlayer.prototype._tick = function (now) {
    var anim = this.anim;
    if (!anim) { active.delete(this); return; }
    if (!this.last) this.last = now;
    var step = 1000 / anim.fps;
    if (now - this.last < step) return;
    this.last += step;
    if (now - this.last > step * 4) this.last = now; // tab was hidden: don't fast-forward
    this.frame += 1;
    if (this.frame >= anim.frames.length) {
      if (this.loop) this.frame = 0;
      else {
        this.frame = anim.frames.length - 1;
        active.delete(this);
        var self = this;
        this._holdTimer = setTimeout(function () { self._complete(); }, anim.hold || 0);
        return;
      }
    }
    this._render(anim.frames[this.frame]);
  };

  SpritePlayer.prototype._render = function (f) {
    var d = this.def;
    var col = f.c % d.columns;
    var row = Math.floor(f.c / d.columns);
    var k = this.scale;
    var key = f.c + '|' + (f.dx || 0) + '|' + (f.dy || 0) + '|' + (f.s || 1) + '|' + (f.o == null ? 1 : f.o) + '|' + (f.b || 1);
    if (key === this._renderedKey) return;
    this._renderedKey = key;
    var s = this.node.style;
    s.backgroundPosition = (-col * this.w) + 'px ' + (-row * this.h) + 'px';
    s.transform = 'translate3d(' + ((f.dx || 0) * k) + 'px,' + ((f.dy || 0) * k) + 'px,0) scale(' + (f.s || 1) + ')';
    s.opacity = f.o == null ? 1 : f.o;
    s.filter = f.b && f.b !== 1 ? 'brightness(' + f.b + ')' : '';
  };

  SpritePlayer.prototype._complete = function () {
    clearTimeout(this._safety);
    clearTimeout(this._holdTimer);
    var cb = this.onComplete;
    this.onComplete = null;
    var next = this.returnTo;
    if (next && this.def.animations[next]) this.play(next);
    if (cb) cb();
  };

  /* Stop the current animation; optionally resolve its pending promise. */
  SpritePlayer.prototype._finish = function (resolvePending) {
    clearTimeout(this._safety);
    clearTimeout(this._holdTimer);
    active.delete(this);
    var cb = this.onComplete;
    this.onComplete = null;
    if (cb) cb(resolvePending);
  };

  SpritePlayer.prototype.stop = function () { this._finish(true); this.anim = null; };

  ATG.SpritePlayer = SpritePlayer;
})(window.ATG = window.ATG || {});
