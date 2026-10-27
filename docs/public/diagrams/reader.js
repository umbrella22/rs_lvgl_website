(() => {
  const reader = window.Archify;
  if (!reader?.preset?.apply || !reader?.motionGovernor?.setMode) {
    throw new Error("The documentation diagram requires the Archify reader API.");
  }
  reader.preset.apply("classic");
  // Start each document in motion without changing the reader's saved preference.
  // The native governor still respects reduced motion and page visibility.
  reader.motionGovernor.setMode("live", { persist: false });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable=true]"))) return;
    // The outer document owns theme; Classic is the documentation's visual style.
    if (["t", "s"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.documentElement.dataset.docsReader = "ready";
})();
