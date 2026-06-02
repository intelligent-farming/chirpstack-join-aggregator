/**
 * Aggregate a noisy stream of LoRaWAN join requests into one row per device.
 *
 * Unregistered LoRaWAN devices retry their JoinRequest aggressively — every
 * few seconds for the first minute, then on a backoff. A live onboarding UI
 * that renders one row per raw `'join'` event ends up showing the same DevEUI
 * dozens of times. This module sits in front of
 * `@intelligentfarming/chirpstack-join-watcher` (or any source emitting the
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
/**
 * Minimal candidate shape this module reads from each {@link JoinEvent}.
 * Structurally compatible with `JoinCandidate` from
 * `@intelligentfarming/chirpstack-join-watcher` — but defined locally so we
 * don't take a hard dependency on a Node-only module.
 */
export interface JoinCandidate {
    devEui: string;
    joinEui: string;
    oui: string;
    devNonce: string;
    vendor?: {
        id?: string;
        name: string;
        source?: string;
    } | null;
}
/** Minimal event shape — structurally matches the watcher's `JoinEvent`. */
export interface JoinEvent {
    gatewayId: string;
    candidate: JoinCandidate;
    receivedAt: Date;
}
/**
 * Anything with an `.on('join', listener)` method — typically a
 * `chirpstack-join-watcher` instance, but any structural equivalent works.
 */
export interface JoinSource {
    on(event: 'join', listener: (e: JoinEvent) => void): unknown;
    off?: (event: 'join', listener: (e: JoinEvent) => void) => unknown;
}
/** Aggregated per-DevEUI state. */
export interface JoinCandidateState {
    devEui: string;
    joinEui: string;
    oui: string;
    vendor: JoinCandidate['vendor'];
    /** First time this DevEUI was recorded. Never changes after the initial record. */
    firstSeen: Date;
    /** Most recent time this DevEUI was recorded. */
    lastSeen: Date;
    /** Most recent DevNonce — useful for spotting replay patterns. */
    lastDevNonce: string;
    /** Total number of times this DevEUI has been recorded. */
    count: number;
    /** Gateway IDs that have heard this device, sorted alphabetically. */
    gateways: string[];
}
/** Configuration accepted by {@link createAggregator}. */
export interface JoinAggregatorOptions {
    /**
     * Drop candidates whose `lastSeen` is older than this many milliseconds.
     * Default `0` (never expire). Set this to a value larger than the device's
     * join-retry backoff (LoRaWAN OTAA retries can wait 30–60 s between attempts
     * after the first burst) to avoid expiring a still-joining device.
     */
    ttlMs?: number;
    /**
     * How often to sweep for expired candidates (ms). Default `30000`.
     * Ignored when {@link ttlMs} is `0`.
     */
    sweepIntervalMs?: number;
    /**
     * Clock source — override for tests. Default `() => new Date()`.
     */
    now?: () => Date;
    /**
     * When provided, the aggregator subscribes to this source's `'join'` events
     * automatically. Equivalent to calling `source.on('join', agg.record)`.
     */
    source?: JoinSource;
}
/** Returned by {@link createAggregator}. Holds the in-memory candidate table. */
export interface JoinAggregator {
    /**
     * Feed a raw {@link JoinEvent}. Updates (or creates) the candidate state and
     * emits `'candidate'` (always) and `'new'` (only on first sight).
     * @returns The post-update state.
     */
    record(event: JoinEvent): JoinCandidateState;
    /** Get the current state for a DevEUI. */
    get(devEui: string): JoinCandidateState | undefined;
    /** All current candidates, sorted by `lastSeen` descending (most-recent first). */
    list(): JoinCandidateState[];
    /** Drop a single candidate. Returns `true` if it existed. */
    forget(devEui: string): boolean;
    /** Drop every candidate. */
    clear(): void;
    /** Stop any TTL sweep timer. Safe to call multiple times. */
    stop(): void;
    on(event: 'candidate', listener: (state: JoinCandidateState) => void): JoinAggregator;
    on(event: 'new', listener: (state: JoinCandidateState) => void): JoinAggregator;
    on(event: 'expired', listener: (state: JoinCandidateState) => void): JoinAggregator;
}
/**
 * Build a new aggregator. Each instance owns its own in-memory candidate
 * table; create multiple if you need to scope by tenant or application.
 */
export declare const createAggregator: (opts?: JoinAggregatorOptions) => JoinAggregator;
//# sourceMappingURL=index.d.ts.map