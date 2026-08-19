import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { tablesApi } from "@/lib/api"
import { toApiOrdering } from "@/lib/sessionSort"
import { queryKeys } from "@/lib/queries/keys"

export function useTables() {
  return useQuery({
    queryKey: queryKeys.tables,
    queryFn: tablesApi.list,
  })
}

export function useTable(id) {
  return useQuery({
    queryKey: queryKeys.table(id),
    queryFn: () => tablesApi.get(id),
    enabled: Boolean(id),
  })
}

export function useTableSessions(tableId, sortOrder = "desc") {
  return useQuery({
    queryKey: queryKeys.tableSessions(tableId, sortOrder),
    queryFn: () => tablesApi.listSessions(tableId, toApiOrdering(sortOrder)),
    enabled: Boolean(tableId),
  })
}

export function useCreateTable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, memberNames, currency }) =>
      tablesApi.create(name, memberNames, currency),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tables })
    },
  })
}

export function useUpdateTable(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, memberNames, currency, defaultBuyIn, defaultBuyInB }) =>
      tablesApi.update(tableId, name, memberNames, currency, {
        defaultBuyIn,
        defaultBuyInB,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.table(tableId), updated)
      queryClient.invalidateQueries({ queryKey: queryKeys.tables })
    },
  })
}

export function useCreateSession(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ playerNames, date, initialBuyIns }) =>
      tablesApi.createSession(tableId, playerNames, date, initialBuyIns),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tables", tableId, "sessions"] })
    },
  })
}

export function useDeleteTable(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => tablesApi.destroy(tableId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.table(tableId) })
      queryClient.removeQueries({ queryKey: queryKeys.tableSessions(tableId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.tables })
    },
  })
}

export function useShareLink(tableId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.tableShareLink(tableId),
    queryFn: () => tablesApi.getShareLink(tableId),
    enabled: Boolean(tableId) && enabled,
  })
}

export function useRotateShareLink(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => tablesApi.rotateShareLink(tableId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.tableShareLink(tableId), data)
    },
  })
}

export function useRevokeShareLink(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => tablesApi.revokeShareLink(tableId),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.tableShareLink(tableId), { share_token: null })
    },
  })
}

export function useTableMemberships(tableId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.tableMemberships(tableId),
    queryFn: () => tablesApi.listMemberships(tableId),
    enabled: Boolean(tableId) && enabled,
  })
}

export function useRemoveMembership(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (membershipId) => tablesApi.removeMembership(tableId, membershipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tableMemberships(tableId) })
    },
  })
}

export function useLeaveTable(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => tablesApi.leave(tableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tables })
      queryClient.removeQueries({ queryKey: ["tables", tableId] })
    },
  })
}

export function useTableRequests(tableId, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.tableRequests(tableId),
    queryFn: () => tablesApi.listRequests(tableId),
    enabled: Boolean(tableId) && enabled,
  })
}

export function useCreateRequest(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ session, message }) => tablesApi.createRequest(tableId, { session, message }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tableRequests(tableId) })
    },
  })
}

export function useResolveRequest(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ requestId, status, resolutionNote }) =>
      tablesApi.resolveRequest(tableId, requestId, { status, resolutionNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tableRequests(tableId) })
    },
  })
}

export function useCreateTransfer(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ fromPlayer, toPlayer, amount, note }) =>
      tablesApi.createTransfer(tableId, { fromPlayer, toPlayer, amount, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.table(tableId) })
    },
  })
}

export function useDeleteTransfer(tableId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (transferId) => tablesApi.deleteTransfer(tableId, transferId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.table(tableId) })
    },
  })
}
