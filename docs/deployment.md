# Deployment: biy.benlocher.com

Prepared for the Carnival host (`dailyoffice`, `104.237.147.195`) with a dedicated Unix account, PostgreSQL database, Gunicorn service, bare Git repository, and Nginx site. Nothing has been installed or deployed remotely by this project yet.

Read-only preflight on 2026-09-19 found Python 3.13, PostgreSQL, Node 22, ffmpeg and Nginx already installed; port 8017 was free. Recheck the port before provisioning. DNS currently returns `45.55.155.69`, which is not the Carnival host. Point the `biy.benlocher.com` A record to `104.237.147.195` (and remove/correct any conflicting AAAA record) before issuing its certificate.

## Isolated resources

- Service/user/database: `biy` (no changes to Carnival or other apps).
- Git remote: `root@dailyoffice:/var/repo/biy.git`, main branch only.
- Checkout: `/var/www/biy-app`; frontend: `/var/www/biy.benlocher.com/dist`.
- Protected configuration: `/etc/biy/biy.env`, root:biy 0640.
- Media: `/var/lib/biy/media`; source Bible: `/var/lib/biy/bible-source`.
- API: `127.0.0.1:8017`; same-origin `/api/` behind Nginx.
- Database URL: `postgresql:///biy?host=/var/run/postgresql` uses local peer authentication as the `biy` user. No shared database password is needed.

## Provision after production authorization

1. Check DNS and `ss -ltn` for 8017. Create `biy` with a home directory and disabled password. Create a PostgreSQL role `biy` with LOGIN and a database `biy` owned by it, using the postgres account. Do not reuse another application's role/database.
2. Create `/var/repo/biy.git` as a bare repository. Create the checkout, web directory, and `/var/lib/biy`; create `/etc/biy` mode 0750 root:biy. Install `deploy/biy.env.example` as `/etc/biy/biy.env` mode 0640; replace `DJANGO_SECRET_KEY` with `secrets.token_urlsafe(64)` privately. Configure the OpenAI key there only if importing on the server.
3. Give `biy` ownership of the checkout and data directory. Nginx needs read/traverse access to media for `X-Accel-Redirect`: use a dedicated `biy-media` group shared by `biy` and `www-data`, set the media directory to group `biy-media` and mode 2750, and ensure imported audio files are group-readable (0640). Keep Bible source and AI checkpoint files private to `biy`. Reload Nginx after changing group membership.
4. Install `deploy/biy.service` as `/etc/systemd/system/biy.service`, run `systemctl daemon-reload`, and install executable `deploy/post-receive` as the bare repo's hook. The hook builds and migrates BIY only. It **never imports podcasts**.
5. Add the production Git remote and explicitly push `main`. This is a live deployment. If build/migration fails, the BIY service remains stopped for inspection. Existing deployed frontend is retained as `dist.previous`.
6. With DNS correct, issue a Let's Encrypt certificate using the existing `/var/www/html` webroot. Install `deploy/nginx.conf` as a separate site, run `nginx -t`, then reload Nginx. Enable the `biy` service.
7. Run `/var/www/biy-app/deploy/manage changepassword ben` in a private terminal. The seeded production account has no usable password until this step and is granted administrator access idempotently. Additional accounts can be managed in the app or created with `deploy/manage create_account NAME`; add `--admin` only for people who should manage other accounts.

## Transfer the single-day acceptance data

The one-day local dataset can be exported with `dumpdata study.era study.day study.episode study.verse --indent 2` to an ignored file under `data/` and loaded with `deploy/manage loaddata`. This exports no accounts, passwords, journal entries, or per-user progress. Transfer only `media/episodes/<id>/audio.mp3` and adjust its group/mode as above. Do not overwrite an existing production dataset or progress blindly. Alternatively import Day 1 directly on the server, using the CLI commands in README.md. Do not run `--all` for this acceptance deployment.

## Verify and back up

Verify HTTPS certificate and redirects, anonymous `/api/library` and audio return 401, login succeeds with CSRF, byte-range audio seeking returns 206, and two accounts cannot read each other's notes. Check `systemctl is-active biy nginx`, service logs and the deployed revision. Test a completion, refresh it, and undo the test.

Back up PostgreSQL with `pg_dump --format=custom biy` as `biy`, plus protected media and `/etc/biy/biy.env`. Keep backups private. Restore to a separate database first and check accounts, notes, timestamps and audio. Never run the full importer as part of deploy or rollback.
