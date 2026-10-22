// Prueba de la pantalla de edición sin navegador: se monta el panel en jsdom con la API simulada (fetch) y se recorre lo principal.
// No reemplaza mirar el panel en un navegador (jsdom no tiene selección, foco ni pegado reales), pero atrapa errores de ejecución.
// Uso: npm run test:pantalla
import './entorno-jsdom'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { App } from '../App'
import { ProveedorSesion } from '../sesion'
import { canonico } from './comparar-cuerpos'
import { tiempos } from '../autoguardado'
import { fuente } from '../VistaPrevia'
import { htmlVistaPrevia } from '../vista-previa'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type J = Record<string, unknown>
const T = (text: string) => ({ type: 'text', text })
const cuerpoOriginal = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [T('Un subtítulo')] },
    { type: 'paragraph', content: [T('Primer párrafo con una nota'), { type: 'footnote', attrs: { content: { type: 'doc', content: [{ type: 'paragraph', content: [T('La nota')] }] } } }] },
    { type: 'imagen', attrs: { imagenId: 5, src: '/media/foto.jpg', alt: 'Una foto', decorativa: false, epigrafe: 'Pie' } },
  ],
}
const articulo = (estado: string) => ({
  id: 7,
  wpId: 123,
  estado,
  publicadoEn: null,
  version: '2026-10-22T10:00:00.000Z',
  conCambiosSinPublicar,
  ruta: null,
  datos: {
    titulo: 'Título de prueba',
    bajada: 'Una bajada',
    cuerpo: cuerpoOriginal,
    seccionId: 1,
    categoriaIds: [10, 11],
    categoriaPrincipalId: 10,
    autorIds: [2, 3],
    imagenEncabezadoId: 5,
    encabezadoAlt: 'Alt del encabezado',
    encabezadoCredito: null,
    encabezadoPuntoFocalX: 0.5,
    encabezadoPuntoFocalY: 0.25,
    conCapital: false,
    novedadHasta: null,
    slug: estado === 'BORRADOR' ? 'borrador-abc' : 'una-nota',
  },
  imagenEncabezado: { id: 5, clave: 'foto.jpg', nombreOriginal: 'foto.jpg' },
})
const catalogos = {
  secciones: [{ id: 1, slug: 'cine', nombre: 'Cine' }, { id: 2, slug: 'arte', nombre: 'Arte' }],
  categorias: [{ id: 10, slug: 'entrevistas', nombre: 'Entrevistas' }, { id: 11, slug: 'ensayos', nombre: 'Ensayos' }, { id: 12, slug: 'reseñas', nombre: 'Reseñas' }],
  autores: [{ id: 2, nombre: 'Ana', soloTexto: false }, { id: 3, nombre: 'Beto', soloTexto: false }, { id: 4, nombre: 'Carla', soloTexto: false }],
}

// ---- Entorno simulado ----
// El autoguardado arranca apagado: las pruebas que lo necesitan lo prenden con tiempos cortos.
tiempos.espera = 1e9
tiempos.reintento = 1e9
let respuestaConfirm = true
const preguntas: string[] = []
window.confirm = (mensaje?: string) => {
  preguntas.push(String(mensaje))
  return respuestaConfirm
}
const portapapeles: string[] = []
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void portapapeles.push(t) }, configurable: true })
fuente.cargar = async () => 'body { margin: 0 }'

