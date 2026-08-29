import { describe, it, expect } from "vitest"
import { buildTableExportPayload, tableExportFilename } from "@/lib/tableExport"

describe("tableExport", () => {
  it("builds ingest-compatible payload and skips incomplete sessions", () => {
    const table = {
      name: "Friday Night",
      default_buy_in: "0",
      currency: "GBP",
      members: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      transfers: [
        { from_player: "Alice", to_player: "Bob", amount: "50.00", note: "Venmo" },
      ],
    }
    const sessions = [
      {
        date: "2026-04-05",
        is_completed: true,
        players: [
          { name: "Alice", total_buy_in: "20.00", cash_out: "30.00" },
          { name: "Bob", total_buy_in: "20.00", cash_out: "10.00" },
        ],
        settlements: [
          { id: 1, from_player: "Bob", to_player: "Alice", amount: "10.00", order: 0 },
        ],
      },
      {
        date: "2026-04-06",
        is_completed: false,
        players: [{ name: "Alice", total_buy_in: "20.00", cash_out: "0" }],
      },
    ]

    expect(buildTableExportPayload(table, sessions)).toEqual({
      tables: [
        {
          name: "Friday Night",
          default_buy_in: "0",
          default_buy_in_b: "0",
          currency: "GBP",
          member_names: ["Alice", "Bob"],
          transfers: [
            { from_player: "Alice", to_player: "Bob", amount: "50.00", note: "Venmo" },
          ],
          sessions: [
            {
              date: "2026-04-05",
              players: [
                { name: "Alice", total_buy_in: "20.00", cash_out: "30.00" },
                { name: "Bob", total_buy_in: "20.00", cash_out: "10.00" },
              ],
              settlements: [
                { from_player: "Bob", to_player: "Alice", amount: "10.00" },
              ],
            },
          ],
        },
      ],
    })
  })

  it("slugs filenames safely", () => {
    expect(tableExportFilename("Friday Night!!", new Date("2026-07-12T12:00:00Z"))).toBe(
      "poker-ledger-friday-night-2026-07-12.json"
    )
  })
})
