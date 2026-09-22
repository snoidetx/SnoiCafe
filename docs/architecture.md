# Architecture and access

One installation is one kitchen. GitHub Pages serves static React/Vite assets. Supabase serves Postgres, private Storage, and Auth. The public landing page is generic and reveals no household data.

## Kitchen-code flow

1. A visitor enters a nickname and kitchen code, or selects chef mode and supplies the chef password.
2. Supabase creates an anonymous device session if needed. Anonymous sessions use the `authenticated` database role; that role alone grants **no kitchen access**.
3. `unlock_kitchen` verifies versioned bcrypt-based hashes inside a non-exposed `private` schema and creates the verified session's membership. After successful credential verification, it finds or creates a chef or customer profile by name within that role (case-insensitive, surrounding spaces trimmed); device memberships reference that stable profile. Customers cannot write memberships or roles directly.
4. Row-level security checks membership on every data access. Chef writes require a verified chef role; choosing the chef tab is not authorization.
5. Code rotation deletes affected memberships. Storage and data queries stop working immediately for those sessions. The frontend also polls every 30 seconds and refreshes on focus/network recovery; Realtime accelerates menu/request changes.

The same public link works for every device. No secret is placed in a URL, public environment variable, or frontend bundle. Store only the two public Supabase values in the GitHub deployment variables.

## Abuse limits and shared-secret tradeoffs