// ---- API simulada ----
let estadoArticulo = 'BORRADOR'
let conCambiosSinPublicar = false
let redCaida = false
const descartados: string[] = []
let respuestaPut: { estado: number; cuerpo: J } = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T10:05:00.000Z', conCambiosSinPublicar: false } }
const guardados: J[] = []
const creados: J[] = []
globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = String(entrada)
  const metodo = init?.method ?? 'GET'
  const responder = (estado: number, cuerpo: J) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })
  if (redCaida && metodo === 'PUT') throw new TypeError('Failed to fetch')
  if (url === '/api/admin/articulos' && metodo === 'GET') return responder(200, { estado: 'ok', total: 0, pagina: 1, paginas: 1, conteos: { BORRADOR: 0, PUBLICADO: 0, PROGRAMADO: 0 }, articulos: [] })
  if (url === '/api/admin/articulos/7/borrador' && metodo === 'DELETE') {
    descartados.push(url)
    conCambiosSinPublicar = false
    return responder(200, { estado: 'ok' })
  }
  if (url === '/api/auth/yo') return responder(200, { usuario: { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR' } })
  if (url === '/api/admin/catalogos') return responder(200, { estado: 'ok', ...catalogos })
  if (url === '/api/admin/articulos/7' && metodo === 'GET') return responder(200, { estado: 'ok', articulo: articulo(estadoArticulo) })
  if (url === '/api/admin/articulos/7' && metodo === 'PUT') {
    guardados.push(JSON.parse(String(init?.body)) as J)
    return responder(respuestaPut.estado, respuestaPut.cuerpo)
  }
  if (url.startsWith('/api/admin/imagenes')) return responder(200, { estado: 'ok', total: 1, pagina: 1, paginas: 1, imagenes: [{ id: 6, clave: 'otra.jpg', nombreOriginal: 'otra.jpg', ancho: 10, alto: 10 }] })
  if (url === '/api/admin/articulos' && metodo === 'POST') {
    creados.push(JSON.parse(String(init?.body)) as J)
    return responder(201, { estado: 'ok', id: 7, version: '2026-10-22T10:00:00.000Z' })
  }
  throw new Error(`pedido no previsto: ${metodo} ${url}`)
}) as typeof fetch

// ---- Utilidades ----
const contenedor = document.createElement('div')
document.body.appendChild(contenedor)
const raiz = createRoot(contenedor)
const esperar = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const hasta = async (condicion: () => boolean, mensaje: string) => {
  for (let i = 0; i < 100; i++) {
    if (condicion()) return
    await esperar(20)
  }
  assert.fail(`no apareció: ${mensaje}`)
}
const escribir = async (el: HTMLInputElement | HTMLTextAreaElement, valor: string) => {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
const clic = async (el: Element) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) })
const boton = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto || b.getAttribute('aria-label') === texto)
const abrir = async () => {
  await act(async () => {
    raiz.render(
      <MemoryRouter initialEntries={['/articulos/7']}>
        <ProveedorSesion>
          <App />
        </ProveedorSesion>
      </MemoryRouter>,
    )
  })
  await hasta(() => !!document.getElementById('titulo') && !!document.querySelector('.ProseMirror'), 'la pantalla de edición')
}

let ok = 0
const t = async (nombre: string, fn: () => Promise<void>) => { await fn(); ok++; console.log('ok', nombre) }

await t('abre un borrador con todos sus campos', async () => {
  estadoArticulo = 'BORRADOR'
  await abrir()
  assert.equal((document.getElementById('titulo') as HTMLInputElement).value, 'Título de prueba')
  assert.equal((document.getElementById('bajada') as HTMLTextAreaElement).value, 'Una bajada')
  assert.equal((document.getElementById('seccion') as HTMLSelectElement).value, '1')
  assert.equal((document.getElementById('slug') as HTMLInputElement).readOnly, false, 'la dirección de un borrador se edita')
  assert.equal((document.getElementById('encabezado-alt') as HTMLInputElement).value, 'Alt del encabezado')
  assert.equal((document.getElementById('foco-y') as HTMLInputElement).value, '25')
  const editor = document.querySelector('.ProseMirror')!
  assert.ok(editor.textContent?.includes('Un subtítulo') && editor.textContent.includes('Primer párrafo con una nota'))
  assert.ok(editor.querySelector('figure.imagen img'), 'la imagen del cuerpo se ve')
  assert.deepEqual([...document.querySelectorAll('.lista-autores li > span:first-child')].map((e) => e.textContent), ['Ana', 'Beto'])
  const marcadas = [...document.querySelectorAll<HTMLInputElement>('.fila-categoria input[type=checkbox]')].map((c) => c.checked)
  assert.deepEqual(marcadas, [true, true, false])
  assert.equal(document.querySelector<HTMLInputElement>('input[name=categoria-principal]:checked')?.closest('li')?.textContent?.includes('Entrevistas'), true)
  assert.equal(document.querySelector('.estado-guardado')?.textContent, 'Sin cambios.')
})

