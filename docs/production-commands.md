# Production commands

Run these commands on the production host (`dailyoffice`). Production commands use the deployment wrapper so `/etc/biy/biy.env` is loaded and Django runs as the `biy` service user.

## Initial setup

```sh
sudo /var/www/biy-app/deploy/manage seed_plan
sudo /var/www/biy-app/deploy/manage seed_catechism_plan
sudo /var/www/biy-app/deploy/manage create_account ben --seed
sudo /var/www/biy-app/deploy/manage changepassword ben
```

The production Bible is already loaded. If the Bible source files are present under `BIBLE_SOURCE_DIR`, the import is resumable:

```sh
sudo /var/www/biy-app/deploy/manage import_bible
```

The official English Catechism text is imported separately from Vatican pages:

```sh
sudo /var/www/biy-app/deploy/manage import_catechism
```

After source, note, or episode changes, reconcile search indexing. The running worker embeds pending chunks asynchronously:

```sh
sudo /var/www/biy-app/deploy/manage index_study
sudo systemctl status biy-worker --no-pager
```

## Prime every podcast episode without AI

```sh
sudo /var/www/biy-app/deploy/manage import_podcasts --all --download-only --workers 2
```

Always include `--edition catechism` for the Catechism feed. The current acceptance scope is deliberately one day and manual; cataloging invokes neither audio download nor AI:

```sh
sudo /var/www/biy-app/deploy/manage import_podcasts \
  --edition catechism --day 1 --catalog-only
```

To fetch that one episode's audio without transcription or AI:

```sh
sudo /var/www/biy-app/deploy/manage import_podcasts \
  --edition catechism --day 1 --download-only
```

Do not run the Catechism command without `--catalog-only` or `--download-only` while the no-transcription acceptance boundary is in effect.

## Run transcription and study-content AI for every episode

Run after the download-only pass. Completed episodes and checkpoints are skipped when rerun:

```sh
sudo /var/www/biy-app/deploy/manage import_podcasts --all --workers 2
```

This requires `OPENAI_API_KEY` in `/etc/biy/biy.env`. Episode study-content generation uses `OPENAI_STUDY_MODEL`.

To regenerate only the summary, key points, outline, and edited commentary for an
already-transcribed episode, add `--force-study`. Existing audio and transcription
are reused. Structured AI generation is attempted up to three times with exponential
backoff before the episode is marked failed:

```sh
sudo /var/www/biy-app/deploy/manage import_podcasts --day 1 --force-study
```

## Prime only the introduction and Day 1

The first introductory episode has GUID `86f0557d-9354-4893-ba9f-2e76afb7ff12`.

Download audio and catalog both episodes without AI:

```sh
sudo /var/www/biy-app/deploy/manage import_podcasts \
  --guid 86f0557d-9354-4893-ba9f-2e76afb7ff12 \
  --download-only

sudo /var/www/biy-app/deploy/manage import_podcasts \
  --day 1 \
  --download-only
```

Then run AI separately:

```sh
sudo /var/www/biy-app/deploy/manage import_podcasts \
  --guid 86f0557d-9354-4893-ba9f-2e76afb7ff12

sudo /var/www/biy-app/deploy/manage import_podcasts \
  --day 1
```

## Check services and indexing

```sh
sudo systemctl is-active biy biy-worker nginx
sudo systemctl is-enabled biy biy-worker nginx
sudo journalctl -u biy-worker -n 100 --no-pager
```

Do not run `manage.py` directly on production unless you manually load `/etc/biy/biy.env`; otherwise Django will fail with a missing `DJANGO_SECRET_KEY`.
