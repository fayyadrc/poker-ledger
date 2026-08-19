import { useNavigate } from "react-router-dom"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import SectionPill from "@/components/reactbits/SectionPill"
import { signOut } from "@/lib/auth"
import { queryClient } from "@/lib/queryClient"
import { queryKeys, useAuthSession } from "@/lib/queries"

export default function AccountCard() {
  const navigate = useNavigate()
  const { data: user } = useAuthSession()

  const handleSignOut = async () => {
    try {
      await signOut()
    } finally {
      queryClient.removeQueries({ queryKey: queryKeys.authSession })
      queryClient.clear()
      navigate("/login", { replace: true })
    }
  }

  return (
    <SpotlightCard className="ui-card-hover space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Account</h2>
          <p className="text-sm text-muted-foreground">Your signed-in account.</p>
        </div>
        <SectionPill text="Signed in" />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user?.email || "Signed in"}</p>
        </div>
        <Button variant="outline" size="icon" onClick={handleSignOut} aria-label="Sign out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </SpotlightCard>
  )
}
