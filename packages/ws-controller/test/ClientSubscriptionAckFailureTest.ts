/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */

import { FabricIndex, NodeId } from "@matter/main";
import { ClientSubscriptionHandler, IncomingInteractionClientMessenger, PeerAddress } from "@matter/main/protocol";
import { TlvDataReport } from "@matter/main/types";

// Fork dist patch (see 2026-07-11 ACK-failure fast-resubscribe design):
// a failed final success-ACK on a subscription data report must close the
// subscription immediately so SustainedSubscription replaces it, instead of
// lingering until the ~11-min subscription timeout.

const PEER = PeerAddress({ fabricIndex: FabricIndex(1), nodeId: NodeId(1) });

/** Minimal empty (keepalive-shaped) subscription data report message. */
function reportMessage() {
    return {
        payloadHeader: { messageType: 5 /* MessageType.ReportData */ },
        payload: TlvDataReport.encode({
            subscriptionId: 1,
            suppressResponse: false,
            interactionModelRevision: 11,
        }),
    };
}

/**
 * Fake MessageExchange: yields the given inbound messages, and delegates
 * outbound send() (the success StatusResponse) to sendImpl.
 */
function fakeExchange(sendImpl: () => Promise<void>, session?: unknown) {
    const inbound = [reportMessage()];
    return {
        via: "test-exchange",
        channel: { session: session ?? { isSecure: true, peerAddress: PEER } },
        nextMessage: async () => {
            const next = inbound.shift();
            if (next === undefined) {
                throw new Error("No more inbound messages expected in this test");
            }
            return next;
        },
        send: (_type: number, _payload: unknown, _options?: unknown) => sendImpl(),
        close: async () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function fakeSubscription() {
    const calls = { close: 0 };
    const sub = {
        subscriptionId: 1,
        isReading: false,
        timeoutAt: undefined,
        request: {},
        close: () => {
            calls.close++;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { sub, calls };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSubscriptions(sub: any, { aborted = false } = {}) {
    const controller = new AbortController();
    if (aborted) {
        controller.abort();
    }
    return {
        isBlocked: false,
        // Both dispose symbols: esbuild's __using helper dispatches on Symbol.dispose
        // (with a Symbol.for fallback); providing both keeps this robust across Node versions.
        beginReading: () => ({ [Symbol.dispose]: () => {}, [Symbol.asyncDispose]: async () => {} }),
        readingAbortSignal: controller.signal,
        getPeer: () => sub,
        resetTimer: () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

describe("ClientSubscriptionAckFailure", () => {
    describe("IncomingInteractionClientMessenger.readDataReports", () => {
        it("invokes onFinalAckFailure when the final success ack cannot be sent", async () => {
            const failure = new Error("peer-unresponsive (test)");
            let captured: unknown;
            const messenger = new IncomingInteractionClientMessenger(fakeExchange(() => Promise.reject(failure)));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const options = { onFinalAckFailure: (error: unknown) => (captured = error) } as any;
            for await (const _report of messenger.readDataReports(options)) {
                // drain
            }
            await messenger.close(); // awaits the tracked end-message promise
            expect(captured).equals(failure);
        });

        it("does not invoke onFinalAckFailure when the ack succeeds", async () => {
            let invoked = false;
            const messenger = new IncomingInteractionClientMessenger(fakeExchange(() => Promise.resolve()));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const options = { onFinalAckFailure: () => (invoked = true) } as any;
            for await (const _report of messenger.readDataReports(options)) {
                // drain
            }
            await messenger.close();
            expect(invoked).equals(false);
        });
    });

    describe("ClientSubscriptionHandler", () => {
        it("closes the subscription when the final ack send fails", async () => {
            const { sub, calls } = fakeSubscription();
            const handler = new ClientSubscriptionHandler(fakeSubscriptions(sub));
            const exchange = fakeExchange(() => Promise.reject(new Error("peer-unresponsive (test)")));
            await handler.onNewExchange(exchange);
            expect(calls.close).equals(1);
        });

        it("does not close the subscription when the ack succeeds", async () => {
            const { sub, calls } = fakeSubscription();
            const handler = new ClientSubscriptionHandler(fakeSubscriptions(sub));
            const exchange = fakeExchange(() => Promise.resolve());
            await handler.onNewExchange(exchange);
            expect(calls.close).equals(0);
        });

        it("does not close the subscription when shutdown abort is active", async () => {
            const { sub, calls } = fakeSubscription();
            const handler = new ClientSubscriptionHandler(fakeSubscriptions(sub, { aborted: true }));
            const exchange = fakeExchange(() => Promise.reject(new Error("peer-unresponsive (test)")));
            await handler.onNewExchange(exchange);
            expect(calls.close).equals(0);
        });
    });
});
