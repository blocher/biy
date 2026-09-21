from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("study", "0009_catechismday_catechismdayprogress_catechismparagraph_and_more")]

    operations = [
        migrations.AddField(
            model_name="episode",
            name="formatted_transcript",
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name="episode",
            name="formatted_commentary",
            field=models.JSONField(default=list),
        ),
    ]
