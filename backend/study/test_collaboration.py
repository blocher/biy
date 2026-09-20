import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Day, DayProgress, Era, Note, Profile
from .notifications import notify_shared_note


@override_settings(SECURE_SSL_REDIRECT=False)
class CollaborationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("reader", email="reader@example.org")
        self.other = get_user_model().objects.create_user("friend", email="friend@example.org")
        self.day = Day.objects.create(
            number=1, era=Era.objects.create(name="Beginning", color="#ffffff", order=1)
        )
        self.client.force_login(self.user)

    def write(self, path, data, method="post"):
        return getattr(self.client, method)(
            "/api" + path, json.dumps(data), content_type="application/json"
        )

    def test_preferences_persist_independently(self):
        self.assertEqual(
            self.client.get("/api/preferences").json()["progress_basis"], "first-completion"
        )
        self.write(
            "/preferences", {"progress_basis": "leaderboard", "email_notifications": False}, "patch"
        )
        self.write("/preferences", {"leaderboard_visible": False}, "patch")
        saved = self.client.get("/api/preferences").json()
        self.assertEqual(saved["progress_basis"], "leaderboard")
        self.assertFalse(saved["email_notifications"])
        self.assertFalse(saved["leaderboard_visible"])
        self.assertEqual(
            self.write("/preferences", {"progress_basis": "wrong"}, "patch").status_code, 422
        )

    def test_shared_start_date_requires_acknowledgement_and_affects_other_users(self):
        self.assertEqual(
            self.write("/community-settings", {"start_date": "2026-01-02"}, "put").status_code, 422
        )
        self.assertEqual(
            self.write(
                "/community-settings",
                {"start_date": "2026-01-02", "confirm_affects_everyone": True},
                "put",
            ).status_code,
            200,
        )
        self.client.force_login(self.other)
        self.assertEqual(
            self.client.get("/api/preferences").json()["leaderboard_start_date"], "2026-01-02"
        )

    def test_leaderboard_excludes_opt_out_and_inactive(self):
        DayProgress.objects.create(user=self.other, day=self.day, completed_at=timezone.now())
        rows = self.client.get("/api/leaderboard").json()
        self.assertEqual(rows[0]["id"], self.other.pk)
        self.assertEqual(rows[0]["current_day"], 2)
        self.assertEqual(rows[0]["completed"], 1)
        self.assertNotIn("email", rows[0])
        Profile.objects.create(user=self.other, leaderboard_visible=False)
        self.assertEqual(len(self.client.get("/api/leaderboard").json()), 1)
        self.other.is_active = False
        self.other.save()
        Profile.objects.filter(user=self.other).delete()
        self.assertEqual(len(self.client.get("/api/leaderboard").json()), 1)

    def test_private_notes_and_mutations_remain_owner_only(self):
        private = Note.objects.create(user=self.other, day=self.day, body="secret", kind="journal")
        shared = Note.objects.create(
            user=self.other, day=self.day, body="hello", kind="journal", shared=True
        )
        self.assertEqual(self.client.get("/api/notes").json(), [])
        rows = self.client.get("/api/shared-notes?day=1").json()
        self.assertEqual([row["id"] for row in rows], [shared.pk])
        self.assertEqual(rows[0]["author"]["id"], self.other.pk)
        self.assertEqual(self.client.get(f"/api/shared-notes?person={self.user.pk}").json(), [])
        self.assertEqual(
            self.write(f"/notes/{shared.pk}", {"body": "overwrite"}, "put").status_code, 404
        )
        self.assertEqual(self.client.delete(f"/api/notes/{private.pk}").status_code, 404)
        shared.shared = False
        shared.save()
        self.assertEqual(self.client.get("/api/shared-notes").json(), [])

    @patch("study.notifications.notify_shared_note")
    def test_first_share_notifies_once_after_commit(self, notify):
        with self.captureOnCommitCallbacks(execute=True):
            result = self.write("/days/1/notes", {"body": "private"}).json()
        notify.assert_not_called()
        with self.captureOnCommitCallbacks(execute=True):
            self.write(f"/notes/{result['id']}", {"body": "shared", "shared": True}, "put")
        notify.assert_called_once_with(result["id"])
        for shared in (True, False, True):
            with self.captureOnCommitCallbacks(execute=True):
                self.write(f"/notes/{result['id']}", {"body": "edited", "shared": shared}, "put")
        notify.assert_called_once()

    @override_settings(EMAIL_HOST="", EMAIL_HOST_USER="", EMAIL_HOST_PASSWORD="")
    @patch("study.notifications.EmailMultiAlternatives")
    def test_missing_credentials_skip_email(self, message):
        note = Note.objects.create(user=self.user, day=self.day, body="hi", shared=True)
        notify_shared_note(note.pk)
        message.assert_not_called()

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.example.org",
        EMAIL_HOST_USER="key",
        EMAIL_HOST_PASSWORD="secret",
        DEFAULT_FROM_EMAIL="study@example.org",
        EMAIL_DELIVERY_MODE="production",
    )
    def test_email_opt_out_and_no_recipient_leaks(self):
        note = Note.objects.create(user=self.user, day=self.day, body="hi", shared=True)
        Profile.objects.create(user=self.other, email_notifications=False)
        notify_shared_note(note.pk)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        Profile.objects.filter(user=self.other).update(email_notifications=True)
        mail.outbox.clear()
        notify_shared_note(note.pk)
        self.assertEqual(len(mail.outbox), 2)
        self.assertTrue(all(len(message.to) == 1 for message in mail.outbox))

    def test_anonymous_cannot_access_community(self):
        self.client.logout()
        for endpoint in ("leaderboard", "shared-notes", "preferences"):
            self.assertEqual(self.client.get("/api/" + endpoint).status_code, 401)

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.example.org",
        EMAIL_HOST_USER="key",
        EMAIL_HOST_PASSWORD="secret",
        DEFAULT_FROM_EMAIL="study@example.org",
        EMAIL_DELIVERY_MODE="redirect",
        EMAIL_REDIRECT_TO="test@example.org",
    )
    def test_development_redirect_and_unshared_entries(self):
        note = Note.objects.create(user=self.user, day=self.day, body="hi", shared=True)
        notify_shared_note(note.pk)
        self.assertEqual(
            [message.to for message in mail.outbox], [["test@example.org"], ["test@example.org"]]
        )
        note.shared = False
        note.save()
        mail.outbox.clear()
        notify_shared_note(note.pk)
        self.assertEqual(mail.outbox, [])

    @override_settings(
        EMAIL_HOST="smtp.example.org",
        EMAIL_HOST_USER="key",
        EMAIL_HOST_PASSWORD="secret",
        DEFAULT_FROM_EMAIL="study@example.org",
        EMAIL_DELIVERY_MODE="production",
    )
    @patch(
        "study.notifications.EmailMultiAlternatives.send", side_effect=RuntimeError("unavailable")
    )
    def test_email_failure_does_not_fail_saved_note(self, send):
        with self.assertLogs("study.notifications", level="ERROR"):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.write("/days/1/notes", {"body": "reflection", "shared": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Note.objects.filter(pk=response.json()["id"], shared=True).exists())
        self.assertEqual(send.call_count, 2)
