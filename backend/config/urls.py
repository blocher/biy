from django.urls import path
from study.api import api

urlpatterns = [path("api/", api.urls)]