await t('guardar sin tocar manda el mismo cuerpo, la versión que se abrió y todos los campos', async () => {
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el pedido de guardado')
  const g = guardados[0]! as { version: string; datos: J }
  assert.equal(g.version, '2026-10-22T10:00:00.000Z')
  assert.deepEqual(canonico(g.datos['cuerpo']), canonico(cuerpoOriginal), 'el cuerpo vuelve igual desde la pantalla')
  assert.deepEqual(Object.keys(g.datos).sort(), ['autorIds', 'bajada', 'categoriaIds', 'categoriaPrincipalId', 'conCapital', 'cuerpo', 'encabezadoAlt', 'encabezadoCredito', 'encabezadoPuntoFocalX', 'encabezadoPuntoFocalY', 'imagenEncabezadoId', 'novedadHasta', 'seccionId', 'slug', 'titulo'])
  await hasta(() => /^Guardado a las/.test(document.querySelector('.estado-guardado')?.textContent ?? ''), 'el aviso de guardado')
})

await t('editar campos: marca cambios, y el siguiente guardado usa la versión nueva', async () => {
  guardados.length = 0
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Otro título')
  assert.equal(document.querySelector('.estado-guardado')?.textContent, 'Hay cambios sin guardar.')
  await escribir(document.getElementById('bajada') as HTMLTextAreaElement, '   ')
  await clic(document.querySelector('.fila-categoria input[type=checkbox]:not(:checked)')!) // Reseñas
  await clic(boton('Subir a Beto')!)
  await clic(boton('Quitar a Ana')!)
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el segundo guardado')
  const g = guardados[0]! as { version: string; datos: J }
  assert.equal(g.version, '2026-10-22T10:05:00.000Z', 'manda la versión que devolvió el guardado anterior')
  assert.equal(g.datos['titulo'], 'Otro título')
  assert.equal(g.datos['bajada'], null, 'una bajada en blanco se guarda como vacía')
  assert.deepEqual(g.datos['categoriaIds'], [10, 11, 12])
  assert.deepEqual(g.datos['autorIds'], [3])
})

await t('un 422 muestra la lista de problemas en lenguaje común', async () => {
  respuestaPut = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá el artículo antes de guardar.', problemas: ['Escribí el título del artículo.', 'Elegí una sección de la lista.'] } }
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Tercer título')
  await clic(boton('Guardar')!)
  await hasta(() => document.querySelectorAll('.aviso-error li').length === 2, 'la lista de problemas')
  assert.ok(document.querySelector('.aviso-error')?.textContent?.includes('Revisá el artículo antes de guardar.'))
  assert.equal(boton('Guardar')!.disabled, false, 'se puede corregir y volver a guardar')
})

await t('un 409 avisa que el artículo cambió y ofrece cargar la versión nueva', async () => {
  respuestaPut = { estado: 409, cuerpo: { estado: 'conflicto', mensaje: 'Este artículo cambió mientras lo editabas.' } }
  await clic(boton('Guardar')!)
  await hasta(() => !!boton('Cargar la versión nueva'), 'el aviso de conflicto')
  assert.ok(document.querySelector('.aviso-error')?.textContent?.includes('Este artículo cambió mientras lo editabas.'))
  assert.equal(boton('Guardar')!.disabled, true, 'no se puede guardar encima de lo que guardó otra persona')
  await clic(boton('Cargar la versión nueva')!)
  await hasta(() => !boton('Cargar la versión nueva') && (document.getElementById('titulo') as HTMLInputElement | null)?.value === 'Título de prueba', 'la versión nueva')
})

