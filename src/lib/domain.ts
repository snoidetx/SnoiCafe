import type {
  Category,
  Dish,
  DishOption,
  FoodRequest,
  KitchenData,
  Language,
  Member,
} from '../types'
export function localized(item: { name: string; name_zh?: string }, language: Language) {
  return language === 'zh' ? item.name_zh || item.name : item.name || item.name_zh || ''
}
export function description(dish: Dish, language: Language) {
  return language === 'zh'
    ? dish.description_zh || dish.description
    : dish.description || dish.description_zh
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
// Names identify family profiles within a role; sessions control device access.
export function kitchenPeople(data: KitchenData) {
  return (['chef', 'customer'] as const).flatMap((role) => {
    const members = data.members.filter((m) => m.role === role)
    const profileKey = (m: Member) => memberProfileId(m) || m.display_name.trim().toLowerCase()
    const profiles = (role === 'chef' ? data.chef_profiles : data.customer_profiles) || [
      ...new Map(
        members.map((m) => [
          profileKey(m),
          {
            id: profileKey(m),
            kitchen_id: m.kitchen_id,
            display_name: m.display_name,
          },
        ]),
      ).values(),
    ]
    return profiles.map((p) => ({
      id: `${role}:${p.id}`,
      display_name: p.display_name,
      role,
      sessions: members.filter((m) => profileKey(m) === p.id),
    }))
  })
}
export function memberProfileId(member: Member) {
  return member.role === 'chef' ? member.chef_profile_id : member.customer_profile_id
}
export function ownsRequest(
  request: Pick<FoodRequest, 'created_by' | 'customer_profile_id'>,
  member?: Member,
) {
  if (!member) return false
  if (request.customer_profile_id)
    return member.role === 'customer' && request.customer_profile_id === member.customer_profile_id
  // Preserve original-device ownership for older requests without a profile.
  return request.created_by === member.user_id
}

export function memberProfile(data: KitchenData, userId: string) {
  const member = data.members.find((m) => m.user_id === userId)
  if (!member) return undefined
  const profiles = member.role === 'chef' ? data.chef_profiles : data.customer_profiles
  return profiles?.find((p) => p.id === memberProfileId(member))
}

export function localizedNames(form: FormData, language: Language) {
  const name = String(form.get('name') || '').trim()
  const name_zh = String(form.get('name_zh') || '').trim()
  if (!(language === 'zh' ? name_zh : name)) throw new Error('emptyName')
  return { name, name_zh }
}
