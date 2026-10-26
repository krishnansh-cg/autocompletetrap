/*
 * InputManager — global activity tracking: keyboard vs pointer (focus rings
 * only for keyboard users) and idle time for the hint beacon.
 */
(function (ATG) {
  'use strict';

  function InputManager(game) {
    this.game = game;
    var self = this;
    // Track keyboard vs pointer so programmatic focus only shows rings for keyboard users.
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') document.documentElement.classList.add('kbd');
      self.game.hints && self.game.hints.activity(e);
    }, true);
    window.addEventListener('pointerdown', function (e) {
      document.documentElement.classList.remove('kbd');
      self.game.hints && self.game.hints.activity(e);
    }, true);
  }

  ATG.InputManager = InputManager;
})(window.ATG = window.ATG || {});
