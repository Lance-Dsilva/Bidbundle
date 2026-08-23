import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scroll methods; components that auto-scroll a
// message list to the bottom just need them to be callable no-ops here.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
