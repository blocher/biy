import django.contrib.postgres.indexes
import django.contrib.postgres.search
from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("study", "0013_note_citation_quote_source_url"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="searchchunk",
            index=django.contrib.postgres.indexes.GinIndex(
                django.contrib.postgres.search.CombinedSearchVector(
                    django.contrib.postgres.search.SearchVector(
                        "title", config="english", weight="A"
                    ),
                    "||",
                    django.contrib.postgres.search.SearchVector(
                        "text", config="english", weight="B"
                    ),
                    django.contrib.postgres.search.SearchConfig("english"),
                ),
                name="study_chunk_fts_gin",
            ),
        ),
    ]
