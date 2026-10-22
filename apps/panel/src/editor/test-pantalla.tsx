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
import { lenguajeComun, problemasEnLenguajeComun } from '../mensajes'
import { fuente } from '../VistaPrevia'
import { htmlVistaPrevia } from '../vista-previa'
import { renderArticleBody } from '@evaristo/compartido/render'

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
let cuerpoServido: unknown = cuerpoOriginal
let publicadoEnServido: string | null = null
let galeriaServida: Array<{ imagenId: number; alt: string | null; epigrafe: string | null }> = []
let fichaServida: Record<string, unknown> | null = null
const articulo = (estado: string) => ({
  id: 7,
  wpId: 123,
  estado,
  publicadoEn: publicadoEnServido,
  version: '2026-10-22T10:00:00.000Z',
  conCambiosSinPublicar,
  ruta: null,
  datos: {
    titulo: 'Título de prueba',
    bajada: 'Una bajada',
    cuerpo: cuerpoServido,
    seccionId: 1,
    categoriaIds: [10, 11],
    categoriaPrincipalId: 10,
    autorIds: [2, 3],
    imagenEncabezadoId: 5,
    encabezadoAlt: 'Alt del encabezado',
    encabezadoCredito: null,
    encabezadoPuntoFocalX: 0.5,
    encabezadoPuntoFocalY: 0.25,
    galeria: galeriaServida,
    ficha: fichaServida,
    conCapital: false,
    novedadHasta: null,
    slug: estado === 'BORRADOR' ? 'borrador-abc' : 'una-nota',
  },
  imagenEncabezado: { id: 5, clave: 'foto.jpg', nombreOriginal: 'foto.jpg' },
  imagenesGaleria: galeriaServida.map((g) => ({ id: g.imagenId, clave: `galeria-${g.imagenId}.jpg`, nombreOriginal: `galeria-${g.imagenId}.jpg` })),
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
// Publicación: lo que devuelve la revisión y cada acción, y lo que se pidió (en orden, para ver que se guarda antes de publicar)
let revisionServida: J = { estado: 'ok', accion: 'publicar', problemas: [], slugPropuesto: 'titulo-de-prueba', publicadoOriginal: null }
let respuestaPublicar: { estado: number; cuerpo: J } = { estado: 200, cuerpo: {} }
let respuestaAccion: { estado: number; cuerpo: J } = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T11:00:00.000Z' } }
const pedidosPublicacion: Array<{ ruta: string; cuerpo: J }> = []
const ordenPedidos: string[] = []
const subidas: Array<{ nombre: string; tamano: number }> = []
const borrados: number[] = []
const IMAGEN_NUEVA = { id: 9, clave: 'nueva-abc123.jpg', nombreOriginal: 'nueva.jpg', ancho: 300, alto: 200 }
let respuestaSubida: { estado: number; cuerpo: J } = { estado: 201, cuerpo: { estado: 'ok', repetida: false, imagen: IMAGEN_NUEVA } }
let respuestaBorrado: { estado: number; cuerpo: J } = { estado: 200, cuerpo: { estado: 'ok' } }
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
    ordenPedidos.push('PUT')
    return responder(respuestaPut.estado, respuestaPut.cuerpo)
  }
  if (url === '/api/admin/articulos/7/publicacion' && metodo === 'GET') return responder(200, revisionServida)
  const accion = /^\/api\/admin\/articulos\/7\/(publicar|publicar-cambios|despublicar)$/.exec(url)
  if (accion && metodo === 'POST') {
    const cuerpo = JSON.parse(String(init?.body)) as J
    pedidosPublicacion.push({ ruta: accion[1]!, cuerpo })
    ordenPedidos.push(`POST ${accion[1]}`)
    const r = accion[1] === 'publicar' ? respuestaPublicar : respuestaAccion
    if (r.estado === 200) {
      // El servidor cambió de estado: la próxima lectura lo refleja
      if (accion[1] === 'publicar') { estadoArticulo = String(r.cuerpo['articuloEstado']); publicadoEnServido = String(r.cuerpo['publicadoEn']) }
      if (accion[1] === 'publicar-cambios') conCambiosSinPublicar = false
      if (accion[1] === 'despublicar') estadoArticulo = 'BORRADOR'
    }
    return responder(r.estado, r.cuerpo)
  }
  if (url === '/api/admin/imagenes' && metodo === 'POST') {
    const archivo = (init?.body as FormData).get('archivo') as File
    subidas.push({ nombre: archivo.name, tamano: archivo.size })
    return responder(respuestaSubida.estado, respuestaSubida.cuerpo)
  }
  const borrar = /^\/api\/admin\/imagenes\/(\d+)$/.exec(url)
  if (borrar && metodo === 'DELETE') {
    borrados.push(Number(borrar[1]))
    return responder(respuestaBorrado.estado, respuestaBorrado.cuerpo)
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
  // La imagen principal se llama así en pantalla (no "encabezado", que no entiende quien no es técnico) y se explica qué es
  const lateral = document.querySelector('.edicion-lateral')!
  assert.ok(Array.from(lateral.querySelectorAll('legend')).some((l) => l.textContent === 'Imagen principal'))
  assert.ok(lateral.textContent!.includes('La foto grande que va arriba del artículo, debajo del título'))
  assert.ok(!/encabezado/i.test(lateral.textContent!), 'la columna de datos no usa la palabra "encabezado"')
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
  assert.deepEqual(Object.keys(g.datos).sort(), ['autorIds', 'bajada', 'categoriaIds', 'categoriaPrincipalId', 'conCapital', 'cuerpo', 'encabezadoAlt', 'encabezadoCredito', 'encabezadoPuntoFocalX', 'encabezadoPuntoFocalY', 'ficha', 'galeria', 'imagenEncabezadoId', 'novedadHasta', 'seccionId', 'slug', 'titulo'])
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
  assert.ok(document.querySelector('.galeria-imagenes') === null, 'el selector se cierra')
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
  publicadoEnServido = null
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
  assert.ok(document.querySelector('.aviso-alerta')!.textContent!.includes('El sitio sigue mostrando la versión anterior, que no tiene estos cambios'), 'dice qué muestra el sitio')
  assert.ok(document.querySelector('.aviso-alerta')!.textContent!.includes('Publicar cambios'), 'y qué hacer')
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

// ---- Etapa 4d: lenguaje común y accesibilidad ----

await t('mensajes: los avisos técnicos del validador y los de zod pasan a lenguaje común', async () => {
  const caso = (tecnico: string, patron: RegExp) => {
    const texto = lenguajeComun(tecnico)
    assert.match(texto, patron, tecnico)
    assert.ok(!/content\[|doc\.|<|\$\./.test(texto), `sin rutas técnicas: ${texto}`)
  }
  caso('Imagen sin texto alternativo en doc.content[3]: completá el texto alternativo o marcala como decorativa.', /imagen sin texto alternativo/i)
  caso('Una imagen nueva no puede quedar con el texto alternativo pendiente: completá el texto alternativo o marcala como decorativa.', /imagen nueva sin texto alternativo/i)
  caso('Enlace con protocolo no permitido o inseguro: "javascript:x" en doc.content[0]', /enlace que no es válido/i)
  caso('Video con proveedor no permitido: "otro" en doc.content[2]. Solo se admiten YouTube y Vimeo.', /YouTube ni de Vimeo/)
  caso('Nota al pie vacía o sin estructura en doc.content[1].content[0]', /nota al pie vacía/i)
  caso('<bulletList> vacío en doc.content[4]', /bloque vacío/i)
  caso('Nodo no permitido: <rarito> en doc.content[1]', /formato esperado/i)
  caso('Celda de tabla combinada no permitida (colspan/rowspan) en doc.content[2]', /tabla/i)
  caso('Too small: expected string to have >=1 characters', /valor que no se acepta/i)
  caso('Invalid input: expected number, received string', /valor que no se acepta/i)
  // Lo que la API ya dice en lenguaje común pasa sin tocar
  assert.equal(lenguajeComun('Escribí el título del artículo.'), 'Escribí el título del artículo.')
  assert.equal(lenguajeComun('Ya hay un artículo con esa dirección. Elegí otra.'), 'Ya hay un artículo con esa dirección. Elegí otra.')
  assert.deepEqual(problemasEnLenguajeComun(['Nodo no permitido: <a> en doc.content[0]', 'Nodo no permitido: <b> en doc.content[1]']).length, 1, 'sin repetidos')
})

await t('un 422 con avisos técnicos llega a la pantalla en lenguaje común', async () => {
  await abrirBorrador()
  respuestaPut = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá el artículo antes de guardar.', problemas: ['Imagen sin texto alternativo en doc.content[2]: completá el texto alternativo o marcala como decorativa.', 'Too small: expected string to have >=1 characters'] } }
  await clic(boton('Guardar')!)
  await hasta(() => document.querySelectorAll('.aviso-error li').length === 2, 'los avisos')
  const texto = document.querySelector('.aviso-error')!.textContent!
  assert.ok(texto.includes('Hay una imagen sin texto alternativo.'))
  assert.ok(!/content\[|Too small/.test(texto), 'sin texto técnico ni en inglés')
})

await t('accesibilidad: título de la pestaña por pantalla y enlace para saltar al contenido', async () => {
  await abrirBorrador()
  assert.equal(document.title, 'Editando: Título de prueba · Panel de Evaristo Cultural')
  const salto = document.querySelector('a.salto-contenido') as HTMLAnchorElement
  assert.ok(salto && salto.getAttribute('href') === '#contenido-panel')
  assert.ok(document.getElementById('contenido-panel'), 'el destino del enlace existe')
  await irA('/articulos/nuevo')
  await hasta(() => document.title.startsWith('Nuevo artículo'), 'el título de la pantalla de alta')
})

await t('accesibilidad: el nombre accesible de cada botón de la barra contiene el texto que se ve', async () => {
  await abrirBorrador()
  const botones = Array.from(document.querySelectorAll<HTMLButtonElement>('[role=toolbar] button.btn-tool'))
  assert.equal(botones.length, 19, 'hay 19 botones en la barra (una sola cita)')
  for (const b of botones) {
    const visible = (b.textContent ?? '').trim().toLowerCase()
    const nombre = (b.getAttribute('aria-label') ?? '').toLowerCase()
    assert.ok(nombre.length > 0, 'todo botón tiene nombre')
    assert.ok(nombre.includes(visible), `"${b.getAttribute('aria-label')}" no contiene el texto visible "${visible}"`)
  }
  const conEstado = document.querySelectorAll('[role=toolbar] button[aria-pressed]')
  assert.ok(conEstado.length >= 10, 'los botones de formato dicen si están activos')
})

await t('accesibilidad: el foco entra a las ventanas, no se escapa con Tab y vuelve al texto al cerrarlas', async () => {
  await abrirBorrador()
  const abridor = boton('Insertar una imagen de la biblioteca')!
  abridor.focus()
  await clic(abridor)
  await hasta(() => !!boton('Elegir imagen'), 'la ventana de imagen')
  const ventana = () => Array.from(document.querySelectorAll('.modal-overlay')).pop() as HTMLElement
  await hasta(() => ventana().contains(document.activeElement), 'el foco dentro de la ventana')
  assert.notEqual(document.activeElement?.className, 'btn-close', 'el foco inicial no es el botón de cerrar')
  // Tab desde el último elemento vuelve al primero; Mayús+Tab desde el primero va al último
  const lista = Array.from(ventana().querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'))
  lista[lista.length - 1]!.focus()
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  assert.ok(document.activeElement === lista[0], 'Tab da la vuelta: el foco quedó en ' + document.activeElement?.outerHTML.slice(0, 80))
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  assert.ok(document.activeElement === lista[lista.length - 1], 'Mayús+Tab da la vuelta hacia atrás: el foco quedó en ' + document.activeElement?.outerHTML.slice(0, 80))
  // Si el foco quedó afuera, vuelve adentro
  ;(document.querySelector('#titulo') as HTMLElement).focus()
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  assert.ok(ventana().contains(document.activeElement), 'no se puede salir de la ventana con Tab')
  // Esc cierra y el foco vuelve a lo que lo tenía
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await hasta(() => !boton('Elegir imagen'), 'que se cierre la ventana')
  // Insertar una imagen devuelve el foco al texto, y ahí es donde sigue escribiendo la persona.
  assert.ok(document.activeElement === document.querySelector('.ProseMirror'), 'el foco vuelve al texto del artículo: quedó en ' + document.activeElement?.outerHTML.slice(0, 80))
})

await t('cita: se puede escribir el autor y la fuente sin que el foco vuelva al texto con cada letra', async () => {
  cuerpoServido = { type: 'doc', content: [{ type: 'paragraph', content: [T('Una frase para citar')] }] }
  await abrirBorrador()
  assert.equal(boton('Cita destacada, sin autor'), undefined, 'ya no hay una segunda cita')
  await clic(boton('Cita, con autor y fuente opcionales')!)
  await hasta(() => !!document.getElementById('cita-autor'), 'la barra de la cita')
  // El comando focus() de TipTap devuelve el foco al editor un instante después (requestAnimationFrame): se deja asentar antes de pasar al campo
  await esperar(150)
  const autor = document.getElementById('cita-autor') as HTMLInputElement
  autor.focus()
  let escrito = ''
  for (const letra of 'Jorge Luis Borges') {
    escrito += letra
    await escribir(document.getElementById('cita-autor') as HTMLInputElement, escrito)
    assert.ok(document.activeElement === document.getElementById('cita-autor'), `con "${escrito}" el foco salió del campo y quedó en ${document.activeElement?.outerHTML.slice(0, 60)}`)
    assert.equal((document.getElementById('cita-autor') as HTMLInputElement).value, escrito, 'el campo conserva lo escrito')
  }
  const fuente = document.getElementById('cita-fuente') as HTMLInputElement
  fuente.focus()
  await escribir(fuente, 'Ficciones')
  assert.ok(document.activeElement === document.getElementById('cita-fuente'), 'tampoco en la fuente')
  // Lo escrito llega al texto del artículo
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  const cita = ((guardados[0] as { datos: { cuerpo: { content: Array<{ type: string; attrs?: J }> } } }).datos.cuerpo.content).find((n) => n.type === 'cita')
  assert.ok(cita, 'el artículo tiene la cita')
  assert.equal(cita.attrs!['autor'], 'Jorge Luis Borges')
  assert.equal(cita.attrs!['fuente'], 'Ficciones')
  // Una sola cita: no hay selector de tipo, y el autor y la fuente son opcionales
  assert.ok(document.getElementById('cita-variante') === null, 'ya no hay selector de tipo de cita')
  assert.ok(document.body.textContent?.includes('Autor (opcional)'))
  // La vista previa la muestra con el diseño de la maqueta: blockquote.cita con cite
  await clic(boton('Vista previa')!)
  await hasta(() => !!document.querySelector('iframe.vista-previa'), 'la vista previa')
  const doc = document.querySelector('iframe.vista-previa')!.getAttribute('srcdoc')!
  assert.ok(doc.includes('<blockquote class="cita"><p>Una frase para citar</p><cite>Jorge Luis Borges, Ficciones</cite></blockquote>'))
  assert.ok(!doc.includes('cita-textual') && !doc.includes('cita-destacada'))
  cuerpoServido = cuerpoOriginal
})

await t('cita: las citas guardadas con la variante anterior (textual o destacada) se abren, se ven igual y se guardan sin cambios', async () => {
  const citas = [
    { type: 'cita', attrs: { variante: 'textual', autor: 'Ana', fuente: '' }, content: [{ type: 'paragraph', content: [T('Una textual')] }] },
    { type: 'cita', attrs: { variante: 'destacada', autor: '', fuente: '' }, content: [{ type: 'paragraph', content: [T('Una destacada')] }] },
  ]
  cuerpoServido = { type: 'doc', content: citas }
  await abrirBorrador()
  assert.equal(document.querySelectorAll('.ProseMirror figure.cita').length, 2, 'las dos se muestran como cita')
  assert.ok(document.querySelector('.ProseMirror figure.cita figcaption')?.textContent === 'Ana', 'el autor sale en el pie')
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  assert.deepEqual(canonico((guardados[0] as { datos: J }).datos['cuerpo']), canonico({ type: 'doc', content: citas }), 'no se pierde ni se cambia nada')
  const ctx = (guardados[0] as { datos: { cuerpo: { content: Array<{ attrs: J }> } } }).datos.cuerpo.content
  assert.deepEqual([ctx[0]!.attrs['variante'], ctx[1]!.attrs['variante']], ['textual', 'destacada'], 'la variante heredada se conserva en los datos')
  cuerpoServido = cuerpoOriginal
})

await t('vista previa: los videos no usan iframe (el sandbox sin scripts bloquea el reproductor): recuadro con miniatura y enlace', async () => {
  const cuerpo = { type: 'doc', content: [{ type: 'video', attrs: { provider: 'youtube', id: 'dQw4w9WgXcQ' } }, { type: 'video', attrs: { provider: 'vimeo', id: '76979871' } }] }
  const doc = htmlVistaPrevia({ titulo: 'T', bajada: null, autores: [], fecha: '', cuerpo, conCapital: false }, '')
  assert.ok(!doc.includes('<iframe'), 'ningún reproductor embebido')
  assert.equal((doc.match(/class="video-previa"/g) ?? []).length, 2, 'los dos videos tienen su recuadro')
  assert.ok(doc.includes('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"') && doc.includes('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), 'YouTube: enlace y miniatura')
  assert.ok(doc.includes('href="https://vimeo.com/76979871"') && doc.includes('Video de Vimeo'), 'Vimeo: enlace')
  assert.ok(doc.includes('target="_blank"'), 'abre en otra pestaña')
  // El renderizador del sitio sí sigue emitiendo el reproductor
  assert.ok(renderArticleBody(cuerpo as never).html.includes('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"'))
  // Un video inválido no deja nada (lo decide el renderizador)
  assert.ok(!htmlVistaPrevia({ titulo: 'T', bajada: null, autores: [], fecha: '', cuerpo: { type: 'doc', content: [{ type: 'video', attrs: { provider: 'otro', id: 'x' } }] }, conCapital: false }, '').includes('video-previa'))
})

// ---- Paso 5: subir y borrar imágenes, punto focal ----

const abrirSelectorDelEncabezado = async () => {
  await abrirBorrador()
  await clic(boton('Cambiar imagen')!)
  await hasta(() => !!document.getElementById('selector-subir'), 'el selector con la subida')
}
const elegirArchivo = async (archivo: File) => {
  const input = document.getElementById('selector-subir') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [archivo], configurable: true })
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })) })
}
const respuestaOk = (repetida: boolean) => ({ estado: 201, cuerpo: { estado: 'ok', repetida, imagen: IMAGEN_NUEVA } })

