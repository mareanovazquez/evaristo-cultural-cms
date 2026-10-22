// Entorno de navegador mínimo para correr TipTap sin navegador (pruebas del editor). Se importa antes de cargar TipTap.
import { JSDOM } from 'jsdom'

export const dom = new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
const g = globalThis as Record<string, unknown>
for (const k of Object.getOwnPropertyNames(dom.window)) {
  try { if (!(k in g)) g[k] = (dom.window as unknown as Record<string, unknown>)[k] } catch { /* propiedades que jsdom no implementa */ }
}
// jsdom no mide la pantalla: ProseMirror pide el tamaño de los rangos al desplazarse hasta el cursor. Se responde "sin medidas".
const sinMedidas = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, toJSON: () => ({}) }
const rangos = dom.window.Range.prototype as unknown as Record<string, unknown>
rangos.getBoundingClientRect ??= () => sinMedidas
rangos.getClientRects ??= () => Object.assign([], { item: () => null })
g.window = dom.window
g.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
