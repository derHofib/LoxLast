/** Browser-Attrappen für jsdom: React Flow braucht ResizeObserver und DOMMatrixReadOnly. */
export function installDomShims(): void {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  class Matrix {
    m22: number;
    constructor(transform?: string) {
      const scale = /scale\(([\d.]+)\)/.exec(transform ?? '');
      this.m22 = scale ? Number(scale[1]) : 1;
    }
  }
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = Matrix;
}
