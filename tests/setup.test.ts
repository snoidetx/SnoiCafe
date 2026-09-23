import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { supabaseTestSchema } from './helpers/supabase'

const setup = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8')
let db: PGlite

beforeEach(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(supabaseTestSchema)
}, 30000)
afterEach(async () => {
  await db.close()
})

async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec('set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  try {
    return await run()
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub','',false)")
  }
}

async function bootstrap() {
  // These intentionally short Unicode credentials require the latest schema.
  return (
    await db.query<{ id: string }>("select public.bootstrap_kitchen('厨','家','Test kitchen') id")
  ).rows[0].id
}

describe('single-file database setup', () => {
  it('installs the current private kitchen and supports the family ordering flow', async () => {
    await db.exec(setup)
    const kitchen = await bootstrap()
    const chef = randomUUID(),
      secondChef = randomUUID()
    const guest = randomUUID(),
      secondGuest = randomUUID(),
      outsider = randomUUID()
    for (const id of [chef, secondChef, guest, secondGuest, outsider]) {
      await db.query('insert into auth.users values($1)', [id])
    }

    for (const [first, second, isChef] of [
      [chef, secondChef, true],
      [guest, secondGuest, false],
    ] as const) {
      for (const [id, name] of [
        [first, 'Family'],
        [second, ' family '],
      ]) {
        await asUser(id, async () => {
          expect(
            (
              await db.query<{ result: unknown }>('select public.unlock_kitchen($1,$2,$3) result', [
                isChef ? '厨' : '家',
                name,
                isChef,
              ])
            ).rows[0].result,
          ).toEqual({ ok: true })
          expect(
            (
              await db.query<{ language: string }>(
                'select public.set_language_preference($1,$2) language',
                [id === first ? 'zh' : 'en', id !== first],
              )
            ).rows[0].language,
          ).toBe('zh')
        })
      }
    }
    expect((await db.query('select id from public.chef_profiles')).rows).toHaveLength(1)
    expect((await db.query('select id from public.customer_profiles')).rows).toHaveLength(1)

    const photoPath = `${kitchen}/dish.webp`
    const dish = await asUser(chef, async () => {
      const category = (
        await db.query<{ id: string }>(
          "insert into public.categories(kitchen_id,name,name_zh) values($1,'','家常菜') returning id",
          [kitchen],
        )
      ).rows[0].id
      await db.query("insert into storage.objects(bucket_id,name) values('dish-photos',$1)", [
        photoPath,
      ])
      return (
        await db.query<{ id: string }>(
          "insert into public.dishes(kitchen_id,category_id,name,name_zh,photo_path) values($1,$2,'','饺子',$3) returning id",
          [kitchen, category, photoPath],
        )
      ).rows[0].id
    })
    expect(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='dish-photos'",
        )
      ).rows[0].public,
    ).toBe(false)
    await asUser(outsider, async () => {
      for (const table of [
        'public.kitchens',
        'public.dishes',
        'public.requests',
        'storage.objects',
      ]) {
        expect((await db.query(`select * from ${table}`)).rows).toEqual([])
      }
      await expect(db.query("select public.bootstrap_kitchen('x','y')")).rejects.toMatchObject({
        code: '42501',
      })
    })

    const order = await asUser(
      guest,
      async () =>
        (
          await db.query<{ id: string; name_zh: string }>(
            "select (public.place_request($1,$2,'',1,'','{}',$3)).*",
            [kitchen, dish, randomUUID()],
          )
        ).rows[0],
    )
    expect(order.name_zh).toBe('饺子')
    await asUser(guest, async () => {
      await expect(
        db.query('select public.delete_wishlist_request($1)', [order.id]),
      ).rejects.toMatchObject({ code: '42501' })
    })
    await asUser(secondGuest, () =>
      db.query("select public.set_request_status($1,'cancelled')", [order.id]),
    )
    await asUser(secondChef, () =>
      db.query('select public.delete_wishlist_request($1)', [order.id]),
    )
    expect((await db.query('select id from public.requests')).rows).toEqual([])
    expect((await db.query('select id from public.dishes')).rows).toEqual([{ id: dish }])
    expect((await db.query('select name from storage.objects')).rows).toEqual([{ name: photoPath }])

    const wish = await asUser(
      guest,
      async () =>
        (
          await db.query<{ id: string }>(
            "select (public.place_request($1,null,'蛋糕',1,'','{}',$2)).*",
            [kitchen, randomUUID()],
          )
        ).rows[0],
    )
    await asUser(chef, async () => {
      await db.query("select public.set_request_status($1,'completed')", [wish.id])
      await expect(
        db.query('select public.delete_wishlist_request($1)', [wish.id]),
      ).rejects.toThrow('request_not_deletable')
    })
    expect((await db.query('select id,status from public.requests')).rows).toEqual([
      { id: wish.id, status: 'completed' },
    ])
  }, 30000)

  it.each([false, true])(
    'refuses reinstallation and preserves existing data (provisioned=%s)',
    async (provisioned) => {
      await db.exec(setup)
      if (provisioned) await bootstrap()
      const before = (await db.query('select * from public.kitchens')).rows
      const categories = (await db.query('select * from public.categories order by id')).rows
      await expect(db.exec(setup)).rejects.toThrow('SnoiCafe is already installed')
      await db.exec('rollback')
      expect((await db.query('select * from public.kitchens')).rows).toEqual(before)
      expect((await db.query('select * from public.categories order by id')).rows).toEqual(
        categories,
      )
    },
    30000,
  )

  it('rolls back earlier migrations if a later migration fails', async () => {
    // An unrelated table causes a collision in migration 004, after 001–003 ran.
    await db.exec(
      "create table public.customer_profiles(existing_data text); insert into public.customer_profiles values('keep me');",
    )
    await expect(db.exec(setup)).rejects.toThrow(/does not exist/)
    await db.exec('rollback')
    expect(
      (
        await db.query(
          "select to_regclass('public.kitchens') as kitchen, to_regclass('public.chef_profiles') as chefs",
        )
      ).rows,
    ).toEqual([{ kitchen: null, chefs: null }])
    expect((await db.query('select * from public.customer_profiles')).rows).toEqual([
      { existing_data: 'keep me' },
    ])
    expect((await db.query('select * from storage.buckets')).rows).toEqual([])
  }, 30000)
})