await t('subir una imagen: se manda el archivo, se muestra lista y se usa como encabezado', async () => {
  await abrirSelectorDelEncabezado()
  subidas.length = 0
  respuestaSubida = respuestaOk(false)
  assert.ok(document.body.textContent?.includes('JPEG, PNG, WebP o GIF, de hasta 10 MB'))
  assert.match(document.getElementById('selector-subir')!.getAttribute('accept') ?? '', /image\/jpeg.*image\/png.*image\/webp.*image\/gif/)
  await elegirArchivo(new File([new Uint8Array(1234)], 'nueva.jpg', { type: 'image/jpeg' }))
  await hasta(() => !!boton('Usar esta imagen'), 'la imagen subida')
  assert.deepEqual(subidas, [{ nombre: 'nueva.jpg', tamano: 1234 }])
  assert.ok(document.querySelector('.subida-lista')?.textContent?.includes('Imagen subida.'))
  assert.ok(document.querySelector('.subida-lista img[src="/media/nueva-abc123.jpg"]'), 'se ve la miniatura subida')
  await clic(boton('Usar esta imagen')!)
  assert.ok(document.querySelector('.galeria-imagenes') === null, 'el selector se cierra')
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  assert.equal(((guardados[0] as { datos: J }).datos)['imagenEncabezadoId'], 9, 'el encabezado es la imagen subida')
})

