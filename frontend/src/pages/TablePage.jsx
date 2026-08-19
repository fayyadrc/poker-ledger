import { useState, useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Play, Users, Settings, ArrowDownWideNarrow, ArrowUpWideNarrow, MessageSquarePlus, HandCoins, LogOut, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { todayIsoDate } from "@/lib/formatDate"
import { useAnimatedList } from "@/lib/hooks/useAnimatedList"
import { useSecretTaps } from "@/lib/hooks/useSecretTaps"
import { useUserPreferences } from "@/contexts/UserPreferencesContext"
import { toAmount } from "@/lib/sessionBalance"
import {
  useTable,
  useTableSessions,
  useCreateSession,
  useTableRequests,
  useLeaveTable,
  useDeleteTransfer,
} from "@/lib/queries"
import NotFoundState from "@/components/layout/NotFoundState"
import PageHeader from "@/components/layout/PageHeader"
import PageSkeleton from "@/components/layout/PageSkeleton"
import Leaderboard from "@/components/table/Leaderboard"
import TransfersList from "@/components/table/TransfersList"
import SessionsList from "@/components/table/SessionsList"
import RaiseRequestDialog from "@/components/table/RaiseRequestDialog"
import AddTransferDialog from "@/components/table/AddTransferDialog"
import RequestsList from "@/components/table/RequestsList"
import PlayerAnalytics from "@/components/table/PlayerAnalytics"
import ConfirmDialog from "@/components/ui/ConfirmDialog"
import StartBuyInPicker from "@/components/session/StartBuyInPicker"

function buyInsConfigured(table) {
  return toAmount(table?.default_buy_in) > 0 && toAmount(table?.default_buy_in_b) > 0
}

export default function TablePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { sessionSortOrder, savePreferences } = useUserPreferences()

  const { data: table, isLoading: tableLoading } = useTable(id)
  const [sessionSort, setSessionSort] = useState(sessionSortOrder)
  const { data: sessions = [], isLoading: sessionsLoading } = useTableSessions(id, sessionSort)
  const createSession = useCreateSession(id)

  const isOwner = table?.role !== "viewer"

  const { data: requests = [] } = useTableRequests(id, { enabled: Boolean(table) })

  const [sessionsListRef] = useAnimatedList()

  const [isStartDialogOpen, setIsStartDialogOpen] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState([])
  const [sessionDate, setSessionDate] = useState(() => todayIsoDate())
  const [buyInSelections, setBuyInSelections] = useState({})
  const [otherDrafts, setOtherDrafts] = useState({})
  const [startError, setStartError] = useState("")

  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false)
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false)
  const [transferToDelete, setTransferToDelete] = useState(null)
  const [isLeaveOpen, setIsLeaveOpen] = useState(false)
  const [isLabsOpen, setIsLabsOpen] = useState(false)
  const leaveTable = useLeaveTable(id)
  const deleteTransfer = useDeleteTransfer(id)
  const { tap: tapViewerBadge } = useSecretTaps({
    taps: 7,
    onUnlock: () => setIsLabsOpen(true),
  })

  useEffect(() => {
    setSessionSort(sessionSortOrder)
  }, [sessionSortOrder])

  const loading = tableLoading && !table

  if (loading) return <PageSkeleton />
  if (!table) return <NotFoundState title="Table not found" icon={Users} />

  const members = table.members || []
  const openRequestCount = requests.filter((r) => r.status === "open").length
  const defaultsReady = buyInsConfigured(table)
  const optionA = toAmount(table.default_buy_in)
  const optionB = toAmount(table.default_buy_in_b)

  const handleOpenNewSession = () => {
    setSelectedMembers([])
    setSessionDate(todayIsoDate())
    setBuyInSelections({})
    setOtherDrafts({})
    setStartError("")
    setIsStartDialogOpen(true)
  }

  const toggleMember = (name) => {
    setSelectedMembers((prev) => {
      if (prev.includes(name)) {
        setBuyInSelections((sels) => {
          const next = { ...sels }
          delete next[name]
          return next
        })
        setOtherDrafts((drafts) => {
          const next = { ...drafts }
          delete next[name]
          return next
        })
        return prev.filter((n) => n !== name)
      }
      return [...prev, name]
    })
  }

  const allBuyInsReady =
    selectedMembers.length > 0 &&
    selectedMembers.every((name) => toAmount(buyInSelections[name]?.amount) > 0)

  const handleStartSession = () => {
    if (!defaultsReady) {
      setStartError("Set default buy-ins A and B in table settings before starting a session.")
      return
    }
    if (selectedMembers.length === 0) return
    if (!allBuyInsReady) {
      setStartError("Pick a buy-in for every selected player.")
      return
    }

    setStartError("")
    const initialBuyIns = selectedMembers.map((name) => String(buyInSelections[name].amount))

    createSession.mutate(
      { playerNames: selectedMembers, date: sessionDate, initialBuyIns },
      {
        onSuccess: (newSession) => {
          setIsStartDialogOpen(false)
          navigate(`/session/${newSession.id}`)
        },
        onError: (err) => setStartError(err.message),
      }
    )
  }

  const toggleSessionSort = () => {
    const next = sessionSort === "desc" ? "asc" : "desc"
    setSessionSort(next)
    savePreferences({ session_sort_order: next })
  }

  return (
    <div className="page-stack pb-safe">
      <PageHeader
        backTo="/tables"
        title={table.name}
        subtitle={
          isOwner
            ? `${members.length} players`
            : `${members.length} players · Owned by ${table.owner_name || table.owner_email || "admin"}`
        }
        action={
          isOwner ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(`/table/${id}/settings`)}
              aria-label="Table settings"
            >
              <Settings className="size-4" />
            </Button>
          ) : (
            <button
              type="button"
              onClick={tapViewerBadge}
              className="touch-manipulation select-none rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Viewer"
            >
              <Badge variant="outline" className="pointer-events-none">
                Viewer
              </Badge>
            </button>
          )
        }
      />

      {isOwner && (
        <Button size="lg" className="h-12 w-full rounded-xl" onClick={handleOpenNewSession}>
          <Play className="mr-2 size-4 fill-current" />
          Start Session
        </Button>
      )}

      <div className="space-y-8">
        <Leaderboard
          members={members}
          sessions={sessions}
          transfers={table.transfers || []}
          currency={table.currency}
        />

        <div className="space-y-3">
          {isOwner && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-11 gap-1.5 rounded-xl"
                onClick={() => setIsTransferDialogOpen(true)}
              >
                <HandCoins className="size-4" />
                Record settlement
              </Button>
            </div>
          )}
          <TransfersList
            transfers={table.transfers || []}
            currency={table.currency}
            onDelete={isOwner ? (transfer) => setTransferToDelete(transfer) : undefined}
          />
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-section">Sessions</h2>
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-11 gap-1.5 rounded-xl"
                onClick={toggleSessionSort}
                aria-label={`Sort sessions ${sessionSort === "desc" ? "oldest first" : "newest first"}`}
              >
                {sessionSort === "desc" ? (
                  <ArrowDownWideNarrow className="size-4" />
                ) : (
                  <ArrowUpWideNarrow className="size-4" />
                )}
                {sessionSort === "desc" ? "Newest" : "Oldest"}
              </Button>
              <Badge variant="secondary">{sessions.length}</Badge>
            </div>
          </div>
          <SessionsList
            sessions={sessions}
            tableId={id}
            readOnly={!isOwner}
            listRef={sessionsListRef}
            showEmpty={!sessionsLoading}
            emptyMessage={isOwner ? "No sessions yet. Start one above." : "No sessions yet."}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="text-section">Requests</h2>
              {openRequestCount > 0 && <Badge>{openRequestCount} open</Badge>}
            </div>
            {!isOwner && (
              <Button
                variant="outline"
                className="h-11 min-h-11 shrink-0 gap-1.5 rounded-xl"
                onClick={() => setIsRequestDialogOpen(true)}
              >
                <MessageSquarePlus className="size-4" />
                Raise a request
              </Button>
            )}
          </div>
          <RequestsList requests={requests} tableId={id} canResolve={isOwner} />
        </section>

        {!isOwner && (
          <Button
            variant="outline"
            className="h-11 w-full rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={leaveTable.isPending}
            onClick={() => setIsLeaveOpen(true)}
          >
            <LogOut className="mr-2 size-4" />
            {leaveTable.isPending ? "Leaving…" : "Leave table"}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={isLeaveOpen}
        onOpenChange={setIsLeaveOpen}
        title="Leave this table?"
        description="You will lose viewer access until you join again via the share link."
        confirmLabel="Leave table"
        destructive
        pending={leaveTable.isPending}
        onConfirm={() => {
          leaveTable.mutate(undefined, {
            onSuccess: () => navigate("/tables", { replace: true }),
          })
        }}
      />

      <RaiseRequestDialog
        tableId={id}
        sessions={sessions}
        open={isRequestDialogOpen}
        onOpenChange={setIsRequestDialogOpen}
      />

      <AddTransferDialog
        tableId={id}
        members={members}
        open={isTransferDialogOpen}
        onOpenChange={setIsTransferDialogOpen}
      />

      <ConfirmDialog
        open={Boolean(transferToDelete)}
        onOpenChange={(next) => {
          if (!next) setTransferToDelete(null)
        }}
        title="Delete this cash settlement?"
        description={
          transferToDelete
            ? `${transferToDelete.from_player} → ${transferToDelete.to_player} will no longer be recorded.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        pending={deleteTransfer.isPending}
        onConfirm={() => {
          deleteTransfer.mutate(transferToDelete.id, {
            onSuccess: () => setTransferToDelete(null),
          })
        }}
      />

      <ResponsiveDialog open={isLabsOpen} onOpenChange={setIsLabsOpen}>
        <ResponsiveDialogContent className="border-border/50 bg-card/80 backdrop-blur-xl sm:max-w-lg">
          <ResponsiveDialogHeader className="pb-2">
            <ResponsiveDialogTitle>Player stats</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Per-player analytics for this table.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <PlayerAnalytics
              members={members}
              sessions={sessions}
              transfers={table.transfers || []}
              currency={table.currency}
            />
          </ResponsiveDialogBody>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={isStartDialogOpen} onOpenChange={setIsStartDialogOpen}>
        <ResponsiveDialogContent className="border-border/50 bg-card/80 backdrop-blur-xl sm:max-w-lg">
          <ResponsiveDialogHeader className="pb-2">
            <ResponsiveDialogTitle>
              {defaultsReady ? "Who's at the table?" : "Buy-ins not set"}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {defaultsReady
                ? "Select players and their starting buy-in."
                : "Set default buy-ins A and B in table settings before starting a session."}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="space-y-4">
            {!defaultsReady ? (
              <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p>
                  Default buy-ins A and B must both be greater than zero. Open table settings to
                  configure them.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {members.map((m) => {
                    const isSelected = selectedMembers.includes(m.name)
                    return (
                      <Badge
                        key={m.id}
                        variant={isSelected ? "default" : "outline"}
                        className="cursor-pointer px-4 py-2 transition-all active:scale-[0.98]"
                        onClick={() => toggleMember(m.name)}
                      >
                        {m.name}
                      </Badge>
                    )
                  })}
                  {members.length === 0 && (
                    <p className="text-sm italic text-muted-foreground">No members. Edit the table first.</p>
                  )}
                </div>

                {selectedMembers.length > 0 && (
                  <div className="space-y-3 border-t border-border/20 pt-4">
                    <Label>Starting buy-ins</Label>
                    {selectedMembers.map((name) => (
                      <StartBuyInPicker
                        key={name}
                        playerName={name}
                        currency={table.currency}
                        optionA={optionA}
                        optionB={optionB}
                        selection={buyInSelections[name]}
                        draftOther={otherDrafts[name] || ""}
                        onSelectPreset={(mode, amount) => {
                          setStartError("")
                          setBuyInSelections((prev) => ({
                            ...prev,
                            [name]: { mode, amount },
                          }))
                          setOtherDrafts((prev) => {
                            const next = { ...prev }
                            delete next[name]
                            return next
                          })
                        }}
                        onSelectOther={() => {
                          setStartError("")
                          setBuyInSelections((prev) => ({
                            ...prev,
                            [name]: { mode: "other", amount: 0 },
                          }))
                        }}
                        onDraftOtherChange={(value) => {
                          setOtherDrafts((prev) => ({ ...prev, [name]: value }))
                        }}
                        onConfirmOther={() => {
                          const amount = toAmount(otherDrafts[name])
                          if (amount <= 0) return
                          setStartError("")
                          setBuyInSelections((prev) => ({
                            ...prev,
                            [name]: { mode: "other", amount },
                          }))
                        }}
                        onClearOther={() => {
                          setOtherDrafts((prev) => ({ ...prev, [name]: "" }))
                          setBuyInSelections((prev) => ({
                            ...prev,
                            [name]: { mode: "other", amount: 0 },
                          }))
                        }}
                      />
                    ))}
                  </div>
                )}

                <div className="space-y-2 border-t border-border/20 pt-4">
                  <Label htmlFor="new-session-date">Session date</Label>
                  <Input
                    id="new-session-date"
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="h-11 bg-card"
                  />
                </div>
              </>
            )}
            {startError && <p className="text-sm text-destructive">{startError}</p>}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {!defaultsReady ? (
              <>
                <Button variant="ghost" onClick={() => setIsStartDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => navigate(`/table/${id}/settings`)}>
                  <Settings className="mr-2 size-4" /> Open settings
                </Button>
              </>
            ) : (
              <>
                <span className="text-center text-sm text-muted-foreground sm:text-left">
                  {selectedMembers.length} selected
                </span>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <Button variant="ghost" onClick={() => setIsStartDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleStartSession}
                    disabled={
                      selectedMembers.length === 0 ||
                      !allBuyInsReady ||
                      createSession.isPending
                    }
                  >
                    <Play className="mr-2 size-4" />
                    {createSession.isPending ? "Starting…" : "Start Game"}
                  </Button>
                </div>
              </>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
