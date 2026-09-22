import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Execute the actual migration in PostgreSQL, with minimal Supabase Auth/Storage scaffolding.
const db = new PGlite({ extensions: { pgcrypto } })
const credentialMigration = readFileSync(
  new URL('../supabase/migrations/202609220002_unrestricted_credentials.sql', import.meta.url),
  'utf8',
)
const profileMigration = readFileSync(
  new URL('../supabase/migrations/202609220003_chef_profiles.sql', import.meta.url),
  'utf8',
)
const customerMigration = readFileSync(
  new URL('../supabase/migrations/202609220004_customer_profiles.sql', import.meta.url),
  'utf8',
)
const languageMigration = readFileSync(
  new URL('../supabase/migrations/202609220005_language_preferences.sql', import.meta.url),
  'utf8',
)
const deleteRequestMigration = readFileSync(
  new URL('../supabase/migrations/202609220006_delete_wishlist_requests.sql', import.meta.url),
  'utf8',
)
const cancelledDeletionMigration = readFileSync(
  new URL('../supabase/migrations/202609230007_delete_cancelled_requests.sql', import.meta.url),
  'utf8',
)
let upgradedCustomers: {
  profiles: number
  distinctProfiles: number
  linked: boolean
  chefUnlinked: boolean
  snapshot: string
  stable: boolean
}
let upgraded: {
  profiles: number
  sessions: number
  distinctProfiles: number
  requestName: string
  stable: boolean
}
const chef = randomUUID(),
  guest = randomUUID(),
  other = randomUUID(),
  stranger = randomUUID()
let kitchen: string, category: string, dish: string
const code = 'family-supper-2026',
  password = 'chef-test-password-2026'