await t('subir una imagen que ya estaba en la biblioteca: lo avisa y usa la existente', async () => {
  await abrirSelectorDelEncabezado()
  respuestaSubida = { estado: 200, cuerpo: { estado: 'ok', repetida: true, imagen: IMAGEN_NUEVA } }
  await elegirArchivo(new File([new Uint8Array(10)], 'otra-copia.jpg', { type: 'image/jpeg' }))
  await hasta(() => !!boton('Usar esta imagen'), 'el resultado')
  const texto = document.querySelector('.subida-lista')!.textContent!
  assert.ok(texto.includes('Esta imagen ya estaba en la biblioteca.') && texto.includes('no se guardó otra copia'))
  await clic(boton('Subir otra')!)
  assert.ok(document.querySelector('.subida-lista') === null, '"Subir otra" limpia el resultado')
})

await t('subir: una imagen de más de 10 MB se rechaza sin mandarla, y los errores del servidor se muestran en lenguaje común', async () => {
  await abrirSelectorDelEncabezado()
  subidas.length = 0
  await elegirArchivo(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'enorme.jpg', { type: 'image/jpeg' }))
  assert.equal(subidas.length, 0, 'no se manda un archivo que se sabe demasiado grande')
  assert.ok(document.querySelector('.aviso-error')?.textContent?.includes('pesa más de 10 MB'))
  respuestaSubida = { estado: 415, cuerpo: { estado: 'error', mensaje: 'Solo se pueden subir imágenes JPEG, PNG, WebP o GIF.' } }
  await elegirArchivo(new File([new Uint8Array(10)], 'dibujo.svg', { type: 'image/svg+xml' }))
  await hasta(() => document.querySelector('.aviso-error')?.textContent?.includes('JPEG, PNG, WebP o GIF') === true, 'el aviso del servidor')
  assert.equal(subidas.length, 1)
  assert.ok(document.querySelector('.subida-lista') === null)
  respuestaSubida = respuestaOk(false)
})

