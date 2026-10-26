/*
 * Mission state machine. All flow goes through `go()`: it validates the edge,
 * checks prerequisites, holds a transition lock, and cancels any sequence
 * still running for the previous state. State names are internal only.
 */
(function (ATG) {
  'use strict';

  var STATES = ['TITLE', 'KRISH_INTRO', 'PHONE_HOOK', 'BLIP_BOOT', 'PREDICTION_RUN', 'CAUSE_GUESS', 'MEMORY_DIVE',
    'MEMORY_SCAN', 'REPAIR_BAY', 'RETEST', 'BYTE_ARRIVAL', 'BYTE_DEMO', 'RULE_FORGE', 'DOT_ARRIVAL',
    'DOT_CHALLENGE', 'COMPLETE'];

  // Forward edges follow the storyboard exactly.
  var FORWARD = {};
  for (var i = 0; i < STATES.length - 1; i++) FORWARD[STATES[i]] = STATES[i + 1];

  // Back always lands on a safe checkpoint that re-renders from saved flags.
  var BACK = {
    BLIP_BOOT: 'PHONE_HOOK',
    PREDICTION_RUN: 'BLIP_BOOT',
    CAUSE_GUESS: 'PREDICTION_RUN',
    MEMORY_DIVE: 'CAUSE_GUESS',
    MEMORY_SCAN: 'CAUSE_GUESS',
    REPAIR_BAY: 'MEMORY_SCAN',
    RETEST: 'REPAIR_BAY',
    BYTE_ARRIVAL: 'RETEST',
    BYTE_DEMO: 'RETEST',
    RULE_FORGE: 'BYTE_DEMO',
    DOT_ARRIVAL: 'RULE_FORGE',
    DOT_CHALLENGE: 'RULE_FORGE',
    COMPLETE: 'DOT_CHALLENGE'
  };

  // Entering a state requires the learning work before it to be resolved.
  var REQUIRES = {
    BLIP_BOOT: function (f) { return f.phoneDone; },
    CAUSE_GUESS: function (f) { return f.trialsDone; },
    MEMORY_DIVE: function (f) { return f.causeGuess !== null; },
    MEMORY_SCAN: function (f) { return f.causeGuess !== null; },
    REPAIR_BAY: function (f) { return f.memoryDone; },
    RETEST: function (f) { return f.repairResolved; },
    BYTE_ARRIVAL: function (f) { return f.retestDone; },
    BYTE_DEMO: function (f) { return f.retestDone; },
    RULE_FORGE: function (f) { return f.byteDemoDone; },
    DOT_ARRIVAL: function (f) { return f.ruleAnswer !== null; },
    DOT_CHALLENGE: function (f) { return f.ruleAnswer !== null; },
    COMPLETE: function (f) { return f.dotAnswer !== null; }
  };

  function Cancelled() { this.name = 'Cancelled'; }

  function StateMachine() {
    this.state = null;
    this.locked = false;
    this.token = 0;
    this.handlers = {};
    this.listeners = [];
    this.flags = {
      phoneDone: false,
      phonePick: null,
      phoneGuess: null,
      trialsDone: false,
      trialIndex: 0,
      predictionMisses: 0,
      causeGuess: null,
      byteDemoDone: false,
      memoryDone: false,
      memoryFound: 0,
      repairResolved: false,
      repairMisses: 0,
      repairRejected: [],
      retestDone: false,
      ruleAnswer: null,
      ruleFixed: false,
      dotAnswer: null,
      dotAnswers: [],
      optionOrder: null,
      finished: false
    };
  }

  StateMachine.prototype.register = function (state, handler) { this.handlers[state] = handler; };
  StateMachine.prototype.onChange = function (fn) { this.listeners.push(fn); };

  StateMachine.prototype.canGo = function (to, via) {
    if (STATES.indexOf(to) < 0) return false;
    if (via === 'dev') return ATG.DEV === true;
    if (via === 'back') { if (BACK[this.state] !== to) return false; }
    else if (via === 'start') { if (!(this.state === null && to === 'TITLE')) return false; }
    else if (FORWARD[this.state] !== to) return false;
    var req = REQUIRES[to];
    return !req || !!req(this.flags);
  };

  /* Transition. Rejects illegal edges and re-entry while a transition runs. */
  StateMachine.prototype.go = function (to, via) {
    if (this.locked) { console.warn('[flow] transition ignored while locked: ' + to); return false; }
    if (!this.canGo(to, via)) { console.warn('[flow] illegal transition ' + this.state + ' → ' + to); return false; }
    var from = this.state;
    this.token += 1;
    this.state = to;
    var self = this;
    this.listeners.forEach(function (fn) { fn(to, from, via); });
    var handler = this.handlers[to];
    if (handler) {
      var seq = new Sequence(this, this.token);
      Promise.resolve()
        .then(function () { return handler(seq, { from: from, via: via, rerender: via === 'back' || via === 'dev' }); })
        .catch(function (err) {
          if (err instanceof Cancelled) return;
          console.error('[flow] error in ' + to, err);
          self.locked = false;
        });
    }
    return true;
  };

  StateMachine.prototype.next = function () { return this.go(FORWARD[this.state]); };
  StateMachine.prototype.backTarget = function () {
    var t = BACK[this.state];
    return t && this.canGo(t, 'back') ? t : null;
  };

  /* Short hard lock for camera moves / scene swaps. */
  StateMachine.prototype.lock = function () { this.locked = true; };
  StateMachine.prototype.unlock = function () { this.locked = false; };

  /*
   * A Sequence is bound to one state entry. Every await goes through it, so a
   * Back press (which bumps the token) cleanly aborts the old script.
   */
  function Sequence(machine, token) { this.m = machine; this.token = token; }
  Sequence.prototype.alive = function () { return this.m.token === this.token; };
  Sequence.prototype.check = function () { if (!this.alive()) throw new Cancelled(); };
  Sequence.prototype.run = function (promise) {
    var self = this;
    return Promise.resolve(promise).then(function (v) { self.check(); return v; });
  };
  Sequence.prototype.wait = function (ms) {
    var self = this;
    return new Promise(function (resolve) { setTimeout(resolve, ms); })
      .then(function () { self.check(); });
  };
  /* Wait for a learner action; resolves with the value passed to the resolver. */
  Sequence.prototype.until = function (setup) {
    var self = this;
    return new Promise(function (resolve) { setup(resolve); }).then(function (v) { self.check(); return v; });
  };

  ATG.STATES = STATES;
  ATG.Cancelled = Cancelled;
  ATG.StateMachine = StateMachine;
})(window.ATG = window.ATG || {});
