// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — RECORDED SOUND
//
//  Everything the game made until now came out of an oscillator: five synthesised
//  beeps for hurt, heal, coin, dawn and victory, plus the procedural BGM. This is
//  the first recorded audio in it.
//
//  It shares the page's one AudioContext (getDahCtx) and answers to the same
//  _soundEnabled / _soundVol the beeps do, so the existing volume slider and mute
//  govern it with no extra controls.
//
//  Ambience is LAZY. The three sea loops are ~780KB each and only the dock zone
//  plays them, so nothing is fetched until a zone asks for it; the game's first
//  paint is unaffected. The one-shots are small and load on first use.
//
//  Fails soft everywhere: no AudioContext, no network, a codec the browser will
//  not decode — every entry point returns false and the game is silent, which is
//  what it was before.
// ═══════════════════════════════════════════════════════════════════════════════
window.DHSound = (function () {
  'use strict';

  const BASE = 'assets/audio/';
  const FADE = 1.6;               // seconds to cross from one ambience to another

  const state = {
    buffers: {},                  // name -> AudioBuffer
    pending: {},                  // name -> Promise, so a file is fetched once
    failed: {},
    bus: null,                    // everything here goes through one gain
    // Ambience runs on CHANNELS, because a bed and a layer over it are two
    // different things: the forest is what the place sounds like, and the
    // river is what is near you in it. One slot meant the river REPLACED the
    // forest as you walked to the bank.
    amb: [],                      // ch -> { src, gain, name }
    want: [],                     // ch -> the name most recently asked for
    ambVol: [],
  };

  function ctx() {
    try {
      return (typeof getDahCtx === 'function') ? getDahCtx() : null;
    } catch (e) { return null; }
  }

  function enabled() {
    return (typeof _soundEnabled === 'undefined') || _soundEnabled;
  }

  function vol() {
    return (typeof _soundVol === 'number') ? _soundVol : 0.8;
  }

  // One node for all recorded sound, so the volume slider can move it in one
  // place and the ambience does not have to be re-ramped per source.
  function bus() {
    const c = ctx();
    if (!c) return null;
    if (!state.bus || state.bus.context !== c) {
      state.bus = c.createGain();
      state.bus.gain.value = vol();
      state.bus.connect(c.destination);
    }
    return state.bus;
  }

  // Called by the volume slider. Ramped rather than set, or moving the slider
  // steps the ambience and clicks.
  function setVolume() {
    const c = ctx(), b = bus();
    if (!c || !b) return;
    b.gain.setTargetAtTime(enabled() ? vol() : 0, c.currentTime, 0.05);
  }

  function load(name) {
    if (state.buffers[name]) return Promise.resolve(state.buffers[name]);
    if (state.failed[name]) return Promise.reject(new Error('failed earlier'));
    if (state.pending[name]) return state.pending[name];
    const c = ctx();
    if (!c) return Promise.reject(new Error('no AudioContext'));

    const p = fetch(BASE + name + '.mp3')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      // decodeAudioData is callback-style in older Safari and returns a promise
      // in everything current; this form works either way.
      .then(buf => new Promise((res, rej) => {
        const out = c.decodeAudioData(buf, res, rej);
        if (out && out.then) out.then(res, rej);
      }))
      .then(b => { state.buffers[name] = b; delete state.pending[name]; return b; })
      .catch(e => {
        state.failed[name] = true;
        delete state.pending[name];
        console.warn('[DHSound] ' + name + ': ' + e.message);
        throw e;
      });
    state.pending[name] = p;
    return p;
  }

  // A one-shot. `rate` detunes it a little so a sound fired twice in a row is
  // not obviously the same sample twice.
  function play(name, gain, rate) {
    if (!enabled()) return false;
    const c = ctx(), b = bus();
    if (!c || !b) return false;
    const buf = state.buffers[name];
    if (!buf) { load(name).catch(() => {}); return false; }
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate || 1;
    const g = c.createGain();
    g.gain.value = (gain === undefined ? 1 : gain);
    s.connect(g); g.connect(b);
    s.start();
    return true;
  }

  // One of a set, picked at random but never the same one twice running.
  //
  // Returns the NAME it played, or false. A name is truthy, so callers that
  // test it as a boolean are unaffected — and it is the only way to see from
  // outside which variant was chosen, which is what the test needs.
  const _lastOf = {};
  function playOneOf(names, gain, spread) {
    if (!names || !names.length) return false;
    let pick = names[(Math.random() * names.length) | 0];
    if (names.length > 1 && pick === _lastOf[names[0]]) {
      pick = names[(names.indexOf(pick) + 1) % names.length];
    }
    _lastOf[names[0]] = pick;
    const s = spread === undefined ? 0.06 : spread;
    return play(pick, gain, 1 + (Math.random() * 2 - 1) * s) ? pick : false;
  }

  // Crossfade to `name`, or to silence when it is null. Calling it with the
  // ambience that is already playing does nothing, so a zone can ask on every
  // frame without restarting the loop.
  function ambient(name, level, ch) {
    ch = ch || 0;
    const v = (level === undefined) ? 1 : level;
    state.want[ch] = name;

    // Already playing the right thing. The short-circuit has to test what is
    // PLAYING, not what is wanted: testing `want` meant that once a zone had
    // asked for a loop, every later call agreed there was nothing to do and
    // the loop was never started at all.
    const cur = state.amb[ch];
    if (cur && cur.name === name) {
      // And only re-ramp when the target actually moves. This is called every
      // frame; re-scheduling an exponential ramp sixty times a second pins the
      // gain wherever it happens to be and it never arrives.
      if (Math.abs((state.ambVol[ch] || 0) - v) > 0.01) {
        state.ambVol[ch] = v; rampTo(cur.gain, v);
      }
      return true;
    }
    state.ambVol[ch] = v;
    if (!name) { fadeOutCurrent(ch); return true; }
    if (!enabled()) { fadeOutCurrent(ch); return false; }

    const buf = state.buffers[name];
    if (!buf) {
      // One fetch, not one per frame. The next frame starts it once the buffer
      // is there; the callback is a belt-and-braces for callers that are not
      // on a frame timer.
      if (!state.pending[name] && !state.failed[name]) {
        load(name).then(() => {
          // Only if this is STILL what is wanted — the player can leave the
          // zone while half a megabyte is in flight.
          if (state.want[ch] === name) ambient(name, state.ambVol[ch], ch);
        }).catch(() => {});
      }
      return false;
    }
    const c = ctx(), b = bus();
    if (!c || !b) return false;

    fadeOutCurrent(ch);
    const g = c.createGain();
    g.gain.value = 0.0001;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g); g.connect(b);
    s.start();
    rampTo(g, state.ambVol[ch]);
    state.amb[ch] = { src: s, gain: g, name: name };
    return true;
  }

  function rampTo(g, v) {
    const c = ctx();
    if (!c) return;
    g.gain.cancelScheduledValues(c.currentTime);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), c.currentTime);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), c.currentTime + FADE);
  }

  function fadeOutCurrent(ch) {
    ch = ch || 0;
    const cur = state.amb[ch];
    if (!cur) return;
    state.amb[ch] = null;
    const c = ctx();
    if (!c) { try { cur.src.stop(); } catch (e) {} return; }
    rampTo(cur.gain, 0.0001);
    // Stopped a beat after the fade, not at the end of it: an exponential ramp
    // never truly reaches zero and cutting the source at FADE exactly leaves an
    // audible step.
    try { cur.src.stop(c.currentTime + FADE + 0.25); } catch (e) {}
  }

  // With no argument, stops every channel — a zone change should silence the
  // lot, not just the bed.
  function stopAmbient(ch) {
    if (ch === undefined) {
      for (let i = 0; i < Math.max(state.amb.length, state.want.length); i++) {
        state.want[i] = null; fadeOutCurrent(i);
      }
      return;
    }
    state.want[ch] = null; fadeOutCurrent(ch);
  }

  // Warm the small one-shots. The ambiences are deliberately NOT preloaded.
  function preload(names) {
    (names || []).forEach(n => { load(n).catch(() => {}); });
  }

  return { play, playOneOf, ambient, stopAmbient, preload, setVolume, load,
           _state: state };
})();
