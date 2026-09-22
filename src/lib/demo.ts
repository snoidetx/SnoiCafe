import type { Dish, KitchenData, Repository } from '../types'
const K = '00000000-0000-4000-8000-000000000001'
export const DEMO_CHEF = '00000000-0000-4000-8000-000000000002'
export const DEMO_CUSTOMER = '00000000-0000-4000-8000-000000000003'
const now = () => new Date().toISOString()
const categories = [
  { id: 'western', name: 'Western', name_zh: '西餐', emoji: '🍝' },
  { id: 'chinese', name: 'Chinese', name_zh: '中餐', emoji: '🥟' },
  { id: 'snacks', name: 'Snacks', name_zh: '小吃', emoji: '🥐' },
  { id: 'drinks', name: 'Drinks', name_zh: '饮品', emoji: '🍵' },
].map((c, position) => ({ ...c, position, kitchen_id: K }))
const base = {
  kitchen_id: K,
  description_zh: '',
  name_zh: '',
  available: true,
  archived: false,
  created_at: now(),
  options: [],
}
const dishes: Dish[] = [
  {
    ...base,
    id: 'pasta',
    name: 'Creamy mushroom pasta',
    name_zh: '奶油蘑菇意面',
    description: 'Mushrooms, parmesan & a little extra love.',
    description_zh: '浓郁奶油与蘑菇，加一点点爱。',
    category_id: 'western',
    price: 18,
    photo_path: 'demo:pasta',
    options: [{ name: 'Portion / 份量', values: ['Regular / 标准', 'Small / 小份'] }],
  },
  {
    ...base,
    id: 'chicken',
    name: 'Lemon herb chicken',
    name_zh: '柠檬香草鸡',
    description: 'Golden, juicy chicken with rosemary.',
    description_zh: '迷迭香与柠檬，鲜嫩多汁。',
    category_id: 'western',
    price: 24,
    photo_path: 'demo:chicken',
  },
  {
    ...base,
    id: 'tomato',
    name: 'Tomato & egg stir-fry',
    name_zh: '番茄炒蛋',
    description: 'The taste of home, over a bowl of rice.',
    description_zh: '酸甜番茄与嫩滑鸡蛋，家的味道。',
    category_id: 'chinese',
    price: 12,
    photo_path: 'demo:tomato',
  },
  {
    ...base,
    id: 'noodles',
    name: 'Spring onion noodles',
    name_zh: '葱油拌面',
    description: 'A simple bowl that always hits the spot.',
    description_zh: '葱香四溢，一碗就满足。',
    category_id: 'chinese',
    price: 10,
    photo_path: 'demo:noodles',
    options: [{ name: 'Spice / 辣度', values: ['Mild / 微辣', 'Not spicy / 不辣'] }],
  },
  {
    ...base,
    id: 'pancakes',
    name: 'Strawberry pancakes',
    name_zh: '草莓松饼',
    description: 'Fluffy little pancakes for a sweet afternoon.',
    description_zh: '蓬松小松饼，甜甜的下午。',
    category_id: 'snacks',
    price: 16,
    photo_path: 'demo:pancakes',
  },
  {
    ...base,
    id: 'tea',
    name: 'Peach iced tea',
    name_zh: '蜜桃冰茶',
    description: 'Fresh peaches, tea & a splash of sunshine.',
    description_zh: '清甜蜜桃，一口夏天。',
    category_id: 'drinks',
    price: 8,
    photo_path: 'demo:tea',
    options: [{ name: 'Temperature / 温度', values: ['Iced / 冰', 'Hot / 热'] }],
  },
]
function seed(): KitchenData {
  return {
    kitchen: { id: K, name: 'SnoiCafe', announcement: '' },
    members: [
      { kitchen_id: K, user_id: DEMO_CHEF, display_name: 'Snoi', role: 'chef' },
      { kitchen_id: K, user_id: DEMO_CUSTOMER, display_name: 'Alex', role: 'customer' },
    ],
    categories: structuredClone(categories),
    dishes: structuredClone(dishes),
    requests: [],
  }
}
export function resetDemo() {
  localStorage.removeItem('snoicafe-demo-v2')
  location.reload()
}
export function createDemoRepository(getUser: () => string): Repository {
  let data = seed()
  try {
    const stored = JSON.parse(localStorage.getItem('snoicafe-demo-v2') || 'null')
    if (stored?.kitchen?.id === K && Array.isArray(stored.dishes) && Array.isArray(stored.requests))
      data = stored
  } catch {
    /* Ignore damaged preview storage. */
  }
  const listeners = new Set<() => void>(),
    photos = new Map<string, string>()
  const persist = () => {
    localStorage.setItem('snoicafe-demo-v2', JSON.stringify(data))
    listeners.forEach((f) => f())
  }
  const requireChef = () => {
    if (getUser() !== DEMO_CHEF) throw new Error('not_allowed')
  }
  return {
    async load() {
      return structuredClone(data)
    },
    async saveDish(dish) {
      requireChef()
      const existing = data.dishes.find((d) => d.id === dish.id)
      data.dishes = existing
        ? data.dishes.map((d) => (d.id === dish.id ? { ...d, ...dish } : d))
        : [...data.dishes, { ...dish, created_at: now() }]
      persist()
    },
    async saveCategory(category) {
      requireChef()
      data.categories = data.categories.some((c) => c.id === category.id)
        ? data.categories.map((c) => (c.id === category.id ? category : c))
        : [...data.categories, category]
      persist()
    },
    async deleteCategory(id) {
      requireChef()
      data.categories = data.categories.filter((c) => c.id !== id)
      data.dishes = data.dishes.map((d) => (d.category_id === id ? { ...d, category_id: null } : d))
      persist()
    },
    async order(input) {
      if (data.requests.some((r) => r.client_id === input.client_id)) return
      const dish = data.dishes.find((d) => d.id === input.dish_id)
      if (input.dish_id && (!dish || dish.archived || !dish.available))
        throw new Error('dish_unavailable')
      data.requests.unshift({
        id: crypto.randomUUID(),
        ...input,
        created_by: getUser(),
        customer_name: data.members.find((m) => m.user_id === getUser())?.display_name || 'Alex',
        name: dish?.name || input.name,
        name_zh: dish?.name_zh || '',
        price: dish?.price || 0,
        status: 'pending',
        created_at: now(),
        completed_at: null,
      })
      persist()
    },
    async status(id, status) {
      const r = data.requests.find((r) => r.id === id)
      if (!r) throw new Error('invalid_request')
      if (status === 'cancelled' && r.created_by === getUser()) {
      } else requireChef()
      r.status = status
      r.completed_at = status === 'completed' ? now() : null
      persist()
    },
    async upload(kitchenId, file) {
      requireChef()
      const path = `${kitchenId}/${crypto.randomUUID()}.webp`
      const value = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(file)
      })
      photos.set(path, value)
      localStorage.setItem('snoicafe-photo:' + path, value)
      return path
    },
    async photo(path) {
      const photo = photos.get(path) || localStorage.getItem('snoicafe-photo:' + path)
      if (!photo) throw new Error('invalidPhoto')
      return photo
    },
    async removePhoto(path) {
      photos.delete(path)
      localStorage.removeItem('snoicafe-photo:' + path)
    },
    async unlock() {},
    async changeCodes() {
      requireChef()
    },
    async removeMember(userId) {
      requireChef()
      if (userId === DEMO_CHEF) throw new Error('not_allowed')
      data.members = data.members.filter((m) => m.user_id !== userId)
      persist()
    },
    async saveKitchen(kitchen) {
      requireChef()
      data.kitchen = kitchen
      persist()
    },
    async saveName(userId, name) {
      data.members = data.members.map((m) =>
        m.user_id === userId ? { ...m, display_name: name } : m,
      )
      persist()
    },
    async exportData() {
      requireChef()
      return structuredClone(data)
    },
    subscribe(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
  }
}
