import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card"
import { formatSessionDate } from "@/lib/formatDate"
import { formatMoney } from "@/lib/currency"
import SessionDateEdit from "@/components/session/SessionDateEdit"

function SessionCard({ session, tableId, readOnly, showSettlements, currency }) {
  const settlements = showSettlements ? session.settlements || [] : []
  return (
    <Card className={readOnly ? "" : "active:scale-[0.99] transition-transform touch-manipulation"}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-4 pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">
            {readOnly ? (
              formatSessionDate(session.date)
            ) : (
              <SessionDateEdit sessionId={session.id} tableId={tableId} date={session.date} />
            )}
          </div>
          <CardDescription className="mt-1">
            {session.players?.length || 0} players
          </CardDescription>
        </div>
        <Badge variant={!session.is_completed ? "default" : "secondary"}>
          {!session.is_completed ? "Active" : "Done"}
        </Badge>
      </CardHeader>
      {settlements.length > 0 && (
        <CardContent className="space-y-1.5 border-t border-border/40 pt-3">
          {settlements.map((item) => (
            <div
              key={item.id ?? `${item.from_player}-${item.to_player}-${item.amount}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{item.from_player}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{item.to_player}</span>
              </div>
              <span className="shrink-0 tabular-nums text-primary">
                {formatMoney(item.amount, currency)}
              </span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

export default function SessionsList({
  sessions,
  tableId,
  readOnly = false,
  linkable = true,
  currency,
  listRef,
  emptyMessage,
  showEmpty = true,
}) {
  // When sessions aren't clickable (e.g. the public share link), there's no
  // way to drill into a session's own settlement table, so show it inline.
  const showSettlements = !linkable
  return (
    <div ref={listRef} className="space-y-3">
      {sessions.map((session) => {
        const card = (
          <SessionCard
            session={session}
            tableId={tableId}
            readOnly={readOnly}
            showSettlements={showSettlements}
            currency={currency}
          />
        )
        if (!linkable) {
          return <div key={session.id}>{card}</div>
        }
        return (
          <Link
            key={session.id}
            to={session.is_completed ? `/summary/${session.id}` : `/session/${session.id}`}
            className="block"
          >
            {card}
          </Link>
        )
      })}
      {showEmpty && sessions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/40 py-10 text-center text-sm text-muted-foreground">
          {emptyMessage || "No sessions yet."}
        </div>
      )}
    </div>
  )
}
