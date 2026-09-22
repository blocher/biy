from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("study", "0012_profile_notification_setup_completed_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="note",
            name="citation",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="note",
            name="quote",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="note",
            name="source_url",
            field=models.CharField(blank=True, max_length=1000),
        ),
    ]
