from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import cache_utils as cache
from .models import Table, TableMembership
from .serializers import SessionDetailSerializer, SharedTableSerializer
from .views import _current_settlements_prefetch


def _get_shared_table(token):
    return (
        Table.objects.filter(share_token=token)
        .select_related("owner")
        .prefetch_related("members", "transfers")
        .first()
    )


class SharedTableView(APIView):
    """Public read-only view of a table for anyone holding the share link."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        table = _get_shared_table(token)
        if table is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        sessions = (
            table.sessions.prefetch_related("players", _current_settlements_prefetch())
            .select_related("table")
            .order_by("-date", "-created_at")
        )
        is_authenticated = request.user.is_authenticated
        is_owner = is_authenticated and table.owner_id == request.user.pk
        is_member = (
            is_authenticated
            and not is_owner
            and table.memberships.filter(user=request.user).exists()
        )
        return Response(
            {
                "table": SharedTableSerializer(table).data,
                "sessions": SessionDetailSerializer(sessions, many=True, context={"request": request}).data,
                "viewer": {
                    "is_authenticated": is_authenticated,
                    "is_owner": is_owner,
                    "is_member": is_member,
                },
            }
        )


class SharedTableJoinView(APIView):
    """Redeem the share link: create a viewer membership for the logged-in user."""

    permission_classes = [IsAuthenticated]

    def post(self, request, token):
        table = _get_shared_table(token)
        if table is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if table.owner_id == request.user.pk:
            return Response({"table_id": table.id, "role": "owner"})

        membership, created = TableMembership.objects.get_or_create(
            table=table,
            user=request.user,
            defaults={"role": TableMembership.ROLE_VIEWER, "owner_id": table.owner_id},
        )
        if created:
            cache.invalidate_tables_list(request.user.pk)
        return Response(
            {"table_id": table.id, "role": membership.role},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
