import json
from datetime import datetime, time
from datetime import timezone as datetime_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Day, DayProgress, Era, Note, Profile, PushDelivery, PushSubscription
from .push_notifications import deliver_push_batch, enqueue_due_reminders, enqueue_shared_note


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
        self.assertIn("Day 2", delivery.payload["body"])
        self.assertEqual(enqueue_due_reminders(self.now), 0)

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
