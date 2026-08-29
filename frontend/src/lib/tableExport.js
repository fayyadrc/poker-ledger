/**
 * Build an ingest-compatible JSON payload for one table.
 * Only completed sessions are included so a re-import stays coherent.
 */
export function buildTableExportPayload(table, sessions = []) {
  const completedSessions = sessions
    .filter((session) => session.is_completed)
    .map((session) => ({
      date: session.date,
      players: (session.players || []).map((player) => ({
        name: player.name,
        total_buy_in: String(player.total_buy_in ?? "0"),
        cash_out: String(player.cash_out ?? "0"),
      })),
      settlements: (session.settlements || []).map((settlement) => ({
        from_player: settlement.from_player,
        to_player: settlement.to_player,
        amount: String(settlement.amount),
      })),
    }))

  const transfers = (table.transfers || []).map((transfer) => {
    const item = {
      from_player: transfer.from_player,
      to_player: transfer.to_player,
      amount: String(transfer.amount),
    }
    if (transfer.note) item.note = transfer.note
    return item
  })

  return {
    tables: [
      {
        name: table.name,
        default_buy_in: String(table.default_buy_in ?? "0"),
        default_buy_in_b: String(table.default_buy_in_b ?? "0"),
        currency: table.currency || "GBP",
        member_names: (table.members || []).map((member) => member.name),
        transfers,
        sessions: completedSessions,
      },
    ],
  }
}

export function tableExportFilename(tableName, date = new Date()) {
  const slug = String(tableName || "table")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "table"
  const stamp = date.toISOString().slice(0, 10)
  return `poker-ledger-${slug}-${stamp}.json`
}

export function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function exportTableToJson(table, sessions = []) {
  const payload = buildTableExportPayload(table, sessions)
  downloadJsonFile(tableExportFilename(table.name), payload)
  return payload
}
