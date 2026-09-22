export type Language = 'en' | 'zh'
export type Status = 'pending' | 'completed' | 'cancelled'
export type Tab = 'menu' | 'wishlist' | 'history'
export interface Kitchen {
  id: string
  name: string
  announcement: string
}
export interface Member {
  kitchen_id: string
  user_id: string
  display_name: string
  role: 'chef' | 'customer'
  chef_profile_id?: string | null
}
export interface ChefProfile {
  id: string
  kitchen_id: string
  display_name: string
}
export interface Category {
  id: string
  kitchen_id: string
  name: string
  name_zh: string
  emoji: string
  position: number
}
export interface DishOption {
  name: string
  values: string[]
}
export interface Dish {
  id: string
  kitchen_id: string
  category_id: string | null
  name: string
  name_zh: string
  description: string
  description_zh: string
  price: number
  photo_path: string
  options: DishOption[]
  available: boolean
  archived: boolean
  created_at: string
}
export interface FoodRequest {
  id: string
  kitchen_id: string
  dish_id: string | null
  created_by: string
  customer_name: string
  name: string
  name_zh: string
  quantity: number
  price: number
  selected_options: Record<string, string>
  notes: string
  status: Status
  created_at: string
  completed_at: string | null
  client_id: string
}
export interface KitchenData {
  kitchen: Kitchen
  members: Member[]
  chef_profiles?: ChefProfile[]
  categories: Category[]
  dishes: Dish[]
  requests: FoodRequest[]
}
export interface OrderInput {
  kitchen_id: string
  dish_id: string | null
  name: string
  quantity: number
  notes: string
  selected_options: Record<string, string>
  client_id: string
}
export type DishInput = Omit<Dish, 'created_at'>
export interface Repository {
  load(userId: string): Promise<KitchenData | null>
  saveDish(dish: DishInput): Promise<void>
  saveCategory(category: Category): Promise<void>
  deleteCategory(id: string): Promise<void>
  order(input: OrderInput): Promise<void>
  status(id: string, status: Status): Promise<void>
  upload(kitchenId: string, file: Blob): Promise<string>
  photo(path: string): Promise<string>
  removePhoto(path: string): Promise<void>
  unlock(code: string, name: string, chef: boolean): Promise<void>
  changeCodes(kitchenCode: string, chefPassword: string): Promise<void>
  removeMember(userId: string): Promise<void>
  saveKitchen(kitchen: Kitchen): Promise<void>
  saveName(userId: string, name: string): Promise<void>
  exportData(): Promise<unknown>
  subscribe(callback: () => void): () => void
}
