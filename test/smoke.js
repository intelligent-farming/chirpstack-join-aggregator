const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createAggregator } = require('..');

// Real-vendor DevEUIs so vendor identification is visible in test output.
const FIX = {
  dragino1: 'A84041035660E3A1',
  dragino2: 'A84041035660E3A2',
  dragino3: 'A84041035660E3A3',
  joinEui: 'A840410000000107',
  vendor: { name: 'Dragino Technology Co., Limited', source: 'oui' },
};

const mkEvent = (overrides = {}) => ({
  gatewayId: overrides.gatewayId ?? 'gw-roof',
  candidate: {
    devEui: overrides.devEui ?? FIX.dragino1,
    joinEui: overrides.joinEui ?? FIX.joinEui,
    oui: (overrides.devEui ?? FIX.dragino1).slice(0, 6),
    devNonce: overrides.devNonce ?? '1234',
    vendor: overrides.vendor ?? FIX.vendor,
  },
  receivedAt: overrides.receivedAt ?? new Date('2026-06-02T12:00:00Z'),
});

describe('record — first sight', () => {
  test('creates state with count=1 and matching first/last seen', () => {
    const agg = createAggregator();
    const state = agg.record(mkEvent());
    assert.equal(state.devEui, FIX.dragino1);
    assert.equal(state.count, 1);
    assert.equal(state.firstSeen.toISOString(), '2026-06-02T12:00:00.000Z');
    assert.equal(state.lastSeen.toISOString(), '2026-06-02T12:00:00.000Z');
    assert.deepEqual(state.gateways, ['gw-roof']);
    assert.match(state.vendor.name, /Dragino/);
    agg.stop();
  });

  test('normalizes lowercase DevEUI to uppercase in the key', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ devEui: 'a84041035660e3a1' }));
    assert.ok(agg.get(FIX.dragino1), 'uppercase get should hit lowercase-inserted entry');
    assert.equal(agg.list()[0].devEui, FIX.dragino1);
    agg.stop();
  });
});

describe('record — retries on the same DevEUI', () => {
  test('increments count, refreshes lastSeen and lastDevNonce, preserves firstSeen', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ receivedAt: new Date('2026-06-02T12:00:00Z'), devNonce: '1234' }));
    const state = agg.record(mkEvent({ receivedAt: new Date('2026-06-02T12:00:05Z'), devNonce: '5678' }));
    assert.equal(state.count, 2);
    assert.equal(state.firstSeen.toISOString(), '2026-06-02T12:00:00.000Z');
    assert.equal(state.lastSeen.toISOString(), '2026-06-02T12:00:05.000Z');
    assert.equal(state.lastDevNonce, '5678');
    agg.stop();
  });

  test('many retries in a row all collapse to one entry', () => {
    const agg = createAggregator();
    for (let i = 0; i < 100; i++) {
      agg.record(mkEvent({
        devNonce: i.toString(16).padStart(4, '0').toUpperCase(),
        receivedAt: new Date(Date.now() + i * 1000),
      }));
    }
    const state = agg.get(FIX.dragino1);
    assert.equal(state.count, 100);
    assert.equal(state.lastDevNonce, '0063');                    // 99 in hex
    assert.equal(agg.list().length, 1, 'still only one row');
    agg.stop();
  });
});

describe('gateway accumulation', () => {
  test('dedupes and sorts gateway IDs', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ gatewayId: 'gw-bravo' }));
    agg.record(mkEvent({ gatewayId: 'gw-alpha' }));
    agg.record(mkEvent({ gatewayId: 'gw-bravo' }));        // duplicate
    agg.record(mkEvent({ gatewayId: 'gw-charlie' }));
    const state = agg.get(FIX.dragino1);
    assert.deepEqual(state.gateways, ['gw-alpha', 'gw-bravo', 'gw-charlie']);
    assert.equal(state.count, 4);
    agg.stop();
  });

  test('single-gateway candidates report exactly one entry', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ gatewayId: 'gw-only' }));
    agg.record(mkEvent({ gatewayId: 'gw-only' }));
    agg.record(mkEvent({ gatewayId: 'gw-only' }));
    assert.deepEqual(agg.get(FIX.dragino1).gateways, ['gw-only']);
    agg.stop();
  });
});

