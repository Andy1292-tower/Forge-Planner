"use strict";
/* ---------- STALE PAGE RECOVERY ----------
 * Every asset the page loads is content-hashed, and the production alias serves one release
 * at a time, so the previous release's URLs stop resolving the moment a new one lands. A
 * reader holding an older index.html — out of the browser cache, or out of an edge that had
 * not turned over yet — then asks for a bundle that is no longer there. The markup paints,
 * nothing runs, and the page looks alive while every control is dead.
 *
 * The new-build notice cannot answer that case: it ships inside the bundle that failed. So
 * this file stays outside the hashed graph, at a stable URL served must-revalidate, and is
 * the second and last release URL that is not content-addressed (version.json is the other).
 * It loads ahead of the bundle to catch the bundle's own load failure.
 *
 * It is deliberately close to inert. A page whose assets all arrive registers one listener,
 * issues no request, and reads nothing. Only a failed script or stylesheet spends anything,
 * and only a release id that disagrees with this page's stamp reloads it.
 */
(function () {
  var STAMP_SHAPE = /^[0-9a-f]{16}$/;
  // Document-relative, like the notice's own check: the release also serves from a subpath.
  var VERSION_URL = "version.json";
  var TRIED_KEY = "forgeBootRecovered";

  var meta = document.querySelector('meta[name="forge-build"]');
  var stamp = meta ? meta.getAttribute("content") || "" : "";
  // An unbuilt source tree keeps the placeholder, which fails the shape test and leaves the
  // whole file inert for local development.
  if (!STAMP_SHAPE.test(stamp)) return;

  var recovering = false;

  /* Reloading is only ever right when the release on the host differs from the one this page
   * was cut from. Matching ids mean the asset is missing for some other reason, and a reload
   * would fetch the same dead page again — so that case is left alone rather than looped. */
  function recover() {
    if (recovering || alreadyTried()) return;
    recovering = true;
    fetch(VERSION_URL, { cache: "no-cache", credentials: "omit", headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (data) {
        var build = data && typeof data.build === "string" ? data.build : "";
        if (!STAMP_SHAPE.test(build) || build === stamp) return;
        rememberTried();
        location.reload();
      })
      .catch(function () {});
  }

  /* Keyed by the stamp being escaped, so one dead release is retried once per tab while a
   * page that goes stale again later can still recover. Storage being unavailable costs the
   * guard, not the recovery: the reload itself revalidates the page, so the id it lands on
   * is the host's current one. */
  function alreadyTried() {
    try {
      return sessionStorage.getItem(TRIED_KEY) === stamp;
    } catch (error) {
      return false;
    }
  }

  function rememberTried() {
    try {
      sessionStorage.setItem(TRIED_KEY, stamp);
    } catch (error) {}
  }

  /* Resource failures do not bubble, so this listens on the capture phase. Scripts and
   * stylesheets only: a missing image leaves a working page, and spending a request on one
   * would put the whole cost of this file onto readers who have nothing wrong with them. */
  window.addEventListener(
    "error",
    function (event) {
      var target = event && event.target;
      if (!target || target === window) return;
      var tag = target.tagName;
      if (tag !== "SCRIPT" && tag !== "LINK") return;
      recover();
    },
    true
  );
})();