await t('borrar una imagen de la biblioteca: pide confirmación, y si está en uso muestra por qué', async () => {
  await abrirSelectorDelEncabezado()
  borrados.length = 0
  respuestaConfirm = false
  await clic(boton('Borrar la imagen otra.jpg')!)
  assert.equal(borrados.length, 0, 'si no se confirma, no se borra')
  assert.ok(preguntas.at(-1)!.includes('otra.jpg') && preguntas.at(-1)!.includes('No se puede deshacer'))
  respuestaConfirm = true
  respuestaBorrado = { estado: 409, cuerpo: { estado: 'error', mensaje: 'No se puede borrar esta imagen porque se usa en el texto del artículo «Una nota». Sacala de ahí primero.' } }
  await clic(boton('Borrar la imagen otra.jpg')!)
  await hasta(() => document.querySelector('.aviso-error')?.textContent?.includes('se usa en el texto del artículo «Una nota»') === true, 'el motivo')
  assert.deepEqual(borrados, [6])
  respuestaBorrado = { estado: 200, cuerpo: { estado: 'ok' } }
  await clic(boton('Borrar la imagen otra.jpg')!)
  await hasta(() => document.querySelector('.aviso-ok')?.textContent?.includes('Se borró la imagen «otra.jpg»') === true, 'el aviso de borrado')
  assert.equal(borrados.length, 2)
})

await t('punto focal: un clic sobre la imagen lo mueve, la marca y el recuadro del sitio lo siguen, y se guarda', async () => {
  await abrirBorrador()
  const marco = document.querySelector('.punto-focal-marco') as HTMLElement
  assert.ok(marco, 'el control de punto focal está')
  marco.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => ({}) })
  const marca = () => document.querySelector('.punto-focal-marca') as HTMLElement
  assert.equal(marca().style.left, '50%')
  assert.equal(marca().style.top, '25%', 'arranca en el punto del artículo (x 50%, y 25%)')
  await act(async () => { marco.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 60, clientY: 95, bubbles: true })) })
  assert.equal(marca().style.left, '25%')
  assert.equal(marca().style.top, '75%')
  assert.equal((document.querySelector('.punto-focal-previa img') as HTMLElement).style.objectPosition, '25% 75%', 'el recuadro del sitio muestra esa parte')
  assert.equal((document.querySelector('.punto-focal-previa') as HTMLElement).style.aspectRatio, '3 / 2', 'con la proporción del sitio')
  assert.equal((document.getElementById('foco-x') as HTMLInputElement).value, '25', 'los campos numéricos acompañan')
  assert.equal((document.getElementById('foco-y') as HTMLInputElement).value, '75')
  // Arrastrar y salirse del borde no pasa de 0 a 100
  await act(async () => { marco.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 900, clientY: -50, bubbles: true })) })
  assert.equal(marca().style.left, '100%')
  assert.equal(marca().style.top, '0%')
  await act(async () => { marco.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true })) })
  await act(async () => { marco.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 60, clientY: 95, bubbles: true })) })
  assert.equal(marca().style.left, '100%', 'sin el botón apretado no se mueve')
  await act(async () => { marco.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 160, clientY: 70, bubbles: true })) })
  await act(async () => { marco.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true })) })
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  const datos = (guardados[0] as { datos: J }).datos
  assert.equal(datos['encabezadoPuntoFocalX'], 0.75)
  assert.equal(datos['encabezadoPuntoFocalY'], 0.5)
})

// ---- Paso 6: publicar, programar, publicar cambios y despublicar ----

/** Abre el artículo en el estado indicado (el que ve el panel: BORRADOR, PUBLICADO o PROGRAMADO). */
const abrirComo = async (estado: string, opciones: { conCambios?: boolean; publicadoEn?: string | null } = {}) => {
  await abrirBorrador()
  estadoArticulo = estado
  conCambiosSinPublicar = opciones.conCambios ?? false
  publicadoEnServido = opciones.publicadoEn ?? (estado === 'BORRADOR' ? null : '2026-10-20T12:00:00.000Z')
  await irA('/articulos/7')
  await hasta(() => !!document.getElementById('titulo') && !!document.querySelector('.ProseMirror'), 'la pantalla de edición')
  guardados.length = 0
  pedidosPublicacion.length = 0
  ordenPedidos.length = 0
}
const botonDelDialogo = (texto: string) => Array.from(document.querySelectorAll('.modal-overlay button')).find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const publicable = () => { revisionServida = { estado: 'ok', accion: 'publicar', problemas: [], slugPropuesto: 'titulo-de-prueba', publicadoOriginal: null } }
const abrirDialogoDePublicar = async () => {
  await clic(boton('Publicar…')!)
  await hasta(() => !!document.getElementById('publicar-titulo'), 'la ventana de publicar')
  await hasta(() => !document.body.textContent?.includes('Revisando el artículo'), 'la revisión')
}

await t('publicar: un borrador ofrece "Publicar…", guarda lo pendiente antes y muestra lo que falta', async () => {
  await abrirComo('BORRADOR')
  revisionServida = { estado: 'ok', accion: 'publicar', problemas: ['Falta la imagen principal del artículo (la foto grande que va arriba, debajo del título).', 'El artículo todavía no tiene texto.'], slugPropuesto: 'titulo-de-prueba', publicadoOriginal: null }
  assert.ok(boton('Publicar…'), 'un borrador se publica')
  assert.equal(boton('Despublicar'), undefined)
  assert.equal(boton('Publicar cambios'), undefined)
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Cambiado antes de publicar')
  await abrirDialogoDePublicar()
  assert.deepEqual(ordenPedidos, ['PUT'], 'lo que estaba sin guardar se guardó antes de abrir la ventana')
  const texto = document.querySelector('.modal-overlay')!.textContent!
  assert.ok(texto.includes('Todavía no se puede publicar') && texto.includes('Falta la imagen principal del artículo (la foto grande que va arriba, debajo del título).') && texto.includes('todavía no tiene texto'))
  assert.equal(botonDelDialogo('Publicar'), undefined, 'con problemas no hay botón para publicar')
  assert.ok(document.getElementById('publicar-slug') === null)
  await clic(botonDelDialogo('Cancelar')!)
  assert.ok(document.getElementById('publicar-titulo') === null, 'se cierra')
  assert.equal(pedidosPublicacion.length, 0, 'no se publicó nada')
})

