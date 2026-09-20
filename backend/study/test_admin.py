import json
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from .models import Day, DayProgress, Era, Note, Profile


class AdminAccountTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            "ben", password="test-long-password", is_staff=True
        )
        self.member = User.objects.create_user("reader", password="reader-long-password")
        self.client.force_login(self.admin)

    def write(self, path, data, method="put"):
        return getattr(self.client, method)(
            "/api" + path, json.dumps(data), content_type="application/json"
        )

    def profile_payload(self, **overrides):
        payload = {
            "username": "reader",
            "first_name": "Ada",
            "last_name": "Lovelace",
            "email": "ada@example.org",
            "is_active": True,
            "is_admin": False,
            "leaderboard_visible": False,
            "email_notifications": False,
            "progress_basis": "january-1",
        }
        payload.update(overrides)
        return payload

    def test_only_staff_can_list_and_edit_users(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.get("/api/admin/users").status_code, 403)
        self.assertEqual(
            self.write(f"/admin/users/{self.admin.pk}", self.profile_payload()).status_code,
            403,
        )

    def test_session_exposes_admin_status_for_navigation(self):
        self.assertEqual(
            self.client.get("/api/session").json()["user"],
            {"username": "ben", "is_admin": True},
        )
        self.client.force_login(self.member)
        self.assertFalse(self.client.get("/api/session").json()["user"]["is_admin"])

    def test_admin_can_create_a_user_with_a_complete_profile(self):
        response = self.write(
            "/admin/users",
            {
                **self.profile_payload(username="new-reader", is_admin=True),
                "password": "a-new-reader-password",
            },
            "post",
        )
        self.assertEqual(response.status_code, 200, response.content)
        created = get_user_model().objects.get(username="new-reader")
        self.assertTrue(created.check_password("a-new-reader-password"))
        self.assertTrue(created.is_staff)
        self.assertEqual(created.get_full_name(), "Ada Lovelace")
        profile = Profile.objects.get(user=created)
        self.assertFalse(profile.leaderboard_visible)
        self.assertFalse(profile.email_notifications)
        self.assertEqual(profile.progress_basis, "january-1")

    def test_admin_can_edit_profile_status_and_password(self):
        response = self.write(
            f"/admin/users/{self.member.pk}",
            self.profile_payload(password="changed-reader-password", is_admin=True),
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.member.refresh_from_db()
        self.assertEqual(self.member.email, "ada@example.org")
        self.assertTrue(self.member.is_staff)
        self.assertTrue(self.member.check_password("changed-reader-password"))
        self.assertEqual(response.json()["progress_basis"], "january-1")

    def test_user_summary_includes_activity_without_private_content(self):
        era = Era.objects.create(name="Beginning", color="#ffffff", order=1)
        day = Day.objects.create(number=1, era=era)
        DayProgress.objects.create(user=self.member, day=day, completed_at="2026-01-01T00:00Z")
        Note.objects.create(user=self.member, day=day, kind="journal", body="private")

        row = next(
            item
            for item in self.client.get("/api/admin/users").json()
            if item["id"] == self.member.pk
        )

        self.assertEqual(row["completed_days"], 1)
        self.assertEqual(row["journal_entries"], 1)
        self.assertNotIn("notes", row)
        self.assertNotIn("password", row)

    def test_last_active_admin_cannot_be_removed(self):
        response = self.write(
            f"/admin/users/{self.admin.pk}",
            self.profile_payload(username="ben", is_admin=False),
        )
        self.assertEqual(response.status_code, 422)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_staff)

    def test_admin_passwords_use_django_validation(self):
        response = self.write(
            "/admin/users",
            {**self.profile_payload(username="weak-password"), "password": "password"},
            "post",
        )
        self.assertEqual(response.status_code, 422)
        self.assertFalse(get_user_model().objects.filter(username="weak-password").exists())


class CreateAccountCommandTests(TestCase):
    def test_seeded_ben_is_an_admin_and_existing_ben_is_upgraded(self):
        output = StringIO()
        call_command("create_account", "ben", seed=True, stdout=output)
        ben = get_user_model().objects.get(username="ben")
        self.assertTrue(ben.is_staff)
        self.assertFalse(ben.has_usable_password())

        ben.is_staff = False
        ben.save(update_fields=["is_staff"])
        call_command("create_account", "ben", seed=True, stdout=output)
        ben.refresh_from_db()
        self.assertTrue(ben.is_staff)