await t('el selector de imágenes del encabezado elige de la biblioteca y limpia el texto alternativo', async () => {
  respuestaPut = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T10:09:00.000Z', conCambiosSinPublicar: false } }
  await clic(boton('Cambiar imagen')!)
  await hasta(() => !!document.querySelector('.imagen-opcion'), 'la biblioteca')
  await clic(document.querySelector('.imagen-opcion')!)
  assert.equal(document.querySelector('.galeria-imagenes'), null, 'el selector se cierra')
  assert.equal((document.getElementById('encabezado-alt') as HTMLInputElement).value, '', 'con otra imagen hay que escribir el texto alternativo de nuevo')
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  assert.equal(((guardados[0] as { datos: J }).datos)['imagenEncabezadoId'], 6)
})

await t('insertar una imagen en el cuerpo: se elige de la biblioteca y se guarda con su imagenId y su dirección', async () => {
  const antes = document.querySelectorAll('.ProseMirror figure.imagen').length
  await clic(boton('Insertar una imagen de la biblioteca')!)
  await hasta(() => !!boton('Elegir imagen'), 'la ventana de imagen')
  // Sin elegir imagen ni texto alternativo no se puede guardar
  await clic(boton('Guardar (Ctrl+Enter)')!)
  assert.ok(document.body.textContent?.includes('Elegí una imagen de la biblioteca.'))
  await clic(boton('Elegir imagen')!)
  await hasta(() => !!document.querySelector('.imagen-opcion'), 'la biblioteca')
  await clic(document.querySelector('.imagen-opcion')!)
  await hasta(() => !!document.querySelector('.imagen-miniatura[src="/media/otra.jpg"]'), 'la miniatura elegida')
  await escribir(document.getElementById('imagen-alt') as HTMLInputElement, 'Otra foto')
  await clic(boton('Guardar (Ctrl+Enter)')!)
  await hasta(() => document.querySelectorAll('.ProseMirror figure.imagen').length === antes + 1, 'la imagen en el texto')
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  const imagenes = (guardados[0] as { datos: { cuerpo: { content: Array<{ type: string; attrs?: J }> } } }).datos.cuerpo.content.filter((n) => n.type === 'imagen')
  assert.equal(imagenes.length, 2)
  const nueva = imagenes.find((n) => n.attrs!['imagenId'] === 6)
  assert.ok(nueva, 'la imagen elegida se guarda con su imagenId')
  assert.equal(nueva.attrs!['src'], '/media/otra.jpg')
  assert.equal(nueva.attrs!['alt'], 'Otra foto')
  assert.ok(imagenes.some((n) => n.attrs!['imagenId'] === 5), 'la imagen que ya estaba conserva su imagenId')
})

/** Desmonta lo que haya y monta el panel en la ruta indicada. */
let raizActual = raiz
const irA = async (ruta: string) => {
  await act(async () => { raizActual.unmount() })
  document.body.innerHTML = ''
  const nuevo = document.createElement('div')
  document.body.appendChild(nuevo)
  raizActual = createRoot(nuevo)
  await act(async () => {
    raizActual.render(
      <MemoryRouter initialEntries={[ruta]}>
        <ProveedorSesion>
          <App />
        </ProveedorSesion>
      </MemoryRouter>,
    )
  })
}

await t('alta: el título y la sección crean el borrador y pasan a la pantalla de edición', async () => {
  estadoArticulo = 'BORRADOR'
  await irA('/articulos/nuevo')
  await hasta(() => document.querySelectorAll('#nueva-seccion option').length > 1, 'las secciones')
  // Sin título ni sección no crea nada
  await clic(boton('Crear y empezar a escribir')!)
  assert.ok(document.body.textContent?.includes('Escribí el título del artículo.'))
  assert.equal(creados.length, 0)
  await escribir(document.getElementById('nuevo-titulo') as HTMLInputElement, '  Una nota nueva ')
  await clic(boton('Crear y empezar a escribir')!)
  assert.ok(document.body.textContent?.includes('Elegí una sección.'))
  const seccion = document.getElementById('nueva-seccion') as HTMLSelectElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(seccion, '2')
    seccion.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await clic(boton('Crear y empezar a escribir')!)
  await hasta(() => !!document.getElementById('titulo'), 'la pantalla de edición')
  assert.deepEqual(creados, [{ titulo: 'Una nota nueva', seccionId: 2 }])
})

