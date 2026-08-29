import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sessionsApi } from "@/lib/api"
import { queryKeys } from "@/lib/queries/keys"

export function useSession(id) {
  return useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => sessionsApi.get(id),
    enabled: Boolean(id),
  })
}

export function useSessionAuditLog(sessionId) {
  return useQuery({
    queryKey: queryKeys.sessionAuditLog(sessionId),
    queryFn: () => sessionsApi.auditLog(sessionId),
    enabled: Boolean(sessionId),
  })
}

export function useSettlementHistory(sessionId) {
  return useQuery({
    queryKey: queryKeys.settlementHistory(sessionId),
    queryFn: () => sessionsApi.settlementHistory(sessionId),
    enabled: Boolean(sessionId),
  })
}

export function useUpdateSession(sessionId, tableId) {
  const queryClient = useQueryClient()

  const patchCaches = (date, fullSession = null, { resort = false } = {}) => {
    const sessionKey = queryKeys.session(sessionId)
    const currentSession = queryClient.getQueryData(sessionKey)
    if (currentSession) {
      queryClient.setQueryData(sessionKey, fullSession ?? { ...currentSession, date })
    }

    if (!tableId) return

    const queries = queryClient.getQueriesData({ queryKey: ["tables", tableId, "sessions"] })
    for (const [key, data] of queries) {
      if (!Array.isArray(data)) continue
      let next = data.map((s) =>
        String(s.id) === String(sessionId) ? (fullSession ?? { ...s, date }) : s
      )
      if (resort) {
        const sortOrder = key[3] || "desc"
        next = [...next].sort((a, b) => {
          const cmp = a.date.localeCompare(b.date)
          if (cmp !== 0) return sortOrder === "asc" ? cmp : -cmp
          return String(b.created_at || "").localeCompare(String(a.created_at || ""))
        })
      }
      queryClient.setQueryData(key, next)
    }
  }

  return useMutation({
    mutationFn: (date) => sessionsApi.update(sessionId, { date }),
    onMutate: async (date) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })

      const previousSession = queryClient.getQueryData(queryKeys.session(sessionId))
      const previousLists = queryClient
        .getQueriesData({ queryKey: ["tables", tableId, "sessions"] })
        .map(([key, data]) => [key, data])

      patchCaches(date, null, { resort: false })
      return { previousSession, previousLists }
    },
    onError: (_err, _date, context) => {
      if (context?.previousSession) {
        queryClient.setQueryData(queryKeys.session(sessionId), context.previousSession)
      }
      for (const [key, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, data)
      }
    },
    onSuccess: (updated) => {
      patchCaches(updated.date, updated, { resort: true })
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionAuditLog(sessionId) })
    },
  })
}

export function useAddBuyIn(sessionId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ playerId, amount }) => sessionsApi.addBuyIn(sessionId, playerId, amount),
    onMutate: async ({ playerId, amount }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })

      const previous = queryClient.getQueryData(queryKeys.session(sessionId))

      queryClient.setQueryData(queryKeys.session(sessionId), (old) => {
        if (!old) return old
        return {
          ...old,
          players: old.players.map((p) =>
            p.id === playerId
              ? { ...p, total_buy_in: String(parseFloat(p.total_buy_in) + amount) }
              : p
          ),
        }
      })

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.session(sessionId), context.previous)
      }
    },
    onSuccess: (updatedPlayer) => {
      queryClient.setQueryData(queryKeys.session(sessionId), (old) => {
        if (!old) return old
        return {
          ...old,
          players: old.players.map((p) => (p.id === updatedPlayer.id ? updatedPlayer : p)),
        }
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionAuditLog(sessionId) })
    },
  })
}

export function useAddPlayer(sessionId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name) => sessionsApi.addPlayer(sessionId, name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })

      const previous = queryClient.getQueryData(queryKeys.session(sessionId))
      const tempId = `temp-${Date.now()}`

      queryClient.setQueryData(queryKeys.session(sessionId), (old) => {
        if (!old) return old
        return {
          ...old,
          players: [
            ...old.players,
            { id: tempId, name, total_buy_in: "0", cash_out: null, _optimistic: true },
          ],
        }
      })

      return { previous, tempId }
    },
    onError: (_err, _name, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.session(sessionId), context.previous)
      }
    },
    onSuccess: (newPlayer, _name, context) => {
      queryClient.setQueryData(queryKeys.session(sessionId), (old) => {
        if (!old) return old
        return {
          ...old,
          players: old.players.map((p) => (p.id === context?.tempId ? newPlayer : p)),
        }
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionAuditLog(sessionId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.settlementHistory(sessionId) })
    },
  })
}

export function useCompleteSession(sessionId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ cashOuts, allowDiscrepancy = false }) =>
      sessionsApi.complete(sessionId, cashOuts, { allowDiscrepancy }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionAuditLog(sessionId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.settlementHistory(sessionId) })
    },
  })
}

export function useAdjustSession(sessionId, tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ players, allowDiscrepancy = false }) =>
      sessionsApi.adjust(sessionId, players, { allowDiscrepancy }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.session(sessionId), updated)
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionAuditLog(sessionId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.settlementHistory(sessionId) })
      if (tableId) {
        queryClient.invalidateQueries({ queryKey: ["tables", tableId, "sessions"] })
        queryClient.invalidateQueries({ queryKey: queryKeys.table(tableId) })
      }
    },
  })
}

export function useDeleteSession(sessionId, tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => sessionsApi.destroy(sessionId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
      if (tableId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tableSessions(tableId) })
      }
    },
  })
}