async function asUser<T>(id: string, run: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  try {
    return await run()
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub','',false)")
  }
}
async function unlock(id: string, value = code, isChef = false, name = 'Family') {
  return asUser(id, async () => {
    const r = await db.query<{ result: { ok?: boolean; error?: string } }>(
      'select public.unlock_kitchen($1,$2,$3) result',
      [value, name, isChef],
    )
    return r.rows[0].result
  })
}
async function order(
  id = guest,
  client = randomUUID(),
  options: unknown = { Temperature: 'Hot' },
  dishId: string | null = dish,
) {
  return asUser(id, async () => {
    const r = await db.query<{ id: string; price: string; name: string }>(
      `select (public.place_request($1,$2,'Handmade dumplings',2,'Less salt',$3,$4)).*`,
      [kitchen, dishId, JSON.stringify(options), client],
    )
    return r.rows[0]
  })
}
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated,anon;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
  `)
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202609220001_kitchen.sql', import.meta.url),
      'utf8',
    ),
  )
  for (const id of [chef, guest, other, stranger])
    await db.query('insert into auth.users values($1)', [id])
  kitchen = (
    await db.query<{ id: string }>('select public.bootstrap_kitchen($1,$2) id', [password, code])
  ).rows[0].id
  // Upgrade a populated installation, then prove the update can be re-run safely.
  await db.exec(credentialMigration)
  await db.exec(credentialMigration)
  await db.query(
    "insert into public.members(kitchen_id,user_id,display_name,role) values($1,$2,'Snoi','chef'),($1,$3,' snoi ','chef')",
    [kitchen, chef, stranger],
  )
  const oldRequest = await order(chef, randomUUID(), {}, null)
  await db.exec(profileMigration)
  const profiles = (
    await db.query<{ id: string }>('select id from public.chef_profiles order by id')
  ).rows
  await db.exec(profileMigration)
  const sessions = (
    await db.query<{ chef_profile_id: string }>('select chef_profile_id from public.members')
  ).rows
  upgraded = {
    profiles: profiles.length,
    sessions: sessions.length,
    distinctProfiles: new Set(sessions.map((m) => m.chef_profile_id)).size,
    requestName: (
      await db.query<{ customer_name: string }>(
        'select customer_name from public.requests where id=$1',
        [oldRequest.id],
      )
    ).rows[0].customer_name,
    stable:
      JSON.stringify(profiles) ===
      JSON.stringify((await db.query('select id from public.chef_profiles order by id')).rows),
  }
  await db.query(
    "insert into public.members(kitchen_id,user_id,display_name,role) values($1,$2,'Alex','customer'),($1,$3,' alex ','customer')",
    [kitchen, guest, other],
  )
  const oldCustomerRequest = await order(guest, randomUUID(), {}, null)
  await db.exec(customerMigration)
  const customerProfiles = (await db.query('select id from public.customer_profiles order by id'))
    .rows
  await db.exec(customerMigration)
  const customerSessions = (
    await db.query<{ customer_profile_id: string }>(
      "select customer_profile_id from public.members where role='customer'",
    )
  ).rows
  const oldCustomer = (
    await db.query<{ customer_profile_id: string; customer_name: string }>(
      'select customer_profile_id,customer_name from public.requests where id=$1',
      [oldCustomerRequest.id],
    )
  ).rows[0]
  upgradedCustomers = {
    profiles: customerProfiles.length,
    distinctProfiles: new Set(customerSessions.map((m) => m.customer_profile_id)).size,
    linked: oldCustomer.customer_profile_id === customerSessions[0].customer_profile_id,
    chefUnlinked:
      (
        await db.query<{ customer_profile_id: string | null }>(
          'select customer_profile_id from public.requests where id=$1',
          [oldRequest.id],
        )
      ).rows[0].customer_profile_id === null,
    snapshot: oldCustomer.customer_name,
    stable:
      JSON.stringify(customerProfiles) ===
      JSON.stringify((await db.query('select id from public.customer_profiles order by id')).rows),
  }
  await db.exec(languageMigration)
  await db.exec(languageMigration)
  const existingRequests = (await db.query('select id from public.requests order by id')).rows
  await db.exec(deleteRequestMigration)
  await db.exec(deleteRequestMigration)
  await db.exec(cancelledDeletionMigration)
  await db.exec(cancelledDeletionMigration)
  expect((await db.query('select id from public.requests order by id')).rows).toEqual(
    existingRequests,
  )
}, 30000)
beforeEach(async () => {
  await db.exec(
    'delete from public.requests;delete from public.dishes;delete from public.categories;delete from public.members;delete from public.chef_profiles;delete from public.customer_profiles;delete from storage.objects;delete from private.unlock_attempts;',
  )
  await db.query(
    "update private.access_secrets set kitchen_hash=extensions.crypt($1,extensions.gen_salt('bf',4)),chef_hash=extensions.crypt($2,extensions.gen_salt('bf',4))",
    [code, password],
  )
  for (const [id, role, name] of [
    [chef, 'chef', 'chef'],
    [guest, 'customer', 'Alex'],
    [other, 'customer', 'Blair'],
  ])
    await db.query(
      'insert into public.members(kitchen_id,user_id,display_name,role) values($1,$2,$3,$4)',
      [kitchen, id, name, role],
    )
  category = randomUUID()
  dish = randomUUID()
  await db.query("insert into public.categories(id,kitchen_id,name) values($1,$2,'Chinese')", [
    category,
    kitchen,
  ])
  await db.query(
    `insert into public.dishes(id,kitchen_id,category_id,name,name_zh,price,photo_path,options)
    values($1,$2,$3,'Noodles','面条',12.50,$4,'[{"name":"Temperature","values":["Hot","Cold"]}]')`,
    [dish, kitchen, category, `${kitchen}/photo.webp`],
  )
  await db.query("insert into storage.objects(bucket_id,name) values('dish-photos',$1)", [
    `${kitchen}/photo.webp`,
  ])
})
afterAll(async () => {
  await db.close()
})
describe('private kitchen access', () => {
  it('hides menu, members, history, and photos until the code is verified', async () => {
    await asUser(stranger, async () => {
      for (const table of [
        'kitchens',
        'members',
        'categories',
        'dishes',
        'requests',
        'chef_profiles',
        'customer_profiles',
      ])
        expect((await db.query(`select * from public.${table}`)).rows).toHaveLength(0)
      expect((await db.query('select * from storage.objects')).rows).toHaveLength(0)
      await expect(db.query('select * from private.access_secrets')).rejects.toThrow(
        /permission denied/,
      )
      await expect(
        db.query('select public.bootstrap_kitchen($1,$2)', [password, code]),
      ).rejects.toThrow(/permission denied/)
    })
    await db.exec('set role anon')
    try {
      await expect(db.query('select * from public.dishes')).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
    expect(await unlock(stranger, 'wrong-code')).toEqual({ error: 'invalid_code' })
    expect(await unlock(stranger)).toEqual({ ok: true })
    await asUser(stranger, async () => {
      expect((await db.query('select * from public.dishes')).rows).toHaveLength(1)
      expect((await db.query('select * from storage.objects')).rows).toHaveLength(1)
    })
  })
  it('never grants chef privileges from the customer code or a direct role update', async () => {
    expect(await unlock(stranger, code, true)).toEqual({ error: 'invalid_code' })
    expect(await unlock(stranger, code)).toEqual({ ok: true })
    await asUser(stranger, async () => {
      await expect(
        db.query("update public.members set role='chef' where user_id=$1", [stranger]),
      ).rejects.toThrow(/permission denied/)
      await expect(
        db.query(
          "insert into public.members(kitchen_id,user_id,display_name,role) values($1,$2,'Imposter','chef')",
          [kitchen, randomUUID()],
        ),
      ).rejects.toThrow(/permission denied/)
      await expect(
        db.query("insert into public.dishes(kitchen_id,name,photo_path) values($1,'Fake',$2)", [
          kitchen,
          `${kitchen}/fake.webp`,
        ]),
      ).rejects.toThrow(/row-level security/)
      expect((await db.query('update public.dishes set price=0 returning id')).rows).toHaveLength(0)
      await expect(
        db.query("select public.change_access_codes('another-code',null)"),
      ).rejects.toThrow('not_allowed')
      await expect(
        db.query("select public.change_access_codes(null,'new-chef-password')"),
      ).rejects.toThrow('not_allowed')
    })
    expect(await unlock(stranger, password, true)).toEqual({ ok: true })
    await asUser(stranger, async () => {
      expect((await db.query('update public.dishes set price=15 returning id')).rows).toHaveLength(
        1,
      )
    })
  })
  it('commits failed attempts and rate limits the ninth attempt', async () => {
    for (let i = 0; i < 8; i++)
      expect(await unlock(stranger, 'incorrect')).toEqual({ error: 'invalid_code' })
    expect(await unlock(stranger)).toEqual({ error: 'rate_limited' })
    expect(
      (
        await db.query<{ attempts: number }>(
          'select attempts from private.unlock_attempts where user_id=$1',
          [stranger],
        )
      ).rows[0].attempts,
    ).toBe(8)
    await db.query(
      "update private.unlock_attempts set window_end=now()-interval '1 second' where user_id=$1",
      [stranger],
    )
    expect(await unlock(stranger)).toEqual({ ok: true })
  })
  it('rotation revokes existing customer access, keeps the chef, and rejects the old code', async () => {
    const request = await order()
    await asUser(chef, () => db.query("select public.change_access_codes('new-family-code',null)"))
    await asUser(guest, async () => {
      expect((await db.query('select * from public.dishes')).rows).toHaveLength(0)
      expect((await db.query('select * from storage.objects')).rows).toHaveLength(0)
      await expect(
        db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
      ).rejects.toThrow('not_member')
    })
    expect(await unlock(guest, code)).toEqual({ error: 'invalid_code' })
    expect(await unlock(guest, 'new-family-code')).toEqual({ ok: true })
    // Updating only the family code leaves the chef password and current chef intact.
    expect(await unlock(stranger, password, true)).toEqual({ ok: true })
    expect(
      (await db.query<{ role: string }>('select role from public.members where user_id=$1', [chef]))
        .rows[0].role,
    ).toBe('chef')
    await asUser(chef, async () =>
      expect((await db.query('select * from public.dishes')).rows).toHaveLength(1),
    )
  })
  it('rotates chef credentials and revokes other chef sessions', async () => {
    await unlock(stranger, password, true)
    await asUser(chef, () =>
      db.query("select public.change_access_codes(null,'new-private-chef-password')"),
    )
    expect(
      (await db.query('select * from public.members where user_id=$1', [stranger])).rows,
    ).toHaveLength(0)
    expect(await unlock(stranger, password, true)).toEqual({ error: 'invalid_code' })
    expect(await unlock(stranger, 'new-private-chef-password', true)).toEqual({ ok: true })
    // Updating only the chef password preserves customer access and the family code.
    expect(
      (
        await db.query<{ role: string }>('select role from public.members where user_id=$1', [
          guest,
        ])
      ).rows[0].role,
    ).toBe('customer')
    expect(await unlock(guest, code)).toEqual({ ok: true })
    expect(
      (await db.query<{ role: string }>('select role from public.members where user_id=$1', [chef]))
        .rows[0].role,
    ).toBe('chef')
    await asUser(chef, async () => {
      await expect(
        db.query('select public.change_access_codes($1,null)', ['new-private-chef-password']),
      ).rejects.toThrow('different_codes')
    })
  })
})
describe('family chef profiles', () => {
  it('upgrades duplicate names without removing sessions or order snapshots and is safe to rerun', () => {
    expect(upgraded).toEqual({
      profiles: 1,
      sessions: 2,
      distinctProfiles: 1,
      requestName: 'Snoi',
      stable: true,
    })
  })
  it('reuses a chef name across devices while keeping different names distinct', async () => {
    expect(await unlock(guest, code, true, 'Snoi')).toEqual({ error: 'invalid_code' })
    expect(await unlock(guest, password, true, 'Snoi')).toEqual({ ok: true })
    expect(await unlock(stranger, password, true, '  sNOI  ')).toEqual({ ok: true })
    expect(await unlock(other, password, true, 'Grandma')).toEqual({ ok: true })
    expect(await unlock(guest, password, true, 'Snoi')).toEqual({ ok: true })
    const sessions = (
      await db.query<{ user_id: string; chef_profile_id: string; display_name: string }>(
        'select * from public.members',
      )
    ).rows
    const first = sessions.find((m) => m.user_id === guest)!,
      second = sessions.find((m) => m.user_id === stranger)!,
      third = sessions.find((m) => m.user_id === other)!
    expect(first.chef_profile_id).toBe(second.chef_profile_id)
    expect(first.display_name).toBe(second.display_name)
    expect(first.chef_profile_id).not.toBe(third.chef_profile_id)
    expect((await db.query('select * from public.chef_profiles')).rows).toHaveLength(3)
    for (const id of [guest, stranger, other])
      await asUser(id, async () =>
        expect((await db.query('select * from public.dishes')).rows).toHaveLength(1),
      )
  })
  it('keeps the profile when all its device memberships are ended', async () => {
    await unlock(stranger, password, true, 'Snoi')
    const profile = (
      await db.query<{ chef_profile_id: string }>(
        'select chef_profile_id from public.members where user_id=$1',
        [stranger],
      )
    ).rows[0].chef_profile_id
    await asUser(chef, () => db.query('select public.remove_member($1)', [stranger]))
    expect(
      (await db.query('select * from public.chef_profiles where id=$1', [profile])).rows,
    ).toHaveLength(1)
    await unlock(guest, password, true, 'Snoi')
    expect(
      (
        await db.query<{ chef_profile_id: string }>(
          'select chef_profile_id from public.members where user_id=$1',
          [guest],
        )
      ).rows[0].chef_profile_id,
    ).toBe(profile)
  })
  it('renames one profile across its devices without changing historical request names', async () => {
    await unlock(stranger, password, true, 'chef')
    const request = await order(chef, randomUUID(), {}, null)
    await asUser(chef, () => db.query("select public.set_display_name('Snoi')"))
    expect(
      (
        await db.query<{ display_name: string }>(
          "select display_name from public.members where role='chef'",
        )
      ).rows.map((m) => m.display_name),
    ).toEqual(['Snoi', 'Snoi'])
    expect(
      (
        await db.query<{ customer_name: string }>(
          'select customer_name from public.requests where id=$1',
          [request.id],
        )
      ).rows[0].customer_name,
    ).toBe('chef')
    await unlock(other, password, true, ' snoi ')
    expect((await db.query('select * from public.chef_profiles')).rows).toHaveLength(1)
    await asUser(guest, () => db.query("select public.set_display_name('Alex')"))
    expect(
      (
        await db.query<{ display_name: string }>(
          'select display_name from public.members where user_id=$1',
          [guest],
        )
      ).rows[0].display_name,
    ).toBe('Alex')
  })
  it('prevents taking another profile by renaming or assigning its identity directly', async () => {
    await unlock(stranger, password, true, 'Grandma')
    await asUser(chef, async () => {
      await expect(db.query("select public.set_display_name(' GRANDMA ')")).rejects.toThrow(
        'chef_name_taken',
      )
      expect(
        (
          await db.query(
            "update public.chef_profiles set display_name='Changed' where display_name='Grandma' returning id",
          )
        ).rows,
      ).toHaveLength(0)
      await expect(
        db.query('update public.members set chef_profile_id=null where user_id=$1', [chef]),
      ).rejects.toThrow(/permission denied/)
    })
    await asUser(guest, async () => {
      expect(
        (await db.query("update public.chef_profiles set display_name='Fake' returning id")).rows,
      ).toHaveLength(0)
      await expect(
        db.query("select private.ensure_chef_profile($1,'Fake')", [kitchen]),
      ).rejects.toThrow(/permission denied/)
      await expect(
        db.query("insert into public.chef_profiles(kitchen_id,display_name) values($1,'Fake')", [
          kitchen,
        ]),
      ).rejects.toThrow(/permission denied/)
    })
  })
})
describe('family customer profiles', () => {
  it('merges legacy names, links matching customer orders, preserves chef orders, and is rerunnable', () => {
    expect(upgradedCustomers).toEqual({
      profiles: 1,
      distinctProfiles: 1,
      linked: true,
      chefUnlinked: true,
      snapshot: 'Alex',
      stable: true,
    })
  })
  it('reuses a customer profile and its menu orders and freeform wishes across devices', async () => {
    const request = await order(),
      wish = await order(guest, randomUUID(), {}, null)
    expect(await unlock(stranger, 'incorrect', false, 'Alex')).toEqual({ error: 'invalid_code' })
    expect(await unlock(stranger, code, false, ' aLeX ')).toEqual({ ok: true })
    const identities = (
      await db.query<{ customer_profile_id: string }>(
        'select customer_profile_id from public.members where user_id in ($1,$2)',
        [guest, stranger],
      )
    ).rows
    expect(identities[0].customer_profile_id).toBe(identities[1].customer_profile_id)
    expect((await db.query('select * from public.customer_profiles')).rows).toHaveLength(2)
    await asUser(
      other,
      async () =>
        await expect(
          db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
        ).rejects.toThrow('not_allowed'),
    )
    await asUser(stranger, async () => {
      await expect(
        db.query('select public.set_request_status($1,$2)', [request.id, 'completed']),
      ).rejects.toThrow('not_allowed')
      for (const r of [request, wish])
        await db.query('select public.set_request_status($1,$2)', [r.id, 'cancelled'])
    })
  })
  it('preserves the profile and order access through ended sessions and code rotation', async () => {
    const request = await order()
    const profile = (
      await db.query<{ customer_profile_id: string }>(
        'select customer_profile_id from public.members where user_id=$1',
        [guest],
      )
    ).rows[0].customer_profile_id
    await asUser(chef, () => db.query('select public.remove_member($1)', [guest]))
    await asUser(
      guest,
      async () =>
        await expect(
          db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
        ).rejects.toThrow('not_member'),
    )
    await asUser(chef, () => db.query("select public.change_access_codes('new-code',null)"))
    expect(await unlock(stranger, code, false, 'Alex')).toEqual({ error: 'invalid_code' })
    expect(await unlock(stranger, 'new-code', false, 'Alex')).toEqual({ ok: true })
    expect(
      (
        await db.query<{ customer_profile_id: string }>(
          'select customer_profile_id from public.members where user_id=$1',
          [stranger],
        )
      ).rows[0].customer_profile_id,
    ).toBe(profile)
    await asUser(stranger, () =>
      db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
    )
  })
  it('renames all devices but keeps request ownership and recorded names stable', async () => {
    const request = await order()
    await unlock(stranger, code, false, 'Alex')
    await asUser(guest, () => db.query("select public.set_display_name('Sunny')"))
    expect(
      (
        await db.query<{ display_name: string }>(
          'select display_name from public.members where user_id in ($1,$2)',
          [guest, stranger],
        )
      ).rows.map((m) => m.display_name),
    ).toEqual(['Sunny', 'Sunny'])
    expect(
      (
        await db.query<{ customer_name: string }>(
          'select customer_name from public.requests where id=$1',
          [request.id],
        )
      ).rows[0].customer_name,
    ).toBe('Alex')
    // Reusing the old name creates a new profile; even the original device loses
    // ownership if it chooses that new identity instead of its renamed profile.
    await unlock(guest, code, false, 'Alex')
    await asUser(
      guest,
      async () =>
        await expect(
          db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
        ).rejects.toThrow('not_allowed'),
    )
    await db.exec(customerMigration)
    await db.exec(languageMigration) // Replay later migrations after rerunning an earlier one.
    await asUser(
      guest,
      async () =>
        await expect(
          db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
        ).rejects.toThrow('not_allowed'),
    )
    await asUser(stranger, () =>
      db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
    )
  })
  it('keeps customer names separate from chef identities and protects profile ownership', async () => {
    expect(await unlock(stranger, code, true, 'chef')).toEqual({ error: 'invalid_code' })
    expect(await unlock(stranger, code, false, 'chef')).toEqual({ ok: true })
    expect(
      (
        await db.query<{ role: string; chef_profile_id: null }>(
          'select role,chef_profile_id from public.members where user_id=$1',
          [stranger],
        )
      ).rows[0],
    ).toEqual({ role: 'customer', chef_profile_id: null })
    await asUser(stranger, async () => {
      expect((await db.query('update public.dishes set price=1 returning id')).rows).toHaveLength(0)
      await expect(db.query("select public.change_access_codes('fake',null)")).rejects.toThrow(
        'not_allowed',
      )
      await expect(
        db.query("select private.ensure_customer_profile($1,'Fake')", [kitchen]),
      ).rejects.toThrow(/permission denied/)
      await expect(
        db.query(
          "insert into public.customer_profiles(kitchen_id,display_name) values($1,'Fake')",
          [kitchen],
        ),
      ).rejects.toThrow(/permission denied/)
      await expect(
        db.query('update public.members set customer_profile_id=null where user_id=$1', [stranger]),
      ).rejects.toThrow(/permission denied/)
      expect(
        (
          await db.query(
            "update public.customer_profiles set display_name='Hijacked' where display_name='Alex' returning id",
          )
        ).rows,
      ).toHaveLength(0)
      await expect(db.query('update public.requests set customer_profile_id=null')).rejects.toThrow(
        /permission denied/,
      )
    })
    await asUser(
      guest,
      async () =>
        await expect(db.query("select public.set_display_name(' BLAIR ')")).rejects.toThrow(
          'customer_name_taken',
        ),
    )
  })
})
describe('unrestricted credential lengths', () => {
  it.each([
    ['one-character', '1', '2'],
    ['long ASCII', 'c'.repeat(160), 'p'.repeat(200)],
    ['long Chinese', '家人🍲'.repeat(50), '主厨🥟'.repeat(50)],
  ])('provisions and unlocks with %s credentials', async (_, kitchenCode, chefPassword) => {
    await db.exec('begin; delete from public.kitchens;')
    try {
      await db.query('select public.bootstrap_kitchen($1,$2)', [chefPassword, kitchenCode])
      expect(await unlock(guest, kitchenCode)).toEqual({ ok: true })
      expect(await unlock(chef, chefPassword, true)).toEqual({ ok: true })
      const hashes = (
        await db.query<{ kitchen_hash: string; chef_hash: string }>(
          'select kitchen_hash,chef_hash from private.access_secrets',
        )
      ).rows[0]
      expect(hashes.kitchen_hash).toMatch(/^snoi-v1\$/)
      expect(hashes.chef_hash).toMatch(/^snoi-v1\$/)
    } finally {
      await db.exec('rollback')
    }
  })
  it.each([
    ['one-character', '1', '2'],
    ['long Unicode', '饭'.repeat(100), '厨'.repeat(100)],
  ])(
    'changes both credentials to %s values and retains revocation behavior',
    async (_, kitchenCode, chefPassword) => {
      await asUser(chef, () =>
        db.query('select public.change_access_codes($1,$2)', [kitchenCode, chefPassword]),
      )
      expect(
        (await db.query("select * from public.members where role='customer'")).rows,
      ).toHaveLength(0)
      expect(await unlock(guest, kitchenCode)).toEqual({ ok: true })
      expect(await unlock(stranger, chefPassword, true)).toEqual({ ok: true })
      expect(await unlock(other, code)).toEqual({ error: 'invalid_code' })
      expect(await unlock(other, password, true)).toEqual({ error: 'invalid_code' })
      await asUser(chef, async () => {
        await expect(
          db.query('select public.change_access_codes($1,null)', [chefPassword]),
        ).rejects.toThrow('different_codes')
        await expect(
          db.query('select public.change_access_codes(null,$1)', [kitchenCode]),
        ).rejects.toThrow('different_codes')
      })
    },
  )
  it('verifies the full input beyond a shared 72-byte prefix', async () => {
    const prefix = '同'.repeat(24),
      kitchenCode = prefix + 'family',
      chefPassword = prefix + 'chef'
    await asUser(chef, () =>
      db.query('select public.change_access_codes($1,$2)', [kitchenCode, chefPassword]),
    )
    expect(await unlock(guest, kitchenCode)).toEqual({ ok: true })
    expect(await unlock(stranger, chefPassword, true)).toEqual({ ok: true })
    expect(await unlock(other, prefix + 'wrong')).toEqual({ error: 'invalid_code' })
    expect(await unlock(other, prefix + 'wrong', true)).toEqual({ error: 'invalid_code' })
    expect(await unlock(other, chefPassword)).toEqual({ error: 'invalid_code' })
    expect(await unlock(other, kitchenCode, true)).toEqual({ error: 'invalid_code' })
  })
  it('keeps legacy credentials valid and rejects suffixes that bcrypt would truncate', async () => {
    expect(await unlock(guest)).toEqual({ ok: true })
    expect(await unlock(chef, password, true)).toEqual({ ok: true })
    const legacy = '家'.repeat(24)
    await db.query(
      "update private.access_secrets set kitchen_hash=extensions.crypt($1,extensions.gen_salt('bf',4))",
      [legacy],
    )
    expect(await unlock(guest, legacy)).toEqual({ ok: true })
    expect(await unlock(other, legacy + 'suffix')).toEqual({ error: 'invalid_code' })
  })
  it('still rejects empty or identical credentials and keeps null updates unchanged', async () => {
    await expect(db.query('select public.bootstrap_kitchen($1,$2)', ['', code])).rejects.toThrow(
      'empty_credential',
    )
    await expect(
      db.query('select public.bootstrap_kitchen($1,$2)', [password, '']),
    ).rejects.toThrow('empty_credential')
    await expect(db.query('select public.bootstrap_kitchen($1,$2)', ['1', '1'])).rejects.toThrow(
      'different_codes',
    )
    await asUser(chef, async () => {
      await expect(db.query('select public.change_access_codes($1,null)', [''])).rejects.toThrow(
        'empty_credential',
      )
      await expect(db.query('select public.change_access_codes(null,$1)', [''])).rejects.toThrow(
        'empty_credential',
      )
      await expect(
        db.query('select public.change_access_codes($1,$2)', ['1', '1']),
      ).rejects.toThrow('different_codes')
      await db.query('select public.change_access_codes(null,null)')
    })
    expect(await unlock(guest)).toEqual({ ok: true })
    expect(await unlock(chef, password, true)).toEqual({ ok: true })
    expect(await unlock(other, '')).toEqual({ error: 'invalid_request' })
    await asUser(guest, async () => {
      await expect(db.query('select private.hash_credential($1)', ['1'])).rejects.toThrow(
        /permission denied/,
      )
      await expect(
        db.query('select private.verify_credential($1,$2)', ['1', 'hash']),
      ).rejects.toThrow(/permission denied/)
    })
  })
})
describe('orders, options and history', () => {
  it('deduplicates retries and snapshots dish name and price', async () => {
    const client = randomUUID(),
      first = await order(guest, client),
      second = await order(guest, client)
    expect(first.id).toBe(second.id)
    expect(Number(first.price)).toBe(12.5)
    await asUser(chef, () =>
      db.query("update public.dishes set name='Changed',price=99,archived=true"),
    )
    const rows = (
      await db.query<{ name: string; price: string }>('select name,price from public.requests')
    ).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Noodles')
    expect(Number(rows[0].price)).toBe(12.5)
    await expect(order()).rejects.toThrow('dish_unavailable')
  })
  it('rejects forged options and supports freeform dish wishes', async () => {
    for (const options of [
      {},
      { Temperature: 'Invalid' },
      { Temperature: 'Hot', Extra: 'Sneaky' },
      { Temperature: 1 },
    ])
      await expect(order(guest, randomUUID(), options)).rejects.toThrow('invalid_options')
    const wish = await order(guest, randomUUID(), {}, null)
    expect(wish.name).toBe('Handmade dumplings')
    expect(Number(wish.price)).toBe(0)
    await expect(order(stranger)).rejects.toThrow('not_member')
  })
  it('customers cancel only their own pending requests; only chefs complete and undo', async () => {
    const request = await order()
    await asUser(other, async () => {
      await expect(
        db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
      ).rejects.toThrow('not_allowed')
    })
    await asUser(guest, async () => {
      await expect(
        db.query('select public.set_request_status($1,$2)', [request.id, 'completed']),
      ).rejects.toThrow('not_allowed')
      await expect(db.query("update public.requests set status='completed'")).rejects.toThrow(
        /permission denied/,
      )
    })
    await asUser(chef, async () => {
      await db.query('select public.set_request_status($1,$2)', [request.id, 'completed'])
      expect(
        (await db.query<{ completed_at: string }>('select completed_at from public.requests'))
          .rows[0].completed_at,
      ).toBeTruthy()
      await db.query('select public.set_request_status($1,$2)', [request.id, 'pending'])
    })
    await asUser(guest, () =>
      db.query('select public.set_request_status($1,$2)', [request.id, 'cancelled']),
    )
    await asUser(chef, async () => {
      await expect(
        db.query('select public.set_request_status($1,$2)', [request.id, 'pending']),
      ).rejects.toThrow('not_allowed')
    })
  })
  it('deleting a category preserves dishes and order history', async () => {
    await order()
    await asUser(chef, () => db.query('select public.delete_category($1)', [category]))
    expect(
      (await db.query<{ category_id: null }>('select category_id from public.dishes')).rows[0]
        .category_id,
    ).toBeNull()
    expect((await db.query('select * from public.requests')).rows).toHaveLength(1)
  })
})
describe('photo permissions', () => {
  it('only chefs upload and only unreferenced kitchen photos can be removed', async () => {
    await asUser(guest, async () => {
      await expect(
        db.query("insert into storage.objects(bucket_id,name) values('dish-photos',$1)", [
          `${kitchen}/new.webp`,
        ]),
      ).rejects.toThrow(/row-level security/)
      expect((await db.query('delete from storage.objects returning *')).rows).toHaveLength(0)
    })
    await asUser(chef, async () => {
      expect((await db.query('delete from storage.objects returning *')).rows).toHaveLength(0)
      await db.query("insert into storage.objects(bucket_id,name) values('dish-photos',$1)", [
        `${kitchen}/new.webp`,
      ])
      expect((await db.query('delete from storage.objects returning *')).rows).toHaveLength(1)
      await expect(
        db.query("insert into storage.objects(bucket_id,name) values('dish-photos',$1)", [
          `${randomUUID()}/new.webp`,
        ]),
      ).rejects.toThrow(/row-level security/)
    })
  })
})

async function setLanguage(id: string, language: string, initialize = false) {
  return asUser(
    id,
    async () =>
      (
        await db.query<{ language: string }>(
          'select public.set_language_preference($1,$2) language',
          [language, initialize],
        )
      ).rows[0].language,
  )
}

describe('profile language preferences', () => {
  it('remembers each chef/customer preference across sessions, renames and migration reruns', async () => {
    expect(await setLanguage(chef, 'en')).toBe('en')
    expect(await setLanguage(guest, 'zh')).toBe('zh')
    expect(await setLanguage(other, 'en')).toBe('en')
    await unlock(stranger, code, false, 'alex')
    expect(await setLanguage(stranger, 'en', true)).toBe('zh')
    await asUser(guest, () => db.query("select public.set_display_name('Sunny')"))
    await db.exec(languageMigration)
    expect(await setLanguage(stranger, 'en', true)).toBe('zh')
    await asUser(chef, () => db.query('select public.remove_member($1)', [stranger]))
    await unlock(stranger, password, true, 'chef')
    expect(await setLanguage(stranger, 'zh', true)).toBe('en')
    const profiles = (
      await db.query<{ display_name: string; preferred_language: string }>(
        'select display_name,preferred_language from public.customer_profiles order by display_name',
      )
    ).rows
    expect(profiles).toEqual([
      { display_name: 'Blair', preferred_language: 'en' },
      { display_name: 'Sunny', preferred_language: 'zh' },
    ])
  })
  it('adopts the first chosen language once and later allows an explicit change', async () => {
    expect(await setLanguage(guest, 'zh', true)).toBe('zh')
    expect(await setLanguage(guest, 'en', true)).toBe('zh')
    expect(await setLanguage(guest, 'en')).toBe('en')
  })
  it('retains preferences when a code rotation revokes customer sessions', async () => {
    await setLanguage(guest, 'zh')
    await asUser(chef, () => db.query("select public.change_access_codes('new-family-code',null)"))
    await expect(setLanguage(guest, 'en')).rejects.toThrow('not_member')
    await unlock(guest, 'new-family-code', false, 'Alex')
    expect(await setLanguage(guest, 'en', true)).toBe('zh')
  })
  it('prevents outsiders, invalid languages and changes to another profile', async () => {
    await expect(setLanguage(stranger, 'zh')).rejects.toThrow('not_member')
    await expect(setLanguage(guest, 'fr')).rejects.toThrow('invalid_language')
    await setLanguage(chef, 'en')
    await setLanguage(other, 'en')
    await asUser(guest, async () => {
      expect(
        (await db.query("update public.chef_profiles set preferred_language='zh' returning id"))
          .rows,
      ).toHaveLength(0)
      expect(
        (
          await db.query(
            "update public.customer_profiles set preferred_language='zh' where display_name='Blair' returning id",
          )
        ).rows,
      ).toHaveLength(0)
      await expect(
        db.query(
          "update public.customer_profiles set preferred_language='fr' where display_name='Alex'",
        ),
      ).rejects.toThrow()
    })
    expect(await setLanguage(chef, 'zh', true)).toBe('en')
    expect(await setLanguage(other, 'zh', true)).toBe('en')
  })
})

describe('menus with either primary language', () => {
  it('saves Chinese-only dishes and categories and snapshots them in request history', async () => {
    await asUser(chef, async () => {
      await db.query("update public.categories set name='',name_zh='中餐' where id=$1", [category])
      await db.query(
        "update public.dishes set name='',name_zh='番茄炒蛋',description='',description_zh='家的味道' where id=$1",
        [dish],
      )
    })
    const request = await order()
    expect(request.name).toBe('')
    expect(
      (
        await db.query<{ name_zh: string }>('select name_zh from public.requests where id=$1', [
          request.id,
        ])
      ).rows[0].name_zh,
    ).toBe('番茄炒蛋')
    await asUser(chef, async () => {
      await db.query("select public.set_request_status($1,'completed')", [request.id])
      await db.query("update public.dishes set name_zh='家常番茄炒蛋' where id=$1", [dish])
    })
    expect(
      (
        await db.query<{ name_zh: string; status: string }>(
          'select name_zh,status from public.requests where id=$1',
          [request.id],
        )
      ).rows[0],
    ).toEqual({ name_zh: '番茄炒蛋', status: 'completed' })
  })
  it('still rejects missing names, oversized translations and customer menu edits', async () => {
    await asUser(chef, async () => {
      await expect(
        db.query("update public.dishes set name=' ',name_zh='' where id=$1", [dish]),
      ).rejects.toThrow()
      await expect(
        db.query("update public.categories set name='',name_zh=' ' where id=$1", [category]),
      ).rejects.toThrow()
      await expect(
        db.query("update public.dishes set name='',name_zh=$2 where id=$1", [
          dish,
          '菜'.repeat(101),
        ]),
      ).rejects.toThrow()
    })
    await asUser(guest, async () => {
      expect(
        (
          await db.query(
            "update public.dishes set name='',name_zh='改名' where id=$1 returning id",
            [dish],
          )
        ).rows,
      ).toHaveLength(0)
    })
  })
})

describe('chef wishlist deletion', () => {
  it('permanently removes pending menu orders and custom wishes without deleting the dish', async () => {
    const menuOrder = await order()
    const wish = await order(guest, randomUUID(), {}, null)
    const retained = await order(other)
    await asUser(chef, async () => {
      await db.query('select public.delete_wishlist_request($1)', [menuOrder.id])
      await db.query('select public.delete_wishlist_request($1)', [wish.id])
      await db.query('select public.delete_wishlist_request($1)', [menuOrder.id])
    })
    for (const id of [chef, guest, other]) {
      await asUser(id, async () => {
        expect((await db.query('select id from public.requests')).rows).toEqual([
          { id: retained.id },
        ])
        expect((await db.query('select id from public.dishes')).rows).toEqual([{ id: dish }])
      })
    }
  })
  it('denies customers including the requester, outsiders and revoked chef sessions', async () => {
    const request = await order()
    for (const id of [guest, other, stranger]) {
      await asUser(id, async () => {
        await expect(
          db.query('select public.delete_wishlist_request($1)', [request.id]),
        ).rejects.toThrow('not_allowed')
        await expect(
          db.query('delete from public.requests where id=$1', [request.id]),
        ).rejects.toThrow(/permission denied/)
      })
    }
    await unlock(stranger, password, true, 'chef')
    await asUser(chef, () => db.query('select public.remove_member($1)', [stranger]))
    await asUser(stranger, async () => {
      await expect(
        db.query('select public.delete_wishlist_request($1)', [request.id]),
      ).rejects.toThrow('not_allowed')
    })
    expect((await db.query('select id from public.requests')).rows).toEqual([{ id: request.id }])
  })
  it('keeps completed history when a stale card attempts deletion', async () => {
    const request = await order()
    await asUser(chef, async () => {
      await db.query("select public.set_request_status($1,'completed')", [request.id])
      await expect(
        db.query('select public.delete_wishlist_request($1)', [request.id]),
      ).rejects.toThrow('request_not_deletable')
      await expect(
        db.query('delete from public.requests where id=$1', [request.id]),
      ).rejects.toThrow(/permission denied/)
    })
    expect(
      (
        await db.query<{ status: string }>('select status from public.requests where id=$1', [
          request.id,
        ])
      ).rows[0].status,
    ).toBe('completed')
  })
  it('upgrades existing cancelled orders and wishes without deleting data until a chef requests it', async () => {
    await db.exec(deleteRequestMigration)
    const menuOrder = await order()
    const wish = await order(guest, randomUUID(), {}, null)
    const retained = await order(other)
    for (const request of [menuOrder, wish]) {
      await asUser(guest, () =>
        db.query("select public.set_request_status($1,'cancelled')", [request.id]),
      )
    }
    await db.exec(cancelledDeletionMigration)
    await db.exec(cancelledDeletionMigration)
    expect((await db.query('select id from public.requests')).rows).toHaveLength(3)
    for (const request of [menuOrder, wish]) {
      for (const id of [guest, other, stranger]) {
        await asUser(id, async () => {
          await expect(
            db.query('select public.delete_wishlist_request($1)', [request.id]),
          ).rejects.toThrow('not_allowed')
        })
      }
      await asUser(chef, async () => {
        await db.query('select public.delete_wishlist_request($1)', [request.id])
        await db.query('select public.delete_wishlist_request($1)', [request.id])
      })
    }
    for (const id of [chef, guest, other]) {
      await asUser(id, async () => {
        expect((await db.query('select id from public.requests')).rows).toEqual([
          { id: retained.id },
        ])
        expect((await db.query('select id from public.dishes')).rows).toEqual([{ id: dish }])
      })
    }
  })
  it('does not expose deletion to the public anonymous role', async () => {
    const request = await order()
    await db.exec('set role anon')
    try {
      await expect(
        db.query('select public.delete_wishlist_request($1)', [request.id]),
      ).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })
})
