# Calpe 2026 — GitHub Pages + Supabase

This version is a static mobile-first web app for `calpe.jankech.cz`. GitHub Pages serves the HTML/CSS/JS/images; Supabase provides Google login and the shared Postgres database. Google Apps Script and Google Sheets are no longer required.

## Tomorrow: shortest deployment path

### 1. Create the Supabase project

Create a new Supabase project. In **SQL Editor** run, in this order:

1. `supabase/01_schema.sql`
2. Open `supabase/02_seed.sql`, replace `REPLACE_WITH_YOUR_GOOGLE_EMAIL`, check the trip dates, and then run it.

The seed creates your admin participant, the Calpe trip, currencies and expense categories. Once you can log in, add the other friends from **Viac → Účastníci**.

If you already ran an older version of `01_schema.sql`, simply run the updated file again. It is designed to be re-runnable and will add the private `calpe-media` bucket and its Storage policies.

### 2. Configure Google login in Supabase

In Supabase **Authentication → Providers → Google**, enable Google.

In Google Cloud / Google Auth Platform create an OAuth client of type **Web application**. Use:

- **Authorized JavaScript origin:** `https://calpe.jankech.cz`
- **Authorized redirect URI:** use the exact Supabase callback URL shown on the Google provider page in your Supabase dashboard. It normally looks like `https://<project-ref>.supabase.co/auth/v1/callback`.

Copy the Google Client ID and Client Secret into the Supabase Google provider settings.

Then in Supabase **Authentication → URL Configuration** set:

- **Site URL:** `https://calpe.jankech.cz`
- **Redirect URL:** `https://calpe.jankech.cz`

For local testing you can additionally allow a localhost URL, but it is not required for the first production deployment.

### 3. Put the public Supabase values in `config.js`

From the Supabase project dashboard copy the project URL and the **publishable key** and edit:

```js
window.CALPE_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'YOUR_PUBLISHABLE_KEY',
  TRIP_SLUG: 'calpe-2026',
  SITE_URL: 'https://calpe.jankech.cz'
};
```

The publishable browser key is intended to be public. **Never put a `service_role` / secret key in GitHub.** Access is enforced by the Row Level Security policies in `01_schema.sql`.

### 4. Replace the current GitHub Pages contents

Copy the contents of this folder into the root of `Jankech/calpe`, replacing the old forwarding `index.html`. Keep `CNAME` with:

```text
calpe.jankech.cz
```

After GitHub Pages publishes the commit, `https://calpe.jankech.cz` becomes the application itself rather than forwarding to Apps Script.

### 5. First login

Open `https://calpe.jankech.cz` and choose **Pokračovať cez Google**. The e-mail must exactly match the admin e-mail in `02_seed.sql`.

After login:

1. Go to **Viac → Výprava** and confirm the trip dates.
2. Go to **Viac → Účastníci** and add each friend's Google e-mail.
3. Go to **Viac → Pobyt** and set arrival/departure dates.
4. Check currency rates before using non-EUR expenses.

Friends can then sign in with their listed Google accounts. Unlisted accounts receive the polished “no access” screen and cannot read the trip data because of RLS.

## Participant photos and trip cover

`01_schema.sql` now creates a private Supabase Storage bucket named **`calpe-media`**. No manual bucket setup is required when you run the schema in the SQL Editor.

After signing in, every participant can go to **Viac → Účet** and choose **Pridať/Zmeniť fotku**. The browser crops the selected image to a square, resizes it to 512×512 WebP and uploads it directly to the participant's protected Storage path. A participant can only change their own avatar; trip admins can manage all media paths at the Storage-policy level.

The trip admin can also go to **Viac → Výprava** and upload a trip cover. It is cropped to 1600×900 and appears as the **Viac** hero image. Removing it restores the generated default background.

The bucket is **private**. The app creates short-lived signed URLs after authentication, and Storage RLS only permits trip members to read the trip's images. The public GitHub repository never contains user-uploaded photos.

`assets/users/` remains only as an optional local fallback for existing photos; if neither a Supabase photo nor a local fallback exists, the app shows initials.

## Background photos

The four current generated images are local files:

- `assets/hero-expenses.webp`
- `assets/hero-bathroom.webp`
- `assets/hero-cup.webp`
- `assets/hero-more.webp`

You can replace any of them later with your own photo while keeping the filename. No code or Supabase change is required.

## What is implemented

- Google authentication through Supabase Auth and an e-mail allow-list based on trip participants.
- Expenses: compact feed, category icons, tap-to-open bottom sheet, full edit/delete, equal/night/custom splitting, settlement and payments.
- Bathroom: collapsed day accordions, two bathrooms, 15-minute morning slots and conflict protection.
- Calpe Cup: compact non-scrolling ranking, expandable point detail, avatars and category composition.
- Rides: compact feed, bottom-sheet detail/edit, multiple named sprints and hill climbs with 1st/2nd/3rd places, plus crashes, punctures and mechanical incidents.
- Mishap points: crash +10, puncture +5, mechanical +5.
- Podium points: sprint 6/4/2; hill climb 6/4/2.
- Everest: group total, number of complete Everests, progress to the next Everest and individual contributions.
- Drinks: date + time + occasion; multiple entries per day; 1 point per drink, plus sober-day and full-trip sober scoring. Variety/social patterns remain badges rather than extra points.
- Badges: riding, mishaps, recovery/drinks, money; first mishap badges are unique Platinum. Repeat mishap badges progress Gold I (1), Gold II (2), Gold III (3+) while retaining the exact × count.
- Settings: collapsed sections; stay dates are side-by-side; participant management is admin-only.
- Profile photos: each participant can upload/change/remove their own picture in Viac → Účet. Photos are resized client-side and stored in private Supabase Storage.
- Trip cover: admins can upload/change/remove a private trip cover in Viac → Výprava.
- Static UI assets stay in GitHub; user-generated images live in Supabase Storage.

## Scoring currently encoded in `app.js`

- 10 km = 1 point (completed 10 km blocks)
- 100 m climbing = 1 point (completed 100 m blocks)
- Sprint podium = 6 / 4 / 2
- Hill-climb podium = 6 / 4 / 2
- Crash = +10
- Puncture = +5
- Mechanical = +5
- Every recorded drink = +1
- Completed sober day = +2
- Entire trip sober = +20 after the trip has ended

Longest ride, Mountain Goat, Everest, Accountant, drink variety and similar achievements are badges only and do **not** add extra leaderboard points.

## Security model

Every shared data table has Row Level Security enabled. A signed-in account is a trip member only when its Google e-mail matches an active `participants` row. Admin-only configuration tables and participant management use an admin role. The special database functions also re-check trip membership before writing.

The browser never receives a database password, Google client secret or Supabase service-role key. The `calpe-media` bucket is private: Storage policies allow members to read media for their trip, participants to manage only their own avatar, and admins to manage the trip cover/all avatars.

## Files

```text
index.html                 main page
app.css                    visual system
app.js                     application logic
config.js                  your public Supabase project configuration
CNAME                      calpe.jankech.cz
manifest.webmanifest       home-screen metadata
assets/                    static backgrounds, icons and optional avatar fallbacks
supabase/01_schema.sql     database + RLS + database functions
supabase/02_seed.sql       initial trip/admin/reference data
```

