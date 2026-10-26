/*
 * ProgressManager — SKAI vertical progress strip on the right edge.
 * Five hatched segments fill from the bottom (future = cream, current =
 * gently pulsing, complete = orange) under a small milestone counter.
 * Internal meanings (never displayed): Discovery, Investigate, Repair,
 * Compare, Prove.
 */
(function (ATG) {
  'use strict';

  function ProgressManager(root, audio) {
    this.root = root;
    this.audio = audio;
    this.done = [false, false, false, false, false];
    this.current = 0;
    root.setAttribute('role', 'img');
    var html = '<span class="rail__rivet rail__rivet--tl"></span><span class="rail__rivet rail__rivet--tr"></span>' +
      '<span class="rail__rivet rail__rivet--bl"></span><span class="rail__rivet rail__rivet--br"></span>' +
      '<span class="rail__count" aria-hidden="true"></span><span class="rail__track">';
    // Top-to-bottom in the DOM; the last milestone sits at the top.
    for (var i = 4; i >= 0; i--) html += '<span class="rail__seg" data-i="' + i + '"></span>';
    html += '</span>';
    root.innerHTML = html;
    this.count = root.querySelector('.rail__count');
    this.segs = {};
    var segs = root.querySelectorAll('.rail__seg');
    for (var k = 0; k < segs.length; k++) this.segs[segs[k].dataset.i] = segs[k];
    this.render();
  }

  ProgressManager.prototype.setCurrent = function (i) { this.current = i; this.render(); };

  ProgressManager.prototype.complete = function (i) {
    if (this.done[i]) return;
    this.done[i] = true;
    if (this.current <= i) this.current = Math.min(4, i + 1);
    this.audio.sfx('progress_node', 0.5);
    var seg = this.segs[i];
    seg.classList.add('is-just-done');
    setTimeout(function () { seg.classList.remove('is-just-done'); }, 1200);
    this.render();
  };

  ProgressManager.prototype.render = function () {
    var count = 0;
    for (var i = 0; i < 5; i++) {
      var s = this.segs[i];
      s.classList.toggle('is-done', this.done[i]);
      s.classList.toggle('is-current', !this.done[i] && i === this.current);
      if (this.done[i]) count++;
    }
    this.count.textContent = count + '/5';
    this.root.setAttribute('aria-label', 'Mission progress: ' + count + ' of 5 milestones complete');
  };

  ATG.ProgressManager = ProgressManager;
})(window.ATG = window.ATG || {});
