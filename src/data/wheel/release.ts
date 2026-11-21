/**
 * D90: release switch for the announced wheel update (D73).
 *
 * Set to `true` once the update is on the live servers (`npm run check:planner` fails). Then:
 * - the old live wheel (D88) is no longer offered: the toggle disappears, stored / linked `live` inputs and
 *   engine requests fall back to the current wheel, own-wheel codes of the old wheel are rejected;
 * - "Open planner" links go to www.tibia.com instead of the test server.
 * The current wheel's data, engine and codes do not depend on this flag.
 */
export const WHEEL_UPDATE_RELEASED = false;
