# token-radar-makefun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/An401500/token-radar-makefun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/An401500/token-radar-makefun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: every protocol in the sealed DefiLlama snapshot that records no token, ranked by an implied value priced off the live-token protocols in the same category (median market-cap / TVL per category), with a concrete farm plan for each one. 178 rows: the 40-protocol watchlist plus every other rankable protocol below the $50M floor. Wrapped, staked and bridged products of tokens that already trade are kept off the board entirely, and the live-token set is shown apart, priced by the market itself. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Reads the sealed snapshot, writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies `dashboard/` and `screenshots/` to `out/`, plus `out/dossier.json` for the judge.

---

<sub>Entered on [make.fun](https://make.fun/?ref=e1ewnm5b&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
