from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.operations import AddIndexConcurrently, TrigramExtension
from django.contrib.postgres.search import SearchVector
from django.db import migrations


class Migration(migrations.Migration):
    atomic = False

    dependencies = [("study", "0014_searchchunk_weighted_text_index")]

    operations = [
        TrigramExtension(),
        AddIndexConcurrently(
            model_name="commentary",
            index=GinIndex(
                SearchVector("source_title", weight="A", config="english")
                + SearchVector("text", weight="B", config="english"),
                name="study_commentary_fts_gin",
            ),
        ),
        AddIndexConcurrently(
            model_name="searchchunk",
            index=GinIndex(
                fields=["title"], opclasses=["gin_trgm_ops"], name="study_chunk_title_trgm"
            ),
        ),
        AddIndexConcurrently(
            model_name="searchchunk",
            index=GinIndex(
                fields=["text"], opclasses=["gin_trgm_ops"], name="study_chunk_text_trgm"
            ),
        ),
    ]
