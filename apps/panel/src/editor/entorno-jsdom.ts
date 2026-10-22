// Entorno de navegador mínimo para correr TipTap sin navegador (pruebas del editor). Se importa antes de cargar TipTap.
import { JSDOM } from 'jsdom'

export const dom = new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
const g = globalThis as Record<string, unknown>
for (const k of Object.getOwnPropertyNames(dom.window)) {
  try { if (!(k in g)) g[k] = (dom.window as unknown as Record<string, unknown>)[k] } catch { /* propiedades que jsdom no implementa */ }
}
g.window = dom.window
g.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
