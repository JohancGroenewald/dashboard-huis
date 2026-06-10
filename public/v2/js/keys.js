// Global keyboard map + the Esc layer stack. Modules that open an overlay
// push an Esc handler; Esc always closes the topmost layer only, so the
// close order (cmdk → popover → dock) stays deterministic.
const escLayers = [];
const handlers = {};

// Named hooks the feature modules fill in: cmdk, toggleDock, undo, redo.
export function setKeyHandler(name, fn) {
  handlers[name] = fn;
}

export function pushEscLayer(onEsc) {
  const entry = { onEsc };
  escLayers.push(entry);
  return () => {
    const i = escLayers.indexOf(entry);
    if (i !== -1) escLayers.splice(i, 1);
  };
}

const inEditable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && escLayers.length) {
    e.preventDefault();
    escLayers[escLayers.length - 1].onEsc();
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (mod && k === 'k') { e.preventDefault(); handlers.cmdk?.(); return; }
  if (mod && k === 'j') { e.preventDefault(); handlers.toggleDock?.(); return; }
  if (e.key === '/' && !mod && !inEditable(e.target)) { e.preventDefault(); handlers.cmdk?.(); return; }

  // Undo/redo — but never steal them from a focused input.
  if (!mod || inEditable(e.target)) return;
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); handlers.undo?.(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); handlers.redo?.(); }
});
