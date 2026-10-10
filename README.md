# Jarvis

A personal scheduling assistant that runs as a Progressive Web App on your iPhone. Free to build and run: no server, no accounts, no analytics. All data stays on the phone (IndexedDB).

- **Interpreter** turns what you say or type into one structured command. An offline rule parser handles common phrases; an optional free-tier AI (Gemini or Groq) handles the rest.
- **Scheduler** is a deterministic TypeScript engine (`src/engine`) that does all placement and replanning. The AI never edits the schedule.
- Every change shows a confirmation card (what was understood, before/after diff, Apply / Edit / Cancel). Undo keeps the last 20 changes.

## Run it on Windows

Needs [Node.js](https://nodejs.org) 20 or newer and [Git for Windows](https://git-scm.com/download/win).

```bash
cd D:\Jarvis\Jarvis
npm install
npm run dev
```

Open http://localhost:5173. To pin the clock for testing, add `?now=2026-10-12T18:00` to the URL.

```bash
npm test
```

Runs the scheduler, parser, storage and AI-fallback unit tests (Vitest).

```bash
npm run e2e
```

Runs the end-to-end flows in your installed Google Chrome at iPhone size (390 x 844): add a task by text, recurring event, block time with a conflict, done and undo, morning brief, night wrap-up, Deadlines, Exams, Inbox, habits, templates.

## Deploy free on GitHub Pages

1. Create a free account at https://github.com and a new **public** repository named `jarvis` (Pages on private repos needs a paid plan; your schedule data never goes into the repo, only the app code).
2. In PowerShell:

```bash
cd D:\Jarvis\Jarvis
git init -b main
git add .
git commit -m "Jarvis"
git remote add origin https://github.com/YOUR-USERNAME/jarvis.git
git push -u origin main
```

3. On GitHub open the repo, then **Settings > Pages > Build and deployment > Source: GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to finish (about a minute). The app is at `https://YOUR-USERNAME.github.io/jarvis/`.

To update later, commit and `git push`. The workflow tests, builds and redeploys; the app on your phone picks up the new version the next time you open it.

## Add it to your iPhone Home Screen

1. Open `https://YOUR-USERNAME.github.io/jarvis/` in **Safari** (it must be Safari).
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open Jarvis from the Home Screen icon. It runs full screen, works offline, and keeps its data separately from Safari.

Tips:
- **Dictation:** tap the "Speak or type" bar, then the microphone on the iPhone keyboard. The round mic button next to the bar (hold to talk) appears only where the browser supports speech recognition; on iPhone the keyboard mic is the reliable way.
- **Backups:** your data lives only on the phone. Export a backup from **More > Settings and backup** now and then (AirDrop or save it to Files). Deleting the Home Screen app deletes its data.
- **Notifications:** a Home Screen web app cannot reliably alert you while closed. Use **More > Export to Calendar** to send the next 7 days (with alerts) to iPhone Calendar. Importing again adds new copies, so import into a separate "Jarvis" calendar you can clear first.

## Set up your own exams and routine

Jarvis starts with a generic weekly template and no exams. Either:
- say `Maths exam on Oct 28 10 to 12`, then set its study target on the **Exams** screen, and edit the routine, subjects and sleep times in **Settings**; or
- keep your setup in a private backup file (never in this repo) and load it with **Settings > Import Backup**.

## Optional: free AI key

Without a key, the offline parser handles everything in the examples below. A key lets Jarvis understand looser phrasing.

**Google Gemini (recommended):**
1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key**, then copy it.
3. In Jarvis open **More > Settings and backup > AI interpreter**, choose **Google Gemini**, paste the key, then tap **Test Key**.

The default model is `gemini-flash-latest`; change it in Settings if Google renames models. Free-tier limits and terms change, so check https://ai.google.dev for current numbers. On the free tier Google may use prompts to improve its models, so keep personal details out of commands.

**Groq** (alternative): get a key at https://console.groq.com/keys and choose Groq in Settings.

The key is stored only on your phone and is left out of backup exports. Rules run first; the AI is only asked when the rules are unsure, and any AI error falls back to the offline parser.

## Jarvis talks back

- After each command Jarvis answers out loud ("Right away, boss. ... Shall I go ahead?"). Reply in the card's box with **yes** / **no** or a change, by typing or with the keyboard mic.
- The **morning brief** and **night wrap-up** have **Read it to me**. With an AI key and *Witty AI briefings* on, Gemini writes them in a JARVIS style from your real schedule (it is told never to invent anything), once per day; otherwise a standard briefing is read. iPhone only allows speech after a tap, so the brief that opens by itself waits for the button.
- **Weather** for the brief comes from the free Open-Meteo service: set a city or tap *Use My Location* in Settings. Only the city or a rounded location is sent.
- **Settings > Voice**: on/off, what Jarvis calls you, which voice, speed. For a more natural voice, download one on the iPhone: Settings > Accessibility > Spoken Content > Voices > English (a British "Enhanced" voice suits Jarvis).

## 20 things you can say

1. `I need to do my History essay, due Thursday.`
2. `Physics lab write-up due Wednesday 9 am, takes 90 min`
3. `Add gym at 7 pm today.`
4. `Robotics meeting Friday 5 to 8`
5. `Add coding practice every day 10:15 to 11 pm till Oct 30.`
6. `Maths every weekday 6:45 to 7:45 am until Oct 30.`
7. `Clear my time till 10 today, I have hackathon work.`
8. `Okay add it today after I come home and push my sleep` (answers a conflict with option a)
9. `Done with chem.`
10. `Didn't finish Maths.`
11. `That took 2 hours.`
12. `What's today?`
13. `What's next?`
14. `What's due this week?`
15. `How many study hours left before Maths?`
16. `Am I on track?`
17. `When am I free tomorrow?`
18. `Move Physics to tomorrow morning.`
19. `Make the optics quiz critical.`
20. `Push everything by 30 minutes.`

Also: `Cancel gym today`, `Delete all coding practice sessions`, `Plan study for maths`, `Maths exam on the 28th 10 to 12` (adds an exam; set its study target on the Exams screen), `panic`, `undo`, or anything without a time (`buy a new calculator`) to drop it in the Inbox.

## How scheduling works

- **Weekly template** (Settings): college 9:00 to 16:00 on weekdays, commute, meals, club after college, plus study and assignment *hint* slots that work is steered into.
- **Placement:** each task has a deadline, estimate, priority, splittable flag, preferred time of day and subject. Work is placed before the deadline with a one-day buffer where possible, in even chunks of at most 90 minutes, hard subjects in your focus hours and light work (write-ups, typing) in low-energy hours, with a buffer between blocks.
- **Durations:** if you give none, Jarvis uses the type default (editable) nudged toward how long your finished tasks of that type really took.
- **Priority:** exams and critical graded work first, then study for the nearest exam, then assignments by deadline, then club and personal items (flexible).
- **Sleep:** nothing is scheduled past your bedtime, latest bedtime, or below minimum sleep (6.5 h), unless you choose to push bedtime for one night. Sleep debt is tracked over the week.
- **Replanning** moves as little as possible and shows a before/after diff. If a displaced item would miss its deadline or is critical, nothing moves silently: you get options (a) later today and push bedtime, (b) shorten the block, (c) swap with a lower-priority item, (d) drop a flexible item.
- **Unfinished work** rolls forward (Today shows a Reschedule banner; the night wrap-up does it for you) with a warning when it becomes tight.

## Project layout

```
src/engine/      deterministic scheduler, metrics, diff, .ics export (+ unit tests)
src/interpret/   rule parser and LLM interpreter (+ tests)
src/store/       IndexedDB storage, undo history, backup
src/ui/          React screens
e2e/             Playwright end-to-end flows
scripts/         screenshots, icon rendering, PWA offline check
```
