// Minimal synchronous pub/sub. Gameplay publishes facts ("weapon fired", "damage applied");
// presentation layers (audio, FX, HUD) subscribe. Gameplay never imports presentation.

export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, (list = []));
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  emit(type, payload) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}
