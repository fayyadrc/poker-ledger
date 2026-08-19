import secrets

from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from . import cache_utils as cache
from .audit import log_session_audit
from .models import ChangeRequest, Table, TableMembership, TableTransfer, Session, SessionPlayer
from .serializers import (
    ChangeRequestSerializer,
    ResolveRequestSerializer,
    TableMembershipSerializer,
    TableSerializer,
    TableTransferSerializer,
    CreateTableTransferSerializer,
    SessionSerializer,
    SessionDetailSerializer,
    SessionPlayerSerializer,
    SessionAuditEntrySerializer,
    AddBuyInSerializer,
    AddPlayerSerializer,
    CompleteSessionSerializer,
    AdjustSessionSerializer,
)
from .settlement import (
    discrepancy_between,
    has_discrepancy,
    persist_settlements,
    quantize_money,
)

SESSION_ORDERING = set(cache.SESSION_ORDERINGS)


def _viewer_ids(table):
    """Everyone whose cached payloads reference this table: owner + members."""
    return [table.owner_id, *table.memberships.values_list("user_id", flat=True)]


def _unbalanced_totals_response(total_buy_in, total_cash_out):
    return Response(
        {"detail": f"Buy-in total ({total_buy_in}) does not match cash-out total ({total_cash_out})."},
        status=status.HTTP_400_BAD_REQUEST,
    )


