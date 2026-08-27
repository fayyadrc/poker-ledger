import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { CheckCircle2, Pencil, Trash2, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import MoneyInput from "@/components/ui/MoneyInput"
import DiscrepancyDialog from "@/components/session/DiscrepancyDialog"
import ConfirmDialog from "@/components/ui/ConfirmDialog"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog"
import { formatMoney, getCurrencySymbol } from "@/lib/currency"
import { useAnimatedList } from "@/lib/hooks/useAnimatedList"
import { useSession, useAdjustSession, useAddPlayer, useDeleteSession } from "@/lib/queries"
import {
  buildAdjustPayload,
  draftFromPlayers,
  playerNet,
  sortPlayersByProfit,
  toAmount,
  validateAdjustDraft,
  balanceFromTotals,
  computeTotals,
} from "@/lib/sessionBalance"
import { profitLossClass } from "@/lib/utils"
import NotFoundState from "@/components/layout/NotFoundState"
import PageHeader from "@/components/layout/PageHeader"
import PageSkeleton from "@/components/layout/PageSkeleton"
import SessionDateEdit from "@/components/session/SessionDateEdit"
import SessionSettlement from "@/components/session/SessionSettlement"
import SessionAuditLog from "@/components/session/SessionAuditLog"

export default function SummaryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: session, isLoading } = useSession(id)
  const adjustSession = useAdjustSession(id, session?.table)
  const addPlayer = useAddPlayer(id)
  const deleteSession = useDeleteSession(id, session?.table)
  const [standingsRef] = useAnimatedList()

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [editError, setEditError] = useState("")
  const [isDiscrepancyDialogOpen, setIsDiscrepancyDialogOpen] = useState(false)
  const [isAddPlayerOpen, setIsAddPlayerOpen] = useState(false)
  const [newPlayerName, setNewPlayerName] = useState("")
  const [addPlayerError, setAddPlayerError] = useState("")
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  useEffect(() => {
    if (!session?.players || isEditing) return
    setDraft(draftFromPlayers(session.players))
  }, [session?.players, isEditing])

  if (isLoading && !session) return <PageSkeleton />
  if (!session) return <NotFoundState title="Summary not found" />

  const canEdit = session.can_edit !== false
  const players = session.players || []
  const currency = session.table_currency || "GBP"
  const currencySymbol = getCurrencySymbol(currency)
  const totalPot = players.reduce((sum, p) => sum + toAmount(p.total_buy_in), 0)

  const sortedPlayers = sortPlayersByProfit(players)
  const biggestWinner = sortedPlayers.length > 0 && playerNet(sortedPlayers[0]) > 0 ? sortedPlayers[0] : null
  const biggestLoser =
    sortedPlayers.length > 0 && playerNet(sortedPlayers[sortedPlayers.length - 1]) < 0
      ? sortedPlayers[sortedPlayers.length - 1]
      : null

  const startEditing = () => {
    setDraft(draftFromPlayers(players))
    setEditError("")
    setIsEditing(true)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditError("")
    setDraft(draftFromPlayers(players))
  }

  const updateDraft = (playerId, field, value) => {
    setDraft((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], [field]: value },
    }))
  }

  const draftTotals = computeTotals(
    players,
    (player) => draft[player.id]?.buyIn,
    (player) => draft[player.id]?.cashOut,
  )
  const { isBalanced, discrepancyAmount } = balanceFromTotals(draftTotals.buyIn, draftTotals.cashOut)

  const saveAdjust = (allowDiscrepancy = false) => {
    setEditError("")
    adjustSession.mutate(
      { players: buildAdjustPayload(players, draft), allowDiscrepancy },
      {
        onSuccess: () => {
          setIsEditing(false)
          setIsDiscrepancyDialogOpen(false)
        },
        onError: (err) => {
          setEditError(err.message)
          setIsDiscrepancyDialogOpen(false)
        },
      },
    )
  }

  const handleSaveClick = () => {
    const validationError = validateAdjustDraft(players, draft)
    if (validationError) {
      setEditError(validationError)
      return
    }
    if (!isBalanced) {
      setIsDiscrepancyDialogOpen(true)
      return
    }
    saveAdjust(false)
  }

  const handleAddPlayer = () => {
    if (!newPlayerName.trim()) return
    setAddPlayerError("")

    addPlayer.mutate(newPlayerName.trim(), {
      onSuccess: () => {
        setIsAddPlayerOpen(false)
        setNewPlayerName("")
      },
      onError: (err) => setAddPlayerError(err.message),
    })
  }

  const handleDeleteSession = () => {
    deleteSession.mutate(undefined, {
      onSuccess: () => {
        setIsDeleteOpen(false)
        navigate(`/table/${session.table}`, { replace: true })
      },
    })
  }

  return (
    <div className="page-stack pb-safe">
      <PageHeader
        backTo={`/table/${session.table}`}
        title="Session summary"
        subtitle={
          <SessionDateEdit
            sessionId={session.id}
            tableId={session.table}
            date={session.date}
            readOnly={!canEdit}
          />
        }
        action={
          canEdit && !isEditing ? (
            <div className="flex gap-2">
              <Button variant="outline" size="icon" className="h-11 min-h-11 rounded-xl" onClick={() => setIsDeleteOpen(true)} aria-label="Delete session">
                <Trash2 className="size-4" />
              </Button>
              <Button variant="outline" className="h-11 min-h-11 gap-1.5 rounded-xl" onClick={startEditing}>
                <Pencil className="size-4" />
                Edit amounts
              </Button>
            </div>
          ) : null
        }
      />

      {!isEditing && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase text-muted-foreground">Total Pot</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{formatMoney(totalPot, currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{players.length} players</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase text-muted-foreground">Biggest Winner</CardTitle>
            </CardHeader>
            <CardContent>
              {biggestWinner ? (
                <>
                  <p className="text-xl font-bold truncate">{biggestWinner.name}</p>
                  <Badge className="mt-2" variant="outline">
                    +{formatMoney(playerNet(biggestWinner), currency)}
                  </Badge>
                </>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase text-muted-foreground">Biggest Loser</CardTitle>
            </CardHeader>
            <CardContent>
              {biggestLoser ? (
                <>
                  <p className="text-xl font-bold truncate">{biggestLoser.name}</p>
                  <Badge className="mt-2" variant="outline">
                    {formatMoney(playerNet(biggestLoser), currency)}
                  </Badge>
                </>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{isEditing ? "Edit amounts" : "Final Standings"}</h2>
          {isEditing && (
            <Badge variant={isBalanced ? "outline" : "destructive"}>
              {isBalanced ? "Balanced" : `${formatMoney(discrepancyAmount, currency)} off`}
            </Badge>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-3">
            {players.map((p) => {
              const buyIn = toAmount(draft[p.id]?.buyIn)
              const cashOut = toAmount(draft[p.id]?.cashOut)
              const net = cashOut - buyIn
              return (
                <Card key={p.id}>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base font-bold">{p.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Buy-in</Label>
                      <MoneyInput
                        currencySymbol={currencySymbol}
                        min="0"
                        step="0.01"
                        value={draft[p.id]?.buyIn ?? ""}
                        onChange={(e) => updateDraft(p.id, "buyIn", e.target.value)}
                        inputClassName="font-semibold"
                        aria-label={`Buy-in for ${p.name}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Cash out</Label>
                      <MoneyInput
                        currencySymbol={currencySymbol}
                        min="0"
                        step="0.01"
                        value={draft[p.id]?.cashOut ?? ""}
                        onChange={(e) => updateDraft(p.id, "cashOut", e.target.value)}
                        inputClassName="font-semibold"
                        aria-label={`Cash out for ${p.name}`}
                      />
                    </div>
                    <p className={`text-xs font-semibold sm:col-span-2 ${profitLossClass(net)}`}>
                      Net: {net > 0 ? "+" : ""}{formatMoney(net, currency)}
                    </p>
                  </CardContent>
                </Card>
              )
            })}

            <Card className={isBalanced ? "border-primary/40 bg-primary/5" : "border-destructive/30"}>
              <CardContent className="grid grid-cols-2 gap-4 p-4 text-center">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Buy-ins</p>
                  <p className="text-xl font-bold">{formatMoney(draftTotals.buyIn, currency)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Cash-outs</p>
                  <p className="text-xl font-bold">{formatMoney(draftTotals.cashOut, currency)}</p>
                </div>
              </CardContent>
            </Card>

            {editError && <p className="text-sm text-destructive">{editError}</p>}

            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1 rounded-xl" onClick={cancelEditing} disabled={adjustSession.isPending}>
                Cancel
              </Button>
              <Button className="h-11 flex-1 rounded-xl" onClick={handleSaveClick} disabled={adjustSession.isPending}>
                {adjustSession.isPending ? "Saving…" : isBalanced ? "Save changes" : "Save anyway"}
              </Button>
            </div>
          </div>
        ) : (
          <div ref={standingsRef} className="space-y-3">
            {sortedPlayers.map((p, i) => {
              const cashOut = toAmount(p.cash_out)
              const totalBuyIn = toAmount(p.total_buy_in)
              const profitLoss = cashOut - totalBuyIn
              const isPositive = profitLoss > 0

              return (
                <Card key={p.id}>
                  <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base font-bold">
                      <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs">{i + 1}</span>
                      {p.name}
                    </CardTitle>
                    <Badge variant="outline" className={profitLossClass(profitLoss)}>
                      {isPositive ? "+" : ""}{formatMoney(profitLoss, currency)}
                    </Badge>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 px-4 pb-4 text-center text-sm">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">Buy-in</p>
                      <p className="font-bold">{formatMoney(totalBuyIn, currency)}</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">Cashed</p>
                      <p className="font-bold">{formatMoney(cashOut, currency)}</p>
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {canEdit && (
              <Button variant="outline" className="h-12 w-full rounded-xl border-dashed" onClick={() => setIsAddPlayerOpen(true)}>
                <UserPlus className="mr-2 size-4" /> Add Player
              </Button>
            )}
          </div>
        )}
      </section>

      {!isEditing && <SessionSettlement settlements={session.settlements} currency={currency} />}

      <SessionAuditLog sessionId={session.id} />

      <Button className="w-full" size="lg" variant="outline" onClick={() => navigate(`/table/${session.table}`)}>
        <CheckCircle2 className="size-4" /> Back to table
      </Button>

      <DiscrepancyDialog
        open={isDiscrepancyDialogOpen}
        onOpenChange={setIsDiscrepancyDialogOpen}
        title="Amounts don't balance"
        description={
          <>
            Buy-ins and cash-outs don&apos;t match. Save with{" "}
            <span className="font-semibold text-destructive">{formatMoney(discrepancyAmount, currency)}</span> discrepancy?
          </>
        }
        confirmLabel="Save anyway"
        pendingLabel="Saving…"
        isPending={adjustSession.isPending}
        onConfirm={() => saveAdjust(true)}
      />

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete this session?"
        description="This cannot be undone. Buy-ins and players for this session will be removed."
        confirmLabel="Delete session"
        destructive
        pending={deleteSession.isPending}
        onConfirm={handleDeleteSession}
      />

      <ResponsiveDialog open={isAddPlayerOpen} onOpenChange={setIsAddPlayerOpen}>
        <ResponsiveDialogContent className="sm:max-w-sm border-border/50 bg-card/80 backdrop-blur-xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Add Player</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Add a player who was left off this session.</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-2">
            <Label>Player Name</Label>
            <Input value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)}
              placeholder="Their name" className="h-11 bg-background/50"
              onKeyDown={e => e.key === "Enter" && handleAddPlayer()} autoFocus />
            {addPlayerError && <p className="text-sm text-destructive">{addPlayerError}</p>}
          </div>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setIsAddPlayerOpen(false)}>Cancel</Button>
            <Button onClick={handleAddPlayer} disabled={!newPlayerName.trim() || addPlayer.isPending}>
              {addPlayer.isPending ? "Adding…" : "Add Player"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
