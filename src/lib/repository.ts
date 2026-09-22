import type {
  Category,
  ChefProfile,
  CustomerProfile,
  Dish,
  FoodRequest,
  Kitchen,
  KitchenData,
  Member,
  Repository,
} from '../types'
import { supabase } from './supabase'
import { photoExtension, preparePhoto } from './photos'
import { validateMenuBackup } from './backup'

export function createRepository(): Repository {
  const db = supabase
  if (!db) throw new Error('notConfigured')
  const check = <T>({ data, error }: { data: T; error: unknown }) => {
    if (error) throw error
    return data
  }
  async function rows<T>(table: string, kitchenId: string): Promise<T[]> {
    const result: T[] = []
    for (let offset = 0; ; offset += 500) {
      const page =
        check(
          await db!
            .from(table)
            .select('*')
            .eq('kitchen_id', kitchenId)
            .order(table === 'members' ? 'user_id' : 'id')
            .range(offset, offset + 499),
        ) || []
      result.push(...(page as T[]))
      if (page.length < 500) return result
    }
  }
  const repository: Repository = {
    async load(userId) {
      const kitchen = check(await db.from('kitchens').select('*').maybeSingle()) as Kitchen | null
      if (!kitchen) return null
      const [members, categories, dishes, requests, chef_profiles, customer_profiles] =
        await Promise.all([
          rows<Member>('members', kitchen.id),
          rows<Category>('categories', kitchen.id),
          rows<Dish>('dishes', kitchen.id),
          rows<FoodRequest>('requests', kitchen.id),
          rows<ChefProfile>('chef_profiles', kitchen.id),
          rows<CustomerProfile>('customer_profiles', kitchen.id),
        ])
      return {
        kitchen,
        members,
        chef_profiles,
        customer_profiles,
        categories,
        dishes,
        requests: requests.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      }
    },
    async saveDish(dish) {
      check(await db.from('dishes').upsert(dish))
    },
    async saveCategory(category) {
      check(await db.from('categories').upsert(category))
    },
    async deleteCategory(id) {
      check(await db.rpc('delete_category', { p_id: id }))
    },
    async order(input) {
      check(
        await db.rpc('place_request', {
          p_kitchen_id: input.kitchen_id,
          p_dish_id: input.dish_id,
          p_name: input.name,
          p_quantity: input.quantity,
          p_notes: input.notes,
          p_selected_options: input.selected_options,
          p_client_id: input.client_id,
        }),
      )
    },
    async status(id, status) {
      check(await db.rpc('set_request_status', { p_id: id, p_status: status }))
    },
    async upload(kitchenId, file) {
      const path = `${kitchenId}/${crypto.randomUUID()}.${photoExtension(file)}`
      check(
        await db.storage
          .from('dish-photos')
          .upload(path, file, { contentType: file.type, cacheControl: '0', upsert: false }),
      )
      return path
    },
    async photo(path) {
      const blob = check(await db.storage.from('dish-photos').download(path))
      if (!blob) throw new Error('invalidPhoto')
      return URL.createObjectURL(blob)
    },
    async removePhoto(path) {
      check(await db.storage.from('dish-photos').remove([path]))
    },
    async unlock(code, name, chef) {
      const result = check(
        await db.rpc('unlock_kitchen', { p_code: code, p_name: name, p_as_chef: chef }),
      )
      if (result?.error) throw new Error(result.error)
    },
    async changeCodes(kitchenCode, chefPassword) {
      check(
        await db.rpc('change_access_codes', {
          p_kitchen_code: kitchenCode || null,
          p_chef_password: chefPassword || null,
        }),
      )
    },
    async removeMember(userId) {
      check(await db.rpc('remove_member', { p_user_id: userId }))
    },
    async saveKitchen(kitchen) {
      check(
        await db
          .from('kitchens')
          .update({ name: kitchen.name, announcement: kitchen.announcement })
          .eq('id', kitchen.id),
      )
    },
    async saveName(userId, name) {
      check(await db.rpc('set_display_name', { p_name: name }))
    },
    async saveLanguage(language, onlyIfUnset = false) {
      return check(
        await db.rpc('set_language_preference', {
          p_language: language,
          p_only_if_unset: onlyIfUnset,
        }),
      )
    },
    async exportData() {
      const auth = await db.auth.getUser()
      if (auth.error) throw auth.error
      const user = auth.data.user
      if (!user) throw new Error('not_member')
      const data = await repository.load(user.id)
      if (!data || data.members.find((m) => m.user_id === user.id)?.role !== 'chef')
        throw new Error('not_allowed')
      return data
    },
    subscribe(callback) {
      const channel = db
        .channel('family-kitchen')
        .on('postgres_changes', { event: '*', schema: 'public' }, callback)
        .subscribe()
      return () => {
        void db.removeChannel(channel)
      }
    },
  }
  return repository
}
export async function downloadBackup(repo: Repository) {
  const data = (await repo.exportData()) as KitchenData
  const photos: Record<string, string> = {}
  for (const path of new Set(data.dishes.map((d) => d.photo_path))) {
    const url = await repo.photo(path)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error('invalidPhoto')
      const blob = await response.blob()
      photos[path] = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } finally {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }
  // Kitchen codes and chef password hashes are never part of portable backups.
  return {
    format: 'snoicafe-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    kitchen: data.kitchen,
    categories: data.categories,
    dishes: data.dishes,
    requests: data.requests,
    members: data.members,
    chef_profiles: data.chef_profiles,
    customer_profiles: data.customer_profiles,
    photos,
  }
}
export async function restoreMenu(repo: Repository, kitchenId: string, file: File) {
  if (file.size > 100 * 1024 * 1024) throw new Error('invalidBackup')
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('invalidBackup')
  }
  const { categories, dishes, photos } = validateMenuBackup(parsed)
  // Decode and resize every image before creating records. Invalid archives make no writes.
  const prepared = new Map<string, Blob>()
  for (const path of new Set(dishes.map((d) => d.photo_path))) {
    try {
      const blob = await (await fetch(photos[path])).blob()
      prepared.set(path, await preparePhoto(new File([blob], 'restore', { type: blob.type })))
    } catch {
      throw new Error('invalidBackup')
    }
  }
  const ids = new Map<string, string>()
  for (const category of categories) {
    const id = crypto.randomUUID()
    ids.set(category.id, id)
    await repo.saveCategory({
      id,
      kitchen_id: kitchenId,
      name: category.name,
      name_zh: category.name_zh || '',
      emoji: category.emoji || '🍽️',
      position: category.position || 0,
    })
  }
  for (const dish of dishes) {
    const path = await repo.upload(kitchenId, prepared.get(dish.photo_path)!)
    try {
      await repo.saveDish({
        id: crypto.randomUUID(),
        kitchen_id: kitchenId,
        category_id: ids.get(dish.category_id || '') || null,
        name: dish.name,
        name_zh: dish.name_zh || '',
        description: dish.description || '',
        description_zh: dish.description_zh || '',
        price: dish.price,
        photo_path: path,
        options: dish.options,
        available: false,
        archived: dish.archived === true,
      })
    } catch (error) {
      await repo.removePhoto(path).catch(() => {})
      throw error
    }
  }
}