Failed unlocks are serialized and persisted server-side. Eight attempts per device session are allowed in a 15-minute window, shared across customer/chef entry. Supabase's anonymous sign-up endpoint also applies its own rate limits; review the project's Auth settings and [anonymous-sign-in documentation](https://supabase.com/docs/guides/auth/auth-anonymous). Per-session limits are not a global brute-force defense: a fresh session resets that counter. Use a long, unique kitchen code and a separate strong chef password. This deliberately simple access model identifies sessions by a chosen nickname, not a verified person. Members can see one another's nicknames and requests.

The chef and customers use the same browser client, but database permissions differ. The frontend never receives password hashes. An administrator provisions the singleton kitchen once; no public “claim the kitchen” endpoint exists. Secret rotation and unlock take row locks so an unlock using an old code cannot create a membership after rotation completes.

## Data rules

- `kitchens`: singleton name and announcement.
- `chef_profiles`: stable family chef identities, unique by kitchen and normalized name. Only verified chef entry can create or select a profile. Members can read the profiles; a chef can rename only the profile used by their current session.
- `customer_profiles`: stable family customer identities with the same naming rules, separate from chef profiles.
- `members`: per-device display name, verified role, and the corresponding chef- or customer-profile reference.
- `requests.customer_profile_id`: server-stamped customer ownership that survives device changes and renames; chef requests and unlinked legacy requests retain original-device attribution.
- `categories`: bilingual labels, emoji, order.
- `dishes`: chef-owned menu metadata, private image path, structured options, availability/archive state.
- `requests`: immutable dish/price/requester snapshots and selected options. Writes use functions; customers can cancel only their own pending requests. Chef can complete pending, undo completed, cancel pending requests, and explicitly delete pending or cancelled requests. Cancelled entries cannot return to pending.
- `private.access_secrets`: versioned credential hashes (and legacy bcrypt hashes). `private.unlock_attempts`: device attempt windows. Neither is readable by a browser.

`place_request` validates every option against the current dish, snapshots its current price/name, and uses a `(created_by, client_id)` unique key for safe retries. Archiving dishes and ending sessions do not erase request history.

The `dish-photos` bucket is private. Storage policies scope reads to verified kitchen members and writes to chefs. The browser downloads authorized blobs rather than publishing long-lived image URLs. Uploads accept JPEG, PNG, WebP, and iPhone HEIC/HEIF files up to 20MB. The browser checks the file header instead of relying on its name or MIME label. It tries native decoding first, including an image-element fallback for Safari; HEIC decoding falls back to a lazily loaded `heic-to` worker. Processing stays on the device. The converted preview is also the upload, resized to a maximum 1200px edge and limited to 2MB. Output is WebP, or JPEG on browsers without WebP encoding; the stored extension and content type match the actual output. No Storage policy update is needed. Referenced photos cannot be deleted; replacing a photo saves the dish first, then removes its old unreferenced object. Failed cleanup can leave an orphan; it never breaks a currently referenced image.

## Operational limits

A Supabase project is required for cross-device persistence. The demo is explicitly a separate development mode and stores fictional data locally. Its role switch cannot appear in a production build. The source repository and frontend hosting may be public without making database records public.

This first version is designed for a household, not a public restaurant: it loads kitchen history in paginated batches into memory. It has no payments, email invitations, multi-kitchen membership, push notifications, automatic translation, offline ordering, or persistent service-worker cache. Portable backup imports add menu records and are not atomic. The kitchen owner is responsible for keeping independent database and Storage backups if full disaster recovery is needed.

## Credential length update

Apply `202609220002_unrestricted_credentials.sql` after the initial migration, including for existing installations. Credential forms, kitchen provisioning, code changes, and unlock no longer impose character-count or byte-length limits. Empty values remain invalid; `null` in the code-change RPC means keep that credential. No whitespace normalization is performed on new credentials.

New hashes use a `snoi-v1$` marker, a random bcrypt salt at cost 10, and a printable HMAC-SHA-256 pre-hash of the complete UTF-8 credential keyed by the domain-prefixed bcrypt salt. Only the 64-character hex digest enters bcrypt, so long Unicode inputs are not truncated. This uses the salt-keyed pre-hash approach described in [Passlib's bcrypt-sha256 documentation](https://passlib.readthedocs.io/en/stable/lib/passlib.hash.bcrypt_sha256.html) with an application-specific encoding. It is not compatible with Passlib's serialized hash format. Neither plaintext credentials nor the intermediate pre-hash are stored.

Existing raw bcrypt hashes remain readable without resetting credentials or sessions. The legacy verification branch rejects candidates above 72 bytes, because the old app could not create such credentials and bcrypt would otherwise truncate a forged suffix. Setting a new credential always writes the new format. Underlying HTTP/database resource limits still apply; the app adds no length policy.

## Named chef profiles

Apply `202609220003_chef_profiles.sql` after 001 and 002. The update backfills existing same-name chefs into a single persistent profile and links their memberships without deleting Auth users or rewriting request history. Returning with the same chef name reuses that profile, and a different name creates another family chef. This is a shared-password family identity model, not individual verified accounts: the chef password is required for every new chef session, and its holders can select any chef name.

A unique index handles concurrent profile creation. Renaming through `set_display_name` updates that profile's current sessions through a trigger; it cannot take a name already held by another chef. Direct member edits cannot change the profile reference. Ending sessions or rotating the chef password revokes device access while preserving profiles. The UI counts profiles rather than chef sessions and keeps per-device revocation in a separate Settings disclosure. Migration 004 extends stable profiles and request ownership to customers.

## Named customer profiles

Apply `202609220004_customer_profiles.sql` after 001–003. It groups existing customer memberships by normalized name, preserves separate chef profiles, and links matching legacy customer requests without changing snapshots or Auth-user references. Legacy requests are backfilled only once, using an existing customer membership with a matching recorded name; requests without this evidence retain their original-device ownership.

A trigger stamps the customer profile on every new request. Cancellation checks the caller's current customer profile against that stored ID, with the original-device fallback only for requests without an ID. The UI uses the same rule. Renaming cannot transfer requests; switching profiles on the original device does not override the stored owner. Customers cannot write profile references, insert arbitrary profiles, rename someone else's profile, complete requests, or acquire chef permissions. Kitchen-code rotation and individual session revocation immediately remove access without deleting profiles or requests.

Names are family identifiers, not individually verified accounts. A holder of the kitchen code can select any customer name, just as a holder of the chef password can select any chef name. The menu's headcount and Settings list use role-specific profiles; Settings keeps all device sessions in a separate chef-managed list.

## Language preferences and bilingual content

Migration `202609220005_language_preferences.sql` adds a nullable `preferred_language` (`en` or `zh`) to both profile tables. Existing profile RLS restricts updates to the current member's profile; the invoker RPC `set_language_preference` exposes no arbitrary target ID. First-visit initialization uses an atomic “only if unset” update, so joining from another device does not overwrite an established preference. Explicit Settings/header changes update the profile. Refresh restores it, while pre-entry language also has a device-local fallback. Profile renames, ended sessions, and code rotation retain the preference.

English `name` and Chinese `name_zh` remain separate fields. Dishes, categories and request snapshots require at least one nonblank name; existing length limits remain. The editor requires the current interface language's name and presents the other translation as optional. Descriptions remain optional. Rendering falls back in both directions, and backup/import accepts a name in either language. Chinese-only orders preserve the original Chinese name in history.

## Wishlist deletion and mobile input

Migration `202609220006_delete_wishlist_requests.sql` adds `delete_wishlist_request(uuid)`; `202609230007_delete_cancelled_requests.sql` extends it to cancelled items in History. The security-definer function uses an empty search path, verifies the caller’s current chef membership, scopes lookup to that kitchen, and locks the request before requiring `pending` or `cancelled`. Customers, outsiders and revoked chef sessions cannot call it successfully. Direct table deletion remains unavailable to browser clients. A stale card cannot delete a completed request; repeating a successful deletion is harmless. The bilingual UI requires confirmation, then removes the row permanently without touching its dish, photo, or other requests.

Text inputs, textareas and selects use at least 16px text to avoid iPhone focus zoom. Touch controls use `touch-action: manipulation` for repeated taps while retaining pinch zoom, and text sizing stays stable across orientation changes. The viewport stays device-width with initial scale 1, without a maximum-scale cap or disabling user scaling.
