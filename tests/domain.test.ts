import { describe, expect, it } from 'vitest'
import {
  parseOptions,
  localized,
  localizedNames,
  description,
  memberProfile,
  filterDishes,
  kitchenPeople,
  ownsRequest,
} from '../src/lib/domain'
import { en, zh, translate } from '../src/i18n'
import type { Dish, KitchenData, Member } from '../src/types'
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

describe('family profiles and devices', () => {
  it('counts each role and named profile once across devices, including offline profiles', () => {
    const data = {
      kitchen: { id: 'k', name: 'Kitchen', announcement: '' },
      chef_profiles: [
        { id: 'snoi', kitchen_id: 'k', display_name: 'Snoi' },
        { id: 'grandma', kitchen_id: 'k', display_name: 'Grandma' },
      ],
      customer_profiles: [{ id: 'alex', kitchen_id: 'k', display_name: 'Alex' }],
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
        {
          kitchen_id: 'k',
          user_id: 'alex1',
          display_name: 'Alex',
          role: 'customer',
          customer_profile_id: 'alex',
        },
        {
          kitchen_id: 'k',
          user_id: 'alex2',
          display_name: 'Alex',
          role: 'customer',
          customer_profile_id: 'alex',
        },
      ],
      categories: [],
      dishes: [],
      requests: [],
    } satisfies KitchenData
    const people = kitchenPeople(data)
    expect(people).toHaveLength(3)
    expect(people.find((p) => p.id === 'chef:snoi')?.sessions).toHaveLength(2)
    expect(people.find((p) => p.id === 'chef:grandma')?.sessions).toHaveLength(0)
    expect(people.filter((p) => p.role === 'customer')).toHaveLength(1)
    expect(people.find((p) => p.id === 'customer:alex')?.sessions).toHaveLength(2)
  })
})

describe('request ownership across devices', () => {
  it('uses stable profile IDs rather than a nickname or the original device', () => {
    const member: Member = {
      kitchen_id: 'k',
      user_id: 'phone',
      display_name: 'Alex',
      role: 'customer',
      customer_profile_id: 'alex',
    }
    const request = { created_by: 'laptop', customer_profile_id: 'alex' }
    expect(ownsRequest(request, member)).toBe(true)
    expect(ownsRequest(request, { ...member, display_name: 'Sunny' })).toBe(true)
    expect(
      ownsRequest(request, { ...member, user_id: 'laptop', customer_profile_id: 'other' }),
    ).toBe(false)
    expect(ownsRequest(request, { ...member, role: 'chef' })).toBe(false)
    expect(ownsRequest(request)).toBe(false)
    expect(ownsRequest({ created_by: 'phone', customer_profile_id: null }, member)).toBe(true)
    expect(ownsRequest({ created_by: 'laptop', customer_profile_id: null }, member)).toBe(false)
  })
})

describe('primary menu language', () => {
  it('requires the selected language while allowing the other name to be empty', () => {
    const form = new FormData()
    form.set('name_zh', '  番茄炒蛋  ')
    expect(localizedNames(form, 'zh')).toEqual({ name: '', name_zh: '番茄炒蛋' })
    expect(() => localizedNames(form, 'en')).toThrow('emptyName')
    form.set('name', 'Tomato eggs')
    expect(localizedNames(form, 'en').name).toBe('Tomato eggs')
    form.set('name_zh', '   ')
    expect(() => localizedNames(form, 'zh')).toThrow('emptyName')
  })
  it('uses the available translation in either language without fabricating English', () => {
    expect(localized({ name: '', name_zh: '茶' }, 'en')).toBe('茶')
    expect(localized({ name: 'Tea', name_zh: '' }, 'zh')).toBe('Tea')
    expect(description({ description: '', description_zh: '暖暖的' } as Dish, 'en')).toBe('暖暖的')
    expect(description({ description: 'Warm', description_zh: '' } as Dish, 'zh')).toBe('Warm')
  })
  it('selects the current role’s language preference even for the same display name', () => {
    const data = {
      members: [
        { user_id: '1', display_name: 'Alex', role: 'chef', chef_profile_id: 'c' },
        { user_id: '2', display_name: 'Alex', role: 'customer', customer_profile_id: 'g' },
      ],
      chef_profiles: [{ id: 'c', preferred_language: 'zh' }],
      customer_profiles: [{ id: 'g', preferred_language: 'en' }],
    } as KitchenData
    expect(memberProfile(data, '1')?.preferred_language).toBe('zh')
    expect(memberProfile(data, '2')?.preferred_language).toBe('en')
    expect(memberProfile(data, 'outsider')).toBeUndefined()
  })
})
