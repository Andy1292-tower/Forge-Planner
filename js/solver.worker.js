"use strict";

/* Permanently retired legacy endpoint. Never reuse this filename: old tabs depend on an uncaught
 * Worker error here to disable background solving and switch to their already-loaded local solver. */
self.onmessage = function () {
  throw new Error("This Forge Planner tab predates the solver upgrade. Refresh to restore background solving.");
};
