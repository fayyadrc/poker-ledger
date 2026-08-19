import { supabase } from "./supabase"

// Thin wrapper over Supabase Auth. Replaces the old django-allauth client.
// The rest of the app talks to Django's /api/ with the access token from here.

// Current access token (JWT) or null. supabase-js refreshes it transparently
// as it nears expiry, so callers can request this per API call.
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

// Normalised snapshot of the signed-in user, or null when signed out.
function toUser(sessionUser) {
  return sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession()
  return toUser(data.session?.user)
}

// Subscribe to auth changes (login, logout, token refresh, confirmation
// redirect, or a change in another tab). Returns an unsubscribe function.
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(toUser(session?.user), event)
  })
  return () => data.subscription.unsubscribe()
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(friendlyAuthError(error))
  return toUser(data.user)
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(friendlyAuthError(error))
  // With email confirmation required, Supabase returns no session until the
  // user clicks the link. Tell the caller so it can show the "check your inbox"
  // state instead of trying to route into the app.
  return { needsConfirmation: !data.session, user: toUser(data.user) }
}

export async function signOut() {
  await supabase.auth.signOut()
}

// Sends a password-reset email. The link lands the user back on
// /reset-password with a recovery session already active.
export async function resetPasswordForEmail(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw new Error(friendlyAuthError(error))
}

// Sets a new password for the user in the current (recovery) session.
export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(friendlyAuthError(error))
}

function friendlyAuthError(error) {
  const message = error?.message || "Authentication failed. Please try again."
  if (/email not confirmed/i.test(message)) {
    return "Please confirm your email first — check your inbox for the link."
  }
  if (/invalid login credentials/i.test(message)) {
    return "Incorrect email or password."
  }
  if (/already registered/i.test(message)) {
    return "That email is already registered. Try signing in instead."
  }
  return message
}
