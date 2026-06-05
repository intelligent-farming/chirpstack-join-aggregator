# @intelligent-farming/chirpstack-join-aggregator

Deduplicate a stream of LoRaWAN join requests by DevEUI and surface aggregated state, so an onboarding UI can render one row per device instead of a flood per retry. Sits in front of `@intelligent-farming/chirpstack-join-watcher` (or any source emitting the same `'join'` event shape) and emits change events on every update.

## Install

```sh
npm install @intelligent-farming/chirpstack-join-aggregator
```

## Usage

```ts
import { createAggregator } from '@intelligent-farming/chirpstack-join-aggregator';
import { watch } from '@intelligent-farming/chirpstack-join-watcher';

const watcher = watch({ url: 'mqtt://localhost:1883' });

// Subscribes to watcher's 'join' events automatically when `source` is passed.
const agg = createAggregator({
  source: watcher,
  ttlMs: 5 * 60_000,    // drop candidates that haven't joined in 5 minutes
});

agg.on('new', state => console.log('first sight:', state.devEui));
agg.on('candidate', state => updateRow(state));   // every update — wire to UI
agg.on('expired', state => fadeOutRow(state.devEui));

// Pull current state on demand
agg.list();              // all candidates, most-recent first
agg.get('A84041035660E3AA');
agg.forget('A84041035660E3AA');   // manually drop after provisioning

// Shutdown
agg.stop();              // cancels the TTL sweep timer
```

Or feed events manually if your source isn't a `chirpstack-join-watcher`:

```ts
const agg = createAggregator();

myCustomSource.on('event', evt => {
  agg.record({
    gatewayId: evt.gw,
    candidate: {
      devEui: evt.devEui,
      joinEui: evt.joinEui,
      oui: evt.devEui.slice(0, 6),
      devNonce: evt.devNonce,
      vendor: null,
    },
    receivedAt: new Date(),
  });
});
```

## State shape

Each entry in the table is a `JoinCandidateState`:

```ts
{
  devEui: 'A84041035660E3AA',
  joinEui: '70B3D57ED0000001',
  oui: 'A84041',
  vendor: { id: 'dragino', name: 'Dragino Technology…', source: 'oui' },
  firstSeen: Date,        // never changes after the initial record
  lastSeen: Date,         // most recent join
  lastDevNonce: '1A2B',   // useful for spotting replay patterns
  count: 17,              // total joins recorded for this DevEUI
  gateways: ['gw-01', 'gw-03'],   // alphabetical, deduped
}
```

## Events

- `'candidate'` — every time `record()` is called. The listener gets the post-update state. **Wire your UI's live list to this.**
- `'new'` — first time a DevEUI is seen. Useful for flashing the row or playing a "new device" sound.
- `'expired'` — TTL elapsed for a candidate that hasn't been seen in `ttlMs`. Lets the UI fade the row out.

## TTL and sweep

`ttlMs` defaults to `0` (never expire). Set it larger than the device's join-retry backoff (LoRaWAN OTAA retries can wait 30–60 s between attempts after the first burst) so a still-joining device isn't expired prematurely. The sweep runs on a timer (`sweepIntervalMs`, default `30000`) and is `unref()`-ed in Node so it won't keep the event loop alive on its own.
