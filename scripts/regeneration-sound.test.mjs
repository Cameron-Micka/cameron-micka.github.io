import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let SoundManager;
let TinyEventEmitter;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  ({ SoundManager } = await server.ssrLoadModule('/src/ui/SoundManager.ts'));
  ({ TinyEventEmitter } = await server.ssrLoadModule(
    '/src/engine/TinyEventEmitter.ts',
  ));
});

after(async () => {
  await server?.close();
});

function audioProbe(
  t,
  { available = true, activated = true, state = 'running' } = {},
) {
  const contexts = [];
  const param = () => ({
    values: [],
    ramps: [],
    setValueAtTime(value, time) {
      this.values.push([value, time]);
    },
    exponentialRampToValueAtTime(value, time) {
      this.ramps.push([value, time]);
    },
  });
  const node = () => ({
    connections: [],
    disconnected: false,
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect() {
      this.disconnected = true;
    },
  });
  class AudioContextMock {
    currentTime = 10;
    state = state;
    destination = {};
    oscillators = [];
    gains = [];
    resumes = 0;
    closes = 0;

    constructor() {
      contexts.push(this);
    }
    createOscillator() {
      const osc = {
        ...node(),
        frequency: param(),
        starts: [],
        stops: [],
        start(time) {
          this.starts.push(time);
        },
        stop(time) {
          this.stops.push(time);
        },
      };
      this.oscillators.push(osc);
      return osc;
    }
    createGain() {
      const gain = { ...node(), gain: param() };
      this.gains.push(gain);
      return gain;
    }
    async resume() {
      this.resumes++;
      this.state = 'running';
    }
    async close() {
      this.closes++;
      this.state = 'closed';
    }
  }
  for (const [key, value] of [
    ['AudioContext', available ? AudioContextMock : undefined],
    ['navigator', { userActivation: { hasBeenActive: activated } }],
  ]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  const events = new TinyEventEmitter();
  const sound = new SoundManager({ events });
  t.after(() => sound.destroy());
  return { sound, events, contexts };
}

test('regeneration event plays a short rising sweep and delayed chime', (t) => {
  const { sound, events, contexts } = audioProbe(t);
  sound.setEnabled(true);
  assert.equal(contexts.length, 0);
  events.emit('bodyRegenerated', null);
  assert.equal(contexts.length, 1);
  const ctx = contexts[0];
  assert.equal(ctx.oscillators.length, 2);
  const [sweep, chime] = ctx.oscillators;
  assert.equal(sweep.type, 'triangle');
  assert.equal(chime.type, 'sine');
  assert.ok(sweep.frequency.ramps[0][0] > sweep.frequency.values[0][0]);
  assert.equal(sweep.frequency.ramps[0][0], chime.frequency.values[0][0]);
  assert.ok(chime.starts[0] > sweep.starts[0]);
  for (const [i, osc] of ctx.oscillators.entries()) {
    assert.equal(osc.starts.length, 1);
    assert.equal(osc.stops.length, 1);
    assert.ok(osc.stops[0] > osc.starts[0]);
    assert.ok(osc.stops[0] - ctx.currentTime < 0.5);
    assert.deepEqual(osc.connections, [ctx.gains[i]]);
    assert.deepEqual(ctx.gains[i].connections, [ctx.destination]);
    assert.equal(ctx.gains[i].gain.ramps.at(-1)[0], 0.0001);
  }
});

test('consecutive regeneration pitches differ even with constant randomness', (t) => {
  const { sound, events, contexts } = audioProbe(t);
  sound.setEnabled(true);
  for (const random of [0, 0.5, 0.999999]) {
    t.mock.method(Math, 'random', () => random);
    for (let i = 0; i < 12; i++) events.emit('bodyRegenerated', null);
  }
  const pitches = contexts[0].oscillators
    .filter((osc) => osc.type === 'triangle')
    .map((osc) => osc.frequency.values[0][0]);
  assert.equal(pitches.length, 36);
  for (let i = 1; i < pitches.length; i++) {
    assert.notEqual(pitches[i], pitches[i - 1]);
  }
});

test('sound stays silent while disabled and reuses its context when enabled', (t) => {
  const { sound, events, contexts } = audioProbe(t);
  events.emit('bodyRegenerated', null);
  assert.equal(contexts.length, 0);
  sound.setEnabled(true);
  events.emit('bodyRegenerated', null);
  sound.setEnabled(false);
  events.emit('bodyRegenerated', null);
  assert.equal(contexts[0].oscillators.length, 2);
  sound.setEnabled(true);
  events.emit('bodyRegenerated', null);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].oscillators.length, 4);
});

for (const options of [{ available: false }, { activated: false }]) {
  test(`regeneration respects audio availability and activation: ${JSON.stringify(options)}`, (t) => {
    const { sound, events, contexts } = audioProbe(t, options);
    sound.setEnabled(true);
    assert.doesNotThrow(() => events.emit('bodyRegenerated', null));
    assert.equal(contexts.length, 0);
  });
}

test('suspended audio context resumes on a regeneration cue', (t) => {
  const { sound, events, contexts } = audioProbe(t, { state: 'suspended' });
  sound.setEnabled(true);
  events.emit('bodyRegenerated', null);
  assert.equal(contexts[0].resumes, 1);
  assert.equal(contexts[0].oscillators.length, 2);
});

test('finished tones disconnect and destroy stops active tones and unsubscribes', (t) => {
  const { sound, events, contexts } = audioProbe(t);
  sound.setEnabled(true);
  events.emit('bodyRegenerated', null);
  const ctx = contexts[0];
  const [finished, active] = ctx.oscillators;
  finished.onended();
  assert.equal(finished.disconnected, true);
  assert.equal(ctx.gains[0].disconnected, true);
  sound.destroy();
  assert.equal(finished.stops.length, 1);
  assert.equal(active.stops.length, 2);
  assert.equal(active.stops.at(-1), undefined);
  assert.equal(active.disconnected, true);
  assert.equal(ctx.gains[1].disconnected, true);
  assert.equal(ctx.closes, 1);
  for (const event of [
    'bodyRegenerated',
    'poiOpened',
    'poiClosed',
    'focusChanged',
  ]) {
    events.emit(event, 0);
  }
  assert.equal(contexts.length, 1);
  assert.equal(ctx.oscillators.length, 2);
  sound.destroy();
  assert.equal(ctx.closes, 1);
});

test('existing POI and focus cues retain their pitches and waveforms', (t) => {
  const { sound, events, contexts } = audioProbe(t);
  sound.setEnabled(true);
  events.emit('poiOpened', null);
  events.emit('poiClosed', null);
  events.emit('focusChanged', 3);
  assert.deepEqual(
    contexts[0].oscillators.map((osc) => [
      osc.frequency.values[0][0],
      osc.type,
    ]),
    [
      [660, 'sine'],
      [330, 'sine'],
      [196 * Math.pow(2, 6 / 12), 'triangle'],
    ],
  );
});
