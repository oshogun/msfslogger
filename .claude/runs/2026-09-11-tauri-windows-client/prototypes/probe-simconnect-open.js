// Prototype for design §3/§4: what does node-simconnect's open() actually do
// on a machine with no sim? Run from a directory where node-simconnect is
// installed (the designer used a scratchpad install; the sidecar will depend
// on it directly):
//
//   node probe-simconnect-open.js
//
// Answers two questions the design rests on:
//   1. does open() reject (so the sidecar's catch/backoff path is real), and
//      with what message and how fast;
//   2. what Protocol enum values exist, so the config's `sim` field maps to a
//      real constant.
'use strict';
const { open, Protocol } = require('node-simconnect');

(async () => {
  console.log('Protocol =', JSON.stringify(Protocol));
  for (const name of ['KittyHawk', 'SunRise', 'FSX_SP2']) {
    const t0 = Date.now();
    try {
      await open('msfslogger-probe', Protocol[name]);
      console.log(`${name}: CONNECTED (unexpected on this machine)`);
    } catch (err) {
      console.log(`${name}: rejected after ${Date.now() - t0} ms — ${err && err.message}`);
    }
  }
})();