await t('publicar ahora: propone la dirección, avisa dónde va a quedar y, al publicar, vuelve a leer el artículo', async () => {
  await abrirComo('BORRADOR')
  publicable()
  respuestaPublicar = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T11:00:00.000Z', articuloEstado: 'PUBLICADO', publicadoEn: new Date().toISOString(), slug: 'titulo-de-prueba', ruta: '/2026/10/22/titulo-de-prueba/' } }
  await abrirDialogoDePublicar()
  assert.deepEqual(ordenPedidos, [], 'sin cambios pendientes no se guarda de más')
  assert.equal((document.getElementById('publicar-slug') as HTMLInputElement).value, 'titulo-de-prueba')
  assert.ok(document.querySelector('.modal-overlay')!.textContent!.includes(`/${new Date().getUTCFullYear()}/`), 'muestra la dirección completa')
  assert.equal(document.querySelector<HTMLInputElement>('input[name=cuando]:checked')?.closest('label')?.textContent?.trim(), 'Ahora')
  assert.ok(document.getElementById('publicar-fecha') === null, 'la fecha solo aparece al programar')
  await escribir(document.getElementById('publicar-slug') as HTMLInputElement, 'mi-direccion')
  await clic(botonDelDialogo('Publicar')!)
  await hasta(() => !!boton('Despublicar'), 'el artículo ya publicado')
  assert.equal(pedidosPublicacion.length, 1)
  assert.equal(pedidosPublicacion[0]!.ruta, 'publicar')
  assert.deepEqual(pedidosPublicacion[0]!.cuerpo, { version: '2026-10-22T10:00:00.000Z', slug: 'mi-direccion', publicadoEn: null }, 'publicar ahora manda la versión, la dirección y fecha null')
  assert.ok(document.getElementById('publicar-titulo') === null, 'la ventana se cerró')
  const banner = document.querySelector('.aviso-ok')!
  assert.ok(banner.textContent!.includes('Se publicó el artículo.'))
  assert.equal(banner.querySelector('a')?.getAttribute('href'), '/2026/10/22/titulo-de-prueba/', 'con el enlace al sitio')
  assert.equal(boton('Publicar…'), undefined, 'ya no es un borrador')
  assert.ok(document.querySelector('.estado-publicado'), 'el estado cambió a Publicado')
})

await t('programar: se elige una fecha futura, se manda como fecha y el panel lo muestra como programado', async () => {
  await abrirComo('BORRADOR')
  publicable()
  await abrirDialogoDePublicar()
  const radio = Array.from(document.querySelectorAll<HTMLInputElement>('input[name=cuando]')).find((r) => r.closest('label')?.textContent?.includes('Programarlo'))!
  await clic(radio)
  assert.ok(document.getElementById('publicar-fecha'), 'aparece el campo de fecha y hora')
  assert.ok(botonDelDialogo('Programar'), 'el botón dice Programar')
  // Una fecha que ya pasó no deja programar
  await escribir(document.getElementById('publicar-fecha') as HTMLInputElement, '2020-01-02T10:30')
  assert.ok(document.body.textContent?.includes('Elegí una fecha y hora que todavía no pasaron'))
  assert.equal(botonDelDialogo('Programar')!.disabled, true)
  await escribir(document.getElementById('publicar-fecha') as HTMLInputElement, '2099-01-02T10:30')
  assert.equal(botonDelDialogo('Programar')!.disabled, false)
  assert.ok(document.querySelector('.modal-overlay')!.textContent!.includes('/2099/01/02/titulo-de-prueba/'), 'la dirección lleva la fecha elegida')
  const esperada = new Date('2099-01-02T10:30').toISOString()
  respuestaPublicar = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T11:00:00.000Z', articuloEstado: 'PROGRAMADO', publicadoEn: esperada, slug: 'titulo-de-prueba', ruta: '/2099/01/02/titulo-de-prueba/' } }
  await clic(botonDelDialogo('Programar')!)
  await hasta(() => !!boton('Cancelar programación'), 'el artículo programado')
  assert.equal(pedidosPublicacion[0]!.cuerpo['publicadoEn'], esperada)
  const banner = document.querySelector('.aviso-ok')!
  assert.ok(banner.textContent!.includes('Quedó programado'))
  assert.equal(banner.querySelector('a'), null, 'todavía no hay enlace al sitio')
  assert.ok(document.querySelector('.programado-fecha')?.textContent?.includes('Sale en el sitio el'), 'la fecha se ve junto al estado')
  assert.ok(document.querySelector('.estado-programado'))
})

await t('volver a publicar un artículo que ya estuvo publicado: propone su fecha original y no la manda', async () => {
  await abrirComo('BORRADOR')
  revisionServida = { estado: 'ok', accion: 'publicar', problemas: [], slugPropuesto: 'ya-publicado', publicadoOriginal: '2020-05-06T12:00:00.000Z' }
  respuestaPublicar = { estado: 200, cuerpo: { estado: 'ok', version: 'v', articuloEstado: 'PUBLICADO', publicadoEn: '2020-05-06T12:00:00.000Z', slug: 'ya-publicado', ruta: '/2020/05/06/ya-publicado/' } }
  await abrirDialogoDePublicar()
  const marcado = document.querySelector<HTMLInputElement>('input[name=cuando]:checked')!.closest('label')!.textContent!
  assert.ok(marcado.includes('fecha original') && marcado.includes('6 de mayo de 2020'), 'viene marcada la fecha original')
  await clic(botonDelDialogo('Publicar')!)
  await hasta(() => pedidosPublicacion.length === 1, 'el pedido')
  assert.equal('publicadoEn' in pedidosPublicacion[0]!.cuerpo, false, 'sin fecha: el servidor mantiene la original')
})

await t('publicar: un rechazo del servidor se muestra en la ventana y un conflicto ofrece cargar la versión nueva', async () => {
  await abrirComo('BORRADOR')
  publicable()
  respuestaPublicar = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá el artículo antes de guardar.', problemas: ['Ya hay un artículo con esa dirección. Elegí otra.'] } }
  await abrirDialogoDePublicar()
  await clic(botonDelDialogo('Publicar')!)
  await hasta(() => document.querySelector('.modal-overlay .aviso-error li')?.textContent === 'Ya hay un artículo con esa dirección. Elegí otra.', 'el motivo')
  assert.ok(document.getElementById('publicar-titulo'), 'la ventana sigue abierta para corregir')
  assert.ok(botonDelDialogo('Publicar'), 'y se puede volver a intentar')
  respuestaPublicar = { estado: 409, cuerpo: { estado: 'conflicto', mensaje: 'Este artículo cambió mientras lo editabas.' } }
  await clic(botonDelDialogo('Publicar')!)
  await hasta(() => !!botonDelDialogo('Cargar la versión nueva'), 'el aviso de conflicto')
  assert.ok(document.querySelector('.modal-overlay')!.textContent!.includes('No se publicó nada'))
  assert.equal(botonDelDialogo('Publicar'), undefined, 'no se puede publicar encima de lo que guardó otra persona')
})

