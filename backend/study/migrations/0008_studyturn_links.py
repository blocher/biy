from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("study", "0007_commentaryauthor_commentary"),
    ]

    operations = [
        migrations.AddField(
            model_name="studyturn",
            name="links",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
