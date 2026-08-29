from decimal import Decimal

from django.db import transaction

from .audit import log_session_audit
from .models import Session, SessionPlayer, Table, TableMember, TableTransfer
from .player_names import canonical_player_name
from .settlement import (
    discrepancy_between,
    has_discrepancy,
    persist_settlements,
    quantize_money,
)


def _member_names_for_table(table_data, sessions_data):
    names = []
    seen = set()
    for name in table_data.get("member_names") or []:
        canonical = canonical_player_name(name)
        if canonical not in seen:
            names.append(canonical)
            seen.add(canonical)
    for session in sessions_data:
        for player in session.get("players") or []:
            canonical = canonical_player_name(player["name"])
            if canonical not in seen:
                names.append(canonical)
                seen.add(canonical)
    return names


def _players_for_session(session_data):
    merged = {}
    order = []
    for player_data in session_data.get("players") or []:
        name = canonical_player_name(player_data["name"])
        buy_in = Decimal(str(player_data["total_buy_in"]))
        cash_out = Decimal(str(player_data["cash_out"]))
        if name in merged:
            merged[name]["total_buy_in"] += buy_in
            merged[name]["cash_out"] += cash_out
            continue
        merged[name] = {
            "name": name,
            "total_buy_in": buy_in,
            "cash_out": cash_out,
        }
        order.append(name)
    return [merged[name] for name in order]


def ingest_tables(user, tables_data, *, actor_id):
    created_tables = []

    with transaction.atomic():
        for table_data in tables_data:
            sessions_data = table_data.get("sessions") or []
            table = Table.objects.create(
                owner=user,
                name=table_data["name"],
                default_buy_in=table_data.get("default_buy_in", "20.00"),
                default_buy_in_b=table_data.get("default_buy_in_b", "0"),
                currency=table_data["currency"],
            )

            for name in _member_names_for_table(table_data, sessions_data):
                TableMember.objects.create(table=table, name=name)

            transfer_count = 0
            for transfer_data in table_data.get("transfers") or []:
                TableTransfer.objects.create(
                    table=table,
                    from_player=canonical_player_name(transfer_data["from_player"]),
                    to_player=canonical_player_name(transfer_data["to_player"]),
                    amount=transfer_data["amount"],
                    note=transfer_data.get("note", ""),
                )
                transfer_count += 1

            session_count = 0
            for session_data in sessions_data:
                session = Session.objects.create(
                    table=table,
                    date=session_data["date"],
                    is_completed=True,
                )
                session_count += 1

                players = []
                total_buy_in = Decimal("0")
                total_cash_out = Decimal("0")
                for player_data in _players_for_session(session_data):
                    buy_in = player_data["total_buy_in"]
                    cash_out = player_data["cash_out"]
                    total_buy_in += buy_in
                    total_cash_out += cash_out
                    players.append(
                        SessionPlayer.objects.create(
                            session=session,
                            name=player_data["name"],
                            total_buy_in=buy_in,
                            cash_out=cash_out,
                        )
                    )

                discrepancy = discrepancy_between(total_buy_in, total_cash_out)
                settlements = persist_settlements(
                    session, reason="session_imported", discrepancy=discrepancy
                )
                unbalanced = has_discrepancy(discrepancy)
                quantized = quantize_money(discrepancy)

                log_session_audit(
                    session,
                    actor_id=actor_id,
                    action="session_imported_with_discrepancy" if unbalanced else "session_imported",
                    message=(
                        f"Imported session on {session.date} with {quantized} discrepancy."
                        if unbalanced
                        else f"Imported session on {session.date} with {len(players)} player(s)."
                    ),
                    details={
                        "source": "json_import",
                        "player_count": len(players),
                        "discrepancy": str(quantized),
                        "total_buy_in": str(total_buy_in),
                        "total_cash_out": str(total_cash_out),
                        "settlement_count": len(settlements),
                    },
                )

            created_tables.append(
                {
                    "id": table.id,
                    "name": table.name,
                    "session_count": session_count,
                    "transfer_count": transfer_count,
                }
            )

    return {
        "tables_created": len(created_tables),
        "sessions_created": sum(item["session_count"] for item in created_tables),
        "transfers_created": sum(item["transfer_count"] for item in created_tables),
        "tables": created_tables,
    }
