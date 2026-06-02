# @intelligentfarming/chirpstack-join-aggregator

Aggregate a noisy stream of LoRaWAN join requests into one row per device.

Unregistered LoRaWAN devices retry their JoinRequest aggressively — every
few seconds for the first minute, then on a backoff. A live onboarding UI
that renders one row per raw `'join'` event ends up showing the same DevEUI
dozens of times. This module sits in front of
`@intelligentfarming/chirpstack-join-watcher` (or any source emitting the
same shape) and collapses retries into a single [JoinCandidateState](#joincandidatestate)
per DevEUI — with first/last-seen timestamps, retry count, and the set of
gateways that have heard it.

Two events are emitted:
- `'candidate'` — every time [JoinAggregator.record](#record) is called. The
  listener gets the post-update state. Wire your UI's "live list" to this.
- `'new'` — first time a DevEUI is seen. Useful for flashing the row or
  playing a "new device" sound.

Optional TTL drops candidates that haven't been seen for a configured
duration — convenient cleanup after a device has been successfully
provisioned and stops emitting joins. Expired candidates are surfaced via
an `'expired'` event so the UI can fade them out.

## Interfaces

### JoinAggregator

Returned by [createAggregator](#createaggregator). Holds the in-memory candidate table.

#### Methods

##### clear()

> **clear**(): `void`

Drop every candidate.

###### Returns

`void`

##### forget()

> **forget**(`devEui`): `boolean`

Drop a single candidate. Returns `true` if it existed.

###### Parameters

###### devEui

`string`

###### Returns

`boolean`

##### get()

> **get**(`devEui`): [`JoinCandidateState`](#joincandidatestate) \| `undefined`

Get the current state for a DevEUI.

###### Parameters

###### devEui

`string`

###### Returns

[`JoinCandidateState`](#joincandidatestate) \| `undefined`

##### list()

> **list**(): [`JoinCandidateState`](#joincandidatestate)[]

All current candidates, sorted by `lastSeen` descending (most-recent first).

###### Returns

[`JoinCandidateState`](#joincandidatestate)[]

##### on()

###### Call Signature

> **on**(`event`, `listener`): [`JoinAggregator`](#joinaggregator)

###### Parameters

###### event

`"candidate"`

###### listener

(`state`) => `void`

###### Returns

[`JoinAggregator`](#joinaggregator)

###### Call Signature

> **on**(`event`, `listener`): [`JoinAggregator`](#joinaggregator)

###### Parameters

###### event

`"new"`

###### listener

(`state`) => `void`

###### Returns

[`JoinAggregator`](#joinaggregator)

###### Call Signature

> **on**(`event`, `listener`): [`JoinAggregator`](#joinaggregator)

###### Parameters

###### event

`"expired"`

###### listener

(`state`) => `void`

###### Returns

[`JoinAggregator`](#joinaggregator)

##### record()

> **record**(`event`): [`JoinCandidateState`](#joincandidatestate)

Feed a raw [JoinEvent](#joinevent). Updates (or creates) the candidate state and
emits `'candidate'` (always) and `'new'` (only on first sight).

###### Parameters

###### event

[`JoinEvent`](#joinevent)

###### Returns

[`JoinCandidateState`](#joincandidatestate)

The post-update state.

##### stop()

> **stop**(): `void`

Stop any TTL sweep timer. Safe to call multiple times.

###### Returns

`void`

***

### JoinAggregatorOptions

Configuration accepted by [createAggregator](#createaggregator).

#### Properties

##### now?

> `optional` **now?**: () => `Date`

Clock source — override for tests. Default `() => new Date()`.

###### Returns

`Date`

##### source?

> `optional` **source?**: [`JoinSource`](#joinsource)

When provided, the aggregator subscribes to this source's `'join'` events
automatically. Equivalent to calling `source.on('join', agg.record)`.

##### sweepIntervalMs?

> `optional` **sweepIntervalMs?**: `number`

How often to sweep for expired candidates (ms). Default `30000`.
Ignored when [ttlMs](#ttlms) is `0`.

##### ttlMs?

> `optional` **ttlMs?**: `number`

Drop candidates whose `lastSeen` is older than this many milliseconds.
Default `0` (never expire). Set this to a value larger than the device's
join-retry backoff (LoRaWAN OTAA retries can wait 30–60 s between attempts
after the first burst) to avoid expiring a still-joining device.

***

### JoinCandidate

Minimal candidate shape this module reads from each [JoinEvent](#joinevent).
Structurally compatible with `JoinCandidate` from
`@intelligentfarming/chirpstack-join-watcher` — but defined locally so we
don't take a hard dependency on a Node-only module.

#### Properties

##### devEui

> **devEui**: `string`

##### devNonce

> **devNonce**: `string`

##### joinEui

> **joinEui**: `string`

##### oui

> **oui**: `string`

##### vendor?

> `optional` **vendor?**: \{ `id?`: `string`; `name`: `string`; `source?`: `string`; \} \| `null`

***

### JoinCandidateState

Aggregated per-DevEUI state.

#### Properties

##### count

> **count**: `number`

Total number of times this DevEUI has been recorded.

##### devEui

> **devEui**: `string`

##### firstSeen

> **firstSeen**: `Date`

First time this DevEUI was recorded. Never changes after the initial record.

##### gateways

> **gateways**: `string`[]

Gateway IDs that have heard this device, sorted alphabetically.

##### joinEui

> **joinEui**: `string`

##### lastDevNonce

> **lastDevNonce**: `string`

Most recent DevNonce — useful for spotting replay patterns.

##### lastSeen

> **lastSeen**: `Date`

Most recent time this DevEUI was recorded.

##### oui

> **oui**: `string`

##### vendor

> **vendor**: \{ `id?`: `string`; `name`: `string`; `source?`: `string`; \} \| `null` \| `undefined`

***

### JoinEvent

Minimal event shape — structurally matches the watcher's `JoinEvent`.

#### Properties

##### candidate

> **candidate**: [`JoinCandidate`](#joincandidate)

##### gatewayId

> **gatewayId**: `string`

##### receivedAt

> **receivedAt**: `Date`

***

### JoinSource

Anything with an `.on('join', listener)` method — typically a
`chirpstack-join-watcher` instance, but any structural equivalent works.

#### Properties

##### off?

> `optional` **off?**: (`event`, `listener`) => `unknown`

###### Parameters

###### event

`"join"`

###### listener

(`e`) => `void`

###### Returns

`unknown`

#### Methods

##### on()

> **on**(`event`, `listener`): `unknown`

###### Parameters

###### event

`"join"`

###### listener

(`e`) => `void`

###### Returns

`unknown`

## Functions

### createAggregator()

> **createAggregator**(`opts?`): [`JoinAggregator`](#joinaggregator)

Build a new aggregator. Each instance owns its own in-memory candidate
table; create multiple if you need to scope by tenant or application.

#### Parameters

##### opts?

[`JoinAggregatorOptions`](#joinaggregatoroptions) = `{}`

#### Returns

[`JoinAggregator`](#joinaggregator)
