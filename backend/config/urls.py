from django.contrib import admin
from django.urls import path, include, re_path

from config.views import FrontendAssetView, FrontendFileView, HealthView, SPAView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", HealthView.as_view()),
    path("api/", include("ledger.urls")),
    re_path(r"^assets/(?P<path>.*)$", FrontendAssetView.as_view()),
    re_path(
        r"^(?P<path>(manifest\.webmanifest|sw\.js|registerSW\.js|workbox-[\w.-]+\.js|pwa-[\w.-]+\.(png|svg)|apple-touch-icon\.png|favicon\.svg|icons\.svg))$",
        FrontendFileView.as_view(),
    ),
    re_path(r"^(?!api/|admin/|static/).*$", SPAView.as_view()),
]
