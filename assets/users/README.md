# Optional local avatar fallbacks

Participant photos are now managed by each user in **Viac → Účet** and stored privately in Supabase Storage.

This folder is only a fallback: if no Supabase avatar exists, the app still tries `assets/users/<slug>.webp` and then falls back to initials. You can leave this folder empty.