await t('un artículo publicado muestra la dirección sin poder editarla', async () => {
  estadoArticulo = 'PUBLICADO'
  await irA('/articulos/7')
  await hasta(() => !!document.getElementById('slug'), 'la pantalla')
  assert.equal((document.getElementById('slug') as HTMLInputElement).readOnly, true)
  assert.equal((document.getElementById('slug') as HTMLInputElement).value, 'una-nota')
  assert.ok(document.body.textContent?.includes('Publicado'))
})

// ---- Etapa 4c: autoguardado, aviso al salir, conflicto, descartar y vista previa ----

const abrirBorrador = async () => {
  estadoArticulo = 'BORRADOR'
  conCambiosSinPublicar = false
  respuestaPut = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T10:05:00.000Z', conCambiosSinPublicar: false } }
  await irA('/articulos/7')
  await hasta(() => !!document.getElementById('titulo') && !!document.querySelector('.ProseMirror'), 'la pantalla de edición')
  guardados.length = 0
}
const estadoGuardado = () => document.querySelector('.estado-guardado')?.textContent ?? ''

await t('autoguardado: guarda solo unos segundos después del último cambio, sin apretar nada', async () => {
  await abrirBorrador()
  tiempos.espera = 150
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Uno')
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Uno dos')
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Uno dos tres')
  assert.equal(estadoGuardado(), 'Hay cambios sin guardar.')
  assert.equal(guardados.length, 0, 'todavía no guardó')
  await hasta(() => guardados.length === 1, 'el autoguardado')
  await esperar(300)
  assert.equal(guardados.length, 1, 'tres cambios seguidos son un solo guardado')
  assert.equal(((guardados[0] as { datos: J }).datos)['titulo'], 'Uno dos tres')
  await hasta(() => /^Guardado a las/.test(estadoGuardado()), 'el aviso de guardado')
  tiempos.espera = 1e9
})

await t('autoguardado: guarda también al salir de un campo, sin esperar', async () => {
  await abrirBorrador()
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Salgo del campo')
  await act(async () => {
    document.getElementById('titulo')!.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  })
  await hasta(() => guardados.length === 1, 'el guardado al salir del campo')
})

await t('autoguardado: un 422 no se reenvía en bucle; con el próximo cambio vuelve a probar', async () => {
  await abrirBorrador()
  respuestaPut = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá el artículo antes de guardar.', problemas: ['Escribí el título del artículo.'] } }
  tiempos.espera = 100
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Rechazado')
  await hasta(() => guardados.length === 1, 'el primer intento')
  await hasta(() => estadoGuardado().startsWith('No se guardó'), 'el aviso de que no se guardó')
  await esperar(500)
  assert.equal(guardados.length, 1, 'no vuelve a intentar sola')
  assert.ok(document.querySelector('.aviso-error')?.textContent?.includes('Escribí el título del artículo.'))
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Corregido')
  await hasta(() => guardados.length === 2, 'el intento después de un cambio')
  tiempos.espera = 1e9
})

await t('autoguardado: si falla la conexión avisa y vuelve a probar hasta que se pueda', async () => {
  await abrirBorrador()
  redCaida = true
  tiempos.espera = 80
  tiempos.reintento = 150
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Sin conexión')
  await hasta(() => estadoGuardado() === 'No se pudo guardar. Probamos de nuevo…', 'el aviso de reintento')
  redCaida = false
  await hasta(() => guardados.length === 1 && /^Guardado a las/.test(estadoGuardado()), 'el guardado cuando vuelve la conexión')
  assert.equal(((guardados[0] as { datos: J }).datos)['titulo'], 'Sin conexión', 'no se pierde lo escrito')
  tiempos.espera = 1e9
  tiempos.reintento = 1e9
})

