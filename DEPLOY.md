# Deploying the site

Two free services, both deploying straight from the GitHub repo:

- **Render** runs the API (FastAPI in Docker, built from `api/Dockerfile`).
- **Vercel** runs the website (Next.js in `web/`).

Order matters. Deploy the API first (the site needs its URL), then the site, then tell the API the site's URL so the browser is allowed to call it.

Before starting, the code has to be on GitHub (see "Step 0" at the bottom if it isn't yet).

---

## a. API on Render

1. Go to https://render.com and sign up with **GitHub** (easiest, it links your repos).
2. In the Render dashboard click **+ New** (top right), then **Web Service**.
3. Under "Source Code", pick **Git Provider**. If `nba-points` isn't listed, click **Configure GitHub** (or "Connect account"), give Render access to the `nba-points` repo, and come back. Click **Connect** next to `nba-points`.
4. Fill in the form:
   - **Name:** `nba-points-api` (this becomes the URL: `https://nba-points-api.onrender.com`, or with a few random letters added if the name is taken)
   - **Language:** `Docker`
   - **Branch:** `main`
   - **Region:** whatever is closest (Oregon is fine for California)
   - **Root Directory:** leave it **empty**. The Docker build needs the whole repo (`src/`, `models/`, `data/site/`, `api/`), not just `api/`.
   - **Instance Type:** **Free**
5. Open **Advanced** and set:
   - **Dockerfile Path:** `./api/Dockerfile`
   - **Docker Build Context Directory:** `.` (a single dot = the repo root)
   - **Health Check Path:** `/health`
   - **Auto-Deploy:** `On Commit` (so every `git push` redeploys)
   - **Environment Variables:** skip for now. You add `CORS_ORIGINS` in step c once the Vercel URL exists. Don't set `PORT`; Render sets it and the Dockerfile reads it.
6. Click **Deploy Web Service**. The first build takes about 3 to 6 minutes (it installs scikit-learn and friends). Watch the log. It's done when you see:
   ```
   loaded data/site + deploy model in 1.1s (stats through ...)
   Uvicorn running on http://0.0.0.0:10000
   ```
   and the status at the top turns green: **Live**.
7. Check it works. Copy the URL from the top of the page (like `https://nba-points-api.onrender.com`) and open:
   - `https://YOUR-API.onrender.com/health` should show `{"status":"ok", ...}`
   - `https://YOUR-API.onrender.com/docs` should show the interactive docs. Click **GET /players**, **Try it out**, **Execute**, and you should get a list of players.

**Save that URL.** You need it for Vercel.

Free tier facts: 512 MB memory (the API uses about 220 MB), and it **goes to sleep after 15 minutes with no traffic**. The first request after that takes about a minute while it wakes up. The site shows a "Waking up the model..." message during that.

---

## b. Website on Vercel

1. Go to https://vercel.com and sign up with **GitHub**.
2. Click **Add New...** then **Project**.
3. Find `nba-points` in the list and click **Import**. (If it isn't there, click **Adjust GitHub App Permissions** and give Vercel access to the repo.)
4. On the "Configure Project" screen:
   - **Project Name:** `nba-points` (gives `https://nba-points.vercel.app` if it's free; otherwise Vercel adds something to it)
   - **Framework Preset:** `Next.js` (it should detect this itself once the root directory is set)
   - **Root Directory:** click **Edit**, pick the **`web`** folder, click **Continue**. This one is important; the repo root isn't a Next.js app.
   - **Build and Output Settings:** leave the defaults.
   - **Environment Variables:** add one:
     - Key `NEXT_PUBLIC_API_URL`, value = your Render URL, for example `https://nba-points-api.onrender.com` (no slash at the end)
5. Click **Deploy**. It takes about 1 to 2 minutes. When it says "Congratulations", click the preview to open the site.
6. Copy the site's URL from the project page under **Domains** (like `https://nba-points.vercel.app`).

At this point the site loads, but the data cards will show an error. That's expected: the API doesn't trust the Vercel URL yet. Step c fixes it.

---

## c. Let the API talk to the site (CORS)

Browsers only let a page call an API that lists the page's address. Tell Render the Vercel URL:

1. Render dashboard, open `nba-points-api`, click **Environment** in the left menu.
2. Click **+ Add Environment Variable**:
   - Key `CORS_ORIGINS`
   - Value = the Vercel URL, for example `https://nba-points.vercel.app`
   - More than one address (say a custom domain later): separate with commas, no spaces needed: `https://nba-points.vercel.app,https://nba.yoursite.com`
3. Click **Save, rebuild, and deploy** (or **Save Changes**, then **Manual Deploy** then **Deploy latest commit**). Wait until it says **Live** again.

Also give the site its own address (used for the link preview image when you share it):

4. Vercel, open the project, **Settings**, **Environment Variables**, add:
   - Key `NEXT_PUBLIC_SITE_URL`, value = the Vercel URL, for example `https://nba-points.vercel.app`
5. Go to the **Deployments** tab, click the **...** on the top deployment, **Redeploy**. (Variables that start with `NEXT_PUBLIC_` get baked in at build time, so any change to them needs a redeploy.)

**Check it:** open the Vercel URL. The Matchup page should show a prediction within a few seconds (up to a minute if the API was asleep). Click through vs Every Team and Model Performance too.

If the cards still show errors: open the browser console (Cmd+Option+J). A message with "CORS" in it means `CORS_ORIGINS` on Render doesn't match the address in your browser's address bar exactly (https, no trailing path).

Note: Vercel also makes "preview" URLs for each deploy (long names with random letters). Those aren't in `CORS_ORIGINS`, so their data won't load. Always use the main `nba-points.vercel.app` address.

---

## d. Updating the data later

Run this on the laptop (stats.nba.com blocks cloud servers, so the pull can't happen on Render):

```bash
cd ~/Downloads/nba-points
./refresh.sh
git add data/site
git commit -m "refresh data"
git push
```

`refresh.sh` pulls the new games, rebuilds `data/site/` and the live tracker, and runs the match test (it should end with PASS). Pushing kicks off both deploys automatically: Render rebuilds the API with the new stats (about 3 to 5 minutes), and Vercel rebuilds the site. Nothing to click.

If you changed code too, `git add -A` instead of `git add data/site` (and run `git status` first to see what's going in).

---

## e. Before a demo

- **The day before or that morning:** run step d so the stats are fresh. If the data is more than 2 days old the site shows a yellow "Stats are N days old" warning.
- **5 minutes before presenting:** open the site and click a player. That wakes the API up (it sleeps after 15 minutes idle and takes about a minute to wake). Leave the tab open. Clicking around every few minutes keeps it awake.
- Backup if the API won't wake up: run it locally (`uvicorn api.main:app` + `cd web && npm run dev`, see README) and demo from http://localhost:3000.

---

## Step 0: getting the code on GitHub (one time)

Already done on the laptop: `git init` and the first commits. To create the GitHub repo and push:

```bash
brew install gh                 # GitHub's command line tool
gh auth login                   # pick GitHub.com, HTTPS, "Login with a web browser", follow the code prompt
cd ~/Downloads/nba-points
gh repo create nba-points --public --source=. --remote=origin --push
```

The last command creates `github.com/YOUR-USERNAME/nba-points`, links it, and pushes everything.
