import json
from datetime import date, datetime, time, timedelta
from datetime import timezone as datetime_timezone
from importlib import import_module
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Day, DayProgress, Era, Note, Profile, PushDelivery, PushSubscription
from .push_notifications import (
    _reminder_payload,
    deliver_push_batch,
    enqueue_due_reminders,
    enqueue_shared_note,
    reading_progress,
)


@override_settings(SECURE_SSL_REDIRECT=False)
class PushNotificationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("reader")
        self.friend = get_user_model().objects.create_user("friend")
        era = Era.objects.create(name="Beginning", color="#ffffff", order=1)
        self.day1 = Day.objects.create(number=1, era=era)
        self.day2 = Day.objects.create(number=2, era=era)
        self.profile = Profile.objects.create(
            user=self.user,
            catechism_enabled=False,
            notification_timezone="America/New_York",
            reminder_condition="incomplete",
            morning_reminder_enabled=True,
            morning_reminder_time=time(7),
        )
        self.subscription = PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example/reader",
            p256dh="key",
            auth="secret",
            device_name="Reader’s iPhone",
        )
        self.now = datetime(2026, 9, 21, 11, 5, tzinfo=datetime_timezone.utc)

    def test_incomplete_respects_personal_schedule_and_is_idempotent(self):
        DayProgress.objects.create(
            user=self.user,
            day=self.day1,
            completed_at=datetime(2026, 9, 20, 14, tzinfo=datetime_timezone.utc),
        )
        self.assertEqual(enqueue_due_reminders(self.now), 1)
        delivery = PushDelivery.objects.get()
        self.assertEqual(delivery.payload["url"], "/day/2?edition=bible")
        self.assertEqual(enqueue_due_reminders(self.now), 0)

    def test_progress_signals_match_schedule_completion_and_inactivity(self):
        for number in range(3, 6):
            Day.objects.create(number=number, era=self.day1.era)
        DayProgress.objects.create(
            user=self.user,
            day=self.day1,
            completed_at=datetime(2026, 9, 17, 14, tzinfo=datetime_timezone.utc),
        )

        state = reading_progress(self.profile, date(2026, 9, 21))[0]

        self.assertEqual(state["expected_day"], 5)
        self.assertEqual(state["completed"], 1)
        self.assertEqual(state["days_behind"], 4)
        self.assertEqual(state["days_inactive"], 4)
        self.assertEqual(state["next_day"], 2)

    def test_reminder_copy_rotates_through_relevant_progress_messages(self):
        progress = [
            {
                "edition": "bible",
                "label": "Bible in a Year",
                "expected_day": 260,
                "today_complete": False,
                "completed": 256,
                "percent": 70,
                "days_behind": 4,
                "days_inactive": 5,
                "next_day": 257,
            }
        ]

        bodies = {
            _reminder_payload(
                self.profile, "morning", progress, date(2026, 9, 21) + timedelta(days=offset)
            )["body"]
            for offset in range(4)
        }

        self.assertEqual(len(bodies), 4)
        self.assertTrue(any("4 days behind" in body and "catch up now" in body for body in bodies))
        self.assertTrue(any("haven’t read in 5 days" in body for body in bodies))
        self.assertIn("You’re 70% complete—keep going.", bodies)
        self.assertTrue(any("Day 260" in body for body in bodies))

    def test_incomplete_suppresses_completed_today_but_always_sends(self):
        DayProgress.objects.create(
            user=self.user,
            day=self.day1,
            completed_at=datetime(2026, 9, 20, 14, tzinfo=datetime_timezone.utc),
        )
        DayProgress.objects.create(user=self.user, day=self.day2, completed_at=self.now)
        self.assertEqual(enqueue_due_reminders(self.now), 0)
        self.profile.reminder_condition = "always"
        self.profile.save(update_fields=["reminder_condition"])
        self.assertEqual(enqueue_due_reminders(self.now), 1)

    def test_never_and_outside_grace_window_do_not_enqueue(self):
        self.profile.reminder_condition = "never"
        self.profile.save(update_fields=["reminder_condition"])
        self.assertEqual(enqueue_due_reminders(self.now), 0)
        self.profile.reminder_condition = "always"
        self.profile.save(update_fields=["reminder_condition"])
        late = datetime(2026, 9, 21, 12, 0, tzinfo=datetime_timezone.utc)
        self.assertEqual(enqueue_due_reminders(late), 0)

    def test_shared_note_targets_opted_in_other_devices_only(self):
        Profile.objects.create(user=self.friend, shared_push_notifications=True)
        friend_device = PushSubscription.objects.create(
            user=self.friend,
            endpoint="https://push.example/friend",
            p256dh="key",
            auth="secret",
        )
        note = Note.objects.create(
            user=self.user, day=self.day1, body="Private words are not copied", kind="journal", shared=True
        )
        self.assertEqual(enqueue_shared_note(note.pk), 1)
        delivery = PushDelivery.objects.get(subscription=friend_device)
        self.assertNotIn(note.body, delivery.payload["body"])
        self.assertFalse(PushDelivery.objects.filter(subscription=self.subscription).exists())

    @override_settings(
        WEB_PUSH_VAPID_SUBJECT="mailto:test@example.org",
        WEB_PUSH_VAPID_PUBLIC_KEY="public",
        WEB_PUSH_VAPID_PRIVATE_KEY="private.pem",
    )
    @patch("study.push_notifications.webpush")
    def test_delivery_marks_success(self, send):
        PushDelivery.objects.create(
            subscription=self.subscription,
            kind="reminder",
            dedupe_key="one",
            payload={"title": "Reminder", "body": "Read", "url": "/"},
        )
        self.assertEqual(deliver_push_batch(now=timezone.now()), 1)
        delivery = PushDelivery.objects.get()
        self.assertIsNotNone(delivery.sent_at)
        send.assert_called_once()

    def test_preferences_and_multi_device_management(self):
        self.client.force_login(self.user)
        response = self.client.patch(
            "/api/preferences",
            json.dumps(
                {
                    "reminder_condition": "always",
                    "morning_reminder_enabled": True,
                    "morning_reminder_time": "06:30",
                    "notification_timezone": "America/Chicago",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["morning_reminder_time"], "06:30")
        added = self.client.post(
            "/api/push/subscriptions",
            json.dumps(
                {
                    "endpoint": "https://push.example/laptop",
                    "p256dh": "key2",
                    "auth": "secret2",
                    "device_name": "Safari on Mac",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(added.status_code, 200)
        devices = self.client.get("/api/push/subscriptions").json()
        self.assertEqual({device["device_name"] for device in devices}, {"Reader’s iPhone", "Safari on Mac"})
        self.assertEqual(
            self.client.delete(f"/api/push/subscriptions/{added.json()['id']}").status_code,
            200,
        )
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 1)

    def test_invalid_timezone_is_rejected(self):
        self.client.force_login(self.user)
        response = self.client.patch(
            "/api/preferences",
            json.dumps({"notification_timezone": "Not/A_Zone"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)


class NotificationDefaultMigrationTests(TestCase):
    def test_only_untouched_profiles_receive_new_defaults(self):
        users = [
            get_user_model().objects.create_user(name)
            for name in ("untouched", "customized", "subscribed")
        ]
        old_defaults = {
            "morning_reminder_enabled": False,
            "morning_reminder_time": time(7),
            "evening_reminder_enabled": False,
            "evening_reminder_time": time(20),
            "shared_push_notifications": False,
            "reminder_condition": "never",
        }
        untouched = Profile.objects.create(user=users[0], **old_defaults)
        customized = Profile.objects.create(
            user=users[1], **{**old_defaults, "morning_reminder_time": time(9)}
        )
        subscribed = Profile.objects.create(user=users[2], **old_defaults)
        PushSubscription.objects.create(
            user=users[2], endpoint="https://push.example/existing", p256dh="key", auth="secret"
        )

        class CurrentApps:
            @staticmethod
            def get_model(app_label, model_name):
                self.assertEqual((app_label, model_name), ("study", "Profile"))
                return Profile

        migration = import_module(
            "study.migrations.0012_profile_notification_setup_completed_and_more"
        )
        migration.apply_notification_defaults(CurrentApps(), None)

        untouched.refresh_from_db()
        customized.refresh_from_db()
        subscribed.refresh_from_db()
        self.assertTrue(untouched.morning_reminder_enabled)
        self.assertEqual(untouched.morning_reminder_time, time(8))
        self.assertTrue(untouched.evening_reminder_enabled)
        self.assertTrue(untouched.shared_push_notifications)
        self.assertEqual(untouched.reminder_condition, "incomplete")
        self.assertFalse(untouched.notification_setup_completed)
        self.assertEqual(customized.morning_reminder_time, time(9))
        self.assertTrue(customized.notification_setup_completed)
        self.assertFalse(subscribed.morning_reminder_enabled)
        self.assertTrue(subscribed.notification_setup_completed)
