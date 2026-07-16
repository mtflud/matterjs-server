/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { parseIntervalSeconds } from "../src/cli.js";

describe("parseIntervalSeconds", () => {
    it("accepts integers 0-65535", () => {
        expect(parseIntervalSeconds("0")).to.equal(0);
        expect(parseIntervalSeconds("300")).to.equal(300);
        expect(parseIntervalSeconds("65535")).to.equal(0xffff);
    });

    it("rejects garbage, fractions, negatives, and out-of-range values", () => {
        for (const bad of ["foo", "12.5", "-1", "65536", "", "300x"]) {
            expect(() => parseIntervalSeconds(bad), bad).to.throw();
        }
    });
});