await t('publicar cambios: un publicado con cambios ofrece "Publicar cambios" y "Despublicar", y pide confirmación', async () => {
  await abrirComo('PUBLICADO', { conCambios: true })
  assert.ok(boton('Publicar cambios') && boton('Despublicar'))
  assert.equal(boton('Publicar…'), undefined, 'un publicado no se publica de nuevo entero')
  respuestaConfirm = false
  await clic(boton('Publicar cambios')!)
  assert.equal(pedidosPublicacion.length, 0, 'si no se confirma, no se publica')
  assert.ok(preguntas.at(-1)!.includes('se van a ver en el sitio ahora'))
  respuestaConfirm = true
  await clic(boton('Publicar cambios')!)
  await hasta(() => !boton('Publicar cambios'), 'los cambios publicados')
  assert.deepEqual(pedidosPublicacion, [{ ruta: 'publicar-cambios', cuerpo: { version: '2026-10-22T10:00:00.000Z' } }])
  assert.ok(document.querySelector('.aviso-ok')?.textContent?.includes('Se publicaron los cambios.'))
  assert.ok(document.querySelector('.aviso-alerta') === null, 'ya no dice que hay cambios sin publicar')
  // Seguir editando: el "Se publicaron los cambios" deja de valer en cuanto hay un cambio nuevo, y no convive con el aviso de cambios sin publicar
  respuestaPut = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T12:00:00.000Z', conCambiosSinPublicar: true } }
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Sigo editando después de publicar')
  assert.ok(document.querySelector('.aviso-ok') === null, 'el aviso de "se publicaron" desaparece al editar')
  await clic(boton('Guardar')!)
  await hasta(() => !!document.querySelector('.aviso-alerta'), 'el aviso de cambios sin publicar')
  assert.ok(document.querySelector('.aviso-ok') === null, 'y nunca se ven los dos a la vez')
})

await t('publicar cambios: lo que está sin guardar se guarda antes, y un rechazo muestra qué falta sin recargar', async () => {
  await abrirComo('PUBLICADO', { conCambios: true })
  // Guardar un publicado lo deja como borrador de cambios (como hace el servidor)
  respuestaPut = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T10:30:00.000Z', conCambiosSinPublicar: true } }
  await escribir(document.getElementById('titulo') as HTMLInputElement, 'Otro cambio todavía sin guardar')
  respuestaAccion = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá el artículo antes de guardar.', problemas: ['Falta la imagen principal del artículo (la foto grande que va arriba, debajo del título).'] } }
  await clic(boton('Publicar cambios')!)
  await hasta(() => document.querySelector('.aviso-error li')?.textContent === 'Falta la imagen principal del artículo (la foto grande que va arriba, debajo del título).', 'el motivo')
  assert.deepEqual(ordenPedidos, ['PUT', 'POST publicar-cambios'], 'primero se guarda y después se publica')
  assert.ok(boton('Publicar cambios'), 'sigue en el mismo artículo, sin recargar')
  respuestaAccion = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T11:00:00.000Z' } }
})

await t('un publicado sin cambios solo ofrece despublicar, y despublicar pide confirmación y lo deja como borrador', async () => {
  await abrirComo('PUBLICADO')
  assert.equal(boton('Publicar cambios'), undefined)
  assert.equal(boton('Publicar…'), undefined)
  respuestaConfirm = false
  await clic(boton('Despublicar')!)
  assert.equal(pedidosPublicacion.length, 0)
  assert.ok(preguntas.at(-1)!.includes('deja de verse en el sitio'))
  respuestaConfirm = true
  await clic(boton('Despublicar')!)
  await hasta(() => !!boton('Publicar…'), 'el borrador')
  assert.equal(pedidosPublicacion[0]!.ruta, 'despublicar')
  assert.ok(document.querySelector('.aviso-ok')?.textContent?.includes('dejó de verse en el sitio'))
  assert.ok(document.querySelector('.estado-borrador'))
})

await t('despublicar con cambios sin publicar: el servidor lo rechaza y el panel explica qué hacer', async () => {
  await abrirComo('PUBLICADO', { conCambios: true })
  respuestaAccion = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá el artículo antes de guardar.', problemas: ['Este artículo tiene cambios sin publicar. Publicalos o descartalos antes de despublicarlo.'] } }
  await clic(boton('Despublicar')!)
  await hasta(() => document.querySelector('.aviso-error li')?.textContent?.includes('Publicalos o descartalos') === true, 'la explicación')
  assert.ok(boton('Despublicar'), 'sigue publicado')
  respuestaAccion = { estado: 200, cuerpo: { estado: 'ok', version: '2026-10-22T11:00:00.000Z' } }
})

await t('programado: se ve cuándo sale y se puede cancelar la programación', async () => {
  await abrirComo('PROGRAMADO', { publicadoEn: '2099-06-07T15:00:00.000Z' })
  assert.ok(document.querySelector('.estado-programado'))
  assert.ok(document.querySelector('.programado-fecha')?.textContent?.includes('2099'), 'dice cuándo sale')
  assert.equal(boton('Despublicar'), undefined)
  assert.ok(boton('Cancelar programación'))
  assert.ok(document.querySelector('.ver-en-sitio') === null, 'todavía no tiene dirección pública')
  respuestaConfirm = true
  await clic(boton('Cancelar programación')!)
  await hasta(() => !!boton('Publicar…'), 'el borrador')
  assert.ok(preguntas.at(-1)!.includes('Se cancela la programación'))
  assert.ok(document.querySelector('.aviso-ok')?.textContent?.includes('Se canceló la programación'))
})

// ---- Paso 6 (resto): galería de imágenes y ficha técnica ----

const abrirConGaleria = async (galeria: typeof galeriaServida, ficha: typeof fichaServida = null) => {
  galeriaServida = galeria
  fichaServida = ficha
  await abrirBorrador()
}
const reiniciarGaleria = () => {
  galeriaServida = []
  fichaServida = null
}
const valorDe = (id: string) => (document.getElementById(id) as HTMLInputElement).value
const ultimoGuardado = () => (guardados.at(-1) as { datos: J }).datos

await t('galería y ficha: se ven vacías en un artículo que no las tiene y la ficha está plegada', async () => {
  await abrirConGaleria([])
  const legendas = Array.from(document.querySelectorAll('legend')).map((l) => l.textContent)
  assert.ok(legendas.includes('Galería de imágenes (opcional)') && legendas.includes('Ficha técnica del libro (opcional)'))
  assert.ok(document.body.textContent?.includes('Todavía no hay imágenes en la galería.'))
  assert.equal(document.querySelector<HTMLDetailsElement>('.ficha-editor details')!.open, false, 'sin datos la ficha está plegada')
  assert.ok(boton('Agregar una imagen'))
  assert.equal(boton('Quitar la ficha técnica'), undefined, 'no hay nada que quitar')
})

