import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'

// Tabla simple: sin redimensionado y sin celdas combinadas.
// colspan/rowspan se conservan como atributos (prosemirror-tables los necesita) pero siempre valen 1,
// incluso al pegar HTML con celdas combinadas.
const simpleCellAttributes = () => ({
  colspan: { default: 1, parseHTML: () => 1 },
  rowspan: { default: 1, parseHTML: () => 1 },
})

export const Tabla = Table.configure({ resizable: false })

export const FilaTabla = TableRow

export const CeldaEncabezado = TableHeader.extend({
  content: 'paragraph+',
  addAttributes: simpleCellAttributes,
})

export const CeldaTabla = TableCell.extend({
  content: 'paragraph+',
  addAttributes: simpleCellAttributes,
})
