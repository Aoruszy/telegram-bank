# Secrets and `.env`

Do not commit real secrets to git.

## Safe workflow

1. Keep real values only in local `.env` files and in the server environment.
2. Commit only `*.example` files with placeholders.
3. If `.env` was already committed, remove it from git tracking without deleting your local file:

```bash
git rm --cached .env
```

4. Commit the removal and rotate any leaked secrets:

```bash
git add .gitignore .env.example docs/SECRETS.md
git commit -m "Stop tracking env secrets"
```

## Recommended files

- Root backend config: `.env`
- Root example: `.env.example`
- Admin production example: `admin-panel/.env.production.example`
- Mini app local/prod values: keep local only, do not commit real values
