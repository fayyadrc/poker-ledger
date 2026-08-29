import { describe, expect, it } from "vitest"
import { computePlayerAnalytics, computePlayerStats, suggestSettlementAmount } from "@/lib/playerStats"

const members = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]

const sessions = [
  {
    id: 10,
    date: "2026-01-10",
    is_completed: true,
    players: [
      { name: "Alice", total_buy_in: "40", cash_out: "70" },
      { name: "Bob", total_buy_in: "40", cash_out: "10" },
    ],
  },
  {
    id: 11,
    date: "2026-02-01",
    is_completed: true,
    players: [
      { name: "Alice", total_buy_in: "20", cash_out: "5" },
      { name: "Bob", total_buy_in: "20", cash_out: "35" },
    ],
  },
  {
    id: 12,
    date: "2026-03-01",
    is_completed: false,
    players: [{ name: "Alice", total_buy_in: "50", cash_out: null }],
  },
]

const transfers = [{ from_player: "Alice", to_player: "Bob", amount: "10" }]

describe("computePlayerStats", () => {
  it("credits the payer and debits the recipient of a cash transfer", () => {
    const stats = computePlayerStats(members, sessions, transfers)
    expect(stats.Alice.totalInvested).toBe(60)
    expect(stats.Alice.totalProfit).toBe(25) // 15 session profit + 10 paid out
    expect(stats.Bob.totalProfit).toBe(-25) // -15 session profit - 10 received
  })

  it("applies the same payer-up/recipient-down direction even when it isn't settling debt", () => {
    // Aryan is up 19.70 (not owed by anyone specifically, not in debt) and
    // still pays Rohan 30 — the direction doesn't depend on either side's
    // existing balance.
    const debtMembers = [{ id: 1, name: "Aryan" }, { id: 2, name: "Rohan" }]
    const debtSessions = [
      {
        id: 1,
        is_completed: true,
        players: [
          { name: "Aryan", total_buy_in: "0", cash_out: "19.70" },
          { name: "Rohan", total_buy_in: "0", cash_out: "40.80" },
        ],
      },
    ]
    const stats = computePlayerStats(
      debtMembers,
      debtSessions,
      [{ from_player: "Aryan", to_player: "Rohan", amount: "30" }]
    )
    expect(stats.Aryan.totalProfit).toBeCloseTo(49.7)
    expect(stats.Rohan.totalProfit).toBeCloseTo(10.8)
  })
})

describe("computePlayerAnalytics", () => {
  it("returns session history and summary for one player", () => {
    const analytics = computePlayerAnalytics("Alice", members, sessions, transfers)

    expect(analytics.sessionsPlayed).toBe(2)
    expect(analytics.wins).toBe(1)
    expect(analytics.losses).toBe(1)
    expect(analytics.breakEven).toBe(0)
    expect(analytics.winRate).toBe(0.5)
    expect(analytics.totalInvested).toBe(60)
    expect(analytics.sessionProfit).toBe(15)
    expect(analytics.avgProfit).toBe(7.5)
    expect(analytics.avgBuyIn).toBe(30)
    expect(analytics.biggestWin).toBe(30)
    expect(analytics.biggestLoss).toBe(-15)
    expect(analytics.transferOut).toBe(10)
    expect(analytics.transferIn).toBe(0)
    expect(analytics.transferNet).toBe(10)
    expect(analytics.totalProfit).toBe(25)
    expect(analytics.history.map((row) => row.sessionId)).toEqual([11, 10])
  })

  it("handles a player with no completed sessions", () => {
    const analytics = computePlayerAnalytics("Carol", members, sessions, [])
    expect(analytics.sessionsPlayed).toBe(0)
    expect(analytics.totalProfit).toBe(0)
    expect(analytics.history).toEqual([])
  })
})

describe("suggestSettlementAmount", () => {
  it("suggests the exact smaller outstanding side", () => {
    expect(suggestSettlementAmount(-103, 105)).toBe(103) // owes 103, owed 105 -> min 103
    expect(suggestSettlementAmount(-105, 103)).toBe(103) // owes 105, owed 103 -> min 103
    expect(suggestSettlementAmount(-119, 200)).toBe(119)
  })

  it("suggests nothing when the payer isn't in debt or the recipient isn't owed", () => {
    expect(suggestSettlementAmount(50, 100)).toBe(0) // "payer" is actually up
    expect(suggestSettlementAmount(-50, -20)).toBe(0) // "recipient" is actually down too
    expect(suggestSettlementAmount(0, 0)).toBe(0)
  })
})