await t('galería: se agrega una imagen de la biblioteca, pide su texto alternativo y se guarda con su epígrafe', async () => {
  await abrirConGaleria([])
  await clic(boton('Agregar una imagen')!)
  await hasta(() => !!document.querySelector('.imagen-opcion'), 'la biblioteca')
  await clic(document.querySelector('.imagen-opcion')!)
  assert.equal(document.querySelector('.galeria-grilla'), null)
  await hasta(() => document.querySelectorAll('.galeria-item').length === 1, 'la imagen en la galería')
  assert.ok(document.querySelector('.galeria-item img[src="/media/otra.jpg"]'), 'con su miniatura')
  assert.ok(document.querySelector('.galeria-editor .form-aviso')?.textContent?.includes('Falta el texto alternativo de una imagen'), 'avisa que falta el texto alternativo')
  await escribir(document.getElementById('galeria-alt-6') as HTMLInputElement, 'Tapa del libro')
  await escribir(document.getElementById('galeria-epigrafe-6') as HTMLInputElement, 'La tapa')
  assert.equal(document.querySelector('.galeria-editor .form-aviso'), null, 'con el texto alternativo ya no avisa')
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  assert.deepEqual(ultimoGuardado()['galeria'], [{ imagenId: 6, alt: 'Tapa del libro', epigrafe: 'La tapa' }])
  // La misma imagen dos veces no
  await clic(boton('Agregar una imagen')!)
  await hasta(() => !!document.querySelector('.imagen-opcion'), 'la biblioteca otra vez')
  await clic(document.querySelector('.imagen-opcion')!)
  assert.ok(document.querySelector('.galeria-editor .form-error')?.textContent?.includes('ya está en la galería'))
  assert.equal(document.querySelectorAll('.galeria-item').length, 1)
})

await t('galería: se reordena y se quita, y lo que está en blanco se manda como vacío', async () => {
  await abrirConGaleria([{ imagenId: 11, alt: 'Uno', epigrafe: null }, { imagenId: 12, alt: 'Dos', epigrafe: 'Epígrafe dos' }, { imagenId: 13, alt: 'Tres', epigrafe: null }])
  const nombres = () => Array.from(document.querySelectorAll('.galeria-item-nombre')).map((n) => n.textContent)
  assert.deepEqual(nombres(), ['galeria-11.jpg', 'galeria-12.jpg', 'galeria-13.jpg'], 'las imágenes en su orden')
  assert.equal(boton('Subir la imagen galeria-11.jpg')!.disabled, true, 'la primera no sube')
  assert.equal(boton('Bajar la imagen galeria-13.jpg')!.disabled, true, 'la última no baja')
  await clic(boton('Bajar la imagen galeria-11.jpg')!)
  assert.deepEqual(nombres(), ['galeria-12.jpg', 'galeria-11.jpg', 'galeria-13.jpg'])
  await clic(boton('Subir la imagen galeria-13.jpg')!)
  assert.deepEqual(nombres(), ['galeria-12.jpg', 'galeria-13.jpg', 'galeria-11.jpg'])
  await clic(boton('Quitar la imagen galeria-13.jpg de la galería')!)
  assert.deepEqual(nombres(), ['galeria-12.jpg', 'galeria-11.jpg'])
  await escribir(document.getElementById('galeria-epigrafe-12') as HTMLInputElement, '   ')
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  assert.deepEqual(ultimoGuardado()['galeria'], [{ imagenId: 12, alt: 'Dos', epigrafe: null }, { imagenId: 11, alt: 'Uno', epigrafe: null }], 'en el nuevo orden y con el epígrafe en blanco como vacío')
  reiniciarGaleria()
})

await t('ficha técnica: se completa, los números se mandan como números y una ficha en blanco se manda vacía', async () => {
  await abrirConGaleria([])
  await clic(document.querySelector('.ficha-editor summary')!)
  await escribir(document.getElementById('ficha-titulo') as HTMLInputElement, 'Cien años de soledad')
  await escribir(document.getElementById('ficha-autor') as HTMLInputElement, 'Gabriel García Márquez')
  await escribir(document.getElementById('ficha-editorial') as HTMLInputElement, 'Sudamericana')
  await escribir(document.getElementById('ficha-anio') as HTMLInputElement, '1967')
  await escribir(document.getElementById('ficha-paginas') as HTMLInputElement, '471')
  await escribir(document.getElementById('ficha-isbn') as HTMLInputElement, '978-950-07-0000-0')
  await escribir(document.getElementById('ficha-precio') as HTMLInputElement, '$ 25.000')
  guardados.length = 0
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 1, 'el guardado')
  assert.deepEqual(ultimoGuardado()['ficha'], { titulo: 'Cien años de soledad', autor: 'Gabriel García Márquez', traductor: null, editorial: 'Sudamericana', coleccion: null, anio: 1967, paginas: 471, isbn: '978-950-07-0000-0', precio: '$ 25.000' })
  assert.ok(boton('Quitar la ficha técnica'), 'con datos aparece "Quitar la ficha técnica"')
  // Borrar un número lo deja vacío
  await escribir(document.getElementById('ficha-anio') as HTMLInputElement, '')
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 2, 'el segundo guardado')
  assert.equal((ultimoGuardado()['ficha'] as J)['anio'], null)
  // Una ficha con solo espacios es lo mismo que no tener ficha
  await clic(boton('Quitar la ficha técnica')!)
  assert.equal(valorDe('ficha-titulo'), '', 'se vaciaron los campos')
  await escribir(document.getElementById('ficha-titulo') as HTMLInputElement, '   ')
  await clic(boton('Guardar')!)
  await hasta(() => guardados.length === 3, 'el tercer guardado')
  assert.equal(ultimoGuardado()['ficha'], null)
})

await t('ficha técnica: un artículo que ya la tiene la muestra abierta y completa', async () => {
  await abrirConGaleria([], { titulo: 'Un libro', autor: 'Alguien', traductor: null, editorial: 'Una editorial', coleccion: null, anio: 2001, paginas: 120, isbn: null, precio: null })
  assert.equal(document.querySelector<HTMLDetailsElement>('.ficha-editor details')!.open, true)
  assert.equal(valorDe('ficha-titulo'), 'Un libro')
  assert.equal(valorDe('ficha-anio'), '2001')
  assert.equal(valorDe('ficha-paginas'), '120')
  assert.equal(valorDe('ficha-traductor'), '')
  reiniciarGaleria()
})

