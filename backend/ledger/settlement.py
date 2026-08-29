from decimal import Decimal

from .models import SessionSettlement, SettlementBatch

MONEY_TOLERANCE = Decimal("0.01")


def quantize_money(amount):
    return Decimal(str(amount)).quantize(MONEY_TOLERANCE)


def has_discrepancy(discrepancy):
    return abs(Decimal(str(discrepancy))) > MONEY_TOLERANCE


def discrepancy_between(total_buy_in, total_cash_out):
    return abs(Decimal(str(total_buy_in)) - Decimal(str(total_cash_out)))


def compute_settlements(players):
    """
    Minimize who-pays-whom transfers from session player net results.
    Each player needs name, total_buy_in, and cash_out.
    Returns list of {from_player, to_player, amount}.
    """
    nets = []
    for player in players:
        buy_in = Decimal(str(player.total_buy_in))
        cash_out = Decimal(str(player.cash_out or 0))
        net = cash_out - buy_in
        if abs(net) < MONEY_TOLERANCE:
            continue
        nets.append((player.name, net))

    debtors = sorted(((name, -net) for name, net in nets if net < 0), key=lambda item: item[1], reverse=True)
    creditors = sorted(((name, net) for name, net in nets if net > 0), key=lambda item: item[1], reverse=True)

    settlements = []
    i = 0
    j = 0
    while i < len(debtors) and j < len(creditors):
        debtor_name, debt = debtors[i]
        creditor_name, credit = creditors[j]
        amount = min(debt, credit)
        settlements.append(
            {
                "from_player": debtor_name,
                "to_player": creditor_name,
                "amount": quantize_money(amount),
            }
        )
        debt -= amount
        credit -= amount
        if debt < MONEY_TOLERANCE:
            i += 1
        else:
            debtors[i] = (debtor_name, debt)
        if credit < MONEY_TOLERANCE:
            j += 1
        else:
            creditors[j] = (creditor_name, credit)

    return settlements


def persist_settlements(session, *, reason, discrepancy=Decimal("0")):
    """Recompute settlements for a session, keeping prior batches as history.

    Older settlement rows are never deleted — they're flagged `is_current=False`
    so past batches remain queryable via `session.settlement_batches`.
    """
    players = list(session.players.all())
    settlements = compute_settlements(players)

    session.settlements.filter(is_current=True).update(is_current=False)
    batch = SettlementBatch.objects.create(
        session=session,
        reason=reason,
        discrepancy=quantize_money(discrepancy),
    )
    SessionSettlement.objects.bulk_create(
        [
            SessionSettlement(
                session=session,
                batch=batch,
                from_player=item["from_player"],
                to_player=item["to_player"],
                amount=item["amount"],
                order=index,
                is_current=True,
            )
            for index, item in enumerate(settlements)
        ]
    )
    return settlements
