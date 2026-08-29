import { History, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import SectionPill from "@/components/reactbits/SectionPill"
import { formatAuditTimestamp } from "@/lib/formatDate"
import { formatMoney } from "@/lib/currency"
import { useSettlementHistory } from "@/lib/queries"
import { ACTION_LABELS, actionVariant } from "@/components/session/SessionAuditLog"

export default function SettlementHistory({ sessionId, currency = "GBP" }) {
  const { data: batches = [], isLoading } = useSettlementHistory(sessionId)

  return (
    <section className="section-stack">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="size-5 text-muted-foreground" />
          <h2 className="text-section">Settlement History</h2>
        </div>
        <SectionPill text="History" />
      </div>

      {isLoading && !batches.length ? (
        <SpotlightCard className="p-5">
          <p className="text-caption">Loading history…</p>
        </SpotlightCard>
      ) : batches.length === 0 ? (
        <SpotlightCard className="p-5">
          <p className="text-caption">No settlement history yet.</p>
        </SpotlightCard>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <SpotlightCard key={batch.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={actionVariant(batch.reason)}>
                  {ACTION_LABELS[batch.reason] || batch.reason}
                </Badge>
                <span className="text-caption tabular-nums">
                  {formatAuditTimestamp(batch.created_at)}
                </span>
              </div>
              {batch.lines.length === 0 ? (
                <p className="text-body text-muted-foreground">Everyone was even.</p>
              ) : (
                <div className="space-y-2">
                  {batch.lines.map((line) => (
                    <div key={line.id} className="flex items-center justify-between gap-3 text-body">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate">{line.from_player}</span>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{line.to_player}</span>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatMoney(line.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SpotlightCard>
          ))}
        </div>
      )}
    </section>
  )
}
