# SnoiCafe 🍲

A tiny kitchen for your favorite people. A cute, mobile-first family menu in **English and 简体中文**, with a category sidebar, dish rows, and Menu / Wishlist / History along the bottom.

[中文说明](docs/README.zh-CN.md) · [Access & architecture](docs/architecture.md)

## What's included

- Customers open **one kitchen link**, enter a **nickname + kitchen code**, and start ordering. No email, Google sign-in, or account creation screen.
- The chef uses a **separate private password** and can change both codes in Settings.
- Photo uploads, bilingual dish names/descriptions, fun coin prices, custom categories, options such as Hot / Cold, availability, and archive/restore.
- Menu orders and freeform dish wishes share a wishlist. Chefs serve requests; customers cancel their own pending requests. History retains the original dish name, price, options, and requester.
- Private photo storage and database authorization. The frontend is public; family content requires verified kitchen access.
- Portable JSON backups containing photos, plus menu import. One kitchen per installation.

## Try the local preview

Install [Node.js 24 LTS](https://nodejs.org/) and [pnpm](https://pnpm.io/installation) (the project pins its pnpm version in `package.json`). Then:

```sh
git clone https://github.com/snoidetx/SnoiCafe.git
cd SnoiCafe
pnpm install
pnpm dev:demo
```

Open the local URL printed in the terminal. The preview has sample dishes and a Chef / Customer switch. Preview changes are kept **only in that browser**, not in Supabase. The sample menu and role switch are excluded from production builds. Access-code changes and backups are disabled in preview mode. Use `pnpm dev` for the real backend.

## Setup

The chef does this once. Family members only need the link and kitchen code afterwards.

### 1. Create the backend

1. Create your own project at [Supabase](https://supabase.com/).
2. Under **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins** and save. This is required for chef and customer entry, even though neither needs an account. It creates a device session behind the scenes; your family will never need an email account or sign-in link. Email and Google providers are not needed.
3. In the SQL Editor, run [the initial database migration](supabase/migrations/202609220001_kitchen.sql), then [the access-code update](supabase/migrations/202609220002_unrestricted_credentials.sql), then [the chef-profile update](supabase/migrations/202609220003_chef_profiles.sql), in that order. The first script runs once on a fresh project; the two updates can be re-run safely. They create the tables, authorization rules, functions, and private `dish-photos` bucket. If you already ran the initial migration, run the access-code update followed by the chef-profile update before continuing.
4. In a separate SQL Editor query, initialize your kitchen. **Replace both example values before running** and keep your actual passwords out of GitHub:

   ```sql
   select public.bootstrap_kitchen(
     p_chef_password := 'REPLACE-with-your-private-chef-password',
     p_kitchen_code := 'REPLACE-with-your-family-code',
     p_name := 'SnoiCafe'
   );
   ```

   The kitchen code and chef password have no application-enforced length limits; both must be nonempty and different. Chinese characters and long phrases are supported without truncation. Only hashes are stored in the application's private tables. Keep the SQL Editor query private too.

5. Copy your **Project URL** and **publishable key** from the project's Connect / API settings. A legacy `anon` key also works. Never use a secret or `service_role` key in this app.

### 2. Connect locally

```sh
cp .env.example .env.local
```

Set these values in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_BASE_PATH=/
```

Then run `pnpm dev`. Choose **I'm the chef**, enter your chef name and private chef password, and add your first dishes. To check customer access, open the site in a different browser/private window and use the kitchen code. Unconfigured installations show a setup screen and do not expose a demo menu.

### 3. Publish through GitHub Pages

1. Fork this repository (or push your own copy), then open its **Settings → Pages**. Choose **GitHub Actions** as the build source.
2. Under **Settings → Secrets and variables → Actions → Variables**, add these two repository variables:

   | Variable                        | Value                                   |
   | ------------------------------- | --------------------------------------- |
   | `VITE_SUPABASE_URL`             | Your Supabase Project URL               |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Your publishable key or legacy anon key |

   These values are designed to be public; database and storage policies protect your data. **Do not add the kitchen code, chef password, database password, or service-role key.**

3. Push to `main`, or run **Actions → Deploy to GitHub Pages → Run workflow**. Tests run before deployment. Until both variables exist, deployment is skipped.
4. GitHub shows the website address in the deployment result, typically `https://YOUR_USERNAME.github.io/SnoiCafe/`. The workflow automatically sets the correct repository subpath; custom domains and `username.github.io` repositories also work.
5. Send your family that link and share the kitchen code privately. **Never share the chef password with customers.** Settings also has a Copy kitchen link button.

There is no email redirect configuration because access uses a kitchen code. A custom domain is optional; GitHub's supplied URL is enough.

## Cost and storage

GitHub Pages can serve a public repository's frontend on GitHub Free ([GitHub documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)). The repository contains app code and the generic banner, **not your private recipes, dish photos, wishes, or access codes**.

Supabase provides the database, anonymous device sessions, and private photo storage. Its Free plan can suit a small household, subject to current quotas and inactivity pauses; paid upgrades are optional. Check [current Supabase pricing](https://supabase.com/pricing) before setup. You can run this without a paid subscription while staying within the free limits. GitHub Pages alone cannot store shared orders or securely verify a secret code, and Google Drive would need an additional application backend for those operations.

## Updating an existing kitchen

If you see a code-length error, run [202609220002_unrestricted_credentials.sql](supabase/migrations/202609220002_unrestricted_credentials.sql) in your existing Supabase project's SQL Editor, then reload the updated app. Existing passwords, kitchen codes, sessions, menus, and orders are preserved. If initial kitchen creation failed, run this update first and retry `bootstrap_kitchen` with your chosen values. Do not rerun the initial table-creation migration.

### Repeated chef entries

Run [202609220003_chef_profiles.sql](supabase/migrations/202609220003_chef_profiles.sql) after the access-code update, then deploy the updated app. It groups existing chef sessions with the same name into one persistent family profile, preserving all passwords, memberships, menus, and order history. It is safe to re-run.

Signing in with the same chef name resumes that profile on another device; capitalization and surrounding spaces are ignored. Different names identify different family chefs, all using this kitchen's chef password. A name by itself never grants chef access. In Settings, changing your chef name renames your profile on every device; a name already used by another chef cannot be taken by renaming. Old orders retain the name recorded when they were placed. **Chef device sessions** lets you end individual sessions while retaining the family profiles. Customer sessions and their order ownership remain separate.

## Sign-in troubleshooting

A wrong kitchen code or chef password produces a specific mismatch message. A setup or connection error does not establish whether your password is correct.

- **Anonymous Sign-Ins disabled:** In Supabase, open **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**, and save. The app needs a device session before it can check either access code. Keep new user sign-ups allowed too.
- **Connection key rejected:** Check that `.env.local` contains the Project URL and publishable key from the same project, then restart `pnpm dev`. Use the public key; never a secret key.
- **Database setup incomplete:** Check that all three SQL migrations completed in that same project. Only run the initial migration on a fresh database.
- **Chef password mismatch:** Use the `p_chef_password` value from kitchen setup, or follow [password recovery](#backups-and-recovery). This is separate from your Supabase account and database passwords.
- **Other sign-in errors:** Share the displayed step and error reference. The app does not include passwords, tokens, or raw database error details in that message.

## Everyday use

- **Customers:** enter a nickname and code once per browser; choose a dish and options or make a new-dish wish. The shared wishlist shows who requested each item.
- **Chef:** select Manage to edit dishes; use Categories to add, rename, reorder, or delete categories. Deleting a category moves its dishes to Other dishes. Archive hides a dish while keeping its history.
- **Language:** switch between English and Chinese in the header. Add an optional Chinese name/description to dishes and categories. Without a translation, the original name is shown. Custom option names/values are entered by the chef and are not machine-translated.
- **Code changes:** Open the header settings button → Kitchen access, enter a new kitchen code, chef password, or both, and select **Update access codes**. Leave either field blank to keep that value. After the initial database setup/update, changes are made entirely in the app. Only chefs can see and use these controls. Changing the kitchen code ends existing customer memberships. They must enter the new code. Changing the chef password ends other chef memberships and preserves the current chef session.
- **Chef profiles:** the Family & friends list and headcount show each named chef once, even when they use multiple devices. Chef names are family identifiers; everyone who knows the chef password can enter as one of those names.
- **Sessions:** a browser remembers your nickname and access. A different device, signing out, or clearing browser data starts a new session. The chef can end old sessions. Completed requests keep their names and history. After starting a new session, customers cannot cancel requests from their previous session; the chef can manage them.
- **Privacy:** anyone with the kitchen code can join. To keep someone out, change the code and share it only with the remaining family. Ending one session alone does not stop someone who still knows the code from joining again. Access revocation is enforced immediately by the database; an already-open page clears its displayed content on its next refresh (at most 30 seconds while visible and online).

## Backups and recovery

In chef Settings, **Download backup** exports the menu, requests, member nicknames, and photos into one JSON file. Keep it private. Access codes, password hashes, and authentication tokens are excluded.

**Restore menu backup** validates an exported file and adds new categories and dishes to the current kitchen; it does not overwrite or delete existing records. Restored dishes are unavailable until you review them. Imports are additive, not transactional: if a connection fails partway through, some records may already have been added; inspect the menu before retrying. Portable import does not restore history or device identities. Complete recovery of those requires a separate database backup and matching Storage objects; see [Supabase backups](https://supabase.com/docs/guides/platform/backups). Database backups do not contain Storage file bytes.

Forgot the chef password? The Supabase project owner can reset it in the SQL Editor. Replace the example value with your new password; use a different value from the family code:

```sql
begin;
update private.access_secrets
set chef_hash = private.hash_credential('REPLACE-with-a-new-private-password');
delete from public.members where role = 'chef';
commit;
```

Then enter through **I'm the chef** with the new password. Do not delete Auth users that have order history: requests retain their identity references. Ending their kitchen sessions in Settings is sufficient.

## Development

```sh
pnpm dev          # real backend from .env.local
pnpm dev:demo     # local sample kitchen, no backend
pnpm test         # domain checks + actual PostgreSQL migration/RLS tests via PGlite
pnpm build        # TypeScript + production bundle
pnpm preview      # serve dist locally
```

Tests run the migration in PostgreSQL with minimal local Auth/Storage scaffolding. They cover outsider access, role escalation, code verification/rotation, persisted attempt limits, private photo permissions, validated orders, idempotent retries, and history. They do not replace a smoke test against your live Supabase project after setup.

React + TypeScript + Vite, Supabase, Lucide icons. No analytics, payments, external font services, or public dish-image URLs. The site requires an internet connection for shared kitchen data; it has no offline caching of private content. This is a web app that can be opened from a phone's home-screen shortcut, not an offline PWA.

Licensed under [MIT](LICENSE). The kitchen banner is an original generated illustration; see [asset notes](docs/assets.md).
