import { History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import SectionPill from "@/components/reactbits/SectionPill"
import { formatAuditTimestamp } from "@/lib/formatDate"
import { useSessionAuditLog } from "@/lib/queries"

export const ACTION_LABELS = {
  session_created: "Started",
  date_changed: "Date changed",
  buy_in_added: "Buy-in",
  player_added: "Player joined",
  session_completed: "Completed",
  session_completed_with_discrepancy: "Completed with discrepancy",
  amounts_adjusted: "Amounts adjusted",
  session_imported: "Imported",
  migrated: "Migrated",
}

export function actionVariant(action) {
  if (action === "session_completed_with_discrepancy") return "destructive"
  if (action === "session_completed") return "default"
  return "secondary"
}

export default function SessionAuditLog({ sessionId }) {
  const { data: entries = [], isLoading } = useSessionAuditLog(sessionId)

  return (
    <section className="section-stack">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="size-5 text-muted-foreground" />
          <h2 className="text-section">Activity</h2>
        </div>
        <SectionPill text="Log" />
      </div>

      {isLoading && !entries.length ? (
        <SpotlightCard className="p-5">
          <p className="text-caption">Loading activity…</p>
        </SpotlightCard>
      ) : entries.length === 0 ? (
        <SpotlightCard className="p-5">
          <p className="text-caption">No activity recorded yet.</p>
        </SpotlightCard>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <SpotlightCard key={entry.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={actionVariant(entry.action)}>
                  {ACTION_LABELS[entry.action] || entry.action}
                </Badge>
                <span className="text-caption tabular-nums">
                  {formatAuditTimestamp(entry.created_at)}
                </span>
              </div>
              <p className="text-body">{entry.message}</p>
            </SpotlightCard>
          ))}
        </div>
      )}
    </section>
  )
}