await t('no autoguarda mientras hay una ventana del editor abierta (la imagen nueva todavía está a medio armar)', async () => {
  await abrirBorrador()
  tiempos.espera = 100
  await clic(boton('Insertar una imagen de la biblioteca')!)
  await hasta(() => !!boton('Elegir imagen'), 'la ventana de imagen')
  await esperar(400)
  assert.equal(guardados.length, 0, 'con la ventana abierta no guarda')
  await clic(boton('Cancelar (Esc)')!)
  await esperar(400)
  assert.equal(document.querySelectorAll('.ProseMirror figure.imagen').length, 1, 'la imagen cancelada se descarta')
  tiempos.espera = 1e9
})

await t('salir con cambios sin guardar: pregunta, y si se cancela se queda', async () => {
  await abrirBorrador()
  preguntas.length = 0
  await clic(Array.from(document.querySelectorAll('a')).find((a) => a.textContent?.includes('Volver a los artículos'))!)
  assert.equal(preguntas.length, 0, 'sin cambios no pregunta')
  await abrirBorrador()
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Cambio sin guardar')
  const antesDeCerrar = new window.Event('beforeunload', { cancelable: true })
  window.dispatchEvent(antesDeCerrar)
  assert.equal(antesDeCerrar.defaultPrevented, true, 'al cerrar la pestaña, el navegador avisa')
  respuestaConfirm = false
  await clic(Array.from(document.querySelectorAll('a')).find((a) => a.textContent?.includes('Volver a los artículos'))!)
  assert.equal(preguntas.length, 1)
  assert.ok(preguntas[0]!.includes('cambios sin guardar'))
  assert.ok(document.getElementById('titulo'), 'sigue en la pantalla de edición')
  assert.equal((document.getElementById('titulo') as HTMLInputElement).value, 'Cambio sin guardar')
  respuestaConfirm = true
  await clic(Array.from(document.querySelectorAll('a')).find((a) => a.textContent?.includes('Volver a los artículos'))!)
  await hasta(() => !document.getElementById('titulo') && !!document.querySelector('h1'), 'la pantalla del listado')
  const alCerrar = new window.Event('beforeunload', { cancelable: true })
  window.dispatchEvent(alCerrar)
  assert.equal(alCerrar.defaultPrevented, false, 'fuera de la pantalla de edición ya no avisa')
})

await t('conflicto: "Copiar mi texto" deja el texto propio en el portapapeles y no se pisa nada', async () => {
  await abrirBorrador()
  respuestaPut = { estado: 409, cuerpo: { estado: 'conflicto', mensaje: 'Este artículo cambió mientras lo editabas.' } }
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Mi título de antes del conflicto')
  await clic(boton('Guardar')!)
  await hasta(() => !!boton('Copiar mi texto'), 'el aviso de conflicto')
  portapapeles.length = 0
  await clic(boton('Copiar mi texto')!)
  await hasta(() => portapapeles.length === 1, 'la copia')
  assert.ok(portapapeles[0]!.includes('Mi título de antes del conflicto'))
  assert.ok(portapapeles[0]!.includes('Primer párrafo con una nota'))
  assert.ok(document.body.textContent?.includes('tu texto está en el portapapeles'))
  respuestaConfirm = false
  await clic(boton('Cargar la versión nueva')!)
  assert.equal((document.getElementById('titulo') as HTMLInputElement).value, 'Mi título de antes del conflicto', 'si se cancela, no se pierde nada')
  respuestaConfirm = true
  await clic(boton('Cargar la versión nueva')!)
  await hasta(() => (document.getElementById('titulo') as HTMLInputElement | null)?.value === 'Título de prueba' && !boton('Copiar mi texto'), 'la versión nueva')
})

