import { describe, expect, it } from 'vitest'
import { parseOptions, localized, filterDishes, kitchenPeople } from '../src/lib/domain'
import { en, zh, translate } from '../src/i18n'
import type { Dish, KitchenData } from '../src/types'
describe('bilingual menu', () => {
  it('keeps every UI string translated and interpolates both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(translate('zh', 'members', { n: 3 })).not.toContain('{n}')
    expect(localized({ name: 'Noodles', name_zh: '' }, 'zh')).toBe('Noodles')
  })
  it('finds dishes in either language and hides archived dishes', () => {
    const dishes = [
      {
        name: 'Noodles',
        name_zh: '面条',
        description: 'Hot',
        description_zh: '热',
        archived: false,
      },
      { name: 'Noodles', name_zh: '面条', archived: true },
    ] as Dish[]
    expect(filterDishes(dishes, '面条', 'en')).toHaveLength(1)
    expect(filterDishes(dishes, 'noodles', 'zh')).toHaveLength(1)
  })
  it('parses English and Chinese options, rejecting ambiguous duplicate groups', () => {
    expect(parseOptions('Temperature: Hot, Cold\n辣度：微辣，不辣')).toEqual([
      { name: 'Temperature', values: ['Hot', 'Cold'] },
      { name: '辣度', values: ['微辣', '不辣'] },
    ])
    for (const value of ['Temp: Hot, Hot', 'Temp: Hot\nTemp: Cold', 'missing delimiter', ' : Hot'])
      expect(() => parseOptions(value)).toThrow('invalidOptions')
  })
})

describe('people and chef devices', () => {
  it('counts named chef profiles once, including offline chefs, and never merges customer names', () => {
    const data = {
      kitchen: { id: 'k', name: 'Kitchen', announcement: '' },
      chef_profiles: [
        { id: 'snoi', kitchen_id: 'k', display_name: 'Snoi' },
        { id: 'grandma', kitchen_id: 'k', display_name: 'Grandma' },
      ],
      members: [
        {
          kitchen_id: 'k',
          user_id: 'phone',
          display_name: 'Snoi',
          role: 'chef',
          chef_profile_id: 'snoi',
        },
        {
          kitchen_id: 'k',
          user_id: 'laptop',
          display_name: 'Snoi',
          role: 'chef',
          chef_profile_id: 'snoi',
        },
        { kitchen_id: 'k', user_id: 'alex1', display_name: 'Alex', role: 'customer' },
        { kitchen_id: 'k', user_id: 'alex2', display_name: 'Alex', role: 'customer' },
      ],
      categories: [],
      dishes: [],
      requests: [],
    } satisfies KitchenData
    const people = kitchenPeople(data)
    expect(people).toHaveLength(4)
    expect(people.find((p) => p.id === 'snoi')?.sessions).toHaveLength(2)
    expect(people.find((p) => p.id === 'grandma')?.sessions).toHaveLength(0)
    expect(people.filter((p) => p.role === 'customer')).toHaveLength(2)
  })
})
