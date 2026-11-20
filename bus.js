const map = new Map();
export const bus = {
  on(evt, fn) { if (!map.has(evt)) map.set(evt, []); map.get(evt).push(fn); },
  emit(evt, data) { (map.get(evt) || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[KAZA]', evt, e); } }); }
};
