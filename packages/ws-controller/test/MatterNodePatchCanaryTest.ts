/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guards the @matter/node keepalive-liveness patch (patches/@matter+node+*.patch).
// Without it, empty maximum-interval keepalive reports never emit subscriptionAlive,
// so PairedNode.connectionAlive starves and the SubscriptionWatchdog false-trips on
// healthy quiet devices. If a dependency bump or an install without patch application
// loses the patch, this fails loudly before slower integration tests do.
describe("MatterNodePatchCanary", () => {
    // matter-test runs with cwd = packages/ws-controller; @matter/node is hoisted.
    const base = resolve(process.cwd(), "../../node_modules/@matter/node/dist");

    for (const flavor of ["esm", "cjs"]) {
        it(`@matter/node ${flavor} NetworkClient wires keepaliveReceived to subscriptionAlive`, () => {
            const source = readFileSync(resolve(base, flavor, "behavior/system/network/NetworkClient.js"), "utf-8");
            expect(source).to.include("fork-patch(keepalive-liveness)");
            expect(source).to.include("keepaliveReceived: () =>");
        });
    }
});
