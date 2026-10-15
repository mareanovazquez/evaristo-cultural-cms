/**
 * Port de `wpautop()` de WordPress (wp-includes/formatting.php).
 *
 * El 72% de los artículos de Evaristo no tiene etiquetas <p> en la base: WordPress
 * las agrega al mostrar la página, convirtiendo los saltos de línea dobles en
 * párrafos y los simples en <br />. Para ver lo mismo que veían los lectores hay
 * que aplicar la misma lógica antes de interpretar el HTML.
 */

const ALL_BLOCKS =
  '(?:table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|form|map|area|blockquote|address|math|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|hgroup|header|footer|nav|figure|figcaption|details|menu|summary)'

const re = (src: string, flags = 'g') => new RegExp(src, flags)

export function wpautop(input: string, br = true): string {
  if (input.trim() === '') return ''
  let text = input + '\n'

  // <pre> se protege: no se tocan sus saltos de línea.
  const preTags: Record<string, string> = {}
  if (text.includes('<pre')) {
    const parts = text.split('</pre>')
    const last = parts.pop() as string
    text = ''
    let i = 0
    for (const part of parts) {
      const start = part.indexOf('<pre')
      if (start === -1) {
        text += part
        continue
      }
      const name = `<pre wp-pre-tag-${i}></pre>`
      preTags[name] = part.slice(start) + '</pre>'
      text += part.slice(0, start) + name
      i++
    }
    text += last
  }

  // Dos <br> seguidos son un salto de párrafo.
  text = text.replace(/<br\s*\/?>\s*<br\s*\/?>/g, '\n\n')

  // Doble salto antes de cada apertura de bloque y después de cada cierre.
  text = text.replace(re('(<' + ALL_BLOCKS + '[\\s/>])'), '\n\n$1')
  text = text.replace(re('(</' + ALL_BLOCKS + '>)'), '$1\n\n')
  text = text.replace(/(<hr\s*?\/?>)/g, '$1\n\n')

  text = text.replace(/\r\n|\r/g, '\n')

  // Los saltos de línea dentro de una etiqueta (atributos) no cuentan.
  text = text.replace(/<[^>]*>/g, (tag) => tag.replace(/\n/g, ' <!-- wpnl --> '))

  text = text.replace(/\n\n+/g, '\n\n')

  const paragraphs = text.split(/\n\s*\n/).filter((s) => s !== '')
  text = ''
  for (const p of paragraphs) text += '<p>' + p.replace(/^\n+|\n+$/g, '') + '</p>\n'

  text = text.replace(/<p>\s*<\/p>/g, '')
  text = text.replace(/<p>([^<]+)<\/(div|address|form)>/g, '<p>$1</p></$2>')
  text = text.replace(re('<p>\\s*(</?' + ALL_BLOCKS + '[^>]*>)\\s*</p>'), '$1')
  text = text.replace(/<p>(<li.+?)<\/p>/g, '$1')
  text = text.replace(/<p><blockquote([^>]*)>/gi, '<blockquote$1><p>')
  text = text.replace(/<\/blockquote><\/p>/g, '</p></blockquote>')
  text = text.replace(re('<p>\\s*(</?' + ALL_BLOCKS + '[^>]*>)'), '$1')
  text = text.replace(re('(</?' + ALL_BLOCKS + '[^>]*>)\\s*</p>'), '$1')

  if (br) {
    text = text.replace(/<(script|style|svg|math).*?<\/\1>/gs, (m) => m.replace(/\n/g, '<WPPreserveNewline />'))
    text = text.replace(/<br>|<br\/>/g, '<br />')
    text = text.replace(/(?<!<br \/>)\s*\n/g, '<br />\n')
    text = text.replace(/<WPPreserveNewline \/>/g, '\n')
  }

  text = text.replace(re('(</?' + ALL_BLOCKS + '[^>]*>)\\s*<br />'), '$1')
  text = text.replace(/<br \/>(\s*<\/?(?:p|li|div|dl|dd|dt|th|pre|td|ul|ol)[^>]*>)/g, '$1')
  text = text.replace(/\n<\/p>$/, '</p>')

  for (const [name, original] of Object.entries(preTags)) text = text.replace(name, () => original)

  text = text.replace(/ <!-- wpnl --> |<!-- wpnl -->/g, '\n')
  return text
}
