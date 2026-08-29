import { toAmount } from "@/lib/sessionBalance"

export function computePlayerStats(members, sessions, transfers) {
  const stats = members.reduce((acc, member) => {
    acc[member.name] = { totalInvested: 0, totalProfit: 0 }
    sessions
      .filter((session) => session.is_completed)
      .forEach((session) => {
        const player = session.players.find((entry) => entry.name === member.name)
        if (!player) return
        acc[member.name].totalInvested += toAmount(player.total_buy_in)
        if (player.cash_out !== null) {
          acc[member.name].totalProfit += toAmount(player.cash_out) - toAmount(player.total_buy_in)
        }
      })
    return acc
  }, {})

  // A transfer only has existing debt to "settle" up to what the payer
  // actually owes and what the recipient is actually owed — that portion
  // nets both balances toward zero (paying down real debt). Any amount
  // beyond that isn't backed by a recorded debt, so it's plain cash leaving
  // the payer's pocket and landing in the recipient's, same as a buy-in /
  // cash-out: it moves the payer's balance down and the recipient's up.
  for (const transfer of transfers || []) {
    const amount = toAmount(transfer.amount)
    const fromStats = stats[transfer.from_player]
    const toStats = stats[transfer.to_player]
    const owedByFrom = fromStats ? Math.max(0, -fromStats.totalProfit) : 0
    const owedToRecipient = toStats ? Math.max(0, toStats.totalProfit) : 0
    const settlePortion = Math.min(amount, owedByFrom, owedToRecipient)
    const excess = amount - settlePortion
    const netChangeForFrom = settlePortion - excess
    if (fromStats) fromStats.totalProfit += netChangeForFrom
    if (toStats) toStats.totalProfit -= netChangeForFrom
  }

  return stats
}

/**
 * Default amount for a cash settlement between two players, rounded down to
 * the nearest 10 so small change (e.g. the 5 in 105, the 3 in 103) is left
 * for the exact figure to be typed in manually instead of forced on anyone.
 * Returns 0 (no suggestion) when the payer isn't actually in debt or the
 * recipient isn't actually owed anything.
 */
export function suggestSettlementAmount(fromBalance, toBalance) {
  const owedByFrom = Math.max(0, -fromBalance)
  const owedToRecipient = Math.max(0, toBalance)
  return Math.min(owedByFrom, owedToRecipient)
}

/** Per-player breakdown for table settings (beta / labs). */
export function computePlayerAnalytics(playerName, members, sessions, transfers) {
  const history = (sessions || [])
    .filter((session) => session.is_completed)
    .map((session) => {
      const player = session.players?.find((entry) => entry.name === playerName)
      if (!player || player.cash_out === null || player.cash_out === undefined) return null
      const buyIn = toAmount(player.total_buy_in)
      const cashOut = toAmount(player.cash_out)
      return {
        sessionId: session.id,
        date: session.date,
        buyIn,
        cashOut,
        profit: cashOut - buyIn,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const sessionsPlayed = history.length
  const wins = history.filter((row) => row.profit > 0).length
  const losses = history.filter((row) => row.profit < 0).length
  const breakEven = sessionsPlayed - wins - losses
  const totalInvested = history.reduce((sum, row) => sum + row.buyIn, 0)
  const sessionProfit = history.reduce((sum, row) => sum + row.profit, 0)
  const avgProfit = sessionsPlayed ? sessionProfit / sessionsPlayed : 0
  const avgBuyIn = sessionsPlayed ? totalInvested / sessionsPlayed : 0

  const winProfits = history.map((row) => row.profit).filter((p) => p > 0)
  const lossProfits = history.map((row) => row.profit).filter((p) => p < 0)
  const biggestWin = winProfits.length ? Math.max(...winProfits) : 0
  const biggestLoss = lossProfits.length ? Math.min(...lossProfits) : 0

  let transferIn = 0
  let transferOut = 0
  for (const transfer of transfers || []) {
    const amount = toAmount(transfer.amount)
    if (transfer.to_player === playerName) transferIn += amount
    if (transfer.from_player === playerName) transferOut += amount
  }
  // Delegate the actual profit adjustment to computePlayerStats — it applies
  // the debt-vs-excess split (see its comment) across every player's
  // transfers, which this single-player loop above can't do on its own.
  const totalProfit = computePlayerStats(members || [], sessions, transfers)[playerName]?.totalProfit ?? sessionProfit
  const transferNet = totalProfit - sessionProfit

  return {
    sessionsPlayed,
    wins,
    losses,
    breakEven,
    winRate: sessionsPlayed ? wins / sessionsPlayed : 0,
    totalInvested,
    sessionProfit,
    avgProfit,
    avgBuyIn,
    biggestWin,
    biggestLoss,
    transferIn,
    transferOut,
    transferNet,
    totalProfit,
    history,
  }
}
