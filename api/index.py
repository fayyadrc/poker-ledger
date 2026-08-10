"""Vercel Python serverless entrypoint for the Django backend.

Vercel's @vercel/python runtime serves the module-level `app` as a WSGI app.
All /api/*, /_allauth/*, /admin/* and /static/* requests are rewritten to this
function by vercel.json; everything else is served as the static SPA.
"""
import os
import sys
from pathlib import Path

# The Django project lives under backend/ — put it on the import path so
# `config.settings` / `config.wsgi` resolve.
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from config.wsgi import application as app  # noqa: E402

# Some Vercel Python versions look for `handler` instead of `app`.
handler = app
