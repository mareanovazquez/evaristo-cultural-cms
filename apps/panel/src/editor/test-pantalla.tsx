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
import { tiemposTooltip } from '../Tooltip'
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
  creadoPor: { id: 4, nombre: 'Rita' },
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
  usuarios: [] as Array<{ id: number; nombre: string; rol: string }>,
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
// Usuarios y cuenta
type UsuarioDeLista = { id: number; email: string; nombre: string; rol: string; activo: boolean; debeCambiarClave: boolean; ultimoAccesoEn: string | null; creadoEn: string; autor: { id: number; nombre: string; slug: string } | null; articulos: number }
let usuarioServido: J = { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR', debeCambiarClave: false, permisos: ['articulos.crear', 'usuarios.gestionar'] }
const cambiosDeClave: J[] = []
const salidas: string[] = []
const pedidosUsuarios: Array<{ ruta: string; metodo: string; cuerpo: J }> = []
const pasados: number[] = []
// Eliminar el artículo que se edita (el 7)
const eliminados7: string[] = []
let respuestaEliminar7: { estado: number; cuerpo: J } = { estado: 200, cuerpo: { estado: 'ok' } }
// Revisión de la migración
const pedidosRevision: Array<{ ruta: string; metodo: string; cuerpo: J }> = []
let articulosRevision: J[] = [
  { id: 31, wpId: 3100, titulo: 'El camino de SEDA', estado: 'PUBLICADO', publicadoEn: '2020-05-01T00:00:00.000Z', altPendientes: 2, seccion: { id: 1, nombre: 'Cine', interna: false }, autores: ['Ana'], avisos: [{ codigo: 'palabra_ambigua', etiqueta: 'Palabra ambigua en el título', revisado: false, por: null, en: null }, { codigo: 'nota_duplicada', etiqueta: 'Nota al pie repetida', revisado: true, por: 'Beto', en: '2026-10-22T10:00:00.000Z' }], ruta: '/2020/05/01/el-camino-de-seda/' },
  { id: 32, wpId: 3200, titulo: 'Sin dueño', estado: 'BORRADOR', publicadoEn: null, altPendientes: 0, seccion: { id: 9, nombre: 'Sin asignar', interna: true }, autores: [], avisos: [], ruta: null },
]
// Secciones y categorías
const pedidosClasificacion: Array<{ ruta: string; metodo: string; cuerpo: J }> = []
let respuestaClasificacion: { estado: number; cuerpo: J } = { estado: 200, cuerpo: {} }
type ItemClasificacion = { id: number; slug: string; nombre: string; articulos: number; interna?: boolean; orden?: number; comoPrincipal?: number }
let seccionesServidas: ItemClasificacion[] = [
  { id: 1, slug: 'cine', nombre: 'Cine', articulos: 12, interna: false, orden: 1 },
  { id: 2, slug: 'arte', nombre: 'Arte', articulos: 0, interna: false, orden: 2 },
  { id: 3, slug: 'teatro', nombre: 'Teatro', articulos: 4, interna: false, orden: 3 },
  { id: 9, slug: 'sin-asignar', nombre: 'Sin asignar', articulos: 103, interna: true, orden: 9 },
]
const categoriasServidas: ItemClasificacion[] = [
  { id: 10, slug: 'entrevistas', nombre: 'Entrevistas', articulos: 30, comoPrincipal: 5 },
  { id: 11, slug: 'ensayos', nombre: 'Ensayos', articulos: 0, comoPrincipal: 0 },
]
// Autores
const pedidosAutores: Array<{ ruta: string; metodo: string; cuerpo: J }> = []
let autorEditaTodo = true
let respuestaAutorPut: { estado: number; cuerpo: J } = { estado: 200, cuerpo: {} }
const bioCorta = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Escribe y enseña.' }] }] }
let autorServido: J = {
  id: 20,
  slug: 'luca',
  nombre: 'Luca',
  soloTexto: false,
  bio: bioCorta,
  instagram: 'https://instagram.com/luca',
  x: null,
  facebook: null,
  sitioWeb: null,
  fotoId: 5,
  fotoAlt: 'Retrato de Luca',
  fotoPuntoFocalX: 0.5,
  fotoPuntoFocalY: 0.5,
  foto: { id: 5, clave: 'foto.jpg', nombreOriginal: 'foto.jpg' },
  version: '2026-10-23T12:00:00.000Z',
  usuario: null,
  articulos: 2,
}
const autoresListados = [
  { id: 20, slug: 'luca', nombre: 'Luca', soloTexto: false, conBio: true, conFoto: true, fotoSinAlt: false, usuario: null, articulos: 2 },
  { id: 22, slug: 'redaccion', nombre: 'Redacción', soloTexto: true, conBio: false, conFoto: false, fotoSinAlt: false, usuario: null, articulos: 40 },
  { id: 23, slug: 'sin-datos', nombre: 'Sin Datos', soloTexto: false, conBio: false, conFoto: false, fotoSinAlt: false, usuario: { id: 4, nombre: 'Rita' }, articulos: 0 },
]
let usuariosServidos: UsuarioDeLista[] = [
  { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR', activo: true, debeCambiarClave: false, ultimoAccesoEn: '2026-10-23T09:00:00.000Z', creadoEn: '2026-10-01T09:00:00.000Z', autor: null, articulos: 0 },
  { id: 4, email: 'rita@b.c', nombre: 'Rita', rol: 'REDACTOR', activo: true, debeCambiarClave: false, ultimoAccesoEn: null, creadoEn: '2026-10-02T09:00:00.000Z', autor: { id: 20, nombre: 'Rita', slug: 'rita' }, articulos: 3 },
]
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
  if (url === '/api/auth/yo' && metodo === 'GET') return responder(200, { usuario: usuarioServido })
  if (url === '/api/auth/salir' && metodo === 'POST') {
    salidas.push(url)
    return responder(200, { estado: 'ok' })
  }
  if (url === '/api/auth/yo' && metodo === 'PATCH') {
    const { nombre } = JSON.parse(String(init?.body)) as { nombre: string }
    usuarioServido = { ...usuarioServido, nombre }
    return responder(200, { estado: 'ok', usuario: usuarioServido })
  }
  if (url === '/api/auth/clave' && metodo === 'POST') {
    const cuerpo = JSON.parse(String(init?.body)) as J
    cambiosDeClave.push(cuerpo)
    if (cuerpo['claveActual'] !== 'provisoria-123') return responder(400, { estado: 'error', mensaje: 'La contraseña actual no es correcta.' })
    usuarioServido = { ...usuarioServido, debeCambiarClave: false }
    return responder(200, { estado: 'ok', usuario: usuarioServido })
  }
  if (url === '/api/admin/usuarios' && metodo === 'GET') return responder(200, { estado: 'ok', usuarios: usuariosServidos })
  if (url === '/api/admin/usuarios' && metodo === 'POST') {
    const cuerpo = JSON.parse(String(init?.body)) as J
    pedidosUsuarios.push({ ruta: url, metodo, cuerpo })
    if (cuerpo['email'] === 'repetido@b.c') return responder(409, { estado: 'error', mensaje: 'Ya hay un usuario con ese email.' })
    const creado: UsuarioDeLista = { id: 9, email: String(cuerpo['email']), nombre: String(cuerpo['nombre']), rol: String(cuerpo['rol']), activo: true, debeCambiarClave: true, ultimoAccesoEn: null, creadoEn: '2026-10-23T10:00:00.000Z', autor: { id: 30, nombre: String(cuerpo['nombre']), slug: 'x' }, articulos: 0 }
    usuariosServidos = [...usuariosServidos, creado]
    return responder(201, { estado: 'ok', usuario: creado })
  }
  if (url.startsWith('/api/admin/usuarios/autores-disponibles')) return responder(200, { estado: 'ok', autores: [{ id: 31, nombre: 'Ficha libre', slug: 'ficha-libre' }] })
  const sobreUsuario = /^\/api\/admin\/usuarios\/(\d+)\/?(desactivar|activar|clave|cerrar-sesiones|ficha)?$/.exec(url)
  if (sobreUsuario && (metodo === 'POST' || metodo === 'PATCH')) {
    const cuerpo = JSON.parse(String(init?.body)) as J
    pedidosUsuarios.push({ ruta: url, metodo, cuerpo })
    const id = Number(sobreUsuario[1])
    let u = usuariosServidos.find((x) => x.id === id)!
    if (sobreUsuario[2] === 'desactivar') u = { ...u, activo: false }
    if (sobreUsuario[2] === 'activar') u = { ...u, activo: true }
    if (sobreUsuario[2] === 'clave') u = { ...u, debeCambiarClave: true }
    if (!sobreUsuario[2]) u = { ...u, nombre: String(cuerpo['nombre']), rol: String(cuerpo['rol']) }
    usuariosServidos = usuariosServidos.map((x) => (x.id === id ? u : x))
    return responder(200, { estado: 'ok', usuario: u, cerradas: 2 })
  }
  if (/^\/api\/admin\/articulos\/7\/pasar$/.test(url) && metodo === 'POST') {
    const { usuarioId } = JSON.parse(String(init?.body)) as { usuarioId: number }
    pasados.push(usuarioId)
    return responder(200, { estado: 'ok', creadoPor: { id: usuarioId, nombre: catalogos.usuarios.find((u) => u.id === usuarioId)!.nombre } })
  }
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
  if (url === '/api/admin/articulos/7' && metodo === 'DELETE') {
    eliminados7.push(url)
    return responder(respuestaEliminar7.estado, respuestaEliminar7.cuerpo)
  }
  if (url === '/api/admin/articulos/7?perderDireccion=1' && metodo === 'DELETE') {
    eliminados7.push(url)
    return responder(200, { estado: 'ok' })
  }
  // Revisión de la migración
  if (url === '/api/admin/revision/resumen') {
    return responder(200, { estado: 'ok', avisos: [{ codigo: 'palabra_ambigua', etiqueta: 'Palabra ambigua en el título', pendientes: 2, revisados: 1 }, { codigo: 'nota_duplicada', etiqueta: 'Nota al pie repetida', pendientes: 0, revisados: 0 }], altPendientes: 5, sinAsignar: 1, sinAutor: 0, borradoresMigrados: 2, secciones: [{ id: 1, nombre: 'Cine', interna: false, articulos: 10 }, { id: 9, nombre: 'Sin asignar', interna: true, articulos: 1 }] })
  }
  if (url.startsWith('/api/admin/revision/articulos')) {
    pedidosRevision.push({ ruta: url, metodo, cuerpo: {} })
    const filtro = new URL(url, 'http://x').searchParams.get('filtro')
    const lista = filtro === 'sin-asignar' ? articulosRevision.filter((a) => (a['seccion'] as J)['interna']) : articulosRevision
    return responder(200, { estado: 'ok', total: lista.length, pagina: 1, paginas: 1, articulos: lista })
  }
  const sobreRevision = /^\/api\/admin\/articulos\/(\d+)(\/(avisos|seccion))?$/.exec(url)
  if (sobreRevision && Number(sobreRevision[1]) !== 7) {
    const cuerpo = metodo === 'DELETE' ? {} : (JSON.parse(String(init?.body)) as J)
    pedidosRevision.push({ ruta: url, metodo, cuerpo })
    const id = Number(sobreRevision[1])
    if (sobreRevision[3] === 'seccion') articulosRevision = articulosRevision.map((a) => (a['id'] === id ? { ...a, seccion: { id: cuerpo['seccionId'], nombre: 'Cine', interna: false } } : a))
    if (metodo === 'DELETE') articulosRevision = articulosRevision.filter((a) => a['id'] !== id)
    return responder(200, { estado: 'ok', por: cuerpo['revisado'] ? 'Prueba' : null })
  }
  // Secciones y categorías
  const claseRuta = /^\/api\/admin\/(secciones|categorias)(\/(orden|\d+)(\/unir)?)?(\?.*)?$/.exec(url)
  if (claseRuta) {
    const tipo = claseRuta[1] as 'secciones' | 'categorias'
    const cuerpo = metodo === 'GET' || metodo === 'DELETE' ? {} : (JSON.parse(String(init?.body)) as J)
    pedidosClasificacion.push({ ruta: url, metodo, cuerpo })
    if (metodo === 'GET' && !claseRuta[2]) return responder(200, { estado: 'ok', [tipo]: tipo === 'secciones' ? seccionesServidas : categoriasServidas })
    if (metodo === 'GET' && claseRuta[4]) {
      const destinoId = Number(new URL(url, 'http://x').searchParams.get('destinoId'))
      const lista = tipo === 'secciones' ? seccionesServidas : categoriasServidas
      return responder(200, { estado: 'ok', sobrante: { nombre: lista.find((x) => x.id === Number(claseRuta[3]))!.nombre }, elegida: { nombre: lista.find((x) => x.id === destinoId)!.nombre }, articulos: 3, yaConAmbas: tipo === 'categorias' ? 1 : undefined, comoPrincipal: tipo === 'categorias' ? 2 : undefined, enBorradores: 1, redireccion: '/x/ → /y/' })
    }
    if (respuestaClasificacion.estado !== 200 && metodo !== 'GET') return responder(respuestaClasificacion.estado, respuestaClasificacion.cuerpo)
    if (metodo === 'POST' && claseRuta[3] === 'orden') {
      const ids = cuerpo['ids'] as number[]
      seccionesServidas = [...ids.map((id, i) => ({ ...seccionesServidas.find((x) => x.id === id)!, orden: i + 1 })), ...seccionesServidas.filter((x) => x.interna)]
      return responder(200, { estado: 'ok' })
    }
    return responder(metodo === 'POST' && !claseRuta[2] ? 201 : 200, { estado: 'ok' })
  }
  // Autores
  if (url.startsWith('/api/admin/autores') && url !== '/api/admin/autores/mia' && !/^\/api\/admin\/autores\/\d+/.test(url) && metodo === 'GET') {
    pedidosAutores.push({ ruta: url, metodo, cuerpo: {} })
    return responder(200, { estado: 'ok', total: 2, pagina: 1, paginas: 1, autores: autoresListados })
  }
  if (url === '/api/admin/autores' && metodo === 'POST') {
    const cuerpo = JSON.parse(String(init?.body)) as J
    pedidosAutores.push({ ruta: url, metodo, cuerpo })
    return responder(201, { estado: 'ok', id: 21 })
  }
  if (url === '/api/admin/autores/mia') return responder(200, { estado: 'ok', id: 20 })
  const autorUnir = /^\/api\/admin\/autores\/(\d+)\/unir/.exec(url)
  if (autorUnir && metodo === 'GET') {
    return responder(200, { estado: 'ok', sobrante: { id: 20, nombre: 'Luca', slug: 'luca' }, elegido: { id: 22, nombre: 'Luca Frondoni', slug: 'luca-frondoni' }, articulos: 2, muestra: [{ id: 1, titulo: 'Una nota', yaTieneAlElegido: false }, { id: 2, titulo: 'Otra nota', yaTieneAlElegido: true }], seCompleta: ['la bio', 'la foto'], redireccion: '/author/luca/ → /author/luca-frondoni/' })
  }
  if (autorUnir && metodo === 'POST') {
    pedidosAutores.push({ ruta: url, metodo, cuerpo: JSON.parse(String(init?.body)) as J })
    return responder(200, { estado: 'ok', movidos: 2 })
  }
  const sobreAutor = /^\/api\/admin\/autores\/(\d+)$/.exec(url)
  if (sobreAutor && metodo === 'GET') {
    if (sobreAutor[1] === '404') return responder(404, { estado: 'error', mensaje: 'No encontramos a ese autor.' })
    return responder(200, { estado: 'ok', autor: { ...autorServido, id: Number(sobreAutor[1]) }, puedeEditarTodo: autorEditaTodo, bioMax: 500 })
  }
  if (sobreAutor && metodo === 'PUT') {
    const cuerpo = JSON.parse(String(init?.body)) as J
    pedidosAutores.push({ ruta: url, metodo, cuerpo })
    if (respuestaAutorPut.estado !== 200) return responder(respuestaAutorPut.estado, respuestaAutorPut.cuerpo)
    const d = cuerpo['datos'] as J
    autorServido = { ...autorServido, ...d, version: '2026-10-23T12:00:01.000Z', foto: d['fotoId'] ? autorServido.foto : null }
    return responder(200, { estado: 'ok', autor: autorServido })
  }
  if (sobreAutor && metodo === 'DELETE') {
    pedidosAutores.push({ ruta: url, metodo, cuerpo: {} })
    return responder(200, { estado: 'ok' })
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
const abrirEn = async (ruta: string) => {
  await act(async () => {
    raiz.render(
      <MemoryRouter initialEntries={[ruta]}>
        <ProveedorSesion>
          <App />
        </ProveedorSesion>
      </MemoryRouter>,
    )
  })
}
const abrir = async () => {
  await abrirEn('/articulos/7')
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

// ---------- Usuarios, mi cuenta y pasar un artículo ----------
const texto = () => document.body.textContent ?? ''
const enlaces = () => [...document.querySelectorAll('nav a')].map((a) => a.textContent)
const montar = async (ruta: string) => {
  // Un contenedor nuevo por pantalla: sin restos de las pruebas anteriores
  document.body.replaceChildren()
  const nuevo = document.createElement('div')
  document.body.appendChild(nuevo)
  const r = createRoot(nuevo)
  await act(async () => {
    r.render(
      <MemoryRouter initialEntries={[ruta]}>
        <ProveedorSesion>
          <App />
        </ProveedorSesion>
      </MemoryRouter>,
    )
  })
  return r
}

await t('el menú muestra Usuarios solo a quien tiene el permiso, y los roles se nombran en lenguaje común', async () => {
  await act(async () => raiz.unmount())
  document.body.replaceChildren()
  const admin = await montar('/')
  await hasta(() => !!document.querySelector('nav a'), 'el menú')
  assert.deepEqual(enlaces(), ['Artículos', 'Autores', 'Secciones y categorías', 'Revisión', 'Usuarios'])
  assert.ok(document.querySelector('.menu-usuario-rol')!.textContent === 'administrador')
  await act(async () => admin.unmount())
  usuarioServido = { id: 4, email: 'rita@b.c', nombre: 'Rita', rol: 'REDACTOR', debeCambiarClave: false, permisos: ['articulos.crear'] }
  const redactor = await montar('/usuarios')
  await hasta(() => document.querySelector('.menu-usuario-rol')?.textContent === 'redactor', 'el menú del redactor')
  assert.deepEqual(enlaces(), ['Artículos', 'Mi ficha'], 'el redactor no ve Usuarios ni el listado de autores, solo su ficha')
  await hasta(() => document.querySelector('h1')?.textContent === 'Artículos', 'vuelve al listado de artículos')
  assert.ok(!texto().includes('Nuevo usuario'), 'y si entra por la dirección no ve la pantalla de usuarios')
  assert.ok(document.querySelector('.menu-usuario-rol')!.textContent === 'redactor')
  await act(async () => redactor.unmount())
  usuarioServido = { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR', debeCambiarClave: false, permisos: ['articulos.crear', 'usuarios.gestionar'] }
})

await t('con la contraseña provisoria solo se puede estar en Mi cuenta hasta elegir una propia', async () => {
  usuarioServido = { ...usuarioServido, debeCambiarClave: true }
  const r = await montar('/')
  await hasta(() => !!document.getElementById('cuenta-clave-actual'), 'Mi cuenta forzada')
  assert.ok(texto().includes('contraseña provisoria'))
  await escribir(document.getElementById('cuenta-clave-actual') as HTMLInputElement, 'provisoria-123')
  await escribir(document.getElementById('cuenta-clave-nueva') as HTMLInputElement, 'una-clave-nueva-larga')
  await escribir(document.getElementById('cuenta-clave-repetida') as HTMLInputElement, 'otra-distinta-larga')
  await clic(boton('Cambiar la contraseña')!)
  assert.ok(texto().includes('Las dos contraseñas nuevas no coinciden.'))
  assert.equal(cambiosDeClave.length, 0, 'no se manda si no coinciden')
  await escribir(document.getElementById('cuenta-clave-actual') as HTMLInputElement, 'equivocada')
  await escribir(document.getElementById('cuenta-clave-repetida') as HTMLInputElement, 'una-clave-nueva-larga')
  await clic(boton('Cambiar la contraseña')!)
  await hasta(() => texto().includes('La contraseña actual no es correcta.'), 'el error de la API')
  await escribir(document.getElementById('cuenta-clave-actual') as HTMLInputElement, 'provisoria-123')
  await clic(boton('Cambiar la contraseña')!)
  await hasta(() => texto().includes('Cambiamos tu contraseña.'), 'el aviso de éxito')
  assert.deepEqual(cambiosDeClave.at(-1), { claveActual: 'provisoria-123', claveNueva: 'una-clave-nueva-larga' })
  assert.ok(!texto().includes('Estás usando una contraseña provisoria'), 'se quita el aviso')
  assert.equal((document.getElementById('cuenta-clave-actual') as HTMLInputElement).value, '', 'se vacían los campos')
  await act(async () => r.unmount())
})

await t('Mi cuenta: cambiar el nombre actualiza el de la barra', async () => {
  const r = await montar('/cuenta')
  await hasta(() => !!document.getElementById('cuenta-nombre'), 'Mi cuenta')
  await escribir(document.getElementById('cuenta-nombre') as HTMLInputElement, 'Prueba Gómez')
  await clic(boton('Guardar el nombre')!)
  await hasta(() => texto().includes('Guardamos tu nombre.'), 'el aviso')
  assert.ok(document.querySelector('.barra-usuario')!.textContent!.includes('Prueba Gómez'))
  await escribir(document.getElementById('cuenta-nombre') as HTMLInputElement, '  ')
  await clic(boton('Guardar el nombre')!)
  assert.ok(texto().includes('Escribí tu nombre.'))
  await act(async () => r.unmount())
})

await t('Usuarios: lista, alta con contraseña provisoria que se muestra una vez, y errores en lenguaje común', async () => {
  const r = await montar('/usuarios')
  await hasta(() => !!document.querySelector('table'), 'la lista de usuarios')
  const filas = [...document.querySelectorAll('tbody tr')].map((f) => f.textContent!)
  assert.equal(filas.length, 2)
  assert.ok(filas[0]!.includes('(vos)') && filas[0]!.includes('Administrador') && filas[0]!.includes('Sin ficha'))
  assert.ok(filas[1]!.includes('Redactor') && filas[1]!.includes('Con acceso') && filas[1]!.includes('Nunca'))
  await clic(boton('Nuevo usuario')!)
  assert.ok(document.getElementById('alta-clave'))
  await clic(boton('Crear usuario')!)
  assert.ok(texto().includes('Completá el email, el nombre y la contraseña provisoria.'))
  // El botón Generar llena la contraseña con algo legible
  await clic(boton('Generar')!)
  const generada = (document.getElementById('alta-clave') as HTMLInputElement).value
  assert.match(generada, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
  await escribir(document.getElementById('alta-nombre') as HTMLInputElement, 'Nora Nueva')
  await escribir(document.getElementById('alta-email') as HTMLInputElement, 'repetido@b.c')
  assert.equal((document.getElementById('alta-rol') as HTMLSelectElement).value, 'REDACTOR', 'arranca como redactor, con la ficha por crear')
  await clic(boton('Crear usuario')!)
  await hasta(() => texto().includes('Ya hay un usuario con ese email.'), 'el error de email repetido')
  await escribir(document.getElementById('alta-email') as HTMLInputElement, 'nora@b.c')
  await clic(boton('Crear usuario')!)
  await hasta(() => texto().includes('Pasale esta contraseña provisoria a'), 'el aviso con la contraseña')
  assert.equal(document.querySelector('.clave-provisoria')!.textContent, generada)
  assert.deepEqual(pedidosUsuarios.at(-1)!.cuerpo, { email: 'nora@b.c', nombre: 'Nora Nueva', rol: 'REDACTOR', clave: generada, ficha: { modo: 'crear' } })
  assert.ok([...document.querySelectorAll('tbody tr')].some((f) => f.textContent!.includes('Nora Nueva') && f.textContent!.includes('Contraseña provisoria')))
  await clic(boton('Ya se la pasé')!)
  assert.ok(!document.querySelector('.clave-provisoria'), 'se oculta y no se vuelve a mostrar')
  await act(async () => r.unmount())
})

await t('Usuarios: revocar y devolver el acceso, restablecer la contraseña y cambiar el rol', async () => {
  const r = await montar('/usuarios')
  await hasta(() => !!document.querySelector('table'), 'la lista')
  const administrar = (nombre: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === `Administrar a ${nombre}`)!
  await clic(administrar('Rita'))
  const ficha = () => document.querySelector('section[aria-label="Administrar a Rita"]')!
  assert.ok(ficha())
  // Revocar pide confirmación y explica que no se pierde nada
  respuestaConfirm = false
  preguntas.length = 0
  await clic(boton('Revocar el acceso')!)
  assert.equal(pedidosUsuarios.filter((p) => p.ruta.endsWith('/desactivar')).length, 0, 'si no confirma, no se manda')
  assert.ok(preguntas[0]!.includes('quedan como están'))
  respuestaConfirm = true
  await clic(boton('Revocar el acceso')!)
  await hasta(() => !!boton('Volver a dar acceso'), 'el botón para devolver el acceso')
  assert.ok([...document.querySelectorAll('tbody tr')][1]!.textContent!.includes('Sin acceso'))
  assert.ok(texto().includes('Revocamos su acceso.'))
  await clic(boton('Volver a dar acceso')!)
  await hasta(() => !!boton('Revocar el acceso'), 'de nuevo con acceso')
  // Restablecer la contraseña: se muestra la nueva para pasarla
  await escribir(ficha().querySelector<HTMLInputElement>('#adm-clave')!, 'restablecida-por-mi-12')
  await clic(boton('Restablecer')!)
  await hasta(() => texto().includes('Pasale esta contraseña provisoria a'), 'la contraseña a entregar')
  assert.deepEqual(pedidosUsuarios.at(-1), { ruta: '/api/admin/usuarios/4/clave', metodo: 'POST', cuerpo: { clave: 'restablecida-por-mi-12' } })
  // Cambiar el rol
  const rol = document.getElementById('adm-rol') as HTMLSelectElement
  await act(async () => {
    rol.value = 'EDITOR'
    rol.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await clic(boton('Guardar nombre y rol')!)
  await hasta(() => [...document.querySelectorAll('tbody tr')][1]!.textContent!.includes('Editor'), 'el rol nuevo en la lista')
  // En la propia ficha no se restablece la contraseña
  await clic(administrar('Prueba'))
  assert.ok(texto().includes('Tu propia contraseña se cambia en «Mi cuenta».'))
  assert.ok(!document.getElementById('adm-clave'))
  await act(async () => r.unmount())
})

await t('un editor ve «De quién es» en el artículo y puede pasárselo a otra persona', async () => {
  catalogos.usuarios = [{ id: 4, nombre: 'Rita', rol: 'REDACTOR' }, { id: 5, nombre: 'Tomás', rol: 'REDACTOR' }]
  estadoArticulo = 'BORRADOR'
  const r = await montar('/articulos/7')
  await hasta(() => !!document.getElementById('pasar-a'), 'el grupo «De quién es»')
  assert.ok(texto().includes('Lo creó Rita.'))
  const select = document.getElementById('pasar-a') as HTMLSelectElement
  assert.ok(![...select.options].some((o) => o.textContent === 'Rita'), 'no se ofrece pasárselo a quien ya lo tiene')
  assert.equal(boton('Pasar el artículo')!.disabled, true)
  await act(async () => {
    select.value = '5'
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  respuestaConfirm = false
  await clic(boton('Pasar el artículo')!)
  assert.deepEqual(pasados, [], 'sin confirmar no se manda')
  respuestaConfirm = true
  await clic(boton('Pasar el artículo')!)
  await hasta(() => texto().includes('Ahora es de Tomás.'), 'el aviso')
  assert.deepEqual(pasados, [5])
  assert.ok(texto().includes('Lo creó Tomás.'))
  await act(async () => r.unmount())
  // Sin lista de usuarios (un redactor) el grupo no aparece
  catalogos.usuarios = []
  const r2 = await montar('/articulos/7')
  await hasta(() => !!document.getElementById('titulo'), 'el artículo')
  assert.ok(!document.getElementById('pasar-a'))
  await act(async () => r2.unmount())
})


await t('en el artículo se puede crear un autor nuevo sin salir de la pantalla y queda agregado a la firma', async () => {
  catalogos.usuarios = []
  estadoArticulo = 'BORRADOR'
  const r = await montar('/articulos/7')
  await hasta(() => !!document.getElementById('titulo'), 'el artículo')
  assert.ok(boton('Crear un autor nuevo'))
  await clic(boton('Crear un autor nuevo')!)
  await clic(boton('Crear y agregar')!)
  assert.ok(texto().includes('Escribí el nombre del autor.'))
  await escribir(document.getElementById('autor-nuevo-nombre') as HTMLInputElement, 'Nora Nueva')
  const antes = pedidosAutores.length
  await clic(boton('Crear y agregar')!)
  await hasta(() => !!document.querySelector('.lista-autores') && [...document.querySelectorAll('.lista-autores li')].some((li) => li.textContent!.includes('Nora Nueva')), 'el autor nuevo en la firma')
  assert.deepEqual(pedidosAutores.slice(antes).at(-1)!.cuerpo, { nombre: 'Nora Nueva' })
  assert.ok(!document.getElementById('autor-nuevo-nombre'), 'se cierra el formulario')
  await act(async () => r.unmount())
})

// ---------- Autores ----------
await t('Autores: listado con marcas, búsqueda, filtros y alta de un autor nuevo', async () => {
  const r = await montar('/autores')
  await hasta(() => !!document.querySelector('table'), 'el listado de autores')
  const filas = [...document.querySelectorAll('tbody tr')].map((f) => f.textContent!)
  assert.equal(filas.length, 3)
  assert.ok(filas[0]!.includes('Luca') && filas[0]!.includes('Completa'))
  assert.ok(filas[1]!.includes('No es una persona') && filas[1]!.includes('40'))
  assert.ok(filas[2]!.includes('Sin bio') && filas[2]!.includes('Sin foto') && filas[2]!.includes('Rita'))
  // Búsqueda y filtro llegan a la API
  await escribir(document.getElementById('busqueda-autores') as HTMLInputElement, 'luc')
  await clic(boton('Buscar')!)
  await hasta(() => pedidosAutores.some((p) => p.ruta === '/api/admin/autores?q=luc'), 'la búsqueda')
  await clic(boton('Sin bio')!)
  await hasta(() => pedidosAutores.some((p) => p.ruta.includes('filtro=sin-bio') && p.ruta.includes('q=luc')), 'el filtro junto con la búsqueda')
  // Alta
  await clic(boton('Nuevo autor')!)
  await clic(boton('Crear autor')!)
  assert.ok(texto().includes('Escribí el nombre del autor.'))
  await escribir(document.getElementById('autor-nuevo') as HTMLInputElement, 'Ana Nueva')
  await clic(boton('Crear autor')!)
  await hasta(() => !!document.getElementById('autor-nombre'), 'la ficha del autor nuevo')
  assert.deepEqual(pedidosAutores.filter((p) => p.metodo === 'POST').at(-1)!.cuerpo, { nombre: 'Ana Nueva' })
  await act(async () => r.unmount())
})

await t('Ficha de autor: campos, redes con dirección completa, guardado y mensajes', async () => {
  autorEditaTodo = true
  const r = await montar('/autores/20')
  await hasta(() => !!document.getElementById('autor-nombre'), 'la ficha')
  assert.equal((document.getElementById('autor-nombre') as HTMLInputElement).value, 'Luca')
  assert.equal((document.getElementById('autor-slug') as HTMLInputElement).value, 'luca')
  assert.equal((document.getElementById('red-instagram') as HTMLInputElement).value, 'https://instagram.com/luca')
  assert.equal((document.getElementById('foto-alt') as HTMLInputElement).value, 'Retrato de Luca')
  assert.ok(document.querySelector('.bio-prosemirror')!.textContent!.includes('Escribe y enseña.'), 'la bio se abre en el editor')
  assert.ok(texto().includes('17 de 500 caracteres'), 'el contador cuenta la bio')
  assert.equal(boton('Guardar')!.disabled, true, 'sin cambios no se guarda')
  assert.ok(texto().includes('Todo guardado.'))
  // Cambios: el nombre, una red y la dirección
  await escribir(document.getElementById('autor-nombre') as HTMLInputElement, 'Luca Frondoni')
  await escribir(document.getElementById('red-x') as HTMLInputElement, '  https://x.com/luca  ')
  await escribir(document.getElementById('autor-slug') as HTMLInputElement, 'luca-frondoni')
  assert.ok(texto().includes('Hay cambios sin guardar.'))
  await clic(boton('Guardar')!)
  await hasta(() => texto().includes('Guardamos los cambios.'), 'el aviso de éxito')
  const put = pedidosAutores.filter((p) => p.metodo === 'PUT').at(-1)!
  assert.equal(put.ruta, '/api/admin/autores/20')
  assert.equal(put.cuerpo['version'], '2026-10-23T12:00:00.000Z', 'manda la versión que abrió')
  const d = put.cuerpo['datos'] as J
  assert.deepEqual({ nombre: d['nombre'], slug: d['slug'], soloTexto: d['soloTexto'], instagram: d['instagram'], x: d['x'], facebook: d['facebook'], sitioWeb: d['sitioWeb'], fotoId: d['fotoId'], fotoAlt: d['fotoAlt'] }, { nombre: 'Luca Frondoni', slug: 'luca-frondoni', soloTexto: false, instagram: 'https://instagram.com/luca', x: 'https://x.com/luca', facebook: null, sitioWeb: null, fotoId: 5, fotoAlt: 'Retrato de Luca' })
  assert.deepEqual(d['bio'], bioCorta, 'la bio sin tocar vuelve igual')
  assert.equal(boton('Guardar')!.disabled, true, 'después de guardar vuelve a «todo guardado»')
  // Un 422 muestra lo que hay que corregir, en lenguaje común
  respuestaAutorPut = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá la ficha antes de guardar.', problemas: ['Instagram: pegá la dirección completa, que empiece con http:// o https://.'] } }
  await escribir(document.getElementById('red-instagram') as HTMLInputElement, '@luca')
  await clic(boton('Guardar')!)
  await hasta(() => texto().includes('Instagram: pegá la dirección completa'), 'el problema')
  assert.ok(texto().includes('Revisá la ficha antes de guardar.'))
  // Un 409 avisa que otra persona guardó y ofrece cargar la versión nueva
  respuestaAutorPut = { estado: 409, cuerpo: { estado: 'conflicto', mensaje: 'Esta ficha cambió mientras la editabas.' } }
  await clic(boton('Guardar')!)
  await hasta(() => texto().includes('no guardamos nada para no pisar el cambio'), 'el aviso de conflicto')
  assert.ok(boton('Cargar la versión nueva'))
  assert.equal(boton('Guardar')!.disabled, true, 'mientras hay conflicto no se guarda')
  respuestaAutorPut = { estado: 200, cuerpo: {} }
  await act(async () => r.unmount())
})

await t('Ficha de autor: una bio migrada más larga que el límite se avisa y se puede guardar sin tocarla', async () => {
  const larga = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(900) }] }] }
  autorServido = { ...autorServido, bio: larga, version: '2026-10-23T12:00:00.000Z' }
  const r = await montar('/autores/20')
  await hasta(() => !!document.getElementById('bio-contador'), 'el contador')
  assert.ok(texto().includes('900 de 500 caracteres'))
  assert.ok(texto().includes('se puede guardar así mientras no la cambies'))
  await escribir(document.getElementById('autor-nombre') as HTMLInputElement, 'Luca Y')
  await clic(boton('Guardar')!)
  await hasta(() => texto().includes('Guardamos los cambios.'), 'guardado')
  assert.deepEqual(((pedidosAutores.filter((p) => p.metodo === 'PUT').at(-1)!.cuerpo['datos']) as J)['bio'], larga, 'la bio larga vuelve igual')
  autorServido = { ...autorServido, bio: bioCorta, version: '2026-10-23T12:00:00.000Z', nombre: 'Luca', slug: 'luca', x: null }
  await act(async () => r.unmount())
})

await t('Ficha de autor: «No es una persona» esconde la bio y la foto; sin foto se pide una', async () => {
  autorServido = { ...autorServido, soloTexto: true }
  const r = await montar('/autores/20')
  await hasta(() => !!document.getElementById('autor-nombre'), 'la ficha')
  assert.ok(!document.getElementById('bio-contador') && !document.getElementById('foto-alt'))
  await act(async () => r.unmount())
  autorServido = { ...autorServido, soloTexto: false, fotoId: null, foto: null, fotoAlt: null }
  const r2 = await montar('/autores/20')
  await hasta(() => !!document.getElementById('autor-nombre'), 'la ficha sin foto')
  assert.ok(boton('Elegir una foto'))
  assert.ok(!document.getElementById('foto-alt'))
  assert.ok(texto().includes('Sin foto se muestran las iniciales.'))
  await act(async () => r2.unmount())
  autorServido = { ...autorServido, fotoId: 5, foto: { id: 5, clave: 'foto.jpg', nombreOriginal: 'foto.jpg' }, fotoAlt: 'Retrato de Luca' }
})

await t('Ficha de autor: «Mi ficha» lleva a la propia y un redactor no ve dirección, tipo ni administración', async () => {
  usuarioServido = { id: 4, email: 'rita@b.c', nombre: 'Rita', rol: 'REDACTOR', debeCambiarClave: false, permisos: ['articulos.crear'] }
  autorEditaTodo = false
  const r = await montar('/autores/mia')
  await hasta(() => !!document.getElementById('autor-nombre'), 'la ficha propia')
  assert.ok(!document.getElementById('autor-slug'), 'no cambia su dirección')
  assert.ok(!texto().includes('No es una persona (por ejemplo'), 'ni el tipo de autor')
  assert.ok(!texto().includes('Administrar') && !boton('Eliminar este autor'), 'ni une ni elimina')
  assert.ok(!document.querySelector('.migas'), 'y no hay vuelta al listado que no ve')
  await act(async () => r.unmount())
  // Un autor que no existe da un mensaje claro
  const r2 = await montar('/autores/404')
  await hasta(() => texto().includes('No pudimos abrir la ficha'), 'el error')
  assert.ok(texto().includes('No encontramos a ese autor.'))
  await act(async () => r2.unmount())
  usuarioServido = { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR', debeCambiarClave: false, permisos: ['articulos.crear', 'usuarios.gestionar'] }
  autorEditaTodo = true
})

await t('Ficha de autor: el administrador une con otro viendo antes qué cambia, y la elimina solo si no tiene artículos', async () => {
  const r = await montar('/autores/20')
  await hasta(() => !!document.getElementById('unir-busqueda'), 'la administración')
  assert.equal(boton('Eliminar este autor')!.disabled, true, 'tiene 2 artículos: no se elimina')
  assert.equal(boton('Ver qué cambia')!.disabled, true, 'primero hay que elegir con quién')
  await escribir(document.getElementById('unir-busqueda') as HTMLInputElement, 'luca')
  await hasta(() => !!document.getElementById('unir-destino'), 'los candidatos')
  const opciones = [...(document.getElementById('unir-destino') as HTMLSelectElement).options].map((o) => o.textContent)
  assert.ok(!opciones.some((o) => o?.startsWith('Luca (')), 'no se ofrece unirlo consigo mismo')
  const select = document.getElementById('unir-destino') as HTMLSelectElement
  await act(async () => {
    select.value = '22'
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await clic(boton('Ver qué cambia')!)
  await hasta(() => texto().includes('Se mueven 2 artículos a Luca Frondoni.'), 'la vista previa')
  assert.ok(texto().includes('Se le completa la bio, la foto con lo de «Luca»'))
  assert.ok(texto().includes('Otra nota (ya tiene a los dos: queda con uno solo)'))
  respuestaConfirm = false
  await clic(boton('Unir los dos autores')!)
  assert.equal(pedidosAutores.filter((p) => p.ruta.endsWith('/unir')).length, 0, 'sin confirmar no se une')
  respuestaConfirm = true
  await clic(boton('Unir los dos autores')!)
  await hasta(() => pedidosAutores.some((p) => p.metodo === 'POST' && p.ruta === '/api/admin/autores/20/unir'), 'la unión')
  assert.deepEqual(pedidosAutores.find((p) => p.ruta === '/api/admin/autores/20/unir')!.cuerpo, { destinoId: 22 })
  await hasta(() => !!document.getElementById('autor-nombre'), 'la ficha del que quedó')
  await act(async () => r.unmount())
  // Eliminar uno sin artículos
  autorServido = { ...autorServido, articulos: 0 }
  const r2 = await montar('/autores/20')
  await hasta(() => !!boton('Eliminar este autor'), 'eliminar')
  assert.equal(boton('Eliminar este autor')!.disabled, false)
  await clic(boton('Eliminar este autor')!)
  await hasta(() => pedidosAutores.some((p) => p.metodo === 'DELETE'), 'el borrado')
  await hasta(() => document.querySelector('h1')?.textContent === 'Autores', 'vuelve al listado')
  await act(async () => r2.unmount())
  autorServido = { ...autorServido, articulos: 2 }
})

// ---------- Secciones y categorías ----------
const filaDe = (nombre: string) => [...document.querySelectorAll('tbody tr')].find((f) => f.querySelector('.titulo-articulo')?.textContent === nombre)!
const botonEn = (fila: Element, texto: string) => [...fila.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(texto) || b.getAttribute('aria-label')?.startsWith(texto))!

/** Mientras dura `fn`, las filas del cuerpo de la tabla miden 40 px de alto y se apilan (jsdom no calcula posiciones y el arrastre las necesita). */
const conFilasMedidas = async (fn: () => Promise<void>) => {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.tagName === 'TR' && this.parentElement?.tagName === 'TBODY') {
      const top = [...this.parentElement.children].indexOf(this) * 40
      return { x: 0, y: top, top, bottom: top + 40, left: 0, right: 600, width: 600, height: 40, toJSON: () => ({}) } as DOMRect
    }
    return original.call(this)
  }
  try {
    await fn()
  } finally {
    Element.prototype.getBoundingClientRect = original
  }
}
const teclaEn = async (el: Element, code: string) => act(async () => { el.dispatchEvent(new window.KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true })) })
const anuncios = () => [...document.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' ')

await t('Secciones: lista en el orden del menú, «Sin asignar» sin acciones, y se reordenan arrastrando (con el teclado también)', async () => {
  const r = await montar('/clasificacion')
  await hasta(() => !!document.querySelector('table'), 'la lista de secciones')
  const nombres = [...document.querySelectorAll('tbody .titulo-articulo')].map((n) => n.textContent)
  assert.deepEqual(nombres, ['Cine', 'Arte', 'Teatro', 'Sin asignar'])
  assert.equal(filaDe('Sin asignar').querySelectorAll('button').length, 0, 'la interna no se toca ni se arrastra')
  assert.ok(filaDe('Sin asignar').textContent!.includes('Es interna'))
  assert.ok(!document.querySelector('button[aria-label^="Subir"]') && !document.querySelector('button[aria-label^="Bajar"]'), 'ya no hay botones de subir y bajar')
  const manijas = [...document.querySelectorAll<HTMLButtonElement>('.boton-arrastre')]
  assert.deepEqual(manijas.map((m) => m.getAttribute('aria-label')), ['Cambiar de lugar Cine en el menú', 'Cambiar de lugar Arte en el menú', 'Cambiar de lugar Teatro en el menú'])
  assert.equal(manijas[0]!.getAttribute('aria-roledescription'), 'sortable', 'es una manija de arrastre para lectores de pantalla')
  assert.ok(document.getElementById(manijas[0]!.getAttribute('aria-describedby')!)!.textContent!.includes('barra espaciadora'), 'con instrucciones en español')

  await conFilasMedidas(async () => {
    // Levantar «Cine», bajarla un lugar y soltarla
    await act(async () => { manijas[0]!.focus() })
    await teclaEn(manijas[0]!, 'Space')
    await hasta(() => anuncios().includes('Levantaste «Cine», que está en el lugar 1 de 3.'), 'el aviso al levantar')
    await teclaEn(document.body, 'ArrowDown')
    await hasta(() => anuncios().includes('«Cine» pasó sobre el lugar 2 de 3.'), 'el aviso al pasar')
    await teclaEn(document.body, 'Space')
    await hasta(() => texto().includes('Guardamos el orden del menú: «Cine» quedó en el lugar 2.'), 'el aviso de guardado')
  })
  const pedido = pedidosClasificacion.filter((p) => p.ruta === '/api/admin/secciones/orden').at(-1)!
  assert.deepEqual(pedido.cuerpo, { ids: [2, 1, 3] }, 'manda el orden completo, sin la interna')
  assert.deepEqual([...document.querySelectorAll('tbody .titulo-articulo')].map((n) => n.textContent), ['Arte', 'Cine', 'Teatro', 'Sin asignar'], 'y la lista queda con el orden nuevo')

  // Esc cancela el movimiento y no se guarda nada
  const antes = pedidosClasificacion.filter((p) => p.ruta.endsWith('/orden')).length
  await conFilasMedidas(async () => {
    const manija = document.querySelector<HTMLButtonElement>('.boton-arrastre')!
    await act(async () => { manija.focus() })
    await teclaEn(manija, 'Space')
    await teclaEn(document.body, 'ArrowDown')
    await teclaEn(document.body, 'Escape')
    await hasta(() => anuncios().includes('Cancelaste el movimiento'), 'el aviso de cancelar')
  })
  assert.equal(pedidosClasificacion.filter((p) => p.ruta.endsWith('/orden')).length, antes, 'cancelar no guarda')
  // Si la API falla, se muestra el error y se vuelve a cargar el orden de la base
  respuestaClasificacion = { estado: 500, cuerpo: { estado: 'error' } }
  await conFilasMedidas(async () => {
    const manija = document.querySelector<HTMLButtonElement>('.boton-arrastre')!
    await act(async () => { manija.focus() })
    await teclaEn(manija, 'Space')
    await teclaEn(document.body, 'ArrowDown')
    await teclaEn(document.body, 'Space')
    await hasta(() => !!document.querySelector('.aviso-error'), 'el error')
  })
  respuestaClasificacion = { estado: 200, cuerpo: {} }
  await act(async () => r.unmount())
})

await t('Secciones: crear, editar el nombre y la dirección (con aviso), y eliminar solo las vacías', async () => {
  const r = await montar('/clasificacion')
  await hasta(() => !!document.querySelector('table'), 'la lista')
  await clic(boton('Crear sección')!)
  assert.ok(texto().includes('Escribí el nombre de la sección.'))
  await escribir(document.getElementById('nuevo-secciones') as HTMLInputElement, 'Cine Argentino')
  await clic(boton('Crear sección')!)
  await hasta(() => texto().includes('Creamos la sección «Cine Argentino».'), 'el aviso de alta')
  assert.deepEqual(pedidosClasificacion.filter((p) => p.metodo === 'POST' && p.ruta === '/api/admin/secciones').at(-1)!.cuerpo, { nombre: 'Cine Argentino' })
  // Editar
  await clic(botonEn(filaDe('Teatro'), 'Editar'))
  await escribir(document.getElementById('nombre-secciones-3') as HTMLInputElement, 'Teatro y danza')
  assert.ok(!texto().includes('conviene hacerlo pocas veces'), 'solo avisa cuando se cambia la dirección')
  await escribir(document.getElementById('slug-secciones-3') as HTMLInputElement, 'teatro-y-danza')
  assert.ok(texto().includes('la vieja redirige'))
  await clic(boton('Guardar')!)
  await hasta(() => texto().includes('Guardamos los cambios.'), 'el aviso de guardado')
  assert.deepEqual(pedidosClasificacion.filter((p) => p.metodo === 'PUT').at(-1), { ruta: '/api/admin/secciones/3', metodo: 'PUT', cuerpo: { nombre: 'Teatro y danza', slug: 'teatro-y-danza' } })
  // Un 422 de la API se muestra en lenguaje común
  respuestaClasificacion = { estado: 422, cuerpo: { estado: 'error', mensaje: 'Revisá los datos antes de guardar.', problemas: ['Ya hay una sección con esa dirección. Elegí otra.'] } }
  await clic(botonEn(filaDe('Teatro'), 'Editar'))
  await escribir(document.getElementById('slug-secciones-3') as HTMLInputElement, 'cine')
  await clic(boton('Guardar')!)
  await hasta(() => texto().includes('Ya hay una sección con esa dirección.'), 'el problema')
  respuestaClasificacion = { estado: 200, cuerpo: {} }
  // Eliminar: la que tiene artículos no se puede; la vacía pide confirmación
  assert.equal((botonEn(filaDe('Cine'), 'Eliminar') as HTMLButtonElement).disabled, true, 'tiene 12 artículos')
  assert.equal((botonEn(filaDe('Arte'), 'Eliminar') as HTMLButtonElement).disabled, false)
  respuestaConfirm = false
  await clic(botonEn(filaDe('Arte'), 'Eliminar'))
  assert.equal(pedidosClasificacion.filter((p) => p.metodo === 'DELETE').length, 0, 'sin confirmar no se elimina')
  respuestaConfirm = true
  await clic(botonEn(filaDe('Arte'), 'Eliminar'))
  await hasta(() => texto().includes('Eliminamos la sección «Arte».'), 'el aviso')
  assert.equal(pedidosClasificacion.filter((p) => p.metodo === 'DELETE').at(-1)!.ruta, '/api/admin/secciones/2')
  await act(async () => r.unmount())
})

await t('Secciones: unir muestra antes cuántos artículos se mueven y pide confirmación', async () => {
  const r = await montar('/clasificacion')
  await hasta(() => !!document.querySelector('table'), 'la lista')
  await clic(botonEn(filaDe('Teatro'), 'Unir'))
  const select = document.getElementById('unir-secciones-3') as HTMLSelectElement
  assert.ok(![...select.options].some((o) => o.textContent?.startsWith('Teatro')), 'no se ofrece consigo misma')
  assert.ok(![...select.options].some((o) => o.textContent?.startsWith('Sin asignar')), 'ni la interna')
  await act(async () => {
    select.value = '1'
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await hasta(() => texto().includes('Se mueven 3 artículos a Cine.'), 'la vista previa')
  assert.ok(texto().includes('También se corrigen 1 con cambios sin publicar.'))
  respuestaConfirm = false
  await clic(boton('Unir')!)
  assert.equal(pedidosClasificacion.filter((p) => p.ruta.endsWith('/unir') && p.metodo === 'POST').length, 0)
  respuestaConfirm = true
  await clic(boton('Unir')!)
  await hasta(() => texto().includes('Unimos «Teatro» con la otra sección.'), 'el aviso')
  assert.deepEqual(pedidosClasificacion.filter((p) => p.ruta === '/api/admin/secciones/3/unir' && p.metodo === 'POST').at(-1)!.cuerpo, { destinoId: 1 })
  await act(async () => r.unmount())
})

await t('Categorías: sin orden, con las volantas, y unir avisa de las que tienen las dos', async () => {
  const r = await montar('/clasificacion?ver=categorias')
  await hasta(() => !!document.querySelector('table') && !!document.getElementById('nuevo-categorias'), 'la lista de categorías')
  assert.deepEqual([...document.querySelectorAll('tbody .titulo-articulo')].map((n) => n.textContent), ['Entrevistas', 'Ensayos'])
  assert.ok(filaDe('Entrevistas').textContent!.includes('30') && filaDe('Entrevistas').textContent!.includes('5 como principal'))
  assert.ok(!document.querySelector('button[aria-label^="Subir"]'), 'las categorías no se ordenan')
  assert.ok(filaDe('Entrevistas').textContent!.includes('/categoria/entrevistas/'))
  await clic(botonEn(filaDe('Entrevistas'), 'Unir'))
  const select = document.getElementById('unir-categorias-10') as HTMLSelectElement
  await act(async () => {
    select.value = '11'
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await hasta(() => texto().includes('Se mueven 3 artículos a Ensayos.'), 'la vista previa')
  assert.ok(texto().includes('1 ya tienen las dos y quedan con una sola.'))
  assert.ok(texto().includes('2 la tenían como principal (volanta)'))
  // Cambiar de solapa vuelve a las secciones
  await clic([...document.querySelectorAll('.solapa')].find((b) => b.textContent === 'Secciones')!)
  await hasta(() => !!document.getElementById('nuevo-secciones'), 'las secciones')
  await act(async () => r.unmount())
})

// ---------- Revisión de la migración ----------
await t('Revisión: el tablero muestra lo que falta y lleva a cada lista', async () => {
  const r = await montar('/revision')
  await hasta(() => !!document.querySelector('.tablero'), 'el tablero')
  const tarjetas = [...document.querySelectorAll('.tablero-tarjeta')].map((c) => c.textContent)
  assert.deepEqual(tarjetas, ['5Artículos con imágenes sin texto alternativo', '1Artículos sin sección (en «Sin asignar»)', '0Artículos sin autor', '2Borradores que vienen de WordPress'])
  const enlacesTablero = [...document.querySelectorAll('.tablero a')].map((a) => a.getAttribute('href'))
  assert.deepEqual(enlacesTablero, ['/revision/articulos?filtro=alt', '/revision/articulos?filtro=sin-asignar', '/revision/articulos?filtro=borrador-migrado'], 'lo que está en cero no es un enlace')
  const hrefs = [...document.querySelectorAll('table a')].map((a) => a.getAttribute('href'))
  assert.ok(hrefs.includes('/revision/articulos?filtro=aviso%3Apalabra_ambigua') && hrefs.includes('/revision/articulos?filtro=revisado%3Apalabra_ambigua'))
  assert.ok(hrefs.includes('/revision/articulos?filtro=seccion%3A1'))
  assert.ok(texto().includes('Palabra ambigua en el título') && texto().includes('Nota al pie repetida'))
  await act(async () => r.unmount())
})

await t('Revisión: marcar un aviso como revisado y deshacerlo', async () => {
  const r = await montar('/revision/articulos?filtro=aviso:palabra_ambigua')
  await hasta(() => !!document.querySelector('table'), 'la lista')
  assert.equal(document.querySelector('h1')!.textContent, 'Por revisar: Palabra ambigua en el título', 'el título usa el nombre del aviso, no su código')
  const fila = [...document.querySelectorAll('tbody tr')][0]!
  assert.ok(fila.textContent!.includes('El camino de SEDA') && fila.textContent!.includes('2 imágenes sin texto alternativo'))
  assert.ok(fila.textContent!.includes('revisado por Beto'), 'los ya revisados muestran quién')
  assert.ok(!fila.textContent!.includes('Eliminar'), 'es un artículo publicado')
  await clic(boton('Marcar como revisado: Palabra ambigua en el título en El camino de SEDA')!)
  await hasta(() => texto().includes('Marcamos el aviso como revisado.'), 'el aviso')
  assert.deepEqual(pedidosRevision.filter((p) => p.ruta === '/api/admin/articulos/31/avisos').at(-1)!.cuerpo, { codigo: 'palabra_ambigua', revisado: true })
  assert.ok(boton('Deshacer: Palabra ambigua en el título en El camino de SEDA'), 'cambia el botón')
  await clic(boton('Deshacer: Palabra ambigua en el título en El camino de SEDA')!)
  await hasta(() => texto().includes('Volvió a quedar pendiente.'), 'el aviso de deshacer')
  assert.deepEqual(pedidosRevision.filter((p) => p.ruta === '/api/admin/articulos/31/avisos').at(-1)!.cuerpo, { codigo: 'palabra_ambigua', revisado: false })
  await act(async () => r.unmount())
})

await t('Revisión: asignar la sección a un artículo de «Sin asignar» sin abrirlo, y eliminar un borrador', async () => {
  const r = await montar('/revision/articulos?filtro=sin-asignar')
  await hasta(() => !!document.querySelector('.asignar-seccion'), 'la fila sin sección')
  assert.equal(boton('Asignar sección a Sin dueño')!.disabled, true, 'primero hay que elegir')
  const select = document.querySelector('.asignar-seccion select') as HTMLSelectElement
  assert.ok([...select.options].some((o) => o.textContent === 'Cine') && ![...select.options].some((o) => o.textContent === 'Sin asignar'), 'ofrece las secciones reales')
  await act(async () => {
    select.value = '1'
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await clic(boton('Asignar sección a Sin dueño')!)
  await hasta(() => texto().includes('«Sin dueño» quedó en Cine.'), 'el aviso')
  assert.deepEqual(pedidosRevision.filter((p) => p.ruta === '/api/admin/articulos/32/seccion').at(-1)!.cuerpo, { seccionId: 1 })
  await hasta(() => document.querySelector('.vacio') !== null, 'la cola de «Sin asignar» se vacía')
  await act(async () => r.unmount())
  // Eliminar un borrador: el administrador lo ve; un editor no
  articulosRevision = [articulosRevision[1]!]
  const r2 = await montar('/revision/articulos')
  await hasta(() => !!boton('Eliminar el borrador Sin dueño'), 'el botón de eliminar')
  respuestaConfirm = false
  await clic(boton('Eliminar el borrador Sin dueño')!)
  assert.equal(pedidosRevision.filter((p) => p.metodo === 'DELETE').length, 0, 'sin confirmar no se elimina')
  respuestaConfirm = true
  await clic(boton('Eliminar el borrador Sin dueño')!)
  await hasta(() => texto().includes('Eliminamos el borrador «Sin dueño».'), 'el aviso')
  assert.equal(pedidosRevision.filter((p) => p.metodo === 'DELETE').at(-1)!.ruta, '/api/admin/articulos/32')
  await act(async () => r2.unmount())
  articulosRevision = [{ ...articulosRevision[0] ?? {}, id: 32, wpId: 3200, titulo: 'Sin dueño', estado: 'BORRADOR', publicadoEn: null, altPendientes: 0, seccion: { id: 1, nombre: 'Cine', interna: false }, autores: [], avisos: [], ruta: null }]
  usuarioServido = { id: 2, email: 'e@b.c', nombre: 'Editor', rol: 'EDITOR', debeCambiarClave: false, permisos: ['articulos.crear'] }
  const r3 = await montar('/revision/articulos')
  await hasta(() => !!document.querySelector('table'), 'la lista del editor')
  assert.ok(!texto().includes('Eliminar el borrador'), 'un editor no elimina')
  assert.ok(enlaces().includes('Revisión'), 'pero sí ve el menú de revisión')
  await act(async () => r3.unmount())
  usuarioServido = { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR', debeCambiarClave: false, permisos: ['articulos.crear', 'usuarios.gestionar'] }
})

await t('Revisión: un redactor no ve el menú ni entra por la dirección', async () => {
  usuarioServido = { id: 4, email: 'rita@b.c', nombre: 'Rita', rol: 'REDACTOR', debeCambiarClave: false, permisos: ['articulos.crear'] }
  const r = await montar('/revision')
  await hasta(() => document.querySelector('h1')?.textContent === 'Artículos', 'vuelve al listado de artículos')
  assert.ok(!enlaces().includes('Revisión'))
  await act(async () => r.unmount())
  usuarioServido = { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR', debeCambiarClave: false, permisos: ['articulos.crear', 'usuarios.gestionar'] }
})

await t('Eliminar desde el artículo: el administrador elimina un borrador; si ya estuvo publicado se pide una segunda confirmación; un publicado explica el camino', async () => {
  catalogos.usuarios = []
  estadoArticulo = 'BORRADOR'
  const r = await montar('/articulos/7')
  await hasta(() => !!boton('Eliminar este borrador'), 'el botón de eliminar')
  respuestaConfirm = false
  await clic(boton('Eliminar este borrador')!)
  assert.equal(eliminados7.length, 0, 'sin confirmar no se elimina')
  // Un borrador que ya estuvo publicado: la API pide confirmar que la dirección se pierde
  respuestaEliminar7 = { estado: 409, cuerpo: { estado: 'error', codigo: 'estuvo_publicado', mensaje: 'Este artículo ya estuvo publicado.', direccion: '/2019/03/04/una-nota/', redirecciones: 2 } }
  respuestaConfirm = true
  preguntas.length = 0
  await clic(boton('Eliminar este borrador')!)
  await hasta(() => eliminados7.includes('/api/admin/articulos/7?perderDireccion=1'), 'la segunda confirmación')
  assert.equal(preguntas.length, 2, 'se preguntó dos veces')
  assert.ok(preguntas[1]!.includes('/2019/03/04/una-nota/') && preguntas[1]!.includes('deja de funcionar para siempre') && preguntas[1]!.includes('2 redirecciones'), 'y explica qué se pierde')
  await hasta(() => document.querySelector('h1')?.textContent === 'Artículos', 'vuelve al listado')
  await act(async () => r.unmount())
  // Un publicado no tiene botón: se explica qué hacer
  respuestaEliminar7 = { estado: 200, cuerpo: { estado: 'ok' } }
  estadoArticulo = 'PUBLICADO'
  const r2 = await montar('/articulos/7')
  await hasta(() => !!document.getElementById('titulo'), 'el artículo publicado')
  assert.ok(!boton('Eliminar este borrador'))
  assert.ok(texto().includes('primero hay que despublicarlo'))
  await act(async () => r2.unmount())
  // Un editor no ve nada de esto
  estadoArticulo = 'BORRADOR'
  usuarioServido = { id: 2, email: 'e@b.c', nombre: 'Editor', rol: 'EDITOR', debeCambiarClave: false, permisos: ['articulos.crear'] }
  const r3 = await montar('/articulos/7')
  await hasta(() => !!document.getElementById('titulo'), 'el artículo del editor')
  assert.ok(!boton('Eliminar este borrador') && !texto().includes('primero hay que despublicarlo'))
  await act(async () => r3.unmount())
  usuarioServido = { id: 1, email: 'a@b.c', nombre: 'Prueba', rol: 'ADMINISTRADOR', debeCambiarClave: false, permisos: ['articulos.crear', 'usuarios.gestionar'] }
})

// ---------- Menú lateral ----------
await t('Menú lateral: en escritorio arranca desplegado, se pliega a íconos con el botón de abajo y se acuerda', async () => {
  window.localStorage.removeItem('panel-menu-plegado')
  const r = await montar('/')
  await hasta(() => !!document.querySelector('.menu-lateral'), 'el menú')
  const estructura = () => document.querySelector('.estructura')!
  assert.ok(!estructura().classList.contains('plegada'), 'desplegado por defecto')
  assert.ok(document.querySelector('nav[aria-label="Secciones del panel"]'), 'tiene su navegación con nombre')
  assert.deepEqual([...document.querySelectorAll('.menu-grupo-titulo')].map((g) => g.textContent), ['Contenido', 'Revisión', 'Administración'], 'agrupado')
  const plegar = boton('Plegar el menú')!
  assert.equal(plegar.getAttribute('aria-pressed'), 'false')
  await clic(plegar)
  assert.ok(estructura().classList.contains('plegada'), 'plegado: solo íconos')
  assert.equal(window.localStorage.getItem('panel-menu-plegado'), '1', 'se recuerda en este navegador')
  const desplegar = boton('Desplegar el menú')!
  assert.equal(desplegar.getAttribute('aria-pressed'), 'true')
  // Plegado, cada enlace conserva su nombre (texto oculto a la vista) y una ayuda al pasar el mouse; todos tienen ícono
  const enlacesMenu = [...document.querySelectorAll('nav a.menu-enlace')]
  assert.ok(enlacesMenu.length >= 5 && enlacesMenu.every((a) => a.querySelector('svg[aria-hidden="true"]') && a.querySelector('.menu-texto')!.textContent === a.getAttribute('title')))
  assert.deepEqual(enlaces(), ['Artículos', 'Autores', 'Secciones y categorías', 'Revisión', 'Usuarios'], 'los mismos enlaces plegado y desplegado')
  assert.equal(document.querySelector('.menu-enlace[aria-current="page"]')!.textContent, 'Artículos', 'marca dónde estás')
  await act(async () => r.unmount())
  // Una visita nueva lo encuentra como se dejó
  const r2 = await montar('/')
  await hasta(() => !!document.querySelector('.menu-lateral'), 'el menú de nuevo')
  assert.ok(estructura().classList.contains('plegada'))
  await clic(boton('Desplegar el menú')!)
  assert.ok(!estructura().classList.contains('plegada'))
  assert.equal(window.localStorage.getItem('panel-menu-plegado'), '0')
  await act(async () => r2.unmount())
})

await t('Menú lateral: en celular arranca cerrado, la hamburguesa lo abre y se cierra con la X, Esc, tocando afuera o al ir a otra pantalla', async () => {
  window.localStorage.removeItem('panel-menu-plegado')
  const r = await montar('/')
  await hasta(() => !!document.querySelector('.menu-lateral'), 'el menú')
  const estructura = () => document.querySelector('.estructura')!
  const hamburguesa = () => document.querySelector<HTMLButtonElement>('.boton-menu[aria-label="Abrir el menú"]')!
  assert.ok(!estructura().classList.contains('menu-abierto'), 'cerrado al entrar')
  assert.equal(hamburguesa().getAttribute('aria-expanded'), 'false')
  assert.equal(hamburguesa().getAttribute('aria-controls'), 'menu-lateral')
  await clic(hamburguesa())
  assert.ok(estructura().classList.contains('menu-abierto'), 'la hamburguesa lo abre')
  assert.equal(hamburguesa().getAttribute('aria-expanded'), 'true')
  assert.ok(document.getElementById('menu-lateral'), 'y el botón apunta al menú')
  // Esc lo cierra y el foco vuelve a la hamburguesa
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(!estructura().classList.contains('menu-abierto'), 'Esc lo cierra')
  assert.equal(document.activeElement, hamburguesa(), 'y el foco vuelve al botón')
  // La X
  await clic(hamburguesa())
  await clic(document.querySelector('.menu-cerrar')!)
  assert.ok(!estructura().classList.contains('menu-abierto'), 'la X lo cierra')
  // Tocar afuera
  await clic(hamburguesa())
  await clic(document.querySelector('.fondo-menu')!)
  assert.ok(!estructura().classList.contains('menu-abierto'), 'tocar afuera lo cierra')
  // Ir a otra pantalla
  await clic(hamburguesa())
  await clic([...document.querySelectorAll('nav a')].find((a) => a.textContent === 'Autores')!)
  await hasta(() => document.querySelector('h1')?.textContent === 'Autores', 'Autores')
  assert.ok(!estructura().classList.contains('menu-abierto'), 'al ir a otra pantalla se cierra')
  await act(async () => r.unmount())
})

await t('Menú lateral: el plegar es un botón de solo ícono en la cabecera y el footer tiene el usuario', async () => {
  window.localStorage.removeItem('panel-menu-plegado')
  const r = await montar('/')
  await hasta(() => !!document.querySelector('.menu-lateral'), 'el menú')
  const cabecera = document.querySelector('.menu-cabecera')!
  const plegar = cabecera.querySelector<HTMLButtonElement>('.menu-plegar')!
  assert.ok(plegar, 'el botón de plegar está en la cabecera')
  assert.equal(plegar.textContent, '', 'y es solo ícono (sin texto)')
  assert.equal(plegar.getAttribute('aria-label'), 'Plegar el menú')
  assert.ok(plegar.querySelector('svg[aria-hidden="true"]'))
  assert.ok(!document.querySelector('.menu-pie .menu-plegar'), 'ya no está en el footer')
  const pie = document.querySelector('.menu-pie')!
  assert.ok(pie.querySelector('.menu-avatar')!.textContent === 'P', 'el footer muestra el avatar con la inicial')
  assert.ok(pie.textContent!.includes('Prueba') && pie.textContent!.includes('administrador'))
  await act(async () => r.unmount())
})

await t('Menú lateral: el usuario del footer abre un popover con Mi cuenta y Salir', async () => {
  salidas.length = 0
  const r = await montar('/')
  await hasta(() => !!document.querySelector('.menu-usuario-boton'), 'el usuario del footer')
  const disparador = () => document.querySelector<HTMLButtonElement>('.menu-usuario-boton')!
  const popover = () => document.querySelector<HTMLElement>('[role="menu"]')
  assert.ok(!popover(), 'cerrado al entrar')
  assert.equal(disparador().getAttribute('aria-haspopup'), 'menu')
  assert.equal(disparador().getAttribute('aria-expanded'), 'false')
  await clic(disparador())
  assert.ok(popover(), 'el clic lo abre')
  assert.equal(disparador().getAttribute('aria-expanded'), 'true')
  assert.deepEqual([...popover()!.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent), ['Mi cuenta', 'Salir'])
  assert.equal(document.activeElement, popover()!.querySelector('[role="menuitem"]'), 'el foco entra al primer ítem')
  // Flechas
  await act(async () => { document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  assert.equal(document.activeElement!.textContent, 'Salir')
  await act(async () => { document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  assert.equal(document.activeElement!.textContent, 'Mi cuenta', 'da la vuelta')
  // Esc lo cierra y el foco vuelve al botón
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(!popover())
  assert.equal(document.activeElement, disparador())
  // Un clic afuera lo cierra
  await clic(disparador())
  assert.ok(popover())
  await act(async () => { document.querySelector('.contenido')!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
  assert.ok(!popover(), 'clic afuera')
  // Salir pide confirmación solo si hay cambios sin guardar (acá no hay): cierra la sesión
  await clic(disparador())
  await clic([...popover()!.querySelectorAll('button')].find((b) => b.textContent === 'Salir')!)
  await hasta(() => salidas.length === 1, 'la salida')
  await act(async () => r.unmount())
  // Mi cuenta lleva a la pantalla y cierra el popover
  const r2 = await montar('/')
  await hasta(() => !!document.querySelector('.menu-usuario-boton'), 'el usuario del footer')
  await clic(document.querySelector('.menu-usuario-boton')!)
  await clic([...document.querySelectorAll('[role="menu"] a')].find((a) => a.textContent === 'Mi cuenta')!)
  await hasta(() => !!document.getElementById('cuenta-nombre'), 'Mi cuenta')
  assert.ok(!document.querySelector('[role="menu"]'), 'el popover se cierra al elegir')
  // Plegado, el popover sigue funcionando desde el avatar
  await clic(boton('Plegar el menú')!)
  await clic(document.querySelector('.menu-usuario-boton')!)
  assert.ok(document.querySelector('[role="menu"]'), 'plegado también se abre')
  await clic(boton('Desplegar el menú')!)
  assert.ok(!document.querySelector('[role="menu"]'), 'y se cierra al plegar o desplegar')
  await act(async () => r2.unmount())
})

await t('Secciones y categorías: las acciones son botones de solo ícono con su tooltip (mouse, teclado, Esc y botones deshabilitados)', async () => {
  tiemposTooltip.demora = 5
  seccionesServidas = [
    { id: 1, slug: 'cine', nombre: 'Cine', articulos: 12, interna: false, orden: 1 },
    { id: 2, slug: 'arte', nombre: 'Arte', articulos: 0, interna: false, orden: 2 },
    { id: 9, slug: 'sin-asignar', nombre: 'Sin asignar', articulos: 103, interna: true, orden: 9 },
  ]
  const r = await montar('/clasificacion')
  await hasta(() => !!document.querySelector('table'), 'la lista')
  const fila = filaDe('Cine')
  const botones = [...fila.querySelectorAll('button')]
  assert.deepEqual(botones.map((b) => b.getAttribute('aria-label')), ['Cambiar de lugar Cine en el menú', 'Editar Cine', 'Unir Cine con otra', 'Eliminar Cine'], 'cada botón tiene su nombre accesible')
  assert.ok(botones.every((b) => b.textContent === '' && b.querySelector('svg[aria-hidden="true"]')), 'y no tiene texto: solo ícono')
  assert.ok(!document.querySelector('[role="tooltip"]'), 'sin tooltip hasta que se pide')
  // Con el teclado el tooltip aparece enseguida y el botón queda descripto por él
  const editar = botones[1]!
  await act(async () => { editar.focus() })
  const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]')
  assert.equal(tip()!.textContent, 'Editar nombre y dirección')
  assert.equal(editar.getAttribute('aria-describedby'), tip()!.id)
  // Esc lo cierra
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(!tip() && !editar.hasAttribute('aria-describedby'))
  await act(async () => { editar.blur() })
  // Con el mouse aparece con una pequeña demora y se va al salir
  const envoltorio = botones[2]!.parentElement!
  await act(async () => { envoltorio.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })) })
  await hasta(() => !!tip(), 'el tooltip con el mouse')
  assert.equal(tip()!.textContent, 'Unir con la sección…')
  await act(async () => { envoltorio.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true })) })
  assert.ok(!tip(), 'se va al sacar el mouse')
  // Un botón deshabilitado explica por qué (el mouse lo recibe el envoltorio)
  const eliminar = botones[3]!
  assert.equal((eliminar as HTMLButtonElement).disabled, true)
  await act(async () => { eliminar.parentElement!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })) })
  await hasta(() => !!tip(), 'el tooltip del botón deshabilitado')
  assert.equal(tip()!.textContent, 'Tiene 12 artículos: pasalos a otra antes (Unir)')
  await act(async () => { eliminar.parentElement!.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true })) })
  // La manija de arrastre también explica qué hace
  const manija = botones[0]!
  await act(async () => { manija.parentElement!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })) })
  await hasta(() => !!tip(), 'el tooltip de la manija')
  assert.equal(tip()!.textContent, 'Arrastrá para cambiar el orden en el menú')
  assert.ok(manija.getAttribute('aria-describedby')!.split(' ').length === 2, 'conserva las instrucciones de arrastre y suma el tooltip')
  await act(async () => { manija.parentElement!.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true })) })
  // La vacía sí se puede eliminar
  assert.equal((filaDe('Arte').querySelector('button[aria-label="Eliminar Arte"]') as HTMLButtonElement).disabled, false)
  // Los íconos siguen haciendo lo suyo: editar abre el formulario
  await clic(editar)
  assert.equal(editar.getAttribute('aria-expanded'), 'true')
  assert.ok(document.getElementById('nombre-secciones-1'))
  tiemposTooltip.demora = 300
  await act(async () => r.unmount())
})

console.log(`\n${ok} pruebas de la pantalla ok`)
process.exit(0)
