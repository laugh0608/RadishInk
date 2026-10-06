// Compatibility for bookmarked static URLs; content lives in the React dialog.
(() => {
  const page = document.body.dataset.informationPage;
  if (page !== "about" && page !== "help") {
    throw new Error("Unknown information page");
  }
  const current = new URL(window.location.href);
  const target = new URL("./", current);
  target.search = current.search;
  target.hash = `radishink/${page === "help" && current.hash === "#syntax" ? "help/syntax" : page}`;
  window.location.replace(target.href);
})();
