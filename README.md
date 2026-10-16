# Calpe 2026 — GitHub Pages + Supabase

Static mobile-first app for `calpe.jankech.cz`. GitHub Pages serves the HTML/CSS/JS/assets; Supabase provides Google login, Postgres, Row Level Security and private image Storage. Apps Script is no longer used at runtime.

## Recommended setup order

### 1. Create the Supabase project

In **Supabase → SQL Editor**, run these files in order:

1. `supabase/01_schema.sql`
2. Edit `supabase/02_seed.sql` and replace `REPLACE_WITH_YOUR_GOOGLE_EMAIL`, then run it.
3. Run `supabase/03_import_legacy.sql` to import the attached legacy Google Sheet data.
4. Optional: run `supabase/04_test_data.sql` to create demo rides/drinks/events. The same demo data can also be generated later from **Viac → Administrácia**.

The scripts are designed so `01_schema.sql` and `03_import_legacy.sql` can be re-run safely during setup.

### 2. What the legacy import contains

`03_import_legacy.sql` was generated from `Cyklo_sustredenie_Calpe.xlsx` supplied with this build. It imports:

- 5 participants: Adam, Marek, Tomáš, Jozef, Pavel
- their existing stay dates
- the legacy currencies and categories
- **5 active expenses totalling €3,140**
- the existing custom bike-rental split weights
- no payments, because the legacy `DB_Platby` sheet has no active records

The deleted €1,000 Hotel test/old row is deliberately excluded.

`Pavel` keeps the real admin Google e-mail entered in `02_seed.sql`. Other imported participants receive temporary addresses such as `adam@pending.local`. After login, replace them with the correct Google e-mails in **Viac → Účastníci**. Those exact e-mails are the access allow-list.

### 3. Configure Google login

In Supabase **Authentication → Providers → Google**, enable Google.

In Google Cloud / Google Auth Platform create an OAuth client of type **Web application**:

- Authorized JavaScript origin: `https://calpe.jankech.cz`
- Authorized redirect URI: use the exact Supabase callback URL shown on the Google provider page, normally `https://<project-ref>.supabase.co/auth/v1/callback`

Copy the Google Client ID and Client Secret into Supabase.

In **Authentication → URL Configuration** set:

- Site URL: `https://calpe.jankech.cz`
- Redirect URL: `https://calpe.jankech.cz`

### 4. Configure `config.js`

From the Supabase project dashboard copy the **Project URL** and **publishable key** and edit:

```js
window.CALPE_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_...',
  TRIP_SLUG: 'calpe-2026',
  SITE_URL: 'https://calpe.jankech.cz'
};
```

The Project URL and publishable key are intentionally public browser values. Never put a `service_role`, `sb_secret_...`, database password or Google OAuth client secret in GitHub.

### 5. Publish to GitHub Pages

Copy this folder into the root of `Jankech/calpe`, replacing the old forwarding page. Keep the included `CNAME`:

```text
calpe.jankech.cz
```

After GitHub Pages publishes the commit, `https://calpe.jankech.cz` is the application itself.

## Admin controls

Users with `participants.role = 'admin'` see **Viac → Administrácia**.

The admin can:

- change all Calpe Cup scoring values; changes recalculate the complete leaderboard immediately
- show/hide **Kúpeľňa** for everybody
- show/hide TEST records in every ride/drink list, leaderboard, Everest calculation and badge calculation
- generate a fresh demo dataset
- delete all demo data

Default scoring is:

- 10 km = 1 point
- 100 m climbing = 1 point
- drink = 1 point
- sprint podium = 6 / 4 / 2
- hill podium = 6 / 4 / 2
- crash = 10
- puncture = 5
- mechanical = 5
- completed sober day = 2
- full trip sober = 20

The scoring configuration is stored in `trips.score_settings`, not hard-coded as the only possible configuration.

## Bathroom / bottom navigation

Bathroom is **hidden by default**. When hidden, the four primary mobile buttons are:

**Výdavky · Odznaky · Calpe Cup · Viac**

If an admin enables Bathroom, its button replaces the Odznaky shortcut. Odznaky are still accessible as a Calpe Cup tab.

## TEST data

`generate_test_data()` creates **6 demo rides** plus **10 demo drink records**, with sprints, hill-climb podiums, a puncture, a mechanical and a crash. All demo rides/drinks are marked `is_test=true`.

When **Show test data** is off, they are excluded from:

- journals
- totals and score
- Everest
- mishaps
- drink statistics
- achievements/badges

Real expenses and participants are never touched by the test-data generator.

## Achievements / team view

Odznaky now work as a team collection rather than only a personal list:

- latest unlocks appear at the top with avatar + date
- **Odznaky** view shows the catalogue and everyone who has each badge
- tap a badge for its full description and all earners
- **Ľudia** view shows every participant and their badge collection
- tap a person for their complete achievement profile

First crash / puncture / mechanical remain unique Platinum badges. Repeat mishaps progress through Gold I, Gold II and Gold III while preserving the exact count.

## Participant photos, trip cover and IBAN

The private Supabase Storage bucket `calpe-media` is created automatically by `01_schema.sql`.

Each participant can use **Viac → Účet** to:

- upload/change/remove their profile photo
- set/change/remove their IBAN

The browser crops avatars to 512×512 WebP before upload. The trip admin can upload the trip cover from **Viac → Výprava**. Storage is private and the app uses short-lived signed URLs.

IBANs are visible only to authenticated members of the trip and appear next to settlement transfers with a copy button.

## New logo

The app icon was replaced by a bolder symbol-only mark combining:

- Spanish/Mediterranean sun
- mountain silhouette
- sweeping coastal road
- road bike

`assets/icon.svg`, `icon-192.png` and `icon-512.png` are ready for the browser/PWA/home-screen icon.

## Main files

```text
index.html
app.css
app.js
config.js
CNAME
manifest.webmanifest
assets/
supabase/01_schema.sql
supabase/02_seed.sql
supabase/03_import_legacy.sql
supabase/04_test_data.sql
```
