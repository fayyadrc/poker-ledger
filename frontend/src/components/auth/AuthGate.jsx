import { Navigate, Outlet, useLocation } from "react-router-dom"
import AppLoadingScreen from "@/components/layout/AppLoadingScreen"
import { useAuthSession } from "@/lib/queries"

// Gates the app's private routes on a live Supabase session. useAuthSession
// resolves the current user and stays subscribed to auth changes, so a sign-out
// (here or in another tab) bounces back to /login automatically.
export default function AuthGate() {
  const location = useLocation()
  const { data: user, isPending } = useAuthSession()

  if (isPending) {
    return <AppLoadingScreen label="Signing in" />
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