await t('vista previa: muestra la ficha y la galería después del texto, como el sitio, sin el visor', async () => {
  await abrirConGaleria([{ imagenId: 11, alt: 'Una foto', epigrafe: 'Con epígrafe' }, { imagenId: 12, alt: 'Otra foto', epigrafe: null }], { titulo: 'Un libro', autor: null, traductor: null, editorial: 'Una editorial', coleccion: null, anio: 2001, paginas: null, isbn: null, precio: null })
  await clic(boton('Vista previa')!)
  await hasta(() => !!document.querySelector('iframe.vista-previa'), 'la vista previa')
  const doc = document.querySelector('iframe.vista-previa')!.getAttribute('srcdoc')!
  assert.ok(doc.includes('<h2 id="ficha-titulo">Ficha técnica</h2>'))
  assert.ok(doc.includes('<dt>Título</dt><dd>Un libro</dd>') && doc.includes('<dt>Editorial</dt><dd>Una editorial</dd>') && doc.includes('<dt>Año</dt><dd>2001</dd>'))
  assert.ok(!doc.includes('<dt>Autor</dt>') && !doc.includes('<dt>ISBN</dt>'), 'los campos vacíos no se ven')
  assert.ok(doc.includes('class="wide galeria"') && doc.includes('src="/media/galeria-11.jpg"') && doc.includes('alt="Una foto"') && doc.includes('<figcaption>Con epígrafe</figcaption>'))
  assert.ok(doc.indexOf('Ficha técnica') < doc.indexOf('id="galeria-titulo"'), 'la ficha va antes que la galería')
  assert.ok(doc.indexOf('id="ficha-titulo"') > doc.indexOf('Primer párrafo'), 'y las dos después del texto')
  assert.ok(!doc.includes('<dialog'), 'el visor no está en la vista previa (no ejecuta scripts)')
  reiniciarGaleria()
})

await t('vista previa: sin ficha ni galería no agrega nada', async () => {
  await abrirConGaleria([])
  await clic(boton('Vista previa')!)
  await hasta(() => !!document.querySelector('iframe.vista-previa'), 'la vista previa')
  const doc = document.querySelector('iframe.vista-previa')!.getAttribute('srcdoc')!
  assert.ok(!doc.includes('ficha-tecnica') && !doc.includes('galeria-grilla'))
})

// ---- Visor de la galería del sitio (apps/sitio/src/lib/visor-galeria.ts), con jsdom ----

await t('visor de la galería: abre la imagen, pasa a la anterior y la siguiente, se cierra, y con una sola no hay flechas', async () => {
  const { iniciarVisor } = await import('../../../sitio/src/lib/visor-galeria')
  const Dialogo = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
  // jsdom no implementa showModal ni close: se simulan con el atributo open
  Dialogo['showModal'] ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  Dialogo['close'] ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  const armar = (n: number) => {
    const seccion = document.createElement('section')
    seccion.className = 'wide galeria'
    seccion.innerHTML =
      '<ul>' +
      Array.from({ length: n }, (_, i) => `<li><figure><a class="galeria-abrir" href="/media/f${i + 1}.jpg"><img src="/media/f${i + 1}.jpg" alt="Foto ${i + 1}"></a>${i === 1 ? '<figcaption>Epígrafe 2</figcaption>' : ''}</figure></li>`).join('') +
      '</ul><dialog class="visor"><div><span class="visor-contador"></span><button class="visor-cerrar">×</button></div><figure><img class="visor-imagen" alt=""><figcaption class="visor-epigrafe"></figcaption></figure><button class="visor-anterior">‹</button><button class="visor-siguiente">›</button></dialog>'
    document.body.appendChild(seccion)
    iniciarVisor(seccion)
    return seccion
  }
  const seccion = armar(3)
  const dialogo = seccion.querySelector('dialog')!
  const visor = () => ({ src: seccion.querySelector<HTMLImageElement>('.visor-imagen')!.getAttribute('src'), alt: seccion.querySelector<HTMLImageElement>('.visor-imagen')!.alt, pie: seccion.querySelector('.visor-epigrafe')!.textContent, cuenta: seccion.querySelector('.visor-contador')!.textContent })
  assert.ok(!dialogo.hasAttribute('open'), 'arranca cerrado')
  // Clic en la segunda imagen: se abre ahí y el enlace no navega
  const clicEnlace = new window.MouseEvent('click', { bubbles: true, cancelable: true })
  seccion.querySelectorAll('a.galeria-abrir')[1]!.dispatchEvent(clicEnlace)
  assert.equal(clicEnlace.defaultPrevented, true, 'el enlace no abre el archivo en otra página')
  assert.ok(dialogo.hasAttribute('open'))
  assert.deepEqual(visor(), { src: '/media/f2.jpg', alt: 'Foto 2', pie: 'Epígrafe 2', cuenta: '2 de 3' })
  // Siguiente y anterior, dando la vuelta
  seccion.querySelector<HTMLElement>('.visor-siguiente')!.click()
  assert.deepEqual(visor(), { src: '/media/f3.jpg', alt: 'Foto 3', pie: '', cuenta: '3 de 3' })
  seccion.querySelector<HTMLElement>('.visor-siguiente')!.click()
  assert.equal(visor().cuenta, '1 de 3', 'después de la última vuelve a la primera')
  seccion.querySelector<HTMLElement>('.visor-anterior')!.click()
  assert.equal(visor().cuenta, '3 de 3', 'y antes de la primera va a la última')
  // Flechas del teclado
  dialogo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
  assert.equal(visor().cuenta, '2 de 3')
  dialogo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  assert.equal(visor().cuenta, '3 de 3')
  // Se cierra con la X y con un clic en el fondo, pero no con un clic adentro
  seccion.querySelector<HTMLElement>('.visor-cerrar')!.click()
  assert.ok(!dialogo.hasAttribute('open'), 'la X lo cierra')
  seccion.querySelectorAll('a.galeria-abrir')[0]!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.ok(dialogo.hasAttribute('open'))
  seccion.querySelector<HTMLElement>('.visor-imagen')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.ok(dialogo.hasAttribute('open'), 'un clic en la imagen no lo cierra')
  dialogo.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.ok(!dialogo.hasAttribute('open'), 'un clic en el fondo lo cierra')
  // Con una sola imagen no hay flechas ni contador, y las flechas del teclado no hacen nada
  const una = armar(1)
  const dUna = una.querySelector('dialog')!
  una.querySelector('a.galeria-abrir')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.ok(dUna.hasAttribute('open'))
  assert.equal(una.querySelector<HTMLElement>('.visor-anterior')!.hidden, true)
  assert.equal(una.querySelector<HTMLElement>('.visor-siguiente')!.hidden, true)
  assert.equal(una.querySelector('.visor-contador')!.textContent, '')
  dUna.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  assert.equal(una.querySelector<HTMLImageElement>('.visor-imagen')!.getAttribute('src'), '/media/f1.jpg')
  // Si el navegador no tiene <dialog>, no se toca nada: queda el enlace al archivo
  const sinDialog = document.createElement('section')
  sinDialog.className = 'galeria'
  sinDialog.innerHTML = '<a class="galeria-abrir" href="/media/x.jpg"><img alt="x"></a>'
  document.body.appendChild(sinDialog)
  iniciarVisor(sinDialog)
  const eventoSin = new window.MouseEvent('click', { bubbles: true, cancelable: true })
  sinDialog.querySelector('a')!.dispatchEvent(eventoSin)
  assert.equal(eventoSin.defaultPrevented, false, 'sin visor, el enlace funciona normal')
})

console.log(`\n${ok} pruebas de la pantalla ok`)
process.exit(0)
