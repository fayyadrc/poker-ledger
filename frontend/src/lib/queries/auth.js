import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getCurrentUser, onAuthChange } from "@/lib/auth"
import { queryKeys } from "@/lib/queries/keys"

// Cached snapshot of the signed-in user ({ id, email } or null). Kept in
// lockstep with Supabase so login/logout/confirmation-redirect/another-tab all
// propagate instantly.
export function useAuthSession() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsubscribe = onAuthChange((user, event) => {
      queryClient.setQueryData(queryKeys.authSession, user ?? null)
      // On an actual identity change, drop the previous user's cached data so
      // it can never bleed into the next session.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        queryClient.invalidateQueries({ queryKey: queryKeys.me })
        queryClient.invalidateQueries({ queryKey: queryKeys.tables })
      }
    })
    return unsubscribe
  }, [queryClient])

  return useQuery({
    queryKey: queryKeys.authSession,
    queryFn: getCurrentUser,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  })
}
