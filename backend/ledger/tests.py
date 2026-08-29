from decimal import Decimal
import json

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from ledger.models import (
    Table,
    TableMembership,
    Session,
    SessionPlayer,
    SessionSettlement,
    SettlementBatch,
    SessionAuditEntry,
    LedgerUser,
    TableTransfer,
)
from ledger.settlement import compute_settlements
from ledger.serializers import _user_display_name


def auth_client(username="alice", email=None):
    client = APIClient()
    user = User.objects.create_user(
        username=username,
        email=email or f"{username}@test.com",
        password="test-pass-123",
    )
    # The API now authenticates via Supabase JWT (SupabaseJWTAuthentication),
    # not Django sessions. force_authenticate sets request.user directly,
    # bypassing the auth class so tests don't need to mint real Supabase tokens.
    client.force_authenticate(user=user)
    return client, user


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class TableAPITests(TestCase):
    def setUp(self):
        cache.clear()
        self.client, self.user = auth_client("alice")
        self.other_client, _ = auth_client("bob")

    def test_list_tables_requires_auth(self):
        response = APIClient().get("/api/tables/")
        # Bearer-token auth answers missing credentials with 401 (not 403).
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_list_tables_returns_only_owned_tables(self):
        Table.objects.create(name="Alice Table", default_buy_in="10.00", owner=self.user)
        Table.objects.create(name="Bob Table", default_buy_in="10.00", owner=User.objects.get(username="bob"))

        response = self.client.get("/api/tables/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["name"], "Alice Table")

    def test_create_table_sets_owner_id(self):
        response = self.client.post(
            "/api/tables/",
            {
                "name": "Friday Night",
                "member_names": ["Alice", "Bob"],
                "currency": "USD",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = response.json()
        self.assertEqual(payload["name"], "Friday Night")
        self.assertEqual(payload["owner_id"], self.user.pk)
        self.assertEqual(payload["owner_email"], self.user.email)
        self.assertEqual(payload["owner_name"], self.user.email)
        self.assertEqual(payload["role"], "owner")
        self.assertEqual(len(payload["members"]), 2)
        self.assertTrue(Table.objects.filter(name="Friday Night", owner=self.user).exists())

    def test_owner_name_prefers_full_name_over_email(self):
        self.user.first_name = "Ada"
        self.user.last_name = "Lovelace"
        self.user.save(update_fields=["first_name", "last_name"])
        table = Table.objects.create(name="Named Owner", default_buy_in="0", owner=self.user)

        response = self.client.get(f"/api/tables/{table.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["owner_name"], "Ada Lovelace")
        self.assertEqual(payload["owner_email"], self.user.email)

    def test_owner_fields_are_read_only_on_update(self):
        table = Table.objects.create(name="Immutable Owner", default_buy_in="0", owner=self.user)
        response = self.client.put(
            f"/api/tables/{table.id}/",
            {
                "name": "Still Mine",
                "member_names": ["Alice"],
                "currency": "GBP",
                "owner_name": "Hacker",
                "owner_email": "hacker@evil.test",
                "owner_id": User.objects.get(username="bob").pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["name"], "Still Mine")
        self.assertEqual(payload["owner_id"], self.user.pk)
        self.assertEqual(payload["owner_email"], self.user.email)
        self.assertEqual(payload["owner_name"], self.user.email)
        table.refresh_from_db()
        self.assertEqual(table.owner_id, self.user.pk)

    def test_create_table_invalidates_cached_list(self):
        empty = self.client.get("/api/tables/")
        self.assertEqual(empty.json(), [])

        self.client.post(
            "/api/tables/",
            {"name": "Cached Table", "member_names": []},
            format="json",
        )

        listed = self.client.get("/api/tables/")
        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(listed.json()[0]["name"], "Cached Table")

    def test_create_table_requires_name(self):
        response = self.client.post(
            "/api/tables/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_access_another_users_table(self):
        bob = User.objects.get(username="bob")
        table = Table.objects.create(name="Private", default_buy_in="10.00", owner=bob)
        response = self.client.get(f"/api/tables/{table.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class OwnerDisplayNameTests(TestCase):
    def test_display_name_helpers(self):
        self.assertIsNone(_user_display_name(None))

        user = User(username="only_user", email="", first_name="", last_name="")
        self.assertEqual(_user_display_name(user), "only_user")

        user.email = "named@test.com"
        self.assertEqual(_user_display_name(user), "named@test.com")

        user.first_name = "Ada"
        user.last_name = "Lovelace"
        self.assertEqual(_user_display_name(user), "Ada Lovelace")


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class SessionAPITests(TestCase):
    def setUp(self):
        cache.clear()
        self.client, self.user = auth_client("alice")
        self.table = Table.objects.create(
            name="Friday Night",
            default_buy_in="15.00",
            currency="AED",
            owner=self.user,
        )

    def test_create_session_starts_players_at_zero_buy_in(self):
        response = self.client.post(
            f"/api/tables/{self.table.id}/sessions/",
            {"player_names": ["Aryan", "DJ"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        session = Session.objects.get(id=response.json()["id"])
        players = SessionPlayer.objects.filter(session=session).order_by("name")
        self.assertEqual(players.count(), 2)
        for player in players:
            self.assertEqual(player.total_buy_in, Decimal("0"))

    def test_create_session_applies_initial_buy_ins(self):
        response = self.client.post(
            f"/api/tables/{self.table.id}/sessions/",
            {
                "player_names": ["Aryan", "DJ"],
                "initial_buy_ins": ["20.00", "40.00"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        session = Session.objects.get(id=response.json()["id"])
        players = {
            player.name: player.total_buy_in
            for player in SessionPlayer.objects.filter(session=session)
        }
        self.assertEqual(players["Aryan"], Decimal("20.00"))
        self.assertEqual(players["DJ"], Decimal("40.00"))

    def test_create_session_rejects_mismatched_initial_buy_ins(self):
        response = self.client.post(
            f"/api/tables/{self.table.id}/sessions/",
            {
                "player_names": ["Aryan", "DJ"],
                "initial_buy_ins": ["20.00"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_buy_in_increments_player_total(self):
        session = Session.objects.create(table=self.table)
        player = SessionPlayer.objects.create(session=session, name="Aryan", total_buy_in="15.00")

        response = self.client.post(
            f"/api/sessions/{session.id}/buy-in/",
            {"player_id": player.id, "amount": "10.00"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["total_buy_in"], "25.00")

    def test_update_session_date(self):
        session = Session.objects.create(table=self.table, date="2026-01-10")

        response = self.client.patch(
            f"/api/sessions/{session.id}/",
            {"date": "2026-03-15"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["date"], "2026-03-15")

    def test_list_sessions_sorted_by_date(self):
        older = Session.objects.create(table=self.table, date="2026-01-01")
        newer = Session.objects.create(table=self.table, date="2026-06-01")

        desc = self.client.get(f"/api/tables/{self.table.id}/sessions/?ordering=-date")
        self.assertEqual([s["id"] for s in desc.json()], [newer.id, older.id])

        asc = self.client.get(f"/api/tables/{self.table.id}/sessions/?ordering=date")
        self.assertEqual([s["id"] for s in asc.json()], [older.id, newer.id])

    def test_complete_session_requires_balanced_totals(self):
        session = Session.objects.create(table=self.table)
        p1 = SessionPlayer.objects.create(session=session, name="Aryan", total_buy_in="20.00")
        p2 = SessionPlayer.objects.create(session=session, name="DJ", total_buy_in="20.00")

        response = self.client.post(
            f"/api/sessions/{session.id}/complete/",
            {
                "cash_outs": [
                    {"player_id": p1.id, "cash_out": "30.00"},
                    {"player_id": p2.id, "cash_out": "5.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_complete_session_allows_discrepancy_when_confirmed(self):
        session = Session.objects.create(table=self.table)
        p1 = SessionPlayer.objects.create(session=session, name="Aryan", total_buy_in="20.00")
        p2 = SessionPlayer.objects.create(session=session, name="DJ", total_buy_in="20.00")

        response = self.client.post(
            f"/api/sessions/{session.id}/complete/",
            {
                "cash_outs": [
                    {"player_id": p1.id, "cash_out": "30.00"},
                    {"player_id": p2.id, "cash_out": "5.00"},
                ],
                "allow_discrepancy": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_complete_session_creates_settlements_and_audit(self):
        session = Session.objects.create(table=self.table)
        winner = SessionPlayer.objects.create(session=session, name="DJ", total_buy_in="20.00")
        loser = SessionPlayer.objects.create(session=session, name="Fayyad", total_buy_in="20.00")

        response = self.client.post(
            f"/api/sessions/{session.id}/complete/",
            {
                "cash_outs": [
                    {"player_id": winner.id, "cash_out": "35.00"},
                    {"player_id": loser.id, "cash_out": "5.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(len(payload["settlements"]), 1)
        self.assertTrue(SessionSettlement.objects.filter(session=session).exists())
        self.assertTrue(SessionAuditEntry.objects.filter(session=session, action="session_completed").exists())

    def test_audit_log_endpoint(self):
        session = Session.objects.create(table=self.table)
        SessionAuditEntry.objects.create(
            session=session,
            actor_id=str(self.user.pk),
            action="session_created",
            message="Session started.",
            details={},
        )

        response = self.client.get(f"/api/sessions/{session.id}/audit-log/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()), 1)

    def test_adjust_completed_session_updates_amounts_and_settlements(self):
        session = Session.objects.create(table=self.table, is_completed=True)
        winner = SessionPlayer.objects.create(
            session=session, name="DJ", total_buy_in="20.00", cash_out="35.00"
        )
        loser = SessionPlayer.objects.create(
            session=session, name="Fayyad", total_buy_in="20.00", cash_out="5.00"
        )
        batch = SettlementBatch.objects.create(session=session, reason="migrated")
        SessionSettlement.objects.create(
            session=session, batch=batch, from_player="Fayyad", to_player="DJ", amount="15.00", order=0
        )

        response = self.client.post(
            f"/api/sessions/{session.id}/adjust/",
            {
                "players": [
                    {"player_id": winner.id, "total_buy_in": "25.00", "cash_out": "40.00"},
                    {"player_id": loser.id, "total_buy_in": "25.00", "cash_out": "10.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        by_name = {p["name"]: p for p in payload["players"]}
        self.assertEqual(by_name["DJ"]["total_buy_in"], "25.00")
        self.assertEqual(by_name["DJ"]["cash_out"], "40.00")
        self.assertEqual(by_name["Fayyad"]["total_buy_in"], "25.00")
        self.assertEqual(by_name["Fayyad"]["cash_out"], "10.00")
        self.assertEqual(len(payload["settlements"]), 1)
        self.assertEqual(payload["settlements"][0]["amount"], "15.00")
        self.assertTrue(
            SessionAuditEntry.objects.filter(session=session, action="amounts_adjusted").exists()
        )

    def test_settlement_recompute_keeps_history_instead_of_deleting(self):
        session = Session.objects.create(table=self.table)
        winner = SessionPlayer.objects.create(session=session, name="DJ", total_buy_in="20.00")
        loser = SessionPlayer.objects.create(session=session, name="Fayyad", total_buy_in="20.00")

        self.client.post(
            f"/api/sessions/{session.id}/complete/",
            {
                "cash_outs": [
                    {"player_id": winner.id, "cash_out": "35.00"},
                    {"player_id": loser.id, "cash_out": "5.00"},
                ],
            },
            format="json",
        )

        self.client.post(
            f"/api/sessions/{session.id}/adjust/",
            {
                "players": [
                    {"player_id": winner.id, "total_buy_in": "20.00", "cash_out": "25.00"},
                    {"player_id": loser.id, "total_buy_in": "20.00", "cash_out": "15.00"},
                ],
            },
            format="json",
        )

        # Both batches still exist — nothing was deleted.
        self.assertEqual(SessionSettlement.objects.filter(session=session).count(), 2)
        self.assertEqual(SettlementBatch.objects.filter(session=session).count(), 2)

        response = self.client.get(f"/api/sessions/{session.id}/settlement-history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        batches = response.json()
        self.assertEqual(len(batches), 2)
        self.assertEqual(batches[0]["reason"], "amounts_adjusted")
        self.assertEqual(batches[0]["lines"][0]["amount"], "5.00")
        self.assertEqual(batches[1]["reason"], "session_completed")
        self.assertEqual(batches[1]["lines"][0]["amount"], "15.00")

        # Only the latest batch is "current" on the session detail payload.
        detail = self.client.get(f"/api/sessions/{session.id}/").json()
        self.assertEqual(len(detail["settlements"]), 1)
        self.assertEqual(detail["settlements"][0]["amount"], "5.00")

    def test_adjust_rejects_imbalance_without_flag(self):
        session = Session.objects.create(table=self.table, is_completed=True)
        p1 = SessionPlayer.objects.create(session=session, name="A", total_buy_in="20.00", cash_out="20.00")
        p2 = SessionPlayer.objects.create(session=session, name="B", total_buy_in="20.00", cash_out="20.00")

        response = self.client.post(
            f"/api/sessions/{session.id}/adjust/",
            {
                "players": [
                    {"player_id": p1.id, "total_buy_in": "20.00", "cash_out": "30.00"},
                    {"player_id": p2.id, "total_buy_in": "20.00", "cash_out": "5.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_adjust_requires_completed_session(self):
        session = Session.objects.create(table=self.table, is_completed=False)
        player = SessionPlayer.objects.create(session=session, name="A", total_buy_in="20.00")

        response = self.client.post(
            f"/api/sessions/{session.id}/adjust/",
            {
                "players": [
                    {"player_id": player.id, "total_buy_in": "25.00", "cash_out": "25.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
    def test_compute_settlements_minimizes_transfers(self):
        class Player:
            def __init__(self, name, total_buy_in, cash_out):
                self.name = name
                self.total_buy_in = total_buy_in
                self.cash_out = cash_out

        players = [
            Player("Winner", "20.00", "50.00"),
            Player("LoserA", "30.00", "0.00"),
            Player("LoserB", "20.00", "20.00"),
        ]
        settlements = compute_settlements(players)
        self.assertEqual(len(settlements), 1)
        self.assertEqual(settlements[0]["amount"], Decimal("30.00"))


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class MeAPITests(TestCase):
    def setUp(self):
        cache.clear()
        self.client, self.user = auth_client("alice")
        self.other_client, self.other_user = auth_client("bob")

    def test_get_me_creates_user_profile(self):
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["user_id"], self.user.pk)
        self.assertTrue(LedgerUser.objects.filter(user=self.user).exists())

    def test_patch_me_updates_preferences(self):
        self.client.get("/api/me/")
        response = self.client.patch(
            "/api/me/",
            {
                "default_currency": "AED",
                "chip_default_values": ["1", "5", "20"],
                "session_sort_order": "asc",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["default_currency"], "AED")

    def test_me_isolated_per_user(self):
        self.client.get("/api/me/")
        self.other_client.get("/api/me/")
        self.other_client.patch("/api/me/", {"default_currency": "USD"}, format="json")

        alice = self.client.get("/api/me/").json()
        bob = self.other_client.get("/api/me/").json()
        self.assertEqual(alice["default_currency"], "GBP")
        self.assertEqual(bob["default_currency"], "USD")


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class IngestAPITests(TestCase):
    def setUp(self):
        cache.clear()
        self.client, self.user = auth_client("alice")

    def test_ingest_creates_table_sessions_and_settlements(self):
        payload = {
            "tables": [
                {
                    "name": "Dubai Summer 2026",
                    "default_buy_in": "20.00",
                    "currency": "AED",
                    "member_names": ["Alice", "Bob"],
                    "sessions": [
                        {
                            "date": "2026-04-05",
                            "players": [
                                {"name": "Alice", "total_buy_in": "20.00", "cash_out": "30.00"},
                                {"name": "Bob", "total_buy_in": "20.00", "cash_out": "10.00"},
                            ],
                        }
                    ],
                }
            ]
        }

        response = self.client.post("/api/me/ingest/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.assertEqual(body["tables_created"], 1)
        self.assertEqual(body["sessions_created"], 1)

        table = Table.objects.get(owner=self.user, name="Dubai Summer 2026")
        self.assertEqual(table.currency, "AED")
        self.assertEqual(table.members.count(), 2)

        session = table.sessions.get()
        self.assertTrue(session.is_completed)
        self.assertEqual(session.players.count(), 2)
        self.assertEqual(session.settlements.count(), 1)
        self.assertEqual(session.audit_entries.filter(action="session_imported").count(), 1)

    def test_ingest_allows_discrepant_sessions(self):
        payload = {
            "tables": [
                {
                    "name": "Unbalanced",
                    "default_buy_in": "10.00",
                    "currency": "GBP",
                    "sessions": [
                        {
                            "date": "2026-04-05",
                            "players": [
                                {"name": "Alice", "total_buy_in": "20.00", "cash_out": "30.00"},
                                {"name": "Bob", "total_buy_in": "20.00", "cash_out": "5.00"},
                            ],
                        }
                    ],
                }
            ]
        }

        response = self.client.post("/api/me/ingest/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        session = Session.objects.get(table__name="Unbalanced")
        self.assertEqual(
            session.audit_entries.filter(action="session_imported_with_discrepancy").count(),
            1,
        )

    def test_ingest_preserves_player_names_as_given(self):
        payload = {
            "tables": [
                {
                    "name": "Name Test",
                    "default_buy_in": "10.00",
                    "currency": "GBP",
                    "member_names": ["Alice", "Bob"],
                    "sessions": [
                        {
                            "date": "2026-04-05",
                            "players": [
                                {"name": "Alice", "total_buy_in": "10.00", "cash_out": "15.00"},
                                {"name": "Bob", "total_buy_in": "10.00", "cash_out": "5.00"},
                            ],
                        }
                    ],
                }
            ]
        }

        response = self.client.post("/api/me/ingest/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        table = Table.objects.get(name="Name Test")
        member_names = set(table.members.values_list("name", flat=True))
        self.assertEqual(member_names, {"Alice", "Bob"})

        session = table.sessions.get()
        players = {player.name: player for player in session.players.all()}
        self.assertEqual(len(players), 2)
        self.assertEqual(players["Alice"].total_buy_in, Decimal("10.00"))
        self.assertEqual(players["Bob"].cash_out, Decimal("5.00"))

    def test_ingest_creates_table_transfers(self):
        payload = {
            "tables": [
                {
                    "name": "Transfer Test",
                    "default_buy_in": "10.00",
                    "currency": "GBP",
                    "transfers": [
                        {"from_player": "Aadi", "to_player": "Daksh", "amount": "50.00"},
                        {"from_player": "Rohan", "to_player": "Aryan", "amount": "30.00"},
                    ],
                    "sessions": [],
                }
            ]
        }

        response = self.client.post("/api/me/ingest/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["transfers_created"], 2)

        table = Table.objects.get(name="Transfer Test")
        transfers = list(table.transfers.order_by("id"))
        self.assertEqual(len(transfers), 2)
        self.assertEqual(transfers[0].from_player, "Aadi")
        self.assertEqual(transfers[1].amount, Decimal("30.00"))

    def test_ingest_requires_auth(self):
        payload = {"tables": [{"name": "X", "default_buy_in": "10", "currency": "GBP", "sessions": []}]}
        response = APIClient().post("/api/me/ingest/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class CrossUserIsolationTests(TestCase):
    """Verify that one authenticated user cannot read or mutate another user's data."""

    def setUp(self):
        cache.clear()
        self.alice_client, self.alice = auth_client("alice_iso")
        self.bob_client, self.bob = auth_client("bob_iso")

        # Alice owns a table with one session and one player
        self.alice_table = Table.objects.create(
            name="Alice Private Table",
            default_buy_in="20.00",
            currency="GBP",
            owner=self.alice,
        )
        self.alice_session = Session.objects.create(table=self.alice_table)
        self.alice_player = SessionPlayer.objects.create(
            session=self.alice_session, name="Alice", total_buy_in="20.00"
        )

    # --- Table isolation ---

    def test_bob_cannot_retrieve_alices_table(self):
        response = self.bob_client.get(f"/api/tables/{self.alice_table.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_bob_cannot_update_alices_table(self):
        response = self.bob_client.patch(
            f"/api/tables/{self.alice_table.id}/",
            {"name": "Hacked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_bob_cannot_delete_alices_table(self):
        response = self.bob_client.delete(f"/api/tables/{self.alice_table.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Table.objects.filter(id=self.alice_table.id).exists())

    def test_bob_cannot_list_alices_sessions(self):
        response = self.bob_client.get(f"/api/tables/{self.alice_table.id}/sessions/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # --- Session isolation ---

    def test_bob_cannot_retrieve_alices_session(self):
        response = self.bob_client.get(f"/api/sessions/{self.alice_session.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_bob_cannot_patch_alices_session_date(self):
        response = self.bob_client.patch(
            f"/api/sessions/{self.alice_session.id}/",
            {"date": "2000-01-01"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_bob_cannot_delete_alices_session(self):
        response = self.bob_client.delete(f"/api/sessions/{self.alice_session.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Session.objects.filter(id=self.alice_session.id).exists())

    def test_bob_cannot_add_buy_in_to_alices_session(self):
        response = self.bob_client.post(
            f"/api/sessions/{self.alice_session.id}/buy-in/",
            {"player_id": self.alice_player.id, "amount": "10.00"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_bob_cannot_complete_alices_session(self):
        response = self.bob_client.post(
            f"/api/sessions/{self.alice_session.id}/complete/",
            {
                "cash_outs": [
                    {"player_id": self.alice_player.id, "cash_out": "20.00"},
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_bob_cannot_view_alices_session_audit_log(self):
        response = self.bob_client.get(f"/api/sessions/{self.alice_session.id}/audit-log/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_bobs_table_list_does_not_include_alices_tables(self):
        response = self.bob_client.get("/api/tables/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [t["id"] for t in response.json()]
        self.assertNotIn(self.alice_table.id, ids)


@override_settings(ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"])
class FrontendAssetTests(TestCase):
    def test_health_endpoint_is_public(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_manifest_is_valid_json_with_manifest_content_type(self):
        response = self.client.get("/manifest.webmanifest")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("application/manifest+json", response["Content-Type"])
        body = b"".join(response.streaming_content)
        payload = json.loads(body.decode())
        self.assertEqual(payload["name"], "Poker Ledger")

    def test_api_tables_requires_auth(self):
        response = self.client.get("/api/tables/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class ShareLinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner_client, self.owner = auth_client("share_owner")
        self.other_client, self.other = auth_client("share_other")
        self.table = Table.objects.create(name="Shared Table", default_buy_in="10.00", owner=self.owner)
        self.session = Session.objects.create(table=self.table)
        SessionPlayer.objects.create(session=self.session, name="P1", total_buy_in="10.00")

    def _enable_sharing(self):
        response = self.owner_client.post(f"/api/tables/{self.table.id}/share-link/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.json()["share_token"]

    def test_share_link_disabled_by_default(self):
        response = self.owner_client.get(f"/api/tables/{self.table.id}/share-link/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.json()["share_token"])

    def test_owner_can_generate_share_link(self):
        token = self._enable_sharing()
        self.assertGreaterEqual(len(token), 40)

    def test_non_owner_cannot_manage_share_link(self):
        response = self.other_client.post(f"/api/tables/{self.table.id}/share-link/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_member_cannot_manage_share_link(self):
        token = self._enable_sharing()
        self.other_client.post(f"/api/shared/{token}/join/")
        response = self.other_client.post(f"/api/tables/{self.table.id}/share-link/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_anonymous_can_view_shared_table(self):
        token = self._enable_sharing()
        response = APIClient().get(f"/api/shared/{token}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["table"]["name"], "Shared Table")
        self.assertEqual(payload["table"]["owner_name"], self.owner.email)
        self.assertNotIn("owner_id", payload["table"])
        self.assertNotIn("owner_email", payload["table"])
        self.assertNotIn("share_token", payload["table"])
        self.assertEqual(len(payload["sessions"]), 1)
        self.assertFalse(payload["sessions"][0]["can_edit"])
        self.assertEqual(
            payload["viewer"],
            {"is_authenticated": False, "is_owner": False, "is_member": False},
        )

    def test_shared_owner_name_uses_full_name(self):
        self.owner.first_name = "Grace"
        self.owner.last_name = "Hopper"
        self.owner.save(update_fields=["first_name", "last_name"])
        token = self._enable_sharing()
        response = APIClient().get(f"/api/shared/{token}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["table"]["owner_name"], "Grace Hopper")
        self.assertNotIn("owner_email", response.json()["table"])

    def test_bad_token_404(self):
        self._enable_sharing()
        response = APIClient().get("/api/shared/not-a-real-token-aaaaaaaaaaaaaaaa/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_rotate_invalidates_old_token(self):
        old_token = self._enable_sharing()
        new_token = self._enable_sharing()
        self.assertNotEqual(old_token, new_token)
        self.assertEqual(APIClient().get(f"/api/shared/{old_token}/").status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(APIClient().get(f"/api/shared/{new_token}/").status_code, status.HTTP_200_OK)

    def test_revoke_disables_link(self):
        token = self._enable_sharing()
        response = self.owner_client.delete(f"/api/tables/{self.table.id}/share-link/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(APIClient().get(f"/api/shared/{token}/").status_code, status.HTTP_404_NOT_FOUND)

    def test_viewer_flags_for_logged_in_non_member(self):
        token = self._enable_sharing()
        response = self.other_client.get(f"/api/shared/{token}/")
        self.assertEqual(
            response.json()["viewer"],
            {"is_authenticated": True, "is_owner": False, "is_member": False},
        )

    def test_viewer_flags_for_owner(self):
        token = self._enable_sharing()
        response = self.owner_client.get(f"/api/shared/{token}/")
        self.assertEqual(
            response.json()["viewer"],
            {"is_authenticated": True, "is_owner": True, "is_member": False},
        )


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class MembershipTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner_client, self.owner = auth_client("mem_owner")
        self.member_client, self.member = auth_client("mem_viewer")
        self.table = Table.objects.create(name="Join Me", default_buy_in="10.00", owner=self.owner)
        self.session = Session.objects.create(table=self.table)
        self.player = SessionPlayer.objects.create(session=self.session, name="P1", total_buy_in="10.00")
        self.token = self.owner_client.post(f"/api/tables/{self.table.id}/share-link/").json()["share_token"]

    def _join(self, client=None):
        return (client or self.member_client).post(f"/api/shared/{self.token}/join/")

    def test_join_creates_viewer_membership(self):
        response = self._join()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json(), {"table_id": self.table.id, "role": "viewer"})
        self.assertTrue(TableMembership.objects.filter(table=self.table, user=self.member).exists())

    def test_join_is_idempotent(self):
        self._join()
        response = self._join()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(TableMembership.objects.filter(table=self.table, user=self.member).count(), 1)

    def test_owner_join_is_noop(self):
        response = self._join(self.owner_client)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["role"], "owner")
        self.assertFalse(TableMembership.objects.filter(table=self.table, user=self.owner).exists())

    def test_anonymous_cannot_join(self):
        response = APIClient().post(f"/api/shared/{self.token}/join/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_member_sees_table_in_list_with_viewer_role(self):
        self._join()
        response = self.member_client.get("/api/tables/")
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["id"], self.table.id)
        self.assertEqual(payload[0]["role"], "viewer")
        self.assertEqual(payload[0]["owner_email"], self.owner.email)
        self.assertEqual(payload[0]["owner_name"], self.owner.email)

    def test_member_retrieve_includes_owner_display_fields(self):
        self.owner.first_name = "Alan"
        self.owner.last_name = "Turing"
        self.owner.save(update_fields=["first_name", "last_name"])
        self._join()
        response = self.member_client.get(f"/api/tables/{self.table.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["role"], "viewer")
        self.assertEqual(payload["owner_name"], "Alan Turing")
        self.assertEqual(payload["owner_email"], self.owner.email)
        self.assertEqual(payload["owner_id"], self.owner.pk)

    def test_owner_sees_owner_role(self):
        response = self.owner_client.get("/api/tables/")
        payload = response.json()[0]
        self.assertEqual(payload["role"], "owner")
        self.assertEqual(payload["owner_email"], self.owner.email)
        self.assertEqual(payload["owner_name"], self.owner.email)

    def test_member_can_read_table_sessions_and_audit_log(self):
        self._join()
        self.assertEqual(self.member_client.get(f"/api/tables/{self.table.id}/").status_code, 200)
        self.assertEqual(self.member_client.get(f"/api/tables/{self.table.id}/sessions/").status_code, 200)
        session_response = self.member_client.get(f"/api/sessions/{self.session.id}/")
        self.assertEqual(session_response.status_code, 200)
        self.assertFalse(session_response.json()["can_edit"])
        self.assertEqual(self.member_client.get(f"/api/sessions/{self.session.id}/audit-log/").status_code, 200)
        self.assertEqual(
            self.member_client.get(f"/api/sessions/{self.session.id}/settlement-history/").status_code, 200
        )

    def test_owner_session_detail_has_can_edit(self):
        response = self.owner_client.get(f"/api/sessions/{self.session.id}/")
        self.assertTrue(response.json()["can_edit"])

    def test_member_cannot_mutate_table(self):
        self._join()
        self.assertEqual(
            self.member_client.patch(f"/api/tables/{self.table.id}/", {"name": "Hax"}, format="json").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.member_client.delete(f"/api/tables/{self.table.id}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_member_cannot_create_session(self):
        self._join()
        response = self.member_client.post(
            f"/api/tables/{self.table.id}/sessions/",
            {"player_names": ["A", "B"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_member_cannot_mutate_session(self):
        self._join()
        endpoints = [
            ("patch", f"/api/sessions/{self.session.id}/", {"date": "2000-01-01"}),
            ("delete", f"/api/sessions/{self.session.id}/", None),
            ("post", f"/api/sessions/{self.session.id}/buy-in/", {"player_id": self.player.id, "amount": "5.00"}),
            ("post", f"/api/sessions/{self.session.id}/add-player/", {"name": "Eve"}),
            ("post", f"/api/sessions/{self.session.id}/complete/", {"cash_outs": []}),
            ("post", f"/api/sessions/{self.session.id}/adjust/", {
                "players": [{"player_id": self.player.id, "total_buy_in": "10.00", "cash_out": "10.00"}],
            }),
        ]
        for method, url, data in endpoints:
            response = getattr(self.member_client, method)(url, data, format="json")
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, f"{method} {url}")

    def test_owner_lists_memberships(self):
        self._join()
        response = self.owner_client.get(f"/api/tables/{self.table.id}/memberships/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["user_id"], self.member.pk)
        self.assertEqual(payload[0]["role"], "viewer")

    def test_member_cannot_list_memberships(self):
        self._join()
        response = self.member_client.get(f"/api/tables/{self.table.id}/memberships/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_owner_removes_member(self):
        self._join()
        membership = TableMembership.objects.get(table=self.table, user=self.member)
        response = self.owner_client.delete(f"/api/tables/{self.table.id}/memberships/{membership.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(
            self.member_client.get(f"/api/tables/{self.table.id}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_member_can_leave(self):
        self._join()
        response = self.member_client.post(f"/api/tables/{self.table.id}/leave/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(TableMembership.objects.filter(table=self.table, user=self.member).exists())

    def test_cache_fanout_member_sees_owner_rename(self):
        self._join()
        # Prime the member's cache
        first = self.member_client.get(f"/api/tables/{self.table.id}/")
        self.assertEqual(first.json()["name"], "Join Me")
        # Owner renames; fanout must invalidate the member's cached copy too
        self.owner_client.patch(f"/api/tables/{self.table.id}/", {"name": "Renamed"}, format="json")
        second = self.member_client.get(f"/api/tables/{self.table.id}/")
        self.assertEqual(second.json()["name"], "Renamed")


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class ChangeRequestTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner_client, self.owner = auth_client("req_owner")
        self.member_client, self.member = auth_client("req_member")
        self.outsider_client, self.outsider = auth_client("req_outsider")
        self.table = Table.objects.create(name="Disputed", default_buy_in="10.00", owner=self.owner)
        self.session = Session.objects.create(table=self.table)
        self.other_table = Table.objects.create(name="Other", default_buy_in="10.00", owner=self.outsider)
        self.other_session = Session.objects.create(table=self.other_table)
        token = self.owner_client.post(f"/api/tables/{self.table.id}/share-link/").json()["share_token"]
        self.member_client.post(f"/api/shared/{token}/join/")

    def _raise_request(self, client=None, **overrides):
        data = {"message": "Buy-in looks wrong", "session": self.session.id}
        data.update(overrides)
        return (client or self.member_client).post(
            f"/api/tables/{self.table.id}/requests/", data, format="json"
        )

    def test_member_can_raise_session_request(self):
        response = self._raise_request()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = response.json()
        self.assertEqual(payload["status"], "open")
        self.assertEqual(payload["requester_id"], self.member.pk)
        self.assertEqual(payload["session"], self.session.id)
        self.assertTrue(
            SessionAuditEntry.objects.filter(session=self.session, action="change_request_raised").exists()
        )

    def test_member_can_raise_table_level_request(self):
        response = self._raise_request(session=None)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(response.json()["session"])

    def test_request_with_foreign_session_rejected(self):
        response = self._raise_request(session=self.other_session.id)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_blank_message_rejected(self):
        response = self._raise_request(message="   ")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_member_cannot_raise_request(self):
        response = self._raise_request(client=self.outsider_client)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_anonymous_cannot_raise_request(self):
        response = APIClient().post(
            f"/api/tables/{self.table.id}/requests/",
            {"message": "hi"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_owner_lists_all_requests_member_lists_own(self):
        self._raise_request()
        self._raise_request(client=self.owner_client, message="Owner note to self")

        owner_list = self.owner_client.get(f"/api/tables/{self.table.id}/requests/").json()
        self.assertEqual(len(owner_list), 2)

        member_list = self.member_client.get(f"/api/tables/{self.table.id}/requests/").json()
        self.assertEqual(len(member_list), 1)
        self.assertEqual(member_list[0]["requester_id"], self.member.pk)

    def test_status_filter(self):
        self._raise_request()
        response = self.owner_client.get(f"/api/tables/{self.table.id}/requests/?status=resolved")
        self.assertEqual(response.json(), [])

    def test_owner_resolves_request(self):
        request_id = self._raise_request().json()["id"]
        response = self.owner_client.post(
            f"/api/tables/{self.table.id}/requests/{request_id}/resolve/",
            {"status": "resolved", "resolution_note": "Fixed the buy-in."},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["status"], "resolved")
        self.assertEqual(payload["resolution_note"], "Fixed the buy-in.")
        self.assertIsNotNone(payload["resolved_at"])
        self.assertTrue(
            SessionAuditEntry.objects.filter(session=self.session, action="change_request_resolved").exists()
        )

    def test_member_cannot_resolve_request(self):
        request_id = self._raise_request().json()["id"]
        response = self.member_client.post(
            f"/api/tables/{self.table.id}/requests/{request_id}/resolve/",
            {"status": "resolved"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_resolve_non_open_request(self):
        request_id = self._raise_request().json()["id"]
        self.owner_client.post(
            f"/api/tables/{self.table.id}/requests/{request_id}/resolve/",
            {"status": "rejected"},
            format="json",
        )
        response = self.owner_client.post(
            f"/api/tables/{self.table.id}/requests/{request_id}/resolve/",
            {"status": "resolved"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


@override_settings(
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"],
    DEBUG=True,
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "ledger-tests",
        }
    },
)
class TableTransferTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner_client, self.owner = auth_client("xfer_owner")
        self.member_client, self.member = auth_client("xfer_member")
        self.outsider_client, self.outsider = auth_client("xfer_outsider")
        self.table = Table.objects.create(name="Cash Table", default_buy_in="10.00", owner=self.owner)
        token = self.owner_client.post(f"/api/tables/{self.table.id}/share-link/").json()["share_token"]
        self.member_client.post(f"/api/shared/{token}/join/")

    def _create_transfer(self, client=None, **overrides):
        data = {"from_player": "Alice", "to_player": "Bob", "amount": "25.00", "note": "IOU settled"}
        data.update(overrides)
        return (client or self.owner_client).post(
            f"/api/tables/{self.table.id}/transfers/", data, format="json"
        )

    def test_owner_can_record_transfer(self):
        response = self._create_transfer()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = response.json()
        self.assertEqual(payload["from_player"], "Alice")
        self.assertEqual(payload["to_player"], "Bob")
        self.assertEqual(payload["amount"], "25.00")
        self.assertEqual(payload["note"], "IOU settled")
        self.assertEqual(TableTransfer.objects.filter(table=self.table).count(), 1)

    def test_transfer_is_visible_to_members(self):
        self._create_transfer()
        response = self.member_client.get(f"/api/tables/{self.table.id}/")
        transfers = response.json()["transfers"]
        self.assertEqual(len(transfers), 1)
        self.assertEqual(transfers[0]["from_player"], "Alice")

    def test_member_cannot_record_transfer(self):
        response = self._create_transfer(client=self.member_client)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_outsider_cannot_record_transfer(self):
        response = self._create_transfer(client=self.outsider_client)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_rejects_non_positive_amount(self):
        response = self._create_transfer(amount="0")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rejects_same_from_and_to_player(self):
        response = self._create_transfer(to_player="Alice")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_owner_can_delete_transfer(self):
        transfer_id = self._create_transfer().json()["id"]
        response = self.owner_client.delete(f"/api/tables/{self.table.id}/transfers/{transfer_id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(TableTransfer.objects.filter(id=transfer_id).exists())

    def test_member_cannot_delete_transfer(self):
        transfer_id = self._create_transfer().json()["id"]
        response = self.member_client.delete(f"/api/tables/{self.table.id}/transfers/{transfer_id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(TableTransfer.objects.filter(id=transfer_id).exists())