class TableViewSet(viewsets.ModelViewSet):
    serializer_class = TableSerializer

    # Mutations stay owner-only (members get 404, same as strangers); reads
    # include tables the user joined via the share link.
    OWNER_ONLY_ACTIONS = {"update", "partial_update", "destroy"}

    def get_queryset(self):
        user = self.request.user
        base = Table.objects.select_related("owner").prefetch_related("members", "transfers")
        if self.action in self.OWNER_ONLY_ACTIONS:
            return base.filter(owner=user)
        return base.filter(Q(owner=user) | Q(memberships__user=user)).distinct()

    def _require_owner(self, table):
        if table.owner_id != self.request.user.pk:
            raise PermissionDenied("Only the table owner can do this.")

    def list(self, request, *args, **kwargs):
        owner_id = request.user.pk
        key = cache.tables_list_key(owner_id)
        cached = cache.cache_get(key)
        if cached is not None:
            return Response(cached)

        response = super().list(request, *args, **kwargs)
        cache.cache_set(key, response.data)
        return response

    def retrieve(self, request, *args, **kwargs):
        owner_id = request.user.pk
        table_id = kwargs.get("pk")
        key = cache.table_key(owner_id, table_id)
        cached = cache.cache_get(key)
        if cached is not None:
            return Response(cached)

        response = super().retrieve(request, *args, **kwargs)
        cache.cache_set(key, response.data)
        return response

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
        cache.invalidate_tables_list(self.request.user.pk)

    def perform_update(self, serializer):
        table = serializer.save()
        cache.invalidate_table(_viewer_ids(table), table.id)

    def perform_destroy(self, instance):
        viewer_ids = _viewer_ids(instance)
        table_id = instance.id
        instance.delete()
        cache.invalidate_table(viewer_ids, table_id)

    @action(detail=True, methods=["get", "post"], url_path="sessions")
    def sessions(self, request, pk=None):
        table = self.get_object()
        viewer_id = request.user.pk

        if request.method == "GET":
            ordering = request.query_params.get("ordering", "-date")
            if ordering not in SESSION_ORDERING:
                ordering = "-date"

            key = cache.sessions_list_key(viewer_id, table.id, ordering)
            cached = cache.cache_get(key)
            if cached is not None:
                return Response(cached)

            sessions = table.sessions.prefetch_related("players").order_by(ordering, "-created_at")
            data = SessionSerializer(sessions, many=True).data
            cache.cache_set(key, data)
            return Response(data)

        self._require_owner(table)
        serializer = SessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.save(table=table)
        player_names = request.data.get("player_names", [])
        initial_buy_ins = request.data.get("initial_buy_ins", [])
        log_session_audit(
            session,
            actor_id=str(viewer_id),
            action="session_created",
            message=f"Session started with {len(player_names)} player(s).",
            details={
                "date": str(session.date),
                "player_names": player_names,
                "initial_buy_ins": [str(amount) for amount in initial_buy_ins],
            },
        )
        cache.invalidate_table(_viewer_ids(table), table.id)
        return Response(SessionSerializer(session).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post", "delete"], url_path="share-link")
    def share_link(self, request, pk=None):
        table = self.get_object()
        self._require_owner(table)

        if request.method == "GET":
            return Response({"share_token": table.share_token})

        if request.method == "POST":
            table.share_token = secrets.token_urlsafe(32)
            table.save(update_fields=["share_token"])
            return Response({"share_token": table.share_token})

        table.share_token = None
        table.save(update_fields=["share_token"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="transfers")
    def transfers(self, request, pk=None):
        table = self.get_object()
        self._require_owner(table)
        serializer = CreateTableTransferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transfer = TableTransfer.objects.create(table=table, **serializer.validated_data)
        cache.invalidate_table(_viewer_ids(table), table.id)
        return Response(TableTransferSerializer(transfer).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"transfers/(?P<transfer_id>\d+)")
    def remove_transfer(self, request, pk=None, transfer_id=None):
        table = self.get_object()
        self._require_owner(table)
        try:
            transfer = table.transfers.get(pk=transfer_id)
        except TableTransfer.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        transfer.delete()
        cache.invalidate_table(_viewer_ids(table), table.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"], url_path="memberships")
    def memberships(self, request, pk=None):
        table = self.get_object()
        self._require_owner(table)
        memberships = table.memberships.select_related("user").order_by("created_at")
        return Response(TableMembershipSerializer(memberships, many=True).data)

    @action(detail=True, methods=["delete"], url_path=r"memberships/(?P<membership_id>\d+)")
    def remove_membership(self, request, pk=None, membership_id=None):
        table = self.get_object()
        self._require_owner(table)
        try:
            membership = table.memberships.get(pk=membership_id)
        except TableMembership.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        removed_user_id = membership.user_id
        membership.delete()
        cache.invalidate_table([removed_user_id], table.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="leave")
    def leave(self, request, pk=None):
        table = self.get_object()
        deleted, _ = table.memberships.filter(user=request.user).delete()
        if not deleted:
            return Response({"detail": "You are not a member of this table."}, status=status.HTTP_400_BAD_REQUEST)
        cache.invalidate_table([request.user.pk], table.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "post"], url_path="requests")
    def requests(self, request, pk=None):
        table = self.get_object()

        if request.method == "GET":
            queryset = table.change_requests.select_related("requester", "session")
            if table.owner_id != request.user.pk:
                queryset = queryset.filter(requester=request.user)
            status_filter = request.query_params.get("status")
            if status_filter:
                queryset = queryset.filter(status=status_filter)
            return Response(ChangeRequestSerializer(queryset, many=True).data)

        serializer = ChangeRequestSerializer(data=request.data, context={"table": table})
        serializer.is_valid(raise_exception=True)
        change_request = serializer.save(
            table=table,
            requester=request.user,
            owner_id=table.owner_id,
        )
        if change_request.session_id:
            log_session_audit(
                change_request.session,
                actor_id=str(request.user.pk),
                action="change_request_raised",
                message=f"A change request was raised: {change_request.message[:200]}",
                details={"change_request_id": change_request.id},
            )
        return Response(ChangeRequestSerializer(change_request).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path=r"requests/(?P<request_id>\d+)/resolve")
    def resolve_request(self, request, pk=None, request_id=None):
        table = self.get_object()
        self._require_owner(table)
        try:
            change_request = table.change_requests.get(pk=request_id)
        except ChangeRequest.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if change_request.status != ChangeRequest.STATUS_OPEN:
            return Response({"detail": "Request is not open."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = ResolveRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        change_request.status = serializer.validated_data["status"]
        change_request.resolution_note = serializer.validated_data["resolution_note"]
        change_request.resolved_at = timezone.now()
        change_request.save(update_fields=["status", "resolution_note", "resolved_at"])

        if change_request.session_id:
            log_session_audit(
                change_request.session,
                actor_id=str(request.user.pk),
                action=f"change_request_{change_request.status}",
                message=f"Change request #{change_request.id} was {change_request.status}.",
                details={
                    "change_request_id": change_request.id,
                    "resolution_note": change_request.resolution_note,
                },
            )
        return Response(ChangeRequestSerializer(change_request).data)


class SessionViewSet(viewsets.GenericViewSet):
    serializer_class = SessionSerializer

    # Members may read; only the table owner may mutate (members get 404 on
    # mutation endpoints because the mutating queryset excludes their tables).
    READ_ACTIONS = {"retrieve", "audit_log"}

    def get_queryset(self):
        user = self.request.user
        base = Session.objects.select_related("table").prefetch_related("players", "settlements")
        if self.action in self.READ_ACTIONS:
            return base.filter(Q(table__owner=user) | Q(table__memberships__user=user)).distinct()
        return base.filter(table__owner=user)

    def retrieve(self, request, pk=None):
        viewer_id = request.user.pk
        key = cache.session_key(viewer_id, pk)
        cached = cache.cache_get(key)
        if cached is not None:
            return Response(cached)

        session = self.get_object()
        data = SessionDetailSerializer(session, context={"request": request}).data
        cache.cache_set(key, data)
        return Response(data)

    def destroy(self, request, pk=None):
        session = self.get_object()
        viewer_ids = _viewer_ids(session.table)
        table_id = session.table_id
        session_id = session.id
        session.delete()
        cache.invalidate_session(viewer_ids, session_id, table_id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def partial_update(self, request, pk=None):
        session = self.get_object()
        allowed = {"date"}
        if set(request.data.keys()) - allowed:
            return Response({"detail": "Only the session date can be updated."}, status=status.HTTP_400_BAD_REQUEST)

        old_date = session.date
        serializer = SessionSerializer(session, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        session = serializer.save()

        if "date" in request.data and str(old_date) != str(session.date):
            log_session_audit(
                session,
                actor_id=str(request.user.pk),
                action="date_changed",
                message=f"Session date changed from {old_date} to {session.date}.",
                details={"old_date": str(old_date), "new_date": str(session.date)},
            )

        self._invalidate_session_cache(session)
        data = SessionDetailSerializer(session, context={"request": request}).data
        cache.cache_set(cache.session_key(request.user.pk, session.id), data)
        return Response(data)

    def _invalidate_session_cache(self, session):
        cache.invalidate_session(_viewer_ids(session.table), session.id, session.table_id)

    @action(detail=True, methods=["get"], url_path="audit-log")
    def audit_log(self, request, pk=None):
        session = self.get_object()
        entries = session.audit_entries.all()
        return Response(SessionAuditEntrySerializer(entries, many=True).data)

    @action(detail=True, methods=["post"], url_path="buy-in")
    def buy_in(self, request, pk=None):
        session = self.get_object()
        if session.is_completed:
            return Response({"detail": "Session is already completed."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = AddBuyInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            player = session.players.get(id=serializer.validated_data["player_id"])
        except SessionPlayer.DoesNotExist:
            return Response({"detail": "Player not found in this session."}, status=status.HTTP_404_NOT_FOUND)

        amount = serializer.validated_data["amount"]
        previous_total = player.total_buy_in
        player.total_buy_in += amount
        player.save()

        log_session_audit(
            session,
            actor_id=str(request.user.pk),
            action="buy_in_added",
            message=f"{player.name} bought in {amount} (total now {player.total_buy_in}).",
            details={
                "player_id": player.id,
                "player_name": player.name,
                "amount": str(amount),
                "previous_total_buy_in": str(previous_total),
                "total_buy_in": str(player.total_buy_in),
            },
        )

        self._invalidate_session_cache(session)
        return Response(SessionPlayerSerializer(player).data)

    @action(detail=True, methods=["post"], url_path="add-player")
    def add_player(self, request, pk=None):
        session = self.get_object()
        if session.is_completed:
            return Response({"detail": "Session is already completed."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = AddPlayerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        player = SessionPlayer.objects.create(
            session=session,
            name=serializer.validated_data["name"],
        )

        log_session_audit(
            session,
            actor_id=str(request.user.pk),
            action="player_added",
            message=f"{player.name} joined the session.",
            details={"player_id": player.id, "player_name": player.name},
        )

        self._invalidate_session_cache(session)
        return Response(SessionPlayerSerializer(player).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        session = self.get_object()
        if session.is_completed:
            return Response({"detail": "Session is already completed."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = CompleteSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        cash_outs = {c["player_id"]: c["cash_out"] for c in serializer.validated_data["cash_outs"]}
        allow_discrepancy = serializer.validated_data.get("allow_discrepancy", False)

        players = list(session.players.all())
        total_buy_in = sum(p.total_buy_in for p in players)
        total_cash_out = sum(cash_outs.get(p.id, 0) for p in players)
        discrepancy = discrepancy_between(total_buy_in, total_cash_out)

        if not allow_discrepancy and has_discrepancy(discrepancy):
            return _unbalanced_totals_response(total_buy_in, total_cash_out)

        cash_out_details = []
        for player in players:
            if player.id not in cash_outs:
                continue
            player.cash_out = cash_outs[player.id]
            player.save()
            cash_out_details.append(
                {
                    "player_id": player.id,
                    "player_name": player.name,
                    "cash_out": str(player.cash_out),
                    "total_buy_in": str(player.total_buy_in),
                }
            )

        session.is_completed = True
        session.save()

        settlements = persist_settlements(session)
        unbalanced = has_discrepancy(discrepancy)
        quantized = quantize_money(discrepancy)

        log_session_audit(
            session,
            actor_id=str(request.user.pk),
            action="session_completed_with_discrepancy" if unbalanced else "session_completed",
            message=(
                f"Session completed with {quantized} discrepancy."
                if unbalanced
                else "Session completed."
            ),
            details={
                "allow_discrepancy": allow_discrepancy,
                "discrepancy": str(quantized),
                "total_buy_in": str(total_buy_in),
                "total_cash_out": str(total_cash_out),
                "cash_outs": cash_out_details,
                "settlement_count": len(settlements),
            },
        )

        self._invalidate_session_cache(session)
        session = self.get_queryset().get(pk=session.pk)
        return Response(SessionDetailSerializer(session, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="adjust")
    def adjust(self, request, pk=None):
        """Owner-only: rewrite buy-in/cash-out on a completed session and recompute settlements."""
        session = self.get_object()
        if not session.is_completed:
            return Response(
                {"detail": "Only completed sessions can be adjusted. Finish the session first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AdjustSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        updates = {row["player_id"]: row for row in serializer.validated_data["players"]}
        allow_discrepancy = serializer.validated_data.get("allow_discrepancy", False)
        players = list(session.players.all())
        player_ids = {p.id for p in players}

        unknown = set(updates) - player_ids
        if unknown:
            return Response(
                {"detail": f"Unknown player id(s): {sorted(unknown)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        missing = player_ids - set(updates)
        if missing:
            return Response(
                {"detail": "Provide buy-in and cash-out for every player in the session."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        total_buy_in = sum(updates[p.id]["total_buy_in"] for p in players)
        total_cash_out = sum(updates[p.id]["cash_out"] for p in players)
        discrepancy = discrepancy_between(total_buy_in, total_cash_out)

        if not allow_discrepancy and has_discrepancy(discrepancy):
            return _unbalanced_totals_response(total_buy_in, total_cash_out)

        changes = []
        for player in players:
            row = updates[player.id]
            before = {
                "total_buy_in": str(player.total_buy_in),
                "cash_out": str(player.cash_out) if player.cash_out is not None else None,
            }
            player.total_buy_in = row["total_buy_in"]
            player.cash_out = row["cash_out"]
            player.save()
            after = {
                "total_buy_in": str(player.total_buy_in),
                "cash_out": str(player.cash_out),
            }
            if before == after:
                continue
            changes.append(
                {
                    "player_id": player.id,
                    "player_name": player.name,
                    "before": before,
                    "after": after,
                }
            )

        settlements = persist_settlements(session)
        unbalanced = has_discrepancy(discrepancy)
        quantized = quantize_money(discrepancy)

        log_session_audit(
            session,
            actor_id=str(request.user.pk),
            action="amounts_adjusted",
            message=(
                f"Session amounts updated with {quantized} discrepancy."
                if unbalanced
                else "Session amounts updated."
            ),
            details={
                "allow_discrepancy": allow_discrepancy,
                "discrepancy": str(quantized),
                "total_buy_in": str(total_buy_in),
                "total_cash_out": str(total_cash_out),
                "changes": changes,
                "settlement_count": len(settlements),
            },
        )

        self._invalidate_session_cache(session)
        session = self.get_queryset().get(pk=session.pk)
        return Response(SessionDetailSerializer(session, context={"request": request}).data)
