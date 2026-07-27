# GitHub Profile Card

Animated GitHub profile stats card — dark bento layout, live stats, contribution morph, and a curtain intro (**cat** / **Spider-Man** / **Batman**).

<p align="center">
  <img src="./assets/examples/batman.gif" alt="Batman curtain demo" width="900" />
</p>

MIT licensed · credit for [AmirHossein Rezaei](https://github.com/DinonowDev) stays on the card even after you fork.

---

## Curtain themes

<p align="center">
  <img src="./assets/examples/cat.gif" alt="Cat curtain" width="900" />
</p>

<p align="center">
  <img src="./assets/examples/spiderman.gif" alt="Spider-Man curtain" width="900" />
</p>

<p align="center">
  <img src="./assets/examples/batman.gif" alt="Batman curtain" width="900" />
</p>

---

## Get your card (0 → 100)

Everything you need is already in this repo: `scripts/generate-cards.mjs` builds `assets/profile-card.svg`, and `.github/workflows/update-stats.yml` runs that script for you on GitHub.

### 1. Fork as your profile repo

1. Open [DinonowDev/github-profile-landing](https://github.com/DinonowDev/github-profile-landing)
2. Click **Fork**
3. Name it exactly `YourUsername/YourUsername` — that makes it your [GitHub profile README](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-github-profile/customizing-your-profile/managing-your-profile-readme)

Already have a profile README? Copy these into that repo instead:

- `scripts/generate-cards.mjs`
- `.github/workflows/update-stats.yml`
- `assets/` (optional starter)

### 2. Personalize the generator

Edit `scripts/generate-cards.mjs` — set your username and social links:

```js
const USERNAME = process.env.GH_USERNAME || "YourUsername";

const SOCIAL = {
  telegram: { handle: "@you", url: "https://t.me/you" },
  linkedin: { handle: "linkedin/in/you", url: "https://www.linkedin.com/in/you" },
  github: { handle: "github.com/YourUsername", url: "https://github.com/YourUsername" },
};
```

Leave `DEVELOPER` unchanged — that author credit is intentional.

### 3. Show the card in your README

Add this to your profile `README.md`:

```html
<p align="center">
  <img src="./assets/profile-card.svg" alt="GitHub profile overview" width="900" />
</p>
```

### 4. Enable Actions and push

1. **Settings → Actions → General** — allow workflows and let Actions write commits
2. Commit your changes and push to `main`
3. Open the **Actions** tab and run **Update Profile Stats** once (or wait for the first push)

The workflow runs `node scripts/generate-cards.mjs` with live GitHub data, writes `assets/profile-card.svg`, and commits it back. After that it refreshes daily and whenever the generator or workflow changes.

### 5. Pick a curtain theme (optional)

**Settings → Secrets and variables → Actions → Variables**

| Name | Value |
| --- | --- |
| `CARD_THEME` | `cat`, `spiderman`, `batman`, or leave empty for random |

You can also choose a theme when running the workflow manually from the Actions tab.

---

## License

MIT — see [`LICENSE`](./LICENSE).
