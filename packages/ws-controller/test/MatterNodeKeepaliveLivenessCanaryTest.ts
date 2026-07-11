/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guards the upstream @matter/node keepalive-liveness fix (matter.js#4057, fixed in
// matter.js#4061, first shipped in 0.17.5-alpha.0-20260711-a60245c75; previously carried
// as a fork dist patch). Without it, empty maximum-interval keepalive reports never emit
// subscriptionAlive, so PairedNode.connectionAlive starves and the SubscriptionWatchdog
// false-trips on healthy quiet devices. If a dependency pin regresses below the fix,
// this fails loudly before slower integration tests do.
describe("MatterNodeKeepaliveLivenessCanary", () => {
    // matter-test runs with cwd = packages/ws-controller; @matter/node is hoisted.
    const base = resolve(process.cwd(), "../../node_modules/@matter/node/dist");

    for (const flavor of ["esm", "cjs"]) {
        it(`@matter/node ${flavor} NetworkClient wires keepaliveReceived to subscriptionAlive`, () => {
            const source = readFileSync(resolve(base, flavor, "behavior/system/network/NetworkClient.js"), "utf-8");
            const keepalive = source.indexOf("keepaliveReceived: () =>");
            expect(keepalive).to.be.greaterThan(-1);
            // The handler must emit liveness, not merely exist.
            const handlerWindow = source.slice(keepalive, keepalive + 400);
            expect(handlerWindow).to.include("subscriptionAlive.emit()");
        });
    }
});
