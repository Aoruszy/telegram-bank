# Bank Telegram System

## VK production checklist

### 1. Backend environment

Set these variables in the cloud backend service:

```env
POSTGRES_DB=bank_db
POSTGRES_USER=bank_user
POSTGRES_PASSWORD=bank_password
POSTGRES_HOST=<your-db-host>
POSTGRES_PORT=<your-db-port>

APP_JWT_SECRET=<long-random-secret>
VK_APP_SECRET=<secret-key-from-vk-mini-app-settings>
VK_GROUP_ACCESS_TOKEN=<group-token>
VK_GROUP_ID=<numeric-group-id>
VK_CALLBACK_CONFIRMATION=<confirmation-string-from-vk-callback-settings>
VK_API_VERSION=5.199
VK_SKIP_LAUNCH_VERIFY=0
```

`VK_APP_SECRET` must exactly match the mini app secret from the VK cabinet, otherwise `/auth/vk` returns `403`.

### 2. Mini app build

Create `miniapp/.env.production` from `miniapp/.env.example` and set the real API URL:

```env
VITE_API_BASE=https://api.example.com
VITE_VK_APP_ID=<your-vk-app-id>
```

Then build:

```powershell
cd miniapp
npm.cmd run build
```

Upload the contents of `miniapp/dist` to the public HTTPS URL configured in VK Mini Apps.

The Vite config now uses relative asset paths, so the app can be hosted both on a domain root and inside a subfolder.

### 3. VK cabinet settings

For the community bot:

- Callback URL: `https://<your-backend-domain>/vk/callback`
- Confirmation code: must match `VK_CALLBACK_CONFIRMATION`
- Group token: must match `VK_GROUP_ACCESS_TOKEN`

For the mini app:

- App URL: the public HTTPS URL where `miniapp/dist/index.html` is available
- Secret key in VK: must match backend `VK_APP_SECRET`

### 4. Quick verification

Check these URLs after deploy:

- `https://<your-backend-domain>/health` should return `{"status":"ok"}`
- `https://<your-miniapp-domain-or-path>/` should open without `404` on JS/CSS assets

If the mini app opens in VK but login fails, the most likely cause is a wrong `VK_APP_SECRET`.
If the bot is not confirmed in VK, the most likely cause is a wrong callback URL or confirmation string.