describe('case-insensitive lookups', () => {
  test('get() and forget() work regardless of input case', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ devEui: 'a84041035660e3a1' }));
    assert.ok(agg.get('A84041035660E3A1'));
    assert.ok(agg.get('a84041035660e3a1'));
    assert.equal(agg.forget('a84041035660e3a1'), true);
    assert.equal(agg.list().length, 0);
    agg.stop();
  });
});

describe('list ordering', () => {
  test('returns candidates sorted by lastSeen descending (most-recent first)', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ devEui: FIX.dragino1, receivedAt: new Date('2026-06-02T12:00:01Z') }));
    agg.record(mkEvent({ devEui: FIX.dragino3, receivedAt: new Date('2026-06-02T12:00:03Z') }));
    agg.record(mkEvent({ devEui: FIX.dragino2, receivedAt: new Date('2026-06-02T12:00:02Z') }));
    assert.deepEqual(
      agg.list().map(s => s.devEui),
      [FIX.dragino3, FIX.dragino2, FIX.dragino1],
    );
    agg.stop();
  });

  test('a fresh record moves an existing candidate to the top', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ devEui: FIX.dragino1, receivedAt: new Date('2026-06-02T12:00:01Z') }));
    agg.record(mkEvent({ devEui: FIX.dragino2, receivedAt: new Date('2026-06-02T12:00:02Z') }));
    // Older device reappears with a later timestamp:
    agg.record(mkEvent({ devEui: FIX.dragino1, receivedAt: new Date('2026-06-02T12:00:10Z') }));
    assert.deepEqual(
      agg.list().map(s => s.devEui),
      [FIX.dragino1, FIX.dragino2],
    );
    agg.stop();
  });
});

describe("event emissions: 'new' vs 'candidate'", () => {
  test("'new' fires once per unique DevEUI", () => {
    const agg = createAggregator();
    const news = [];
    agg.on('new', s => news.push(s.devEui));
    agg.record(mkEvent({ devEui: FIX.dragino1 }));
    agg.record(mkEvent({ devEui: FIX.dragino1 }));
    agg.record(mkEvent({ devEui: FIX.dragino2 }));
    agg.record(mkEvent({ devEui: FIX.dragino2 }));
    assert.deepEqual(news, [FIX.dragino1, FIX.dragino2]);
    agg.stop();
  });

  test("'candidate' fires on every record() including duplicates", () => {
    const agg = createAggregator();
    const candidates = [];
    agg.on('candidate', s => candidates.push(s.devEui));
    agg.record(mkEvent({ devEui: FIX.dragino1 }));
    agg.record(mkEvent({ devEui: FIX.dragino1 }));
    agg.record(mkEvent({ devEui: FIX.dragino2 }));
    assert.deepEqual(candidates, [FIX.dragino1, FIX.dragino1, FIX.dragino2]);
    agg.stop();
  });

  test('listeners receive the post-update state', () => {
    const agg = createAggregator();
    let latest = null;
    agg.on('candidate', s => { latest = s; });
    agg.record(mkEvent({ devEui: FIX.dragino1, devNonce: '0001' }));
    agg.record(mkEvent({ devEui: FIX.dragino1, devNonce: '0002' }));
    assert.equal(latest.count, 2);
    assert.equal(latest.lastDevNonce, '0002');
    agg.stop();
  });

  test('on() supports chaining', () => {
    const agg = createAggregator();
    const result = agg.on('new', () => {}).on('candidate', () => {});
    assert.equal(result, agg);
    agg.stop();
  });
});

describe('forget / clear', () => {
  test('forget() drops one candidate and returns false on a second call', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ devEui: FIX.dragino1 }));
    agg.record(mkEvent({ devEui: FIX.dragino2 }));
    assert.equal(agg.forget(FIX.dragino1), true);
    assert.equal(agg.forget(FIX.dragino1), false);
    assert.equal(agg.list().length, 1);
    assert.equal(agg.list()[0].devEui, FIX.dragino2);
    agg.stop();
  });

  test('forget() returns false for an unknown DevEUI', () => {
    const agg = createAggregator();
    assert.equal(agg.forget(FIX.dragino1), false);
    agg.stop();
  });

  test('clear() drops every candidate', () => {
    const agg = createAggregator();
    agg.record(mkEvent({ devEui: FIX.dragino1 }));
    agg.record(mkEvent({ devEui: FIX.dragino2 }));
    agg.clear();
    assert.equal(agg.list().length, 0);
    agg.stop();
  });

  test('clear() does not emit any event', () => {
    const agg = createAggregator();
    agg.record(mkEvent());
    let emitted = false;
    agg.on('expired', () => { emitted = true; });
    agg.clear();
    assert.equal(emitted, false);
    agg.stop();
  });
});

