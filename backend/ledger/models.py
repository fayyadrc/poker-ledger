from django.conf import settings
from django.db import models
from django.utils import timezone


def default_session_date():
    return timezone.localdate()


FACTORY_CHIP_VALUES = ["0.25", "1", "5", "25"]


def default_chip_values():
    return list(FACTORY_CHIP_VALUES)


class LedgerUser(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ledger_profile")
    # Stable link to the Supabase Auth user (GoTrue `sub`, a UUID). Set on first
    # authenticated request by SupabaseJWTAuthentication. Null for rows created
    # before the migration and for users who have not signed in via Supabase yet.
    supabase_id = models.CharField(max_length=64, unique=True, null=True, blank=True, db_index=True)
    default_currency = models.CharField(max_length=3, default="GBP")
    chip_default_values = models.JSONField(default=default_chip_values)
    session_sort_order = models.CharField(max_length=4, default="desc")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return str(self.user)


class Table(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="tables",
        db_index=True,
    )
    name = models.CharField(max_length=255)
    default_buy_in = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    default_buy_in_b = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="GBP")
    # Multi-use invite/share token. Null = sharing disabled. Generated with
    # secrets.token_urlsafe(32) in the share-link view action.
    share_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class TableMembership(models.Model):
    """A user who joined a table via its share link. The owner never gets a row."""

    ROLE_VIEWER = "viewer"
    ROLE_CHOICES = [(ROLE_VIEWER, "Viewer")]

    table = models.ForeignKey(Table, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="table_memberships")
    # Denormalized copy of table.owner_id so the RLS policy on this table never
    # needs to subquery ledger_table (which would recurse with ledger_table's
    # member-read policy). Ownership is never transferred, so it cannot drift.
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+", db_index=True)
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default=ROLE_VIEWER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("table", "user")

    def __str__(self):
        return f"{self.user} @ {self.table.name} ({self.role})"


class ChangeRequest(models.Model):
    STATUS_OPEN = "open"
    STATUS_RESOLVED = "resolved"
    STATUS_REJECTED = "rejected"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open"),
        (STATUS_RESOLVED, "Resolved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    table = models.ForeignKey(Table, on_delete=models.CASCADE, related_name="change_requests")
    session = models.ForeignKey(
        "Session", on_delete=models.CASCADE, related_name="change_requests", null=True, blank=True
    )
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="change_requests")
    # Denormalized table.owner_id — same RLS rationale as TableMembership.owner.
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+", db_index=True)
    message = models.TextField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_OPEN, db_index=True)
    resolution_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["table", "status"])]

    def __str__(self):
        return f"Request #{self.pk} on {self.table.name} ({self.status})"


class TableMember(models.Model):
    table = models.ForeignKey(Table, on_delete=models.CASCADE, related_name="members")
    name = models.CharField(max_length=100)

    class Meta:
        unique_together = ("table", "name")

    def __str__(self):
        return f"{self.name} @ {self.table.name}"


class TableTransfer(models.Model):
    table = models.ForeignKey(Table, on_delete=models.CASCADE, related_name="transfers")
    from_player = models.CharField(max_length=100)
    to_player = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.from_player} → {self.to_player}: {self.amount}"


class Session(models.Model):
    table = models.ForeignKey(Table, on_delete=models.CASCADE, related_name="sessions")
    date = models.DateField(default=default_session_date)
    is_completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Session {self.id} — {self.table.name} ({self.date})"


class SessionPlayer(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="players")
    name = models.CharField(max_length=100)
    total_buy_in = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cash_out = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    def __str__(self):
        return f"{self.name} in session {self.session.id}"


class SettlementBatch(models.Model):
    """One settlement recompute event for a session (grouping of SessionSettlement lines)."""

    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="settlement_batches")
    # Mirrors SessionAuditEntry.action values (session_completed, amounts_adjusted,
    # player_added, session_imported, migrated) so history labels line up with the
    # existing activity log.
    reason = models.CharField(max_length=32)
    discrepancy = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"Batch #{self.pk} for session {self.session_id} ({self.reason})"


class SessionSettlement(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="settlements")
    batch = models.ForeignKey(SettlementBatch, on_delete=models.CASCADE, related_name="lines")
    from_player = models.CharField(max_length=100)
    to_player = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    order = models.PositiveSmallIntegerField(default=0)
    is_current = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.from_player} → {self.to_player}: {self.amount}"


class SessionAuditEntry(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="audit_entries")
    actor_id = models.CharField(max_length=64, blank=True, db_index=True)
    action = models.CharField(max_length=50)
    message = models.TextField()
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} @ {self.created_at}"
