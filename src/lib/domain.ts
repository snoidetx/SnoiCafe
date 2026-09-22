import type { Category, Dish, DishOption, Language } from '../types'
export function localized(item: { name: string; name_zh?: string }, language: Language) {
  return language === 'zh' && item.name_zh ? item.name_zh : item.name
}
export function description(dish: Dish, language: Language) {
  return language === 'zh' && dish.description_zh ? dish.description_zh : dish.description
}
export function filterDishes(dishes: Dish[], search: string, language: Language) {
  const term = search.trim().toLocaleLowerCase()
  return dishes.filter(
    (d) =>
      !d.archived &&
      (!term ||
        `${localized(d, language)} ${d.name} ${d.name_zh} ${d.description} ${d.description_zh}`
          .toLocaleLowerCase()
          .includes(term)),
  )
}
export function orderedCategories(categories: Category[]) {
  return [...categories].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}
export function parseOptions(text: string): DishOption[] {
  if (!text.trim()) return []
  const options = text
    .split('\n')
    .filter((x) => x.trim())
    .map((line) => {
      const index = line.indexOf(':') >= 0 ? line.indexOf(':') : line.indexOf('：')
      if (index < 1) throw new Error('invalidOptions')
      const name = line.slice(0, index).trim()
      const values = line
        .slice(index + 1)
        .split(/[,，]/)
        .map((v) => v.trim())
        .filter(Boolean)
      if (
        !name ||
        name.length > 60 ||
        !values.length ||
        values.length > 12 ||
        values.some((v) => v.length > 60) ||
        new Set(values).size !== values.length
      )
        throw new Error('invalidOptions')
      return { name, values }
    })
  if (options.length > 8 || new Set(options.map((x) => x.name)).size !== options.length)
    throw new Error('invalidOptions')
  return options
}
export function optionsText(options: DishOption[]) {
  return options.map((o) => `${o.name}: ${o.values.join(', ')}`).join('\n')
}
export function photoFileName(path: string) {
  return path.split('/').pop() || 'photo.webp'
}
export async function preparePhoto(file: File): Promise<Blob> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('invalidPhoto')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('invalidPhoto')
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('invalidPhoto'))), 'image/webp', 0.84),
  )
  if (blob.size > 2 * 1024 * 1024) throw new Error('invalidPhoto')
  return blob
}
