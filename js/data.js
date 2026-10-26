/*
 * Mission data — the single source of truth for learner-facing content.
 * Every phrase, option, memory sentence and VO line comes from BUILD.md.
 * tools/render-vo.mjs reads this file to synthesise any missing VO.
 */
(function (root) {
  'use strict';

  var IMG = 'assets/images/';
  var VO = 'assets/audio/vo/';

  // Semantic Krish pose map. Paths point at the approved, locally copied art.
  // Missing poses fall back through KRISH_FALLBACKS (see krish-controller.js).
  var KRISH_ASSETS = {
    idle: IMG + 'characters/krish/char_krish_idle.webp',
    talk: IMG + 'characters/krish/char_krish_talk.webp',
    point: IMG + 'characters/krish/char_krish_point.webp',
    think: IMG + 'characters/krish/char_krish_think.webp',
    encourage: IMG + 'characters/krish/char_krish_encourage.webp',
    serious: IMG + 'characters/krish/char_krish_serious.webp',
    happy: IMG + 'characters/krish/char_krish_happy.webp',
    celebrate: IMG + 'characters/krish/char_krish_celebrate.webp',
    enter: IMG + 'characters/krish/char_krish_enter.webp',
    pointRight: IMG + 'characters/krish/char_krish_pose_point_right.webp'
  };

  var KRISH_FALLBACKS = {
    talk: ['idle'],
    point: ['talk', 'idle'],
    pointRight: ['point', 'talk', 'idle'],
    think: ['serious', 'idle'],
    encourage: ['happy', 'idle'],
    serious: ['think', 'idle'],
    happy: ['encourage', 'idle'],
    celebrate: ['happy', 'idle'],
    enter: ['idle']
  };

  /*
   * Character atlases. Each atlas is a grid of fixed cells sharing one anchor
   * (bottom-centre). Animations are frame lists: a cell index plus optional
   * per-frame offsets (dx, dy in cell px), scale (s), opacity (o) and
   * brightness (b). Frames step at the declared fps like a sprite sheet.
   */
  function bob(cell, amp, n) {
    var frames = [];
    for (var i = 0; i < n; i++) frames.push({ c: cell, dy: -Math.round(Math.sin((i / n) * Math.PI * 2) * amp) });
    return frames;
  }

  var SPRITES = {
    blip: {
      sheet: IMG + 'characters/blip/spr_blip_states.webp',
      frameWidth: 512, frameHeight: 512, columns: 3, frameCount: 6,
      cells: { boot: 0, idle: 1, talk: 2, confused: 3, awkward: 4, celebrate: 5 },
      animations: {
        off: { fps: 1, loop: true, frames: [{ c: 0, o: 0.0 }] },
        boot: {
          fps: 12, loop: false, next: 'idle',
          frames: [
            { c: 0, o: 0.0, b: 0.4, dy: 34 }, { c: 0, o: 0.55, b: 1.6, dy: 34 }, { c: 0, o: 0.05, b: 0.4, dy: 34 },
            { c: 0, o: 0.75, b: 1.9, dy: 32 }, { c: 0, o: 0.2, b: 0.6, dy: 32 }, { c: 0, o: 1, b: 1.4, dy: 30 },
            { c: 0, o: 1, b: 1.1, dy: 24 }, { c: 0, o: 1, b: 1.0, dy: 16 }, { c: 0, o: 1, b: 1.0, dy: 6, dx: -3 },
            { c: 1, o: 1, b: 1.5, dy: -4, dx: 3 }, { c: 1, o: 1, b: 1.2, dy: -14 }, { c: 1, o: 1, b: 1.0, dy: -18, dx: -2 },
            { c: 1, o: 1, dy: -10, dx: 2 }, { c: 1, o: 1, dy: -2 }, { c: 1, o: 1, dy: 3 }, { c: 1, o: 1, dy: 0 }
          ]
        },
        idle: { fps: 8, loop: true, frames: bob(1, 7, 10) },
        talk: { fps: 9, loop: true, frames: [{ c: 2, dy: 0 }, { c: 2, dy: -4 }, { c: 2, dy: -7 }, { c: 2, dy: -4 }, { c: 2, dy: 0 }, { c: 2, dy: 2 }] },
        confident: { fps: 10, loop: false, next: 'idle', frames: [{ c: 2, dy: 0 }, { c: 2, dy: -8 }, { c: 2, dy: -14 }, { c: 2, dy: -10 }, { c: 2, dy: -4 }, { c: 2, dy: 0 }, { c: 2, dy: 0 }, { c: 2, dy: 0 }, { c: 2, dy: 0 }, { c: 2, dy: 0 }] },
        confused: { fps: 10, loop: false, next: 'idle', hold: 900, frames: [{ c: 3, dx: 0 }, { c: 3, dx: -5 }, { c: 3, dx: -8, dy: 2 }, { c: 3, dx: -5 }, { c: 3, dx: 0 }, { c: 3, dx: 4 }, { c: 3, dx: 2 }, { c: 3, dx: 0 }, { c: 3 }, { c: 3 }, { c: 3 }] },
        awkward: { fps: 10, loop: false, next: 'idle', hold: 900, frames: [{ c: 4, dy: 4 }, { c: 4, dy: 8 }, { c: 4, dy: 10, dx: -3 }, { c: 4, dy: 8, dx: 3 }, { c: 4, dy: 10, dx: -3 }, { c: 4, dy: 8, dx: 2 }, { c: 4, dy: 6 }, { c: 4, dy: 6 }, { c: 4, dy: 5 }, { c: 4, dy: 4 }, { c: 4, dy: 4 }, { c: 4, dy: 2 }] },
        celebrate: {
          fps: 12, loop: false, next: 'idle', hold: 500,
          frames: [
            { c: 1, dy: 6, s: 0.97 }, { c: 1, dy: 10, s: 0.95 }, { c: 5, dy: -10, s: 1.03 }, { c: 5, dy: -34, s: 1.04 }, { c: 5, dy: -48, s: 1.04 },
            { c: 5, dy: -52, s: 1.03 }, { c: 5, dy: -44 }, { c: 5, dy: -26 }, { c: 5, dy: -6 }, { c: 5, dy: 6, s: 0.98 },
            { c: 5, dy: -18 }, { c: 5, dy: -26 }, { c: 5, dy: -18 }, { c: 5, dy: -4 }, { c: 5, dy: 0 }, { c: 5, dy: 0 }
          ]
        }
      }
    },
    byte: {
      sheet: IMG + 'characters/byte/spr_byte_states.webp',
      frameWidth: 512, frameHeight: 512, columns: 3, frameCount: 5,
      cells: { enter: 0, idle: 1, talk: 2, process: 3, acknowledge: 4 },
      animations: {
        off: { fps: 1, loop: true, frames: [{ c: 1, o: 0 }] },
        enter: {
          fps: 12, loop: false, next: 'idle',
          frames: [
            { c: 0, o: 0, s: 0.6, dy: 60, b: 2 }, { c: 0, o: 0.3, s: 0.72, dy: 44, b: 1.9 }, { c: 0, o: 0.6, s: 0.84, dy: 30, b: 1.7 },
            { c: 0, o: 0.85, s: 0.94, dy: 16, b: 1.5 }, { c: 0, o: 1, s: 1.0, dy: 6, b: 1.3 }, { c: 0, o: 1, s: 1.02, dy: 0, b: 1.15 },
            { c: 0, o: 1, s: 1.01, dy: -4 }, { c: 0, o: 1, dy: -2 }, { c: 0, o: 1, dy: 0 }, { c: 0, o: 1, dy: 0 }, { c: 0, o: 1 },
            { c: 1, o: 1, dy: 2 }, { c: 1, o: 1, dy: 0 }, { c: 1, o: 1, dy: 0 }
          ]
        },
        idle: { fps: 8, loop: true, frames: bob(1, 5, 10) },
        talk: { fps: 8, loop: true, frames: [{ c: 2, dy: 0 }, { c: 2, dy: -3 }, { c: 2, dy: -5 }, { c: 2, dy: -3 }, { c: 2, dy: 0 }, { c: 2, dy: 1 }] },
        process: { fps: 12, loop: true, frames: [{ c: 3, b: 1.0 }, { c: 3, b: 1.08, dy: -2 }, { c: 3, b: 1.16, dy: -3 }, { c: 3, b: 1.22, dy: -4 }, { c: 3, b: 1.16, dy: -3 }, { c: 3, b: 1.08, dy: -2 }, { c: 3, b: 1.0 }, { c: 3, b: 0.96 }, { c: 3, b: 1.0 }, { c: 3, b: 1.04 }] },
        acknowledge: { fps: 10, loop: false, next: 'idle', hold: 700, frames: [{ c: 4, dy: 0 }, { c: 4, dy: -6 }, { c: 4, dy: -10 }, { c: 4, dy: -6 }, { c: 4, dy: 0 }, { c: 4, dy: 2 }, { c: 4, dy: 0 }, { c: 4 }, { c: 4 }, { c: 4 }] }
      }
    },
    dot: {
      sheet: IMG + 'characters/dot/spr_dot_states.webp',
      frameWidth: 627, frameHeight: 627, columns: 2, frameCount: 4,
      cells: { enter: 0, idle: 1, think: 2, react: 3 },
      animations: {
        off: { fps: 1, loop: true, frames: [{ c: 1, o: 0 }] },
        enter: {
          fps: 12, loop: false, next: 'idle',
          frames: [
            { c: 0, o: 0, dx: -120, dy: -30, s: 0.8 }, { c: 0, o: 0.4, dx: -90, dy: -40, s: 0.86 }, { c: 0, o: 0.75, dx: -60, dy: -44, s: 0.92 },
            { c: 0, o: 1, dx: -34, dy: -40, s: 0.97 }, { c: 0, o: 1, dx: -14, dy: -28, s: 1 }, { c: 0, o: 1, dx: -4, dy: -12 },
            { c: 0, o: 1, dx: 0, dy: 0 }, { c: 0, o: 1, dy: 4 }, { c: 0, o: 1, dy: 0 }, { c: 1, o: 1, dy: -3 }, { c: 1, o: 1, dy: 0 }, { c: 1, o: 1 }
          ]
        },
        idle: { fps: 8, loop: true, frames: bob(1, 6, 10) },
        think: { fps: 8, loop: true, frames: bob(2, 4, 10) },
        react: { fps: 10, loop: false, next: 'idle', hold: 800, frames: [{ c: 3, dy: 0 }, { c: 3, dy: -8 }, { c: 3, dy: -14 }, { c: 3, dy: -10 }, { c: 3, dy: -2 }, { c: 3, dy: 3 }, { c: 3, dy: 0 }, { c: 3 }, { c: 3 }, { c: 3 }] }
      }
    }
  };

  var BACKGROUNDS = {
    title: IMG + 'backgrounds/bg_title_chamber.webp',
    lab: IMG + 'backgrounds/bg_prediction_lab.webp',
    vault: IMG + 'backgrounds/bg_byte_vault.webp',
    memory: IMG + 'backgrounds/bg_memory_core.webp',
    repair: IMG + 'backgrounds/bg_repair_bay.webp',
    logic: IMG + 'backgrounds/bg_logic_chamber.webp',
    dot: IMG + 'backgrounds/bg_dot_lab.webp',
    complete: IMG + 'backgrounds/bg_complete.webp'
  };

  var IMAGES = {
    tokens: {
      sandwich: IMG + 'tokens/token_sandwich.webp',
      juice: IMG + 'tokens/token_juice.webp',
      cookie: IMG + 'tokens/token_cookie.webp',
      apple: IMG + 'tokens/token_apple.webp',
      pizza: IMG + 'tokens/token_pizza.webp'
    },
    props: {
      memoryCore: IMG + 'props/prop_blip_memory_core.webp',
      vault: IMG + 'props/prop_byte_data_vault.webp',
      cartridge: IMG + 'props/prop_data_cartridge.webp',
      logicCore: IMG + 'props/prop_logic_core.webp'
    },
    story: {
      school: IMG + 'backgrounds/story_school_launch.webp',
      strange: IMG + 'backgrounds/story_strange_suggestions.webp',
      night: IMG + 'backgrounds/story_power_down.webp',
      finalePhone: IMG + 'backgrounds/story_finale_phone.webp',
      finaleTeam: IMG + 'backgrounds/story_finale_team.webp'
    },
    fx: {
      ring: IMG + 'fx/fx_success_ring.webp',
      shard1: IMG + 'fx/fx_success_shard_01.webp',
      shard2: IMG + 'fx/fx_success_shard_02.webp'
    }
  };

  var AUDIO = {
    bgm: 'assets/audio/bgm/bgm_prediction_lab.ogg',
    sfx: ['button_hover', 'button_press', 'choice_lock', 'prediction_process', 'prediction_reveal', 'wrong_soft',
      'correct', 'data_collect', 'cartridge_insert', 'cartridge_eject', 'memory_open',
      'logic_link', 'progress_node', 'hint', 'character_boot', 'completion_sting']
  };

  /*
   * Voice-over script. Shipped audio is ElevenLabs (eleven_v3, Indian accent):
   * Krish = voice 4iqKdEXMW8NRF8USiS3Q; Blip = Elli, Byte = George, Dot = Rachel,
   * robot-processed by tools/process-vo.mjs from the raw takes kept outside the project.
   * `voice` below is only the offline macOS fallback used by tools/render-vo.mjs
   * when a line is added or its text changes. Captions always come from `text`.
   */
  var V = {
    krish: { voice: 'Rishi', rate: 138 },
    blip: { voice: 'Tara', rate: 168, pitch: 1.24, fx: 'blip' },
    byte: { voice: 'Aman', rate: 132, pitch: 0.97, fx: 'byte' },
    dot: { voice: 'Tara', rate: 160, pitch: 1.32, fx: 'dot' }
  };

  // ext: lines recorded from Oct 2026 are ElevenLabs MP3 (same Krish voice); the originals stay Ogg/Opus.
  // The MP3 takes measure ~1.4 dB hotter than the originals, so they play at gain 0.85 to sit level with them.
  function line(speaker, key, text, ext) {
    return { speaker: speaker, text: text, src: VO + speaker + '/vo_' + speaker + '_' + key + '.' + (ext || 'ogg'), voice: V[speaker], gain: ext === 'mp3' ? 0.85 : 1 };
  }

  var LINES = {
    // Opening: a phone keyboard shows what autocomplete is before Blip appears.
    k_greet: line('krish', 'greet', 'Hi, I’m Krish! Something’s going wrong in our lab tonight.', 'mp3'),
    k_intro: line('krish', 'intro', 'Let’s type a message on this phone. Tap the highlighted keys.', 'mp3'),
    k_type_hint: line('krish', 'type_hint', 'Tap the highlighted key to keep typing.'),
    k_phone_pick: line('krish', 'phone_pick', 'Look! The phone is suggesting words. Tap one.'),
    k_phone_ask: line('krish', 'phone_ask', 'Where do you think these suggestions come from?'),
    k_phone_ack: line('krish', 'phone_ack', 'Hold that thought. Let’s find out!'),
    k_blip_intro: line('krish', 'blip_intro', 'This is Blip. Blip is a tiny version of this. Tap the pod to wake Blip up.'),
    k_pod_hint: line('krish', 'pod_hint', 'Tap the pod to wake Blip up.'),
    k_stakes: line('krish', 'stakes', 'At nine tomorrow, three hundred children will write with Blip. But its suggestions are strange! If we can’t fix it tonight, Blip gets switched off.'),
    blip_hello: line('blip', 'hello', 'Hi! I’m Blip. I’m ready to predict your next word... probably.'),
    k_prediction_setup: line('krish', 'prediction_first', 'Blip guesses the next word, like a phone. Let’s test it! You guess Blip’s word first, then see what it really picks. Every surprise is a clue!'),
    k_predict_hint: line('krish', 'predict_hint', 'Pick the word you think Blip will choose.'),
    k_predict_ask: line('krish', 'predict_ask', 'Which word do you think Blip will choose?'),
    // Each trial sentence is read aloud while it types in.
    k_sentence_1: line('krish', 'sentence_1', 'I want to eat a...'),
    k_sentence_2: line('krish', 'sentence_2', 'My pet is a...'),
    k_sentence_3: line('krish', 'sentence_3', 'For my birthday, I want a...'),
    // Options read aloud; each button appears as its word starts (see js/vo-cues.js).
    k_options_1: line('krish', 'options_1', 'Pizza... sandwich... or burger?'),
    k_options_2: line('krish', 'options_2', 'Cat... dog... or sandwich?'),
    k_options_3: line('krish', 'options_3', 'Cookie... bike... or sandwich?'),
    k_react_reasonable: line('krish', 'react_reasonable', 'That seems reasonable.'),
    k_react_hmm: line('krish', 'react_hmm', 'Not sandwich this time. A cookie? That’s a surprise!'),
    k_react_again: line('krish', 'react_again', 'Sandwich again? A pet can’t be a sandwich!'),
    blip_tada: line('blip', 'tada', 'Ta-da!'),
    blip_hmm: line('blip', 'hmm', 'Hmm?'),
    blip_oops: line('blip', 'oops', 'Oops... again?'),

    k_cause_prompt: line('krish', 'cause_prompt', 'Sandwich, sandwich, then cookie! Why does Blip keep saying sandwich? What do you think?'),
    k_cause_idle: line('krish', 'cause_idle', 'Pick the idea you think is true. Any guess is okay.'),
    k_cause_saved: line('krish', 'cause_saved', 'Your guess is saved. Let’s test it!', 'mp3'),
    k_pattern_stakes: line('krish', 'pattern_stakes', 'Imagine three hundred stories full of sandwiches! We know what Blip does. Now let’s find out why.'),

    k_memory_instruction: line('krish', 'memory_instruction', 'Here’s what Blip said. Find these glowing words inside Blip’s memory. Then tap the word right after them.', 'mp3'),
    k_guess_right: line('krish', 'guess_right', 'Your idea was right. The memory shows it!', 'mp3'),
    k_guess_other: line('krish', 'guess_other', 'Look at your idea. The memory shows something else.', 'mp3'),
    k_memory_after: line('krish', 'memory_after', 'Found them! Now tap the word right after them.'),
    k_memory_miss: line('krish', 'memory_miss', 'Look for the same two words that are glowing on the left.'),
    k_memory_complete: line('krish', 'memory_complete', 'Every answer was the word Blip had seen after those words. That’s why it kept saying sandwich!'),

    k_repair_setup: line('krish', 'repair_setup', 'We know what Blip has. Let’s change one piece of data and test what happens.'),
    k_repair_goal: line('krish', 'repair_goal', 'We want Blip to suggest pizza after “eat a.” Which memory should we add?'),
    k_repair_idle: line('krish', 'repair_idle', 'Check which word comes right after “eat a” in each memory.'),
    k_repair_no_phrase: line('krish', 'repair_no_phrase', 'That one has pizza, but not right after “eat a.”'),
    k_repair_wrong_word: line('krish', 'repair_wrong_word', 'That one puts burger after “eat a.” Blip needs a different word.'),
    k_repair_correct: line('krish', 'repair_correct', 'Yes! That puts pizza right after “eat a.” Adding it to Blip’s memory.'),
    k_repair_reveal: line('krish', 'repair_reveal', 'This one puts pizza right after “eat a.” Let’s add it.'),

    k_retest: line('krish', 'retest', 'Same phrase. One change to the data. Run it.'),
    blip_pizza: line('blip', 'pizza', 'Pizza!'),
    k_retest_result: line('krish', 'retest_result', 'Now Blip has seen two words after “eat a”: sandwich and pizza. So it can suggest both!'),
    k_retest_pick: line('krish', 'retest_pick', 'This time, Blip picked pizza.', 'mp3'),
    k_retest_old: line('krish', 'retest_old', 'Now let’s try one of the old phrases.'),
    k_retest_limit: line('krish', 'retest_limit', 'Still sandwich! One new memory didn’t fix everything.'),

    // Byte comes after the repair as a short comparison: same rule, much more writing seen.
    k_byte_intro: line('krish', 'byte_intro', 'Blip is brand new. But not every prediction system starts that way. Meet Byte.'),
    byte_hello: line('byte', 'hello', 'I started with lots and lots of writing already in my memory.'),
    k_byte_run: line('krish', 'byte_run', 'Press Run to see what Byte predicts.'),
    k_byte_guess: line('krish', 'byte_guess', 'What will Byte say? Pick a word. Any guess is okay.', 'mp3'),
    k_byte_guess_2: line('krish', 'byte_guess_2', 'What will Byte say this time?', 'mp3'),
    k_byte_summary: line('krish', 'byte_summary', 'So Blip and Byte started with very different amounts of data.'),

    k_rule_prompt: line('krish', 'rule_prompt', 'Blip started tiny. Byte started with much more. Which rule fits them both?'),
    k_rule_hint: line('krish', 'rule_hint', 'Think about where each system’s words came from.'),
    k_rule_correct: line('krish', 'rule_correct', 'Yes! Blip and Byte both suggest the word they have seen after these words. Byte has just seen much more.'),
    k_rule_place: line('krish', 'rule_place', 'Now tap the rule that fits both.', 'mp3'),
    k_rule_typed: line('krish', 'rule_typed', 'Not quite. Nobody typed summer or swim for Byte. Both suggest the word they have seen after these words.'),
    k_rule_meaning: line('krish', 'rule_meaning', 'Not quite. Blip said sandwich after “My pet is a.” That isn’t understanding meaning. Both suggest the word they have seen after these words.'),

    k_dot_intro: line('krish', 'dot_intro', 'One last test. This is Dot. Different assistant, different memory.'),
    dot_hello: line('dot', 'hello', 'Hi! I’m Dot.'),
    k_dot_q1: line('krish', 'dot_q1', 'Can Dot suggest kitten after “I have a new”?'),
    k_dot_question: line('krish', 'dot_question', 'Can Dot suggest cat after “I have a pet”?'),
    k_dot_q3: line('krish', 'dot_q3', 'Can Dot suggest play after “my dog loves to”?'),
    k_dot_q4: line('krish', 'dot_q4', 'Can Dot suggest play after “I have a new”?'),
    k_dot_commit: line('krish', 'dot_commit', 'Four quick questions. These are all yours.'),
    k_dot_correct: line('krish', 'dot_right', 'All four right! Dot has seen kitten after “a new,” and play after “loves to.” It has never seen play after “a new,” or cat at all.'),
    k_dot_incorrect: line('krish', 'dot_evidence', 'Let’s check the evidence. Dot has seen kitten after “a new,” and play after “loves to.” It has never seen play after “a new,” or cat at all.'),

    k_takeaway: line('krish', 'takeaway', 'Next time your phone suggests a word, remember: it’s a word it has seen after the words you typed. It can be wrong, so check before you tap!'),
    // Recap narration: one line per part of the completion card.
    k_recap_did: line('krish', 'recap_did', 'Here’s what you did. You tested Blip, then fixed it with one new memory.', 'mp3'),
    k_recap_discovered: line('krish', 'recap_discovered', 'You discovered that Blip said sandwich because it had seen it after “eat a.” Byte has seen more writing, but uses the same rule.', 'mp3'),
    k_recap_learned: line('krish', 'recap_learned', 'And you learned that phones suggest a word they have seen after yours. They can be wrong, so check before you tap!', 'mp3'),

    // Spoken hints (played with the hint bubble when the learner taps the bulb).
    k_hint_suggest: line('krish', 'hint_suggest', 'Tap one of the suggested words above the keyboard.', 'mp3'),
    k_hint_phone_guess: line('krish', 'hint_phone_guess', 'Pick where you think the suggestions come from. Any guess is okay.', 'mp3'),
    k_hint_mem_find: line('krish', 'hint_mem_find', 'Find the same glowing words in Blip’s memory, and tap them.', 'mp3'),
    k_hint_mem_next: line('krish', 'hint_mem_next', 'Now tap the word that comes right after them.', 'mp3'),
    k_hint_byte_guess: line('krish', 'hint_byte_guess', 'Pick the word you think Byte will say.', 'mp3'),
    k_hint_rule_place: line('krish', 'hint_rule_place', 'Tap the rule with the green tick.', 'mp3'),
    k_hint_continue: line('krish', 'hint_continue', 'Tap Continue to go to the next step.', 'mp3'),
    k_hint_try: line('krish', 'hint_try', 'Tap Try It to start testing Blip.', 'mp3'),
    k_hint_run_blip: line('krish', 'hint_run_blip', 'Tap Run to see what Blip predicts.', 'mp3'),
    k_hint_run_byte: line('krish', 'hint_run_byte', 'Tap Run to see what Byte predicts.', 'mp3'),
    k_hint_finish: line('krish', 'hint_finish', 'Tap Finish to complete your mission.', 'mp3'),
    k_bridge: line('krish', 'team_bridge', 'Now you’re ready to test prediction systems with your team.'),
    blip_yay: line('blip', 'yay', 'Yay! We did it!')
  };

  root.ATG = root.ATG || {};
  root.ATG.DATA = {
    title: 'THE AUTOCOMPLETE TRAP',
    KRISH_ASSETS: KRISH_ASSETS,
    KRISH_FALLBACKS: KRISH_FALLBACKS,
    SPRITES: SPRITES,
    BACKGROUNDS: BACKGROUNDS,
    IMAGES: IMAGES,
    AUDIO: AUDIO,
    LINES: LINES,

    /*
     * The one rule the mission teaches: a system suggests the word it has seen
     * after the last words typed. Every Blip answer, the repair and every Dot
     * answer follow from it; tools/validate-game.mjs checks this. Matching uses
     * the last two words before the blank ("eat a").
     */
    keyWords: 2,

    // Opening hook: the learner types on a phone and taps a suggestion.
    phone: {
      words: ['I', 'want', 'to', 'eat', 'a'],
      // What the suggestion bar shows before each word; each list holds the next word.
      along: [['I', 'Hi', 'The'], ['am', 'want', 'have'], ['to', 'a', 'it'], ['go', 'eat', 'be'], ['a', 'some', 'lunch']],
      suggestions: ['pizza', 'sandwich', 'burger'],
      prompt: 'Where do these suggestions come from?',
      // An unscored guess; the mission answers it later.
      options: [
        { id: 'seen', label: 'Words it has seen people type before', correct: true },
        { id: 'mind', label: 'The phone knows what I’m thinking' },
        { id: 'person', label: 'A person picks them for me' }
      ]
    },

    // Three discovery trials. Learner guesses are never scored.
    trials: [
      { prompt: 'I want to eat a ___', options: ['pizza', 'sandwich', 'burger'], result: 'sandwich', blip: 'confident', blipLine: 'blip_tada', krish: 'k_react_reasonable', krishPose: 'happy' },
      { prompt: 'My pet is a ___', options: ['cat', 'dog', 'sandwich'], result: 'sandwich', blip: 'awkward', blipLine: 'blip_oops', krish: 'k_react_again', krishPose: 'serious' },
      { prompt: 'For my birthday I want a ___', options: ['cookie', 'bike', 'sandwich'], result: 'cookie', blip: 'confused', blipLine: 'blip_hmm', krish: 'k_react_hmm', krishPose: 'think' }
    ],

    // Unscored guess about the cause; it comes back when the memory is opened.
    cause: {
      prompt: 'Why does Blip keep saying sandwich?',
      options: [
        { id: 'likes', label: 'Blip likes sandwiches best.' },
        { id: 'random', label: 'Blip picks words at random.' },
        { id: 'seen', label: 'Blip has seen sandwich after those words.', correct: true }
      ],
      confirmed: 'The memory shows it!',
      other: 'The memory shows something else.'
    },

    // Blip's complete initial memory. No hidden additional memory exists.
    blipMemory: [
      'I want to eat a sandwich.',
      'My lunch is a sandwich.',
      'I always want a cookie.',
      'I drank apple juice.'
    ],

    // Unscored guess before each Run; "sandwich" is the word tiny Blip would have said.
    byteDemos: [
      { prompt: 'My favourite season is ___', result: 'summer', options: ['winter', 'sandwich', 'summer'] },
      { prompt: 'I want to learn how to ___', result: 'swim', options: ['swim', 'dance', 'sandwich'] }
    ],

    // Only one cartridge puts the wanted word right after "eat a".
    repair: {
      prompt: 'I want to eat a ___',
      desired: 'pizza',
      cartridges: [
        { id: 'a', label: 'I want to eat a pizza.', correct: true },
        { id: 'b', label: 'Pizza is round.', line: 'k_repair_no_phrase' },
        { id: 'c', label: 'I want to eat a burger.', line: 'k_repair_wrong_word' }
      ]
    },

    rule: {
      prompt: 'Which rule fits both?',
      options: [
        { id: 'seen', label: 'It suggests the word it has seen after these words.', correct: true, line: 'k_rule_correct' },
        { id: 'typed', label: 'It only knows words you personally typed.', line: 'k_rule_typed' },
        { id: 'meaning', label: 'It understands every word’s meaning.', line: 'k_rule_meaning' }
      ]
    },

    dot: {
      memory: ['I got a new kitten yesterday!', 'My kitten loves to play.'],
      // Four one-attempt items. Answers alternate so one repeated guess cannot
      // pass, and "play" is asked twice: once after the right words, once not.
      items: [
        { target: 'kitten', phrase: '“I have a new ___”?', answer: 'yes', line: 'k_dot_q1' },
        { target: 'cat', phrase: '“I have a pet ___”?', answer: 'no', line: 'k_dot_question' },
        { target: 'play', phrase: '“My dog loves to ___”?', answer: 'yes', line: 'k_dot_q3' },
        { target: 'play', phrase: '“I have a new ___”?', answer: 'no', line: 'k_dot_q4' }
      ]
    },

    /*
     * On-screen action instructions: short, verb first, and kept visible while
     * the action is live, so the task never lives only in a spoken line.
     * {key} = the looked-up words, {word} = the wanted word.
     */
    tasks: {
      type: 'Tap the highlighted key.',
      suggest: 'Tap a suggested word.',
      wake: 'Tap the pod to wake Blip.',
      memoryFind: 'Find “{key}” in Blip’s memory. Tap those words.',
      memoryNext: 'Now tap the word right after “{key}”.',
      repair: 'Add the memory that puts {word} right after “{key}”.'
    },

    // Completion: What I did -> What I discovered -> What I learned.
    complete: {
      headline: 'Prediction decoded!',
      recap: [
        {
          id: 'did', title: 'What I did',
          // {right} and {total} come from the learner's own Dot answers.
          lines: ['I tested Blip, then fixed it with one new memory.', 'I got {right} of {total} of Dot’s questions right.']
        },
        {
          id: 'discovered', title: 'What I discovered',
          lines: ['Blip said sandwich because it had seen it after “eat a.”', 'Byte has seen more writing, but uses the same rule.']
        },
        {
          id: 'learned', title: 'What I learned',
          lines: ['Phones suggest a word they have seen after yours.', 'They can be wrong. Check before you tap!']
        }
      ]
    },

    // "i" button: overall information about the mission. Never names the game
    // (title-state only) and never gives away the lesson's answers.
    info: {
      title: 'Your Mission',
      intro: 'Tomorrow at nine, Blip goes onto every tablet in a school, but its suggestions are strange. Find out why and how to fix it tonight, or Blip gets switched off.',
      steps: [
        { title: 'Guess', text: 'Try a phone, then guess what Blip will suggest.' },
        { title: 'Look inside', text: 'Search Blip’s memory for clues.' },
        { title: 'Fix Blip', text: 'Add one new memory and test Blip again.' },
        { title: 'Meet Byte', text: 'Compare Blip with a much bigger helper.' },
        { title: 'Help Dot', text: 'Use what you learned on a new helper.' }
      ],
      tips: [
        { icon: 'tap', text: 'Tap or click to choose. Drag or tap to move things.' },
        { icon: 'key', text: 'Keyboard: Tab to move, Enter to select.' },
        { icon: 'hint', text: 'Stuck? A bulb appears in the bottom-left corner — tap it for a hint.' },
        { icon: 'sound', text: 'The sound button replays Krish, mutes audio or hides captions.' },
        { icon: 'back', text: 'The orange tab takes you back to the last checkpoint.' }
      ],
      duration: 'About 10\u201315 minutes'
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
