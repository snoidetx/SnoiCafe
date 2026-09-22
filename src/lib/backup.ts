import type { Category, Dish, DishOption } from '../types'
interface MenuBackup {
  categories: Category[]
  dishes: Dish[]
  photos: Record<string, string>
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number, required = false) =>
  typeof v === 'string' && v.length <= max && (!required || !!v.trim())
function options(value: unknown): value is DishOption[] {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every(
      (o) =>
        record(o) &&
        text(o.name, 60, true) &&
        Array.isArray(o.values) &&
        o.values.length > 0 &&
        o.values.length <= 12 &&
        o.values.every((v) => text(v, 60, true)) &&
        new Set(o.values).size === o.values.length,
    ) &&
    new Set(value.map((o) => o.name)).size === value.length
  )
}
export function validateMenuBackup(input: unknown): MenuBackup {
  if (
    !record(input) ||
    input.format !== 'snoicafe-backup' ||
    input.version !== 1 ||
    !Array.isArray(input.categories) ||
    input.categories.length > 100 ||
    !Array.isArray(input.dishes) ||
    input.dishes.length > 500 ||
    !record(input.photos)
  )
    throw new Error('invalidBackup')
  const { categories, dishes, photos } = input
  if (
    categories.some(
      (c) =>
        !record(c) ||
        !text(c.id, 100, true) ||
        !text(c.name, 60, true) ||
        !text(c.name_zh, 60) ||
        !text(c.emoji, 12) ||
        !Number.isSafeInteger(c.position) ||
        Number(c.position) < -2147483648 ||
        Number(c.position) > 2147483647,
    ) ||
    new Set(categories.map((c) => c.id)).size !== categories.length
  )
    throw new Error('invalidBackup')
  const ids = new Set(categories.map((c) => c.id))
  if (
    dishes.some(
      (d) =>
        !record(d) ||
        !text(d.name, 100, true) ||
        !text(d.name_zh, 100) ||
        !text(d.description, 1000) ||
        !text(d.description_zh, 1000) ||
        typeof d.price !== 'number' ||
        !Number.isFinite(d.price) ||
        d.price < 0 ||
        d.price > 999999 ||
        !options(d.options) ||
        (d.category_id !== null && !ids.has(d.category_id)) ||
        !text(d.photo_path, 300, true) ||
        !Object.hasOwn(photos, String(d.photo_path)) ||
        typeof photos[String(d.photo_path)] !== 'string' ||
        !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          String(photos[String(d.photo_path)]),
        ) ||
        String(photos[String(d.photo_path)]).length > 3 * 1024 * 1024,
    )
  )
    throw new Error('invalidBackup')
  return {
    categories: categories as Category[],
    dishes: dishes as Dish[],
    photos: photos as Record<string, string>,
  }
}
