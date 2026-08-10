from dotenv import load_dotenv
from pathlib import Path
import os

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("SECRET_KEY", "dev-insecure-key-change-in-production")

DEBUG = os.getenv("DEBUG", "False") == "True"

ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "127.0.0.1,localhost").split(",") if h.strip()]

# Vercel sets VERCEL=1 in its build and runtime environments.
IS_SERVERLESS = bool(os.getenv("VERCEL"))
if IS_SERVERLESS:
    # Vercel production + preview deployments are served from dynamic *.vercel.app hosts.
    ALLOWED_HOSTS = list(dict.fromkeys([*ALLOWED_HOSTS, ".vercel.app"]))

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    "rest_framework",
    "corsheaders",
    "allauth",
    "allauth.account",
    "allauth.headless",
    "ledger",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "config.middleware.SetRLSUserMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173").rstrip("/")

_local_dev_origins = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
)
_env_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _env_origins:
    CORS_ALLOWED_ORIGINS = list(dict.fromkeys([*_env_origins, FRONTEND_URL]))
else:
    CORS_ALLOWED_ORIGINS = list(dict.fromkeys([*_local_dev_origins, FRONTEND_URL]))
if DEBUG:
    CORS_ALLOWED_ORIGINS = list(dict.fromkeys([*CORS_ALLOWED_ORIGINS, *_local_dev_origins, FRONTEND_URL]))
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS

SITE_ID = 1

ROOT_URLCONF = "config.urls"

FRONTEND_DIR = BASE_DIR / "static" / "frontend"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [FRONTEND_DIR] if FRONTEND_DIR.exists() else [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

import dj_database_url

DATABASE_URL = os.getenv("DATABASE_URL")

# On serverless (Vercel) each invocation is short-lived and may land on a fresh
# backend, so persistent connections don't help and risk exhausting Postgres.
# A long-lived gunicorn keeps them warm instead.
#
# IMPORTANT (RLS): SetRLSUserMiddleware relies on set_config(..., is_local=FALSE),
# a *session*-scoped variable. That requires a session-mode connection. When using
# Supabase, connect through the **Session pooler** or the direct connection —
# never the Transaction pooler (:6543), which would break RLS silently.
DB_CONN_MAX_AGE = int(os.getenv("DB_CONN_MAX_AGE", "0" if IS_SERVERLESS else "600"))

if DATABASE_URL:
    DATABASES = {"default": dj_database_url.config(default=DATABASE_URL, conn_max_age=DB_CONN_MAX_AGE)}
    # Managed Postgres (Supabase) requires TLS outside local dev.
    if not DEBUG:
        DATABASES["default"].setdefault("OPTIONS", {}).setdefault(
            "sslmode", os.getenv("DB_SSLMODE", "require")
        )
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

if FRONTEND_DIR.exists():
    STATICFILES_DIRS = [FRONTEND_DIR]

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

REDIS_URL = os.getenv("REDIS_URL", "").strip()
CACHE_TTL = int(os.getenv("CACHE_TTL", "300"))

if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
            },
            "KEY_PREFIX": "poker-ledger",
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "poker-ledger-local",
        }
    }

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

HEADLESS_ONLY = True

ACCOUNT_EMAIL_VERIFICATION = "none"
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*"]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

# ── Production hardening ───────────────────────────────────────────────────────
# Applied only outside local dev. The SPA and API share one origin on Vercel, so
# SameSite=Lax cookies work without the third-party-cookie problems of a split
# deployment.
if not DEBUG:
    # Vercel terminates TLS and forwards the original scheme in this header.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SAMESITE = "Lax"
    CSRF_COOKIE_SAMESITE = "Lax"

if IS_SERVERLESS:
    # Trust CSRF/Origin checks from Vercel's dynamic deployment hosts. Set
    # FRONTEND_URL (and CORS_ALLOWED_ORIGINS) to your canonical URL as well.
    CSRF_TRUSTED_ORIGINS = list(dict.fromkeys([*CSRF_TRUSTED_ORIGINS, "https://*.vercel.app"]))
