import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog"
import { toAmount } from "@/lib/sessionBalance"
import { computePlayerStats, suggestSettlementAmount } from "@/lib/playerStats"
import { useCreateTransfer } from "@/lib/queries"

export default function AddTransferDialog({
  tableId,
  members = [],
  sessions = [],
  transfers = [],
  open,
  onOpenChange,
}) {
  const createTransfer = useCreateTransfer(tableId)
  const [fromPlayer, setFromPlayer] = useState("")
  const [toPlayer, setToPlayer] = useState("")
  const [amount, setAmount] = useState("")
  const [amountTouched, setAmountTouched] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")

  const playerStats = useMemo(
    () => computePlayerStats(members, sessions, transfers),
    [members, sessions, transfers]
  )

  const suggestedAmount = useMemo(() => {
    if (!fromPlayer || !toPlayer || fromPlayer === toPlayer) return 0
    const fromBalance = playerStats[fromPlayer]?.totalProfit ?? 0
    const toBalance = playerStats[toPlayer]?.totalProfit ?? 0
    return suggestSettlementAmount(fromBalance, toBalance)
  }, [fromPlayer, toPlayer, playerStats])

  useEffect(() => {
    if (amountTouched || !suggestedAmount) return
    setAmount(String(suggestedAmount))
  }, [suggestedAmount, amountTouched])

  const handleOpenChange = (next) => {
    if (next) {
      setFromPlayer("")
      setToPlayer("")
      setAmount("")
      setAmountTouched(false)
      setNote("")
      setError("")
    }
    onOpenChange(next)
  }

  const isValid = fromPlayer && toPlayer && fromPlayer !== toPlayer && toAmount(amount) > 0

  const handleSubmit = () => {
    setError("")
    if (fromPlayer === toPlayer) {
      setError("Pick two different players.")
      return
    }
    createTransfer.mutate(
      { fromPlayer, toPlayer, amount: String(toAmount(amount)), note: note.trim() },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => setError(err.message),
      }
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg border-border/50 bg-card/80 backdrop-blur-xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-2xl">Record cash settlement</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Log a cash payment made outside a session so it's visible to everyone on this table.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="transfer-from">Paid by</Label>
              <select
                id="transfer-from"
                value={fromPlayer}
                onChange={(e) => setFromPlayer(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background/50 px-3 text-sm"
              >
                <option value="">Select player</option>
                {members.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-to">Paid to</Label>
              <select
                id="transfer-to"
                value={toPlayer}
                onChange={(e) => setToPlayer(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background/50 px-3 text-sm"
              >
                <option value="">Select player</option>
                {members.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-amount">Amount</Label>
            <Input
              id="transfer-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmountTouched(true)
                setAmount(e.target.value)
              }}
              placeholder="0.00"
              className="h-11 bg-card"
            />
            {!amountTouched && suggestedAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Prefilled from the outstanding balance — edit to enter a different amount.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-note">Note (optional)</Label>
            <Input
              id="transfer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Settled over Venmo"
              className="h-11 bg-card"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="h-11"
            onClick={handleSubmit}
            disabled={!isValid || createTransfer.isPending}
          >
            {createTransfer.isPending ? "Saving…" : "Save settlement"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
