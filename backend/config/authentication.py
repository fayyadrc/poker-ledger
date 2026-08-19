"""
Supabase Auth → Django authentication bridge.

The React SPA authenticates against Supabase Auth (GoTrue) and sends the
resulting access token as ``Authorization: Bearer <jwt>`` on every ``/api/``
request. This DRF authentication class verifies that JWT and maps the Supabase
identity onto a Django user, so the rest of the app (RLS, DRF permissions,
serializers, ``get_queryset`` owner filters) keeps working unchanged against
integer Django user PKs.

Identity mapping (see SUPABASE_AUTH_SETUP.md):
  1. Known Supabase user  → ``LedgerUser.supabase_id`` match → its Django user.
  2. Pre-existing user re-signing up with the SAME email → linked by email so
     all of their historical tables/sessions stay attached, and the Supabase id
     is persisted for next time.
  3. Brand-new user → a fresh Django user is created.

RLS note: ``SetRLSUserMiddleware`` runs *before* DRF resolves the bearer token,
so it can only set a safe default (``app.current_user_id = '0'``). Once we know
the real user here — which happens inside the view, before ``get_queryset`` — we
set the session variable to the actual PK so the Postgres RLS policies bind to
the right user even if the app connects as a non-superuser role.

Security: ``SUPABASE_JWT_SECRET`` verifies the signature and must stay
server-side only. The SPA uses the anon/publishable key exclusively.
"""

import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from jwt import PyJWKClient
from rest_framework import authentication, exceptions

User = get_user_model()

# Cached per SUPABASE_URL — PyJWKClient does its own in-memory caching of the
# fetched keys, so this client should live for the process lifetime rather
# than being rebuilt per request.
_jwks_client = None
_jwks_client_url = None


def _get_jwks_client():
    global _jwks_client, _jwks_client_url
    if not settings.SUPABASE_URL:
        return None
    if _jwks_client is None or _jwks_client_url != settings.SUPABASE_URL:
        _jwks_client = PyJWKClient(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json")
        _jwks_client_url = settings.SUPABASE_URL
    return _jwks_client


class SupabaseJWTAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            # No bearer token — let DRF treat the request as unauthenticated.
            # AllowAny views (e.g. /api/shared/<token>/) still work.
            return None
        if len(header) == 1:
            raise exceptions.AuthenticationFailed("Invalid bearer header: no credentials.")
        if len(header) > 2:
            raise exceptions.AuthenticationFailed("Invalid bearer header: token contains spaces.")

        payload = self._decode(header[1].decode())

        sub = payload.get("sub")
        if not sub:
            raise exceptions.AuthenticationFailed("Token is missing the subject (sub) claim.")
        email = (payload.get("email") or "").strip()

        user = self._resolve_user(sub, email)
        if not user.is_active:
            raise exceptions.AuthenticationFailed("This account is disabled.")

        self._bind_rls_user(user)
        return (user, header[1].decode())

    def authenticate_header(self, request):
        # Makes DRF answer 401 (not 403) when auth is missing/invalid.
        return self.keyword

    # ── JWT verification ────────────────────────────────────────────────────
    # Newer Supabase projects sign access tokens with an asymmetric key (ES256)
    # rather than the legacy shared HS256 secret — the two are mutually
    # exclusive per project, not a fallback chain. Prefer JWKS (SUPABASE_URL)
    # when configured; only fall back to the legacy HS256 secret otherwise.
    def _decode(self, token):
        jwks_client = _get_jwks_client()
        if jwks_client:
            try:
                signing_key = jwks_client.get_signing_key_from_jwt(token)
            except jwt.PyJWTError:
                raise exceptions.AuthenticationFailed("Token is invalid.")
            return self._verify(token, signing_key.key, ["ES256", "RS256"])

        secret = getattr(settings, "SUPABASE_JWT_SECRET", "")
        if not secret:
            raise exceptions.AuthenticationFailed(
                "Server auth is not configured (set SUPABASE_URL for JWKS "
                "verification, or SUPABASE_JWT_SECRET for legacy HS256)."
            )
        return self._verify(token, secret, ["HS256"])

    def _verify(self, token, key, algorithms):
        try:
            return jwt.decode(
                token,
                key,
                algorithms=algorithms,
                audience=settings.SUPABASE_JWT_AUD,
                options={"require": ["exp", "sub"]},
            )
        except jwt.ExpiredSignatureError:
            raise exceptions.AuthenticationFailed("Token has expired.")
        except jwt.InvalidAudienceError:
            raise exceptions.AuthenticationFailed("Token has an invalid audience.")
        except jwt.PyJWTError:
            # Covers bad signature, wrong algorithm, malformed token, etc.
            raise exceptions.AuthenticationFailed("Token is invalid.")

    # ── Supabase identity → Django user ─────────────────────────────────────
    def _resolve_user(self, sub, email):
        from ledger.models import LedgerUser

        profile = LedgerUser.objects.select_related("user").filter(supabase_id=sub).first()
        if profile:
            # Keep Django's copy of the email in sync if it changed in Supabase.
            if email and (profile.user.email or "").lower() != email.lower():
                profile.user.email = email
                profile.user.save(update_fields=["email"])
            return profile.user

        with transaction.atomic():
            existing = User.objects.filter(email__iexact=email).first() if email else None
            if existing:
                # A pre-existing account re-signing up through Supabase. Link by
                # email so their historical data stays attached, then remember
                # the Supabase id so future logins skip straight to the match.
                LedgerUser.objects.update_or_create(
                    user=existing, defaults={"supabase_id": sub}
                )
                return existing

            # Brand-new identity. Password lives in Supabase, so the Django user
            # gets an unusable password (create_user with no password sets one).
            username = (email or sub)[:150]
            try:
                user = User.objects.create_user(username=username, email=email)
            except IntegrityError:
                # Username collided with a legacy row — fall back to the uuid.
                user = User.objects.create_user(username=sub[:150], email=email)
            LedgerUser.objects.update_or_create(user=user, defaults={"supabase_id": sub})
            return user

    # ── RLS ─────────────────────────────────────────────────────────────────
    def _bind_rls_user(self, user):
        # Overwrite the middleware's safe default now that the real user is
        # known, before get_queryset issues any SELECTs on this connection.
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('app.current_user_id', %s, FALSE)", [str(user.pk)]
                )
