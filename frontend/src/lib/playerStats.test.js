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
  it("treats a transfer as plain cash flow when neither side has debt backing it", () => {
    // Alice is up 15 (not in debt) and Bob is down 15 (not owed anything), so
    // Alice paying Bob $10 isn't settling any recorded debt between them —
    // it's just $10 leaving Alice's pocket and landing in Bob's.
    const stats = computePlayerStats(members, sessions, transfers)
    expect(stats.Alice.totalInvested).toBe(60)
    expect(stats.Alice.totalProfit).toBe(5) // 15 session profit - 10 paid out
    expect(stats.Bob.totalProfit).toBe(-5) // -15 session profit + 10 received
  })

  it("nets an actual debt toward zero instead of double-counting it", () => {
    const debtMembers = [{ id: 1, name: "Maya" }, { id: 2, name: "Hriday" }]
    const debtSessions = [
      {
        id: 1,
        is_completed: true,
        players: [
          { name: "Maya", total_buy_in: "0", cash_out: "-103" },
          { name: "Hriday", total_buy_in: "0", cash_out: "105" },
        ],
      },
    ]
    const stats = computePlayerStats(
      debtMembers,
      debtSessions,
      [{ from_player: "Maya", to_player: "Hriday", amount: "100" }]
    )
    expect(stats.Maya.totalProfit).toBe(-3) // owed 103, paid 100 -> still owes 3
    expect(stats.Hriday.totalProfit).toBe(5) // owed 105, collected 100 -> still owed 5
  })

  it("splits a transfer that partly settles debt and partly overpays it", () => {
    const debtMembers = [{ id: 1, name: "Aryan" }, { id: 2, name: "Rohan" }]
    const debtSessions = [
      {
        id: 1,
        is_completed: true,
        players: [
          { name: "Aryan", total_buy_in: "0", cash_out: "-50" },
          { name: "Rohan", total_buy_in: "0", cash_out: "80" },
        ],
      },
    ]
    const stats = computePlayerStats(
      debtMembers,
      debtSessions,
      [{ from_player: "Aryan", to_player: "Rohan", amount: "70" }]
    )
    // 50 of the 70 settles Aryan's actual debt (nets to 0); the extra 20 has
    // no debt behind it, so it's plain cash flow on top of that.
    expect(stats.Aryan.totalProfit).toBe(-20) // -50 + 50 settled - 20 excess
    expect(stats.Rohan.totalProfit).toBe(50) // 80 - 50 settled + 20 excess
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
    // Alice isn't in debt, so her $10 transfer to Bob is plain cash flow out.
    expect(analytics.transferNet).toBe(-10)
    expect(analytics.totalProfit).toBe(5)
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