await t('descartar cambios sin publicar: avisa, pide confirmación y vuelve a la versión publicada', async () => {
  estadoArticulo = 'PUBLICADO'
  conCambiosSinPublicar = true
  await irA('/articulos/7')
  await hasta(() => !!boton('Descartar los cambios'), 'el aviso de cambios sin publicar')
  assert.ok(document.body.textContent?.includes('Este artículo tiene cambios sin publicar.'))
  respuestaConfirm = false
  descartados.length = 0
  await clic(boton('Descartar los cambios')!)
  assert.equal(descartados.length, 0, 'si no se confirma, no descarta')
  respuestaConfirm = true
  await clic(boton('Descartar los cambios')!)
  await hasta(() => descartados.length === 1 && !boton('Descartar los cambios'), 'el descarte y la recarga')
  assert.ok(!document.body.textContent?.includes('tiene cambios sin publicar'))
})

await t('un artículo en borrador no ofrece descartar (no tiene versión publicada)', async () => {
  await abrirBorrador()
  assert.equal(boton('Descartar los cambios'), undefined)
})

await t('vista previa: muestra el artículo con la estructura del sitio y lo que hay escrito ahora, sin guardar', async () => {
  await abrirBorrador()
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Título sin guardar')
  await clic(Array.from(document.querySelectorAll('input[type=checkbox]')).find((c) => c.closest('label')?.textContent?.includes('Letra capital')) as Element)
  await clic(boton('Vista previa')!)
  await hasta(() => !!document.querySelector('iframe.vista-previa'), 'la vista previa')
  const marco = document.querySelector('iframe.vista-previa') as HTMLIFrameElement
  const doc = marco.getAttribute('srcdoc')!
  assert.ok(doc.includes('<h1>Título sin guardar</h1>'))
  assert.ok(doc.includes('<p class="bajada">Una bajada</p>'))
  assert.ok(doc.includes('class="etiqueta">Cine<'), 'el cintillo de la sección')
  assert.ok(doc.includes('class="volanta"><a>Entrevistas</a>'), 'la volanta es la categoría principal')
  assert.ok(doc.includes('Por Ana y Beto'))
  assert.ok(doc.includes('class="hero-img" src="/media/foto.jpg"') && doc.includes('object-position: 50% 25%'))
  assert.ok(doc.includes('Un subtítulo'), 'el cuerpo')
  assert.ok(doc.includes('La nota'), 'las notas al pie')
  assert.ok(doc.includes('body { margin: 0 }'), 'las hojas del sitio')
  assert.equal(marco.getAttribute('sandbox'), 'allow-popups allow-popups-to-escape-sandbox', 'sin scripts')
  assert.equal(document.querySelector('.edicion-grilla')!.hasAttribute('hidden'), true, 'el formulario queda oculto pero no se pierde')
  await clic(boton('Editar')!)
  assert.equal(document.querySelector('.edicion-grilla')!.hasAttribute('hidden'), false)
  assert.equal((document.getElementById('titulo') as HTMLInputElement).value, 'Título sin guardar', 'lo escrito sigue ahí')
})

await t('vista previa: el título y los textos se escapan, y los enlaces externos abren en otra pestaña', async () => {
  const doc = htmlVistaPrevia(
    {
      titulo: '<script>alert(1)</script>',
      bajada: null,
      autores: [],
      fecha: '',
      cuerpo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'enlace', marks: [{ type: 'link', attrs: { href: 'https://ejemplo.org/' } }] }] }] },
      conCapital: false,
    },
    'p { color: red }',
  )
  assert.ok(!doc.includes('<script>'), 'el título no inyecta HTML')
  assert.ok(doc.includes('&lt;script&gt;'))
  assert.ok(doc.includes('<a target="_blank" rel="noopener noreferrer" href="https://ejemplo.org/">'))
})

await t('vista previa: la letra capital se marca solo si está activada y el cuerpo empieza con un párrafo', async () => {
  const base = { titulo: 'T', bajada: null, autores: [], fecha: '', cuerpo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Había una vez' }] }] } }
  assert.ok(htmlVistaPrevia({ ...base, conCapital: true }, '').includes('con-capital'))
  assert.ok(!htmlVistaPrevia({ ...base, conCapital: false }, '').includes('con-capital'))
})

console.log(`\n${ok} pruebas de la pantalla ok`)
process.exit(0)
