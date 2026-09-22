import { expect, it } from 'vitest'
import { validateMenuBackup } from '../src/lib/backup'
const archive = () => ({
  format: 'snoicafe-backup',
  version: 1,
  categories: [{ id: 'cat', name: 'Drinks', name_zh: '饮品', emoji: '🍵', position: 0 }],
  dishes: [
    {
      name: 'Tea',
      name_zh: '茶',
      description: '',
      description_zh: '',
      price: 5,
      category_id: 'cat',
      photo_path: 'kitchen/photo.webp',
      options: [{ name: 'Temperature', values: ['Hot', 'Cold'] }],
    },
  ],
  photos: { 'kitchen/photo.webp': 'data:image/webp;base64,UklGRg==' },
})
it('accepts a complete portable menu before attempting photo decoding', () =>
  expect(validateMenuBackup(archive()).dishes).toHaveLength(1))
it('rejects invalid shapes, remote images, bad categories, and malformed options before writes', () => {
  for (const value of [
    null,
    [],
    {},
    { ...archive(), photos: { 'kitchen/photo.webp': 'https://example.com/photo.webp' } },
    { ...archive(), categories: [] },
    { ...archive(), dishes: [{ ...archive().dishes[0], price: -1 }] },
    {
      ...archive(),
      dishes: [
        { ...archive().dishes[0], options: [{ name: 'Temperature', values: ['Hot', 'Hot'] }] },
      ],
    },
  ])
    expect(() => validateMenuBackup(value)).toThrow('invalidBackup')
})

it('backs up Chinese-only dishes/categories and rejects names missing in both languages', () => {
  const data = archive()
  data.categories[0].name = ''
  data.dishes[0].name = ''
  expect(validateMenuBackup(data).dishes[0].name_zh).toBe('茶')
  data.dishes[0].name_zh = ' '
  expect(() => validateMenuBackup(data)).toThrow('invalidBackup')
  data.dishes[0].name_zh = '茶'
  data.categories[0].name_zh = ''
  expect(() => validateMenuBackup(data)).toThrow('invalidBackup')
})
