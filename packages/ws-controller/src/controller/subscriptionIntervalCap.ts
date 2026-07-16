/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { Duration, NetworkClient, Seconds } from "@matter/main";

/**
 * Bounds how long a silently-dead subscription can go undetected: the native
 * ClientSubscription timeout tracks the negotiated max interval, so a battery
 * device's 10-minute default leaves the controller blind for ~11 minutes when
 * the device-side subscription dies without any server-visible error.
 * Requesting a lower ceiling shrinks that window deterministically; devices
 * without an IcdManagement cluster offer no other bound.
 */

/** Minimal view of a node used by the subscription-interval cap. */
export interface SubscriptionIntervalCapNode {
    /** Negotiated subscription max interval in seconds; undefined while no subscription is established. */
    readonly negotiatedIntervalSeconds: number | undefined;
    /** Ceiling currently requested via NetworkClient.defaultSubscription, in seconds; undefined when matter.js defaults apply. */
    readonly requestedCeilingSeconds: number | undefined;
    /** Request a lower ceiling; matter.js re-subscribes automatically on the state change. */
    applyCeilingSeconds(seconds: number): Promise<void>;
}

export interface SubscriptionIntervalCapResult {
    applied: boolean;
    negotiatedIntervalSeconds?: number;
}

/** Matter maxInterval is uint16 seconds; larger caps are meaningless. */
const MAX_CAP_SECONDS = 0xffff;

export function sanitizeCapSeconds(value: number | undefined): number | undefined {
    if (value === undefined || !Number.isFinite(value)) {
        return undefined;
    }
    const seconds = Math.floor(value);
    if (seconds <= 0) {
        return undefined;
    }
    return Math.min(seconds, MAX_CAP_SECONDS);
}

/**
 * Cap once per subscription generation: acts only when the negotiated interval
 * exceeds the cap AND we have not already requested a ceiling at/below it.
 * The requested-ceiling guard makes this idempotent across negotiation jitter
 * (+10%) and devices that ignore the requested ceiling entirely.
 */
export async function maybeCapSubscriptionInterval(
    node: SubscriptionIntervalCapNode,
    capSeconds: number,
): Promise<SubscriptionIntervalCapResult> {
    const negotiated = node.negotiatedIntervalSeconds;
    if (negotiated === undefined || negotiated <= capSeconds) {
        return { applied: false };
    }
    const requested = node.requestedCeilingSeconds;
    if (requested !== undefined && requested <= capSeconds) {
        return { applied: false };
    }
    await node.applyCeilingSeconds(capSeconds);
    return { applied: true, negotiatedIntervalSeconds: negotiated };
}

/**
 * Structural view of a matter.js PairedNode — only what the adapter touches, so
 * tests can fake it without the compat API.
 */
export interface PairedNodeLike {
    readonly currentSubscriptionIntervalSeconds: number | undefined;
    readonly node: {
        maybeStateOf(type: unknown): { defaultSubscription?: { maxIntervalCeiling?: Duration } } | undefined;
        set(values: object): Promise<void>;
    };
}

/**
 * Adapter over a PairedNode. Writes a cap-ONLY defaultSubscription (single
 * maxIntervalCeiling key) so isCapOnlySubscriptionOptions recognizes the
 * persisted state at the next startup. Setting defaultSubscription re-subscribes
 * automatically (NetworkClient reacts to defaultSubscription$Changed).
 */
export function subscriptionCapNodeOf(node: PairedNodeLike): SubscriptionIntervalCapNode {
    return {
        get negotiatedIntervalSeconds() {
            return node.currentSubscriptionIntervalSeconds;
        },
        get requestedCeilingSeconds() {
            const ceiling = node.node.maybeStateOf(NetworkClient)?.defaultSubscription?.maxIntervalCeiling;
            return ceiling === undefined ? undefined : Seconds.of(ceiling);
        },
        applyCeilingSeconds: async seconds => {
            await node.node.set({ network: { defaultSubscription: { maxIntervalCeiling: Seconds(seconds) } } });
        },
    };
}

/**
 * True when a persisted NetworkClient.defaultSubscription holds exactly our cap
 * (a single maxIntervalCeiling matching capSeconds) — the startup clearing loop
 * keeps such state so known-capped nodes subscribe once with the capped ceiling
 * instead of renegotiating from the device default on every boot.
 */
export function isCapOnlySubscriptionOptions(
    options: { maxIntervalCeiling?: Duration } | undefined,
    capSeconds: number | undefined,
): boolean {
    if (capSeconds === undefined || options === undefined || options.maxIntervalCeiling === undefined) {
        return false;
    }
    const keys = Object.keys(options).filter(key => (options as Record<string, unknown>)[key] !== undefined);
    if (keys.length !== 1 || keys[0] !== "maxIntervalCeiling") {
        return false;
    }
    return Seconds.of(options.maxIntervalCeiling) === capSeconds;
}

/**
 * The startup clearing decision: clear any persisted defaultSubscription EXCEPT
 * exactly our current cap. A cap from an older configuration (changed value) and
 * a cap left behind after disabling the feature both get cleared — matter.js then
 * renegotiates from device defaults, and the reactive path re-caps if warranted.
 */
export function shouldClearPersistedDefaultSubscription(
    options: { maxIntervalCeiling?: Duration } | undefined,
    capSeconds: number | undefined,
): boolean {
    return options !== undefined && !isCapOnlySubscriptionOptions(options, capSeconds);
}
