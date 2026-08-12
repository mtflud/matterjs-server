/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */

import { mdiCheck, mdiClockOutline, mdiFire, mdiSnowflake } from "@mdi/js";
import { css, type CSSResultGroup, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "../../../components/ha-svg-icon.js";
import {
    buildDaySegments,
    compareTransitionsForDisplay,
    computeSetpointRange,
    DAY_LABELS,
    type DaySegment,
    formatDayOfWeek,
    formatHandleShort,
    formatMinutes,
    formatSegmentTooltip,
    formatSetpoint,
    isMSCHActive,
    readActiveScheduleHandle,
    readPresets,
    pickSetpointForMode,
    readSchedules,
    resolveScheduleDefaults,
    resolveTransitionLabel,
    type ScheduleColorMode,
    setpointColorMixPercent,
    THERMOSTAT_CLUSTER_ID,
} from "../../../util/thermostat-schedule.js";
import { BaseClusterCommands } from "../base-cluster-commands.js";
import { registerClusterCommands } from "../registry.js";

const HOUR_TICKS = [0, 4, 8, 12, 16, 20, 24];

@customElement("thermostat-cluster-commands")
class ThermostatClusterCommands extends BaseClusterCommands {
    @state() private _selectedHandle: string | null = null;
    @state() private _colorMode: ScheduleColorMode = "heat";
    private _scheduleContext?: string;

    override willUpdate(changedProperties: Map<string, unknown>) {
        super.willUpdate(changedProperties);
        if (!this.node) return;
        const context = `${String(this.node.node_id)}/${this.endpoint}/${this.cluster}`;
        if (this._scheduleContext !== undefined && this._scheduleContext !== context) {
            this._selectedHandle = null;
            this._colorMode = "heat";
        }
        this._scheduleContext = context;
    }

    override render() {
        if (!this.node || this.cluster !== THERMOSTAT_CLUSTER_ID || !isMSCHActive(this.node, this.endpoint)) {
            return nothing;
        }

        const schedules = readSchedules(this.node, this.endpoint);
        const activeHandle = readActiveScheduleHandle(this.node, this.endpoint);
        const presets = readPresets(this.node, this.endpoint);

        const pickedSchedule =
            (this._selectedHandle !== null ? schedules?.find(s => s.handle === this._selectedHandle) : undefined) ??
            (activeHandle !== null ? schedules?.find(s => s.handle === activeHandle) : undefined) ??
            schedules?.[0];
        const selectedSchedule =
            pickedSchedule !== undefined ? resolveScheduleDefaults(pickedSchedule, presets) : undefined;
        const resolvedTransitions = selectedSchedule?.transitions ?? [];
        const transitionRows = resolvedTransitions
            .map((resolved, index) => ({ resolved, reported: pickedSchedule?.transitions[index] }))
            .sort((a, b) => compareTransitionsForDisplay(a.resolved, b.resolved));

        const range = selectedSchedule ? computeSetpointRange(selectedSchedule, this._colorMode) : undefined;
        const hasDualSetpoints =
            resolvedTransitions.some(t => t.heatingSetpoint !== null) &&
            resolvedTransitions.some(t => t.coolingSetpoint !== null);

        return html`
            <details class="command-panel" open>
                <summary>
                    <ha-svg-icon .path=${mdiClockOutline}></ha-svg-icon>
                    Schedule Configuration
                    <span class="feature-map-badge">FeatureMap: MSCH</span>
                </summary>
                <div class="command-content">
                    ${
                        schedules === undefined
                            ? html`<p class="empty">Schedules attribute not available.</p>`
                            : schedules.length === 0
                              ? html`<p class="empty">No schedules configured.</p>`
                              : html`
                                    <ul class="schedule-chips">
                                        ${schedules.map((s, index) => {
                                            const isActive = s.handle === activeHandle;
                                            return html`
                                                <li>
                                                    <button
                                                        class="schedule-chip ${isActive ? "active" : ""} ${
                                                            selectedSchedule?.handle === s.handle ? "selected" : ""
                                                        }"
                                                        @click=${() => {
                                                            this._selectedHandle = s.handle;
                                                        }}
                                                    >
                                                        <span>${s.name ?? `Schedule ${index + 1}`}</span>
                                                        <span class="chip-handle">${formatHandleShort(s.handle)}</span>
                                                        ${
                                                            isActive
                                                                ? html`<span class="active-badge">
                                                                      <ha-svg-icon .path=${mdiCheck}></ha-svg-icon>
                                                                      Active
                                                                  </span>`
                                                                : nothing
                                                        }
                                                    </button>
                                                </li>
                                            `;
                                        })}
                                    </ul>

                                    ${
                                        selectedSchedule
                                            ? html`
                                                  ${
                                                      hasDualSetpoints
                                                          ? html`
                                                                <div class="grid-toolbar">
                                                                    <span class="grid-toolbar-label">Color by</span>
                                                                    <button
                                                                        class="mode-toggle ${
                                                                            this._colorMode === "heat" ? "active" : ""
                                                                        }"
                                                                        @click=${() => {
                                                                            this._colorMode = "heat";
                                                                        }}
                                                                    >
                                                                        <ha-svg-icon .path=${mdiFire}></ha-svg-icon>
                                                                        Heat
                                                                    </button>
                                                                    <button
                                                                        class="mode-toggle ${
                                                                            this._colorMode === "cool" ? "active" : ""
                                                                        }"
                                                                        @click=${() => {
                                                                            this._colorMode = "cool";
                                                                        }}
                                                                    >
                                                                        <ha-svg-icon
                                                                            .path=${mdiSnowflake}
                                                                        ></ha-svg-icon>
                                                                        Cool
                                                                    </button>
                                                                </div>
                                                            `
                                                          : nothing
                                                  }
                                                  <div class="schedule-grid">
                                                      <div class="grid-ticks">
                                                          ${HOUR_TICKS.map(
                                                              h => html`<span>${String(h).padStart(2, "0")}:00</span>`,
                                                          )}
                                                      </div>
                                                      ${DAY_LABELS.map((label, day) => {
                                                          const segments = buildDaySegments(selectedSchedule, day);
                                                          return html`
                                                              <div
                                                                  class="grid-row ${segments.length > 0 ? "" : "dimmed"}"
                                                              >
                                                                  <span class="day-label">${label}</span>
                                                                  <div class="day-timeline">
                                                                      ${segments.map(
                                                                          seg => html`
                                                                              <span
                                                                                  class="segment"
                                                                                  style=${`left:${(seg.startMin / 1440) * 100}%;width:${
                                                                                      ((seg.endMin - seg.startMin) /
                                                                                          1440) *
                                                                                      100
                                                                                  }%;background:${this._segmentColor(
                                                                                      seg,
                                                                                      range,
                                                                                      this._colorMode,
                                                                                  )}`}
                                                                                  title=${formatSegmentTooltip(seg, presets)}
                                                                              ></span>
                                                                          `,
                                                                      )}
                                                                  </div>
                                                              </div>
                                                          `;
                                                      })}
                                                  </div>

                                                  ${
                                                      range
                                                          ? html`
                                                                <div class="legend">
                                                                    ${
                                                                        range.min === range.max
                                                                            ? html`<span>
                                                                                  ${formatSetpoint(range.min)}
                                                                              </span>`
                                                                            : html`<span>
                                                                                      ${formatSetpoint(range.min)}
                                                                                  </span>
                                                                                  <span class="legend-bar"></span>
                                                                                  <span>
                                                                                      ${formatSetpoint(range.max)}
                                                                                  </span>`
                                                                    }
                                                                </div>
                                                            `
                                                          : nothing
                                                  }

                                                  <div class="transitions">
                                                      <div class="transitions-header">
                                                          TRANSITIONS ·
                                                          ${selectedSchedule.name ?? formatHandleShort(selectedSchedule.handle)}
                                                      </div>
                                                      <ul class="transitions-list">
                                                          ${transitionRows.map(
                                                              ({ resolved: t, reported }) => html`
                                                                  <li class="transition-row">
                                                                      <span class="transition-days">
                                                                          ${formatDayOfWeek(t.dayOfWeek)}
                                                                      </span>
                                                                      <span class="transition-time">
                                                                          ${formatMinutes(t.transitionTimeMin)}
                                                                      </span>
                                                                      <span class="transition-label">
                                                                          ${resolveTransitionLabel(t, presets)}
                                                                      </span>
                                                                      <span class="transition-setpoint">
                                                                          ${this._setpointCell(
                                                                              mdiFire,
                                                                              t.heatingSetpoint,
                                                                              reported?.heatingSetpoint ?? null,
                                                                          )}
                                                                          ${this._setpointCell(
                                                                              mdiSnowflake,
                                                                              t.coolingSetpoint,
                                                                              reported?.coolingSetpoint ?? null,
                                                                          )}
                                                                      </span>
                                                                  </li>
                                                              `,
                                                          )}
                                                      </ul>
                                                  </div>
                                              `
                                            : nothing
                                    }
                                `
                    }
                </div>
            </details>
        `;
    }

    /** A value the device did not report for this transition comes from its preset, so it is marked as derived. */
    private _setpointCell(icon: string, resolved: number | null, reported: number | null) {
        if (resolved === null) return nothing;
        const fromPreset = resolved !== reported;
        return html`<span
            class="setpoint-value ${fromPreset ? "inherited" : ""}"
            title=${fromPreset ? "From preset" : nothing}
        >
            <ha-svg-icon .path=${icon}></ha-svg-icon>
            ${formatSetpoint(resolved)}
        </span>`;
    }

    private _segmentColor(
        seg: DaySegment,
        range: { min: number; max: number } | undefined,
        mode: ScheduleColorMode,
    ): string {
        const value = pickSetpointForMode(seg, mode);
        if (value === null || !range) {
            return "repeating-linear-gradient(45deg, var(--md-sys-color-outline) 0 3px, transparent 3px 7px)";
        }
        const pct = setpointColorMixPercent(value, range.min, range.max);
        return `color-mix(in srgb, var(--schedule-color-cold), var(--schedule-color-hot) ${pct}%)`;
    }

    static override styles: CSSResultGroup = [
        BaseClusterCommands.styles,
        css`
            .feature-map-badge {
                margin-left: auto;
                font-size: 0.75rem;
                font-weight: 400;
                color: var(--md-sys-color-on-surface-variant);
            }

            .schedule-chips {
                list-style: none;
                margin: 0 0 16px 0;
                padding: 0;
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }

            .schedule-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 8px;
                border: 1px solid var(--md-sys-color-outline);
                background: transparent;
                color: var(--md-sys-color-on-surface);
                font: inherit;
                cursor: pointer;
            }

            .schedule-chip.active {
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
                border-color: transparent;
            }

            .schedule-chip.selected {
                outline: 2px solid var(--md-sys-color-primary);
                outline-offset: 1px;
            }

            .chip-handle {
                font-family: var(--monospace-font);
                font-size: 0.75rem;
                color: var(--md-sys-color-on-surface-variant);
            }

            .active-badge {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                font-size: 0.75rem;
                color: var(--md-sys-color-on-secondary-container);
            }

            .active-badge ha-svg-icon {
                --mdc-icon-size: 14px;
                --icon-primary-color: var(--success-color, #2e7d32);
            }

            .grid-toolbar {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }

            .grid-toolbar-label {
                font-size: 0.75rem;
                color: var(--md-sys-color-on-surface-variant);
            }

            .mode-toggle {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                border-radius: 8px;
                border: 1px solid var(--md-sys-color-outline);
                background: transparent;
                color: var(--md-sys-color-on-surface-variant);
                font: inherit;
                font-size: 0.8rem;
                cursor: pointer;
            }

            .mode-toggle ha-svg-icon {
                --mdc-icon-size: 14px;
            }

            .mode-toggle.active {
                background: var(--md-sys-color-secondary-container);
                color: var(--md-sys-color-on-secondary-container);
                border-color: transparent;
            }

            .schedule-grid {
                margin-bottom: 12px;
            }

            .grid-ticks {
                display: flex;
                justify-content: space-between;
                font-size: 0.7rem;
                color: var(--md-sys-color-on-surface-variant);
                padding: 0 0 4px 48px;
            }

            .grid-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 2px 0;
            }

            .grid-row.dimmed {
                opacity: 0.45;
            }

            .day-label {
                width: 40px;
                flex-shrink: 0;
                font-size: 0.8rem;
                font-weight: 500;
            }

            .grid-row:not(.dimmed) .day-label {
                font-weight: 700;
                color: var(--md-sys-color-on-surface);
            }

            .day-timeline {
                position: relative;
                flex: 1;
                height: 18px;
                border-radius: 4px;
                overflow: hidden;
                background: var(--md-sys-color-surface-container-highest);
            }

            .segment {
                position: absolute;
                top: 0;
                bottom: 0;
                min-width: 2px;
            }

            .legend {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.8rem;
                color: var(--md-sys-color-on-surface-variant);
                padding: 8px 0 16px 48px;
            }

            .legend-bar {
                flex: 1;
                max-width: 240px;
                height: 8px;
                border-radius: 4px;
                background: linear-gradient(to right, var(--schedule-color-cold), var(--schedule-color-hot));
            }

            .transitions-header {
                font-weight: 500;
                font-size: 0.8rem;
                letter-spacing: 0.04em;
                color: var(--md-sys-color-on-surface-variant);
                text-transform: uppercase;
                margin-bottom: 8px;
            }

            .transitions-list {
                list-style: none;
                margin: 0;
                padding: 0;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .transition-row {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 12px;
                border-radius: 8px;
                background: var(--md-sys-color-surface-container-highest);
            }

            .transition-days {
                min-width: 104px;
                flex-shrink: 0;
                font-size: 0.8rem;
                font-weight: 500;
                color: var(--md-sys-color-on-surface-variant);
            }

            .transition-time {
                font-family: var(--monospace-font);
                font-weight: 500;
                width: 48px;
            }

            .transition-label {
                flex: 1;
                color: var(--md-sys-color-on-surface-variant);
            }

            .transition-setpoint {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-weight: 500;
            }

            .transition-setpoint ha-svg-icon {
                --mdc-icon-size: 16px;
            }

            .setpoint-value {
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }

            .setpoint-value.inherited {
                font-style: italic;
                font-weight: 400;
                color: var(--md-sys-color-on-surface-variant);
            }

            .empty {
                color: var(--md-sys-color-on-surface-variant);
                margin: 0;
            }
        `,
    ];
}

registerClusterCommands(THERMOSTAT_CLUSTER_ID, "thermostat-cluster-commands");

declare global {
    interface HTMLElementTagNameMap {
        "thermostat-cluster-commands": ThermostatClusterCommands;
    }
}
