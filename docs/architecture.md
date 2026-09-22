# Architecture and access

One installation is one kitchen. GitHub Pages serves static React/Vite assets. Supabase serves Postgres, private Storage, and Auth. The public landing page is generic and reveals no household data.

## Kitchen-code flow

1. A visitor enters a nickname and kitchen code, or selects chef mode and supplies the chef password.
2. Supabase creates an anonymous device session if needed. Anonymous sessions use the `authenticated` database role; that role alone grants **no kitchen access**.
3. `unlock_kitchen` verifies versioned bcrypt-based hashes inside a non-exposed `private` schema and creates the verified session's membership. After successful chef-password verification, it finds or creates the kitchen's chef profile by name (case-insensitive, surrounding spaces trimmed); device memberships reference that stable profile. Customers cannot write memberships or roles directly.
4. Row-level security checks membership on every data access. Chef writes require a verified chef role; choosing the chef tab is not authorization.
5. Code rotation deletes affected memberships. Storage and data queries stop working immediately for those sessions. The frontend also polls every 30 seconds and refreshes on focus/network recovery; Realtime accelerates menu/request changes.

The same public link works for every device. No secret is placed in a URL, public environment variable, or frontend bundle. Store only the two public Supabase values in the GitHub deployment variables.

## Abuse limits and shared-secret tradeoffs

Failed unlocks are serialized and persisted server-side. Eight attempts per device session are allowed in a 15-minute window, shared across customer/chef entry. Supabase's anonymous sign-up endpoint also applies its own rate limits; review the project's Auth settings and [anonymous-sign-in documentation](https://supabase.com/docs/guides/auth/auth-anonymous). Per-session limits are not a global brute-force defense: a fresh session resets that counter. Use a long, unique kitchen code and a separate strong chef password. This deliberately simple access model identifies sessions by a chosen nickname, not a verified person. Members can see one another's nicknames and requests.

The chef and customers use the same browser client, but database permissions differ. The frontend never receives password hashes. An administrator provisions the singleton kitchen once; no public “claim the kitchen” endpoint exists. Secret rotation and unlock take row locks so an unlock using an old code cannot create a membership after rotation completes.

## Data rules

- `kitchens`: singleton name and announcement.
- `chef_profiles`: stable family chef identities, unique by kitchen and normalized name. Only verified chef entry can create or select a profile. Members can read the profiles; a chef can rename only the profile used by their current session.
- `members`: per-device nickname, verified role, and optional chef-profile reference. Customers remain separate sessions; sharing a nickname does not transfer ownership of pending requests.
- `categories`: bilingual labels, emoji, order.
- `dishes`: chef-owned menu metadata, private image path, structured options, availability/archive state.
- `requests`: immutable dish/price/requester snapshots and selected options. Writes use functions; customers can cancel only their own pending requests. Chef can complete pending, undo completed, and cancel pending requests. Cancelled entries are terminal.
- `private.access_secrets`: versioned credential hashes (and legacy bcrypt hashes). `private.unlock_attempts`: device attempt windows. Neither is readable by a browser.

`place_request` validates every option against the current dish, snapshots its current price/name, and uses a `(created_by, client_id)` unique key for safe retries. Archiving dishes and ending sessions do not erase request history.

The `dish-photos` bucket is private. Storage policies scope reads to verified kitchen members and writes to chefs. The browser downloads authorized blobs rather than publishing long-lived image URLs. Uploads are converted to WebP, resized to a maximum 1200px edge, and limited to 2MB after processing. Referenced photos cannot be deleted; replacing a photo saves the dish first, then removes its old unreferenced object. Failed cleanup can leave an orphan; it never breaks a currently referenced image.

## Operational limits

A Supabase project is required for cross-device persistence. The demo is explicitly a separate development mode and stores fictional data locally. Its role switch cannot appear in a production build. The source repository and frontend hosting may be public without making database records public.

This first version is designed for a household, not a public restaurant: it loads kitchen history in paginated batches into memory. It has no payments, email invitations, multi-kitchen membership, push notifications, automatic translation, offline ordering, or persistent service-worker cache. Portable backup imports add menu records and are not atomic. The kitchen owner is responsible for keeping independent database and Storage backups if full disaster recovery is needed.

## Credential length update

Apply `202609220002_unrestricted_credentials.sql` after the initial migration, including for existing installations. Credential forms, kitchen provisioning, code changes, and unlock no longer impose character-count or byte-length limits. Empty values remain invalid; `null` in the code-change RPC means keep that credential. No whitespace normalization is performed on new credentials.

New hashes use a `snoi-v1$` marker, a random bcrypt salt at cost 10, and a printable HMAC-SHA-256 pre-hash of the complete UTF-8 credential keyed by the domain-prefixed bcrypt salt. Only the 64-character hex digest enters bcrypt, so long Unicode inputs are not truncated. This uses the salt-keyed pre-hash approach described in [Passlib's bcrypt-sha256 documentation](https://passlib.readthedocs.io/en/stable/lib/passlib.hash.bcrypt_sha256.html) with an application-specific encoding. It is not compatible with Passlib's serialized hash format. Neither plaintext credentials nor the intermediate pre-hash are stored.

Existing raw bcrypt hashes remain readable without resetting credentials or sessions. The legacy verification branch rejects candidates above 72 bytes, because the old app could not create such credentials and bcrypt would otherwise truncate a forged suffix. Setting a new credential always writes the new format. Underlying HTTP/database resource limits still apply; the app adds no length policy.

## Named chef profiles

Apply `202609220003_chef_profiles.sql` after 001 and 002. The update backfills existing same-name chefs into a single persistent profile and links their memberships without deleting Auth users or rewriting request history. Returning with the same chef name reuses that profile, and a different name creates another family chef. This is a shared-password family identity model, not individual verified accounts: the chef password is required for every new chef session, and its holders can select any chef name.

A unique index handles concurrent profile creation. Renaming through `set_display_name` updates that profile's current sessions through a trigger; it cannot take a name already held by another chef. Direct member edits cannot change the profile reference. Ending sessions or rotating the chef password revokes device access while preserving profiles. The UI counts profiles rather than chef sessions and keeps per-device revocation in a separate Settings disclosure. Customer session identity and order authorization stay unchanged.
