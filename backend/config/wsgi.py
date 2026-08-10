"""
WSGI config for config project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/wsgi/
"""

import os
import sys
from pathlib import Path

# Ensure the Django project package ("config", "ledger", …) is importable no
# matter how this module is loaded. On Vercel the runtime imports this file
# directly as the function entrypoint, so backend/ is not implicitly on sys.path
# and "config.settings" would fail with ModuleNotFoundError: No module named 'config'.
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_wsgi_application()
