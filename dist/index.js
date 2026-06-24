"use strict";
/**
 * Aggregate a noisy stream of LoRaWAN join requests into one row per device.
 *
 * Unregistered LoRaWAN devices retry their JoinRequest aggressively — every
 * few seconds for the first minute, then on a backoff. A live onboarding UI
 * that renders one row per raw `'join'` event ends up showing the same DevEUI
 * dozens of times. This module sits in front of
 * `@intelligent-farming/chirpstack-join-watcher` (or any source emitting the
 * same shape) and collapses retries into a single {@link JoinCandidateState}
 * per DevEUI — with first/last-seen timestamps, retry count, and the set of
 * gateways that have heard it.
 *
 * Two events are emitted:
 * - `'candidate'` — every time {@link JoinAggregator.record} is called. The
 *   listener gets the post-update state. Wire your UI's "live list" to this.
 * - `'new'` — first time a DevEUI is seen. Useful for flashing the row or
 *   playing a "new device" sound.
 *
 * Optional TTL drops candidates that haven't been seen for a configured
 * duration — convenient cleanup after a device has been successfully
 * provisioned and stops emitting joins. Expired candidates are surfaced via
 * an `'expired'` event so the UI can fade them out.
 *
 * @packageDocumentation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAggregator = void 0;
const events_1 = require("events");
/* -------------------------------------------------------------------------- */
/* Implementation                                                              */
/* -------------------------------------------------------------------------- */
/**
 * Build a new aggregator. Each instance owns its own in-memory candidate
 * table; create multiple if you need to scope by tenant or application.
 */
const createAggregator = (opts = {}) => {
    const now = opts.now ?? (() => new Date());
    const ttlMs = opts.ttlMs ?? 0;
    const sweepIntervalMs = opts.sweepIntervalMs ?? 30000;
    const table = new Map();
    const emitter = new events_1.EventEmitter();
    const record = (event) => {
        const key = event.candidate.devEui.toUpperCase();
        const existing = table.get(key);
        let state;
        let isNew = false;
        if (existing) {
            state = existing;
            state.lastSeen = event.receivedAt;
            state.lastDevNonce = event.candidate.devNonce;
            state.count += 1;
            // Maintain sorted, deduped gateway list.
            if (!state.gateways.includes(event.gatewayId)) {
                state.gateways = [...state.gateways, event.gatewayId].sort();
            }
            // Refresh vendor info — the candidate may carry an updated lookup result.
            state.vendor = event.candidate.vendor;
            state.joinEui = event.candidate.joinEui;
        }
        else {
            isNew = true;
            state = {
                devEui: key,
                joinEui: event.candidate.joinEui,
                oui: event.candidate.oui,
                vendor: event.candidate.vendor,
                firstSeen: event.receivedAt,
                lastSeen: event.receivedAt,
                lastDevNonce: event.candidate.devNonce,
                count: 1,
                gateways: [event.gatewayId],
            };
            table.set(key, state);
        }
        if (isNew)
            emitter.emit('new', state);
        emitter.emit('candidate', state);
        return state;
    };
    const sweep = () => {
        if (ttlMs <= 0)
            return;
        const cutoff = now().getTime() - ttlMs;
        for (const [key, state] of table) {
            if (state.lastSeen.getTime() < cutoff) {
                table.delete(key);
                emitter.emit('expired', state);
            }
        }
    };
    // Only schedule a sweep when TTL is configured. `setInterval` exists in both
    // Node and browser runtimes; the returned handle has different concrete
    // types but `clearInterval` accepts either.
    const sweepHandle = ttlMs > 0 ? setInterval(sweep, sweepIntervalMs) : undefined;
    // Don't keep the Node event loop alive just for the sweep. `.unref()` exists
    // only on Node timers — in browsers it's a no-op.
    if (sweepHandle && typeof sweepHandle.unref === 'function') {
        sweepHandle.unref();
    }
    const agg = {
        record,
        get: (devEui) => table.get(devEui.toUpperCase()),
        list: () => Array.from(table.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime()),
        forget: (devEui) => table.delete(devEui.toUpperCase()),
        clear: () => table.clear(),
        stop: () => { if (sweepHandle)
            clearInterval(sweepHandle); },
        on: (event, listener) => {
            emitter.on(event, listener);
            return agg;
        },
    };
    if (opts.source)
        opts.source.on('join', record);
    return agg;
};
exports.createAggregator = createAggregator;
//# sourceMappingURL=index.js.map