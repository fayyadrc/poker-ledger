import { useEffect, useState } from "react"
import { TrendingDown, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { formatMoney } from "@/lib/currency"
import { formatSessionDate } from "@/lib/formatDate"
import { computePlayerAnalytics } from "@/lib/playerStats"
import { cn, profitLossClass } from "@/lib/utils"

function StatCell({ label, children }) {
  return (
    <div className="space-y-1 rounded-lg bg-background/40 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm font-semibold tabular-nums text-foreground">{children}</div>
    </div>
  )
}

function formatSignedMoney(amount, currency) {
  const value = typeof amount === "number" ? amount : parseFloat(amount) || 0
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${formatMoney(value, currency)}`
}

export default function PlayerAnalytics({ members = [], sessions = [], transfers = [], currency }) {
  const names = members.map((m) => m.name)
  const namesKey = names.join("\0")
  const [selected, setSelected] = useState(names[0] || "")

  useEffect(() => {
    const nextNames = namesKey ? namesKey.split("\0") : []
    if (!nextNames.length) {
      setSelected("")
      return
    }
    setSelected((current) => (nextNames.includes(current) ? current : nextNames[0]))
  }, [namesKey])

  if (!names.length) {
    return <p className="text-caption">Add members to see player stats.</p>
  }

  const analytics = selected
    ? computePlayerAnalytics(selected, members, sessions, transfers)
    : null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="player-analytics-select">Player</Label>
        <select
          id="player-analytics-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex h-11 w-full rounded-xl border border-input bg-background/50 px-3.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {analytics && (
        <>
          <div className="flex items-end justify-between gap-3 border-b border-border/30 pb-3">
            <div>
              <p className="text-caption">Net P/L</p>
              <p className={cn("text-2xl font-semibold tabular-nums", profitLossClass(analytics.totalProfit))}>
                {formatSignedMoney(analytics.totalProfit, currency)}
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              {analytics.sessionsPlayed} session{analytics.sessionsPlayed === 1 ? "" : "s"}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCell label="Win rate">
              {analytics.sessionsPlayed ? `${Math.round(analytics.winRate * 100)}%` : "—"}
            </StatCell>
            <StatCell label="W / L / —">
              {analytics.wins} / {analytics.losses} / {analytics.breakEven}
            </StatCell>
            <StatCell label="Avg / session">
              <span className={profitLossClass(analytics.avgProfit)}>
                {analytics.sessionsPlayed ? formatSignedMoney(analytics.avgProfit, currency) : "—"}
              </span>
            </StatCell>
            <StatCell label="Invested">{formatMoney(analytics.totalInvested, currency)}</StatCell>
            <StatCell label="Biggest win">
              <span className={profitLossClass(analytics.biggestWin)}>
                {analytics.biggestWin > 0 ? formatSignedMoney(analytics.biggestWin, currency) : "—"}
              </span>
            </StatCell>
            <StatCell label="Biggest loss">
              <span className={profitLossClass(analytics.biggestLoss)}>
                {analytics.biggestLoss < 0 ? formatMoney(analytics.biggestLoss, currency) : "—"}
              </span>
            </StatCell>
            <StatCell label="Transfers">
              <span className={profitLossClass(analytics.transferNet)}>
                {formatSignedMoney(analytics.transferNet, currency)}
              </span>
            </StatCell>
            <StatCell label="Avg buy-in">
              {analytics.sessionsPlayed ? formatMoney(analytics.avgBuyIn, currency) : "—"}
            </StatCell>
          </div>

          {analytics.history.length > 0 ? (
            <div className="space-y-2">
              <p className="text-caption">Session history</p>
              <div className="divide-y divide-border/30 overflow-hidden rounded-xl border border-border/40">
                {analytics.history.map((row) => {
                  const positive = row.profit > 0
                  const negative = row.profit < 0
                  return (
                    <div
                      key={row.sessionId}
                      className="flex items-center justify-between gap-3 bg-card/30 px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{formatSessionDate(row.date)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(row.buyIn, currency)} in · {formatMoney(row.cashOut, currency)} out
                        </p>
                      </div>
                      <Badge variant="secondary" className={cn("shrink-0", profitLossClass(row.profit))}>
                        {positive && <TrendingUp className="mr-1 size-3.5" />}
                        {negative && <TrendingDown className="mr-1 size-3.5" />}
                        {formatSignedMoney(row.profit, currency)}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="text-caption">No completed sessions for this player yet.</p>
          )}
        </>
      )}
    </div>
  )
}
