import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Requests } from '../src/components/Requests'
import type { FoodRequest, Member, Status } from '../src/types'

const request: FoodRequest = {
  id: 'request',
  kitchen_id: 'kitchen',
  dish_id: null,
  created_by: 'customer',
  customer_name: 'Alex',
  customer_profile_id: 'alex',
  name: 'Dumplings',
  name_zh: '',
  quantity: 1,
  price: 0,
  selected_options: {},
  notes: '',
  status: 'pending',
  created_at: '2026-09-22T12:00:00Z',
  completed_at: null,
  client_id: 'client',
}
const member: Member = {
  user_id: 'customer',
  kitchen_id: 'kitchen',
  display_name: 'Alex',
  role: 'customer',
  customer_profile_id: 'alex',
}
const render = (chef: boolean, status: Status = 'pending') =>
  renderToStaticMarkup(
    createElement(Requests, {
      requests: [{ ...request, status }],
      chef,
      history: status !== 'pending',
      member,
      disabled: false,
      onStatus: async () => {},
      onDelete: async () => {},
      onBrowse: () => {},
    }),
  )

describe('wishlist actions', () => {
  it('offers chefs separate delete, cancel and complete actions for pending wishes', () => {
    const markup = render(true)
    expect(markup).toContain('aria-label="Delete Dumplings"')
    expect(markup).toContain('Cancel request')
    expect(markup).toContain('Served!')
  })
  it('offers deletion for cancelled history only to chefs', () => {
    expect(render(true, 'cancelled')).toContain('aria-label="Delete Dumplings"')
    expect(render(true, 'cancelled')).not.toContain('Cancel request')
    expect(render(false, 'cancelled')).not.toContain('aria-label="Delete')
  })
  it('retains customer cancellation without exposing deletion, and protects completed history', () => {
    expect(render(false)).toContain('Cancel request')
    expect(render(false)).not.toContain('aria-label="Delete')
    expect(render(true, 'completed')).not.toContain('aria-label="Delete')
    expect(render(true, 'completed')).toContain('Undo completion')
  })
})
