/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guards the fork dist patch "ACK-failure fast resubscribe" (see homeassistant repo
// docs/superpowers/specs/2026-07-11-matter-ack-failure-fast-resubscribe-design.md).
// Without it, a subscription whose final success-ACK cannot be delivered lingers
// until its natural timeout (~11 min) and every device report in that window is
// lost. If a matter.js bump regenerates node_modules without the patch applying,
// this fails loudly before slower integration tests do.
describe("ProtocolAckFailurePatchCanary", () => {
    // matter-test runs with cwd = packages/ws-controller; @matter/protocol is hoisted.
    const base = resolve(process.cwd(), "../../node_modules/@matter/protocol/dist");

    for (const flavor of ["esm", "cjs"]) {
        it(`@matter/protocol ${flavor} InteractionMessenger surfaces final-ack failures`, () => {
            const source = readFileSync(resolve(base, flavor, "interaction/InteractionMessenger.js"), "utf-8");
            const hook = source.indexOf("onFinalAckFailure");
            expect(hook).greaterThan(-1);
            // The hook must rethrow so the existing "Error sending success…" log stays.
            const window = source.slice(hook, hook + 400);
            expect(window.includes("throw error")).equals(true);
        });

        it(`@matter/protocol ${flavor} ClientSubscriptionHandler closes the subscription on final-ack failure`, () => {
            const source = readFileSync(
                resolve(base, flavor, "action/client/subscription/ClientSubscriptionHandler.js"),
                "utf-8",
            );
            const hook = source.indexOf("onFinalAckFailure");
            expect(hook).greaterThan(-1);
            expect(source.includes("Peer unresponsive acking data report; replacing subscription")).equals(true);
            expect(source.includes("ackFailureSubscription.close()")).equals(true);
        });
    }
});