describe('TTL sweep with injected clock', () => {
  test('drops stale candidates and emits expired', async () => {
    let fakeNow = new Date('2026-06-02T12:00:00Z');
    const agg = createAggregator({
      ttlMs: 60_000,
      sweepIntervalMs: 1,
      now: () => fakeNow,
    });
    const expired = [];
    agg.on('expired', s => expired.push(s.devEui));

    agg.record({
      gatewayId: 'gw-1',
      candidate: { devEui: FIX.dragino1, joinEui: FIX.joinEui, oui: 'A84041', devNonce: '0001', vendor: null },
      receivedAt: fakeNow,
    });
    agg.record({
      gatewayId: 'gw-1',
      candidate: { devEui: FIX.dragino2, joinEui: FIX.joinEui, oui: 'A84041', devNonce: '0002', vendor: null },
      receivedAt: fakeNow,
    });

    fakeNow = new Date('2026-06-02T12:02:00Z');     // +2 min (well past TTL)
    await new Promise(r => setTimeout(r, 30));

    assert.equal(agg.list().length, 0);
    assert.deepEqual(expired.sort(), [FIX.dragino1, FIX.dragino2]);
    agg.stop();
  });

  test('candidates within TTL are preserved across sweeps', async () => {
    let fakeNow = new Date('2026-06-02T12:00:00Z');
    const agg = createAggregator({
      ttlMs: 60_000,
      sweepIntervalMs: 1,
      now: () => fakeNow,
    });
    agg.record({
      gatewayId: 'gw-1',
      candidate: { devEui: FIX.dragino1, joinEui: FIX.joinEui, oui: 'A84041', devNonce: '0001', vendor: null },
      receivedAt: fakeNow,
    });

    fakeNow = new Date('2026-06-02T12:00:30Z');    // +30s, within 60s TTL
    await new Promise(r => setTimeout(r, 30));
    assert.equal(agg.list().length, 1, 'still within TTL window');
    agg.stop();
  });

  test('disabling TTL (ttlMs=0) means never expire', async () => {
    let fakeNow = new Date('2026-06-02T12:00:00Z');
    const agg = createAggregator({ now: () => fakeNow });   // ttlMs defaults to 0
    agg.record({
      gatewayId: 'gw-1',
      candidate: { devEui: FIX.dragino1, joinEui: FIX.joinEui, oui: 'A84041', devNonce: '0001', vendor: null },
      receivedAt: fakeNow,
    });
    fakeNow = new Date('2026-06-03T12:00:00Z');             // +24 hours
    await new Promise(r => setTimeout(r, 10));
    assert.equal(agg.list().length, 1);
    agg.stop();
  });

  test("stop() halts the sweep timer (can be called multiple times safely)", () => {
    const agg = createAggregator({ ttlMs: 1000, sweepIntervalMs: 1 });
    agg.stop();
    agg.stop();                                              // idempotent
    assert.equal(agg.list().length, 0);
  });
});

describe('source auto-subscription', () => {
  test('records every join emitted by an EventEmitter source', () => {
    const source = new EventEmitter();
    const agg = createAggregator({ source });
    source.emit('join', mkEvent());
    source.emit('join', mkEvent());
    const s = agg.get(FIX.dragino1);
    assert.equal(s.count, 2);
    agg.stop();
  });

  test('also accepts a duck-typed source (anything with .on)', () => {
    let listener;
    const fakeSource = { on(event, fn) { if (event === 'join') listener = fn; } };
    const agg = createAggregator({ source: fakeSource });
    assert.equal(typeof listener, 'function');
    listener(mkEvent());
    assert.equal(agg.get(FIX.dragino1).count, 1);
    agg.stop();
  });
});

describe('isolation between instances', () => {
  test('two aggregators do not share state', () => {
    const a = createAggregator();
    const b = createAggregator();
    a.record(mkEvent({ devEui: FIX.dragino1 }));
    assert.equal(b.list().length, 0);
    assert.equal(a.list().length, 1);
    a.stop();
    b.stop();
  });
});
