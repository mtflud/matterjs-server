/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { Seconds } from "@matter/main";
import {
    isCapOnlySubscriptionOptions,
    maybeCapSubscriptionInterval,
    PairedNodeLike,
    sanitizeCapSeconds,
    shouldClearPersistedDefaultSubscription,
    subscriptionCapNodeOf,
    SubscriptionIntervalCapNode,
} from "../src/controller/subscriptionIntervalCap.js";

function fakeNode(overrides: Partial<SubscriptionIntervalCapNode> = {}) {
    const applied: number[] = [];
    const node: SubscriptionIntervalCapNode = {
        negotiatedIntervalSeconds: 622, // battery-device default: 10 min + jitter
        requestedCeilingSeconds: undefined,
        applyCeilingSeconds: async seconds => {
            applied.push(seconds);
        },
        ...overrides,
    };
    return { node, applied };
}

describe("subscriptionIntervalCap", () => {
    describe("maybeCapSubscriptionInterval", () => {
        it("caps a node whose negotiated interval exceeds the cap", async () => {
            const { node, applied } = fakeNode();
            const result = await maybeCapSubscriptionInterval(node, 300);
            expect(result).to.deep.equal({ applied: true, negotiatedIntervalSeconds: 622 });
            expect(applied).to.deep.equal([300]);
        });

        it("leaves a node at or below the cap alone (mains devices negotiate ~60s)", async () => {
            const { node, applied } = fakeNode({ negotiatedIntervalSeconds: 66 });
            expect((await maybeCapSubscriptionInterval(node, 300)).applied).to.equal(false);
            expect(applied).to.deep.equal([]);
        });

        it("skips a node with no established subscription", async () => {
            const { node, applied } = fakeNode({ negotiatedIntervalSeconds: undefined });
            expect((await maybeCapSubscriptionInterval(node, 300)).applied).to.equal(false);
            expect(applied).to.deep.equal([]);
        });

        it("is idempotent after negotiation jitter (requested 300 -> negotiated up to 330)", async () => {
            const { node, applied } = fakeNode({ negotiatedIntervalSeconds: 330, requestedCeilingSeconds: 300 });
            expect((await maybeCapSubscriptionInterval(node, 300)).applied).to.equal(false);
            expect(applied).to.deep.equal([]);
        });

        it("does not loop when a device ignores the requested ceiling", async () => {
            // e.g. a sleepy device that pins its own long interval regardless of the request
            const { node, applied } = fakeNode({ negotiatedIntervalSeconds: 3600, requestedCeilingSeconds: 300 });
            expect((await maybeCapSubscriptionInterval(node, 300)).applied).to.equal(false);
            expect(applied).to.deep.equal([]);
        });
    });

    describe("sanitizeCapSeconds", () => {
        it("passes sane values, floors fractions, clamps to uint16, rejects <=0/NaN/undefined", () => {
            expect(sanitizeCapSeconds(300)).to.equal(300);
            expect(sanitizeCapSeconds(300.9)).to.equal(300);
            expect(sanitizeCapSeconds(1_000_000)).to.equal(0xffff);
            expect(sanitizeCapSeconds(0)).to.equal(undefined);
            expect(sanitizeCapSeconds(-5)).to.equal(undefined);
            expect(sanitizeCapSeconds(Number.NaN)).to.equal(undefined);
            expect(sanitizeCapSeconds(undefined)).to.equal(undefined);
        });
    });

    describe("subscriptionCapNodeOf (adapter over PairedNode)", () => {
        function fakePairedNode(negotiated: number | undefined, ceiling?: number) {
            const writes: object[] = [];
            const node: PairedNodeLike = {
                currentSubscriptionIntervalSeconds: negotiated,
                node: {
                    maybeStateOf: () =>
                        ceiling === undefined
                            ? { defaultSubscription: undefined }
                            : { defaultSubscription: { maxIntervalCeiling: Seconds(ceiling) } },
                    set: async values => {
                        writes.push(values);
                    },
                },
            };
            return { node, writes };
        }

        it("exposes the negotiated interval and requested ceiling in seconds", () => {
            const { node } = fakePairedNode(622, 300);
            const adapted = subscriptionCapNodeOf(node);
            expect(adapted.negotiatedIntervalSeconds).to.equal(622);
            expect(adapted.requestedCeilingSeconds).to.equal(300);
        });

        it("reports undefined ceiling when matter.js defaults apply", () => {
            const { node } = fakePairedNode(622);
            expect(subscriptionCapNodeOf(node).requestedCeilingSeconds).to.equal(undefined);
        });

        it("writes exactly one cap-only defaultSubscription state update", async () => {
            const { node, writes } = fakePairedNode(622);
            await subscriptionCapNodeOf(node).applyCeilingSeconds(300);
            expect(writes.length).to.equal(1);
            const write = writes[0] as { network: { defaultSubscription: { maxIntervalCeiling: unknown } } };
            expect(Seconds.of(write.network.defaultSubscription.maxIntervalCeiling as never)).to.equal(300);
            // cap-only: no other keys ride along (keeps isCapOnlySubscriptionOptions recognizing it at startup)
            expect(Object.keys(write.network.defaultSubscription)).to.deep.equal(["maxIntervalCeiling"]);
        });

        it("end-to-end with the decision helper: caps once, then goes quiet", async () => {
            const { node, writes } = fakePairedNode(622);
            expect((await maybeCapSubscriptionInterval(subscriptionCapNodeOf(node), 300)).applied).to.equal(true);
            const after = fakePairedNode(330, 300); // post-resubscribe view
            expect((await maybeCapSubscriptionInterval(subscriptionCapNodeOf(after.node), 300)).applied).to.equal(
                false,
            );
            expect(writes.length).to.equal(1);
            expect(after.writes.length).to.equal(0);
        });
    });

    describe("isCapOnlySubscriptionOptions", () => {
        it("recognizes exactly our persisted cap and nothing else", () => {
            expect(isCapOnlySubscriptionOptions({ maxIntervalCeiling: Seconds(300) }, 300)).to.equal(true);
            expect(isCapOnlySubscriptionOptions({ maxIntervalCeiling: Seconds(600) }, 300)).to.equal(false);
            expect(isCapOnlySubscriptionOptions(undefined, 300)).to.equal(false);
            expect(isCapOnlySubscriptionOptions({ maxIntervalCeiling: Seconds(300) }, undefined)).to.equal(false);
            // anything beyond the ceiling key is somebody else's subscription spec — never keep it
            expect(
                isCapOnlySubscriptionOptions({ maxIntervalCeiling: Seconds(300), attributes: [{}] } as never, 300),
            ).to.equal(false);
        });
    });

    describe("shouldClearPersistedDefaultSubscription (startup clearing decision)", () => {
        it("keeps exactly our current cap; clears changed, disabled, and foreign state", () => {
            // matching cap-only state survives the boot
            expect(shouldClearPersistedDefaultSubscription({ maxIntervalCeiling: Seconds(300) }, 300)).to.equal(false);
            // nothing persisted -> nothing to clear
            expect(shouldClearPersistedDefaultSubscription(undefined, 300)).to.equal(false);
            // cap value changed in config -> stale cap is cleared, reactive path re-caps at the new value
            expect(shouldClearPersistedDefaultSubscription({ maxIntervalCeiling: Seconds(300) }, 120)).to.equal(true);
            // cap disabled -> leftover cap is cleared, matter.js defaults return
            expect(shouldClearPersistedDefaultSubscription({ maxIntervalCeiling: Seconds(300) }, undefined)).to.equal(
                true,
            );
            // foreign subscription spec -> always cleared (upstream behavior preserved)
            expect(
                shouldClearPersistedDefaultSubscription(
                    { maxIntervalCeiling: Seconds(300), attributes: [{}] } as never,
                    300,
                ),
            ).to.equal(true);
        });
    });
});
