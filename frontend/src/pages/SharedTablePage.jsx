import { Link, useNavigate, useParams } from "react-router-dom"
import { useReducedMotion } from "framer-motion"
import { Eye, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useJoinTable, useSharedTable } from "@/lib/queries"
import AppLoadingScreen from "@/components/layout/AppLoadingScreen"
import PageHeader from "@/components/layout/PageHeader"
import AuroraBackdrop from "@/components/reactbits/AuroraBackdrop"
import SectionPill from "@/components/reactbits/SectionPill"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import Leaderboard from "@/components/table/Leaderboard"
import TransfersList from "@/components/table/TransfersList"
import SessionsList from "@/components/table/SessionsList"

export default function SharedTablePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const { data, isLoading, isError } = useSharedTable(token)
  const joinTable = useJoinTable(token)

  if (isLoading) {
    return <AppLoadingScreen label="Opening table" />
  }

  if (isError || !data) {
    return (
      <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
        <AuroraBackdrop
          reduce={reduce}
          amplitude={0.75}
          blend={0.5}
          speed={0.45}
          className="pointer-events-none absolute inset-x-0 top-0 h-[42%]"
        />
        <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6 px-5 py-10">
          <Link to="/" className="text-2xl font-semibold tracking-tight">
            <span className="text-primary">♠</span> Poker Ledger
          </Link>
          <SpotlightCard className="w-full space-y-4 p-8 text-center">
            <Users className="mx-auto size-12 opacity-50" />
            <h2 className="text-section">Link not found</h2>
            <p className="text-caption">
              This share link is invalid or has been revoked by the table admin.
            </p>
            <Button className="w-full" variant="outline" onClick={() => navigate("/")}>
              Back to home
            </Button>
          </SpotlightCard>
        </div>
      </div>
    )
  }

  const { table, sessions, viewer } = data
  const members = table.members || []
  const transfers = table.transfers || []

  const handleJoin = () => {
    joinTable.mutate(undefined, {
      onSuccess: (result) => navigate(`/table/${result.table_id}`),
    })
  }

  const cta = viewer.is_owner || viewer.is_member ? (
    <Button className="h-11 rounded-xl" onClick={() => navigate(`/table/${table.id}`)}>
      Open table
    </Button>
  ) : viewer.is_authenticated ? (
    <Button className="h-11 rounded-xl" onClick={handleJoin} disabled={joinTable.isPending}>
      {joinTable.isPending ? "Joining…" : "Join table"}
    </Button>
  ) : (
    <Button
      className="h-11 rounded-xl"
      onClick={() => navigate(`/login?next=/shared/${token}`)}
    >
      Log in to join
    </Button>
  )

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-background text-foreground">
      <AuroraBackdrop
        reduce={reduce}
        amplitude={0.75}
        blend={0.5}
        speed={0.45}
        className="pointer-events-none absolute inset-x-0 top-0 h-[42%]"
      />
      <div className="relative z-10 mx-auto w-full max-w-lg px-5 pt-safe pb-safe md:max-w-2xl lg:max-w-3xl">
        <div className="page-stack py-6 md:py-8">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="text-sm font-semibold tracking-tight text-foreground">
              <span className="text-primary">♠</span> Poker Ledger
            </Link>
            <SectionPill text="Shared" />
          </div>

          <PageHeader
            title={table.name}
            subtitle={
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="size-3.5" />
                  View only
                </span>
                {table.owner_name ? (
                  <>
                    <span className="text-border">·</span>
                    <span>Owned by {table.owner_name}</span>
                  </>
                ) : null}
                <span className="text-border">·</span>
                <span>{members.length} players</span>
              </span>
            }
            action={cta}
          />

          <Leaderboard
            members={members}
            sessions={sessions}
            transfers={transfers}
            currency={table.currency}
          />

          <TransfersList transfers={transfers} currency={table.currency} as={SpotlightCard} />

          <section className="section-stack">
            <div className="flex items-center justify-between">
              <h2 className="text-section">Sessions</h2>
              <Badge variant="secondary">{sessions.length}</Badge>
            </div>
            <SessionsList
              sessions={sessions}
              readOnly
              linkable={false}
              currency={table.currency}
              emptyMessage="No sessions recorded yet."
            />
          </section>
        </div>
      </div>
    </div>
  )
}
