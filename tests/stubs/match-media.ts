/**
 * jsdom does not implement `window.matchMedia`. Components that need to tell
 * mobile from desktop (the AI widget's bottom-sheet vs. popover presentation)
 * call it directly, so tests install a minimal, controllable stub.
 */
export function installMatchMediaStub(initiallyMatches: boolean) {
  let matches = initiallyMatches;
  const listeners = new Set<(event: { matches: boolean }) => void>();

  const mql = {
    get matches() {
      return matches;
    },
    media: "",
    onchange: null,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };

  window.matchMedia = ((): typeof mql => mql) as unknown as typeof window.matchMedia;

  return {
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}
