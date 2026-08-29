import { ArrowRight } from "lucide-react"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import SectionPill from "@/components/reactbits/SectionPill"
import { formatMoney } from "@/lib/currency"

export default function SessionSettlement({ settlements = [], currency = "GBP" }) {
  if (!settlements.length) {
    return (
      <section className="section-stack">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section">Settlement</h2>
          <SectionPill text="Even" />
        </div>
        <SpotlightCard className="p-5">
          <p className="text-caption">Everyone broke even. No payments needed.</p>
        </SpotlightCard>
      </section>
    )
  }

  return (
    <section className="section-stack">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section">Settlement</h2>
          <SectionPill text="Pay up" />
        </div>
        <p className="text-caption">Who pays whom to settle up after this session.</p>
      </div>
      <SpotlightCard className="overflow-x-auto p-0">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border/50 text-caption">
              <th className="px-5 py-3 font-medium">From</th>
              <th className="px-5 py-3 font-medium" />
              <th className="px-5 py-3 font-medium">To</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((item) => (
              <tr
                key={item.id ?? `${item.from_player}-${item.to_player}-${item.amount}`}
                className="border-b border-border/30 last:border-0"
              >
                <td className="max-w-0 truncate px-5 py-3 font-medium">{item.from_player}</td>
                <td className="px-2 py-3">
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </td>
                <td className="max-w-0 truncate px-5 py-3 font-medium">{item.to_player}</td>
                <td className="px-5 py-3 text-right font-semibold tabular-nums text-primary">
                  {formatMoney(item.amount, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SpotlightCard>
    </section>
  )
}
