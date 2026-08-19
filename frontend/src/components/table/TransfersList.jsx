import { Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatMoney } from "@/lib/currency"

export default function TransfersList({ transfers, currency, as: Wrapper = Card, onDelete }) {
  if (!transfers?.length) return null

  const Content = Wrapper === Card ? CardContent : "div"
  const contentProps =
    Wrapper === Card
      ? { className: "divide-y divide-border/40 p-0" }
      : { className: "divide-y divide-border/40" }

  return (
    <section className="section-stack">
      <div className="flex items-center justify-between">
        <h2 className="text-section">Cash transfers</h2>
        <Badge variant="outline" className="text-xs">Off-table</Badge>
      </div>
      <Wrapper {...(Wrapper === Card ? {} : { className: "overflow-hidden p-0" })}>
        <Content {...contentProps}>
          {transfers.map((transfer) => (
            <div
              key={transfer.id}
              className="flex items-center justify-between gap-4 p-5 text-base"
            >
              <div className="min-w-0">
                <p>
                  <span className="font-medium">{transfer.from_player}</span>
                  <span className="text-muted-foreground"> paid </span>
                  <span className="font-medium">{transfer.to_player}</span>
                </p>
                {transfer.note && (
                  <p className="truncate text-sm text-muted-foreground">{transfer.note}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="secondary">{formatMoney(transfer.amount, currency)}</Badge>
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label="Delete cash transfer"
                    onClick={() => onDelete(transfer)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Content>
      </Wrapper>
    </section>
  )
}
