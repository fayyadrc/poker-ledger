import { createClient } from "@supabase/supabase-js"

// Public project URL + anon (publishable) key. These are safe to ship to the
// browser — the anon key only grants what RLS/Supabase Auth allow. The JWT
// signing secret and service-role key stay server-side (Django) only.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // createClient throws "supabaseUrl is required." on empty input, which
  // white-screens the app. Add a clearer hint first so the fix is obvious.
  console.error(
    "[supabase] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. " +
      "Copy them from Supabase → Project Settings → API into frontend/.env.local.",
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Lets the email-confirmation / magic-link redirect drop the user straight
    // into an authenticated session when they land back on the app.
    detectSessionInUrl: true,
  },
})
