/*
 * HintManager — after 12s of genuine inactivity, a subtle beacon lights up
 * in one fixed bottom-left spot (beside Krish's usual corner). Pressing it shows the context hint as a one-sentence bubble in
 * the caption slot (and runs any pulse / spoken line that goes with it). The idle
 * clock only runs while: narration has ended, an interaction is active, no
 * transition is running and no feedback animation is playing. There is no
 * permanent hint control, and contexts without a hint (Dot's decision) never
 * arm it.
 */
(function (ATG) {
  'use strict';

  var IDLE_MS = 12000;

  function HintManager(opts) {
    this.audio = opts.audio;
    this.machine = opts.machine;
    this.krish = opts.krish;
    this.isBusy = opts.isBusy;
    this.beacon = opts.beacon;
    this.bubble = opts.bubble;
    this.bubbleText = opts.bubble.querySelector('.hint-bubble__text');
    this.lines = opts.lines || {};
    this.onShow = opts.onShow || function () {};
    this.context = null;
    this.idleSince = 0;
    this.visible = false;
    this.bubbleTimer = null;
    var self = this;
    this.beacon.addEventListener('click', function () { self.trigger(); });
    // Another line's caption takes the same slot, so it replaces the bubble.
    this.audio.on('caption', function () { self._hideBubble(); });
    setInterval(function () { self._tick(); }, 250);
  }

  /*
   * ctx: { text, line, pose, run } — call when an interaction becomes available.
   *   text  sentence shown in the bubble (string or function); defaults to the line's text
   *   line  optional Krish VO line spoken with the hint (no caption: the bubble shows it)
   *   run   optional visual nudge (pulse the target)
   */
  HintManager.prototype.setContext = function (ctx) {
    this.context = ctx || null;
    this.idleSince = 0;
    this._hide();
    this._hideBubble();
  };
  HintManager.prototype.clear = function () { this.setContext(null); };

  /* Any meaningful learner action resets the clock (pressing the beacon itself is not one). */
  HintManager.prototype.activity = function (e) {
    if (e && e.target && this.beacon.contains(e.target)) return;
    this.idleSince = 0;
    if (this.visible) this._hide();
  };

  HintManager.prototype._eligible = function () {
    return !!(this.context && !this.audio.speaking && !this.machine.locked && !this.isBusy());
  };

  HintManager.prototype._tick = function () {
    if (!this._eligible()) { this.idleSince = 0; if (this.visible && !this.context) this._hide(); return; }
    var now = performance.now();
    if (!this.idleSince) { this.idleSince = now; return; }
    if (!this.visible && now - this.idleSince >= IDLE_MS) this._show();
    if (this.visible) this._place();
  };

  HintManager.prototype._place = function () {
    var p = this.krish.cornerPoint(); // bottom-left, the same spot on every screen
    this.beacon.style.transform = 'translate3d(' + (p.x - 32) + 'px,' + (p.y - 32) + 'px,0)';
  };

  HintManager.prototype._show = function () {
    this._place();
    this.visible = true;
    this.beacon.hidden = false;
    this.beacon.classList.add('is-on');
    this.onShow();
  };

  HintManager.prototype._hide = function () {
    this.visible = false;
    this.beacon.classList.remove('is-on');
    this.beacon.hidden = true;
  };

  HintManager.prototype._text = function (ctx) {
    var t = typeof ctx.text === 'function' ? ctx.text() : ctx.text;
    if (!t && ctx.line && this.lines[ctx.line]) t = this.lines[ctx.line].text;
    return t || '';
  };

  HintManager.prototype._showBubble = function (text) {
    if (!text) return;
    var b = this.bubble;
    clearTimeout(this.bubbleTimer);
    this.bubbleText.textContent = text;
    b.hidden = false;
    void b.offsetWidth;
    b.classList.add('is-on');
    var self = this;
    var ms = Math.max(5000, text.split(/\s+/).length * 420 + 3000);
    this.bubbleTimer = setTimeout(function () { self._hideBubble(); }, ms);
  };

  HintManager.prototype._hideBubble = function () {
    var b = this.bubble;
    clearTimeout(this.bubbleTimer);
    if (b.hidden) return;
    b.classList.remove('is-on');
    this.bubbleTimer = setTimeout(function () { b.hidden = true; }, 260);
  };

  HintManager.prototype.trigger = function () {
    var ctx = this.context;
    this._hide();
    this.idleSince = 0;
    if (!ctx) return;
    this._showBubble(this._text(ctx));
    if (ctx.run) ctx.run();
    if (ctx.line) this.krish.say(ctx.line, ctx.pose || 'point', { noCaption: true });
  };

  ATG.HintManager = HintManager;
})(window.ATG = window.ATG || {});
