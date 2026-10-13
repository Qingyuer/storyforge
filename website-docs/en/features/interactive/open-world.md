---
productId: upper.text-open-world
status: preview
lastVerified: 2026-10-13
---
# Text open world

> Preview. Dedicated production, player UI, and runtime AI are connected; general production still requires real-provider calibration and human acceptance of both ending paths.

Text open world combines regional exploration, character schedules, quests, combat, inventory, and ongoing change. Sources can be a frozen world version or an explicitly selected range of a novel. Product assets and play results belong to the product and do not automatically update the world or original work.

## Try Salt Ridge: Night of the Cutoff (盐脊：断流之夜)

Open Text open world and choose “先试玩《盐脊：断流之夜》”. No workspace selection or model configuration is needed. Starting for the first time creates an independent release and save. Explore, interact with characters, complete quests, and reach endings; continue from your own progress.

This is a prepared showcase, not evidence that any input automatically produces an equally complete game. See [Built-in works and examples](/en/guides/examples).

## Three 3D narrative games

Find **Built-in narrative games (内置叙事游戏)** in the Player view of Text open world. No workspace, API configuration, or external game engine is required. These three games are not featured on the homepage.

- **Tidemark: Between Two Bells (潮痕：两声之间)**: a separate story of roughly 4–5 minutes. Inspect water marks, collect tools, operate the sluice in order, and carry out either rescue route.
- **Tidemark: The Last Lamp (潮痕：最后一盏灯)**: ten chapters of coastal fantasy, over 30,000 Chinese characters in the main story, over 500 distinct dialogue lines, and four endings.
- **Aphelion: Dock Seven (远日点：第七码头)**: ten chapters of space science fiction, over 30,000 Chinese characters in the main story and over 500 distinct dialogue lines, with equipment puzzles, side routes, and four endings.

Start with Between Two Bells. Desktop controls include WASD/arrow keys, click-to-move, and E to interact nearby. Phone users can use on-screen buttons; settings offer text exploration, lighter graphics, and reading modes. Content is prepared only after an explicit start. Continue after a refresh; new journeys and checkpoint branches preserve previous saves. Transfer progress through a full project backup; browser data does not automatically sync between devices.

The main stories use frozen scripts supplied with the repository, without free-form model dialogue or voice acting. The longer games only offer optional synthesized ambience; the short story currently has no sound. These works do not establish completion of general open-world generation. Download a `main` checkout containing this update or a later Release; older archives do not automatically gain this content.

## Produce your own work

1. Open Text open world → Produce (制作), then choose a workspace and a world version or novel source range.
2. Review available sources and gaps before continuing to the main Agent conversation. Selecting sources alone does not start production or billing.
3. Confirm the goal, gameplay, scale, budget, and production brief; resolve required inputs and model configuration.
4. Explicitly authorize production. Inspect progress and pending artifacts; use the current task's recovery guidance after interruptions.
5. Review the story, protagonist, map, quests, gameplay, and assets. Edit or repair the relevant artifacts and recheck affected dependencies.
6. Complete quality checks and playtest evidence, then freeze a publishable product version. Production previews remain separate from the formal game library.

Production may use your model and image services. Budget, failure, and quality gates must not be bypassed by editing stored data.

## Player controls and saves

The Player view provides scenes, maps, quests, characters, inventory, combat, crafting and trade, world records, and save settings. Inspect action requirements, costs, and results; follow explanations for unavailable actions.

New games and existing saves each bind to an immutable release. Existing saves are never silently upgraded; migration requires a compatible, validated path. Confirm the target before restoring, branching, or deleting a timeline. Deleting one timeline does not remove other saves or its frozen release.

Runtime AI can assist with intent interpretation, character dialogue, and result expression, within gameplay state and permission boundaries. On service failure, inspect the error and recovery options instead of repeatedly resending an action whose result is unknown.

## Productization branch preview (not merged or deployed)

The `feat/text-open-world-productization-20261013` branch adds the following changes. Availability depends on the version you run; this is not a new released version. See [Development status](/en/updates/development-status).

- The production workspace groups progress into **game content**, **product systems**, and **media**. Expand each group to inspect missing artifacts, dependencies, blocked tasks, usage, and the existing repair entry. These groups contribute to one game and retain the underlying execution lanes.
- New builds freeze the three groups' input hashes during assembly. A repair creates a child build and reruns the affected dependencies; historical builds, releases, and saves stay pinned to their original versions. New-format records require an application version containing this update; older applications may reject them.
- Image review requires opening each verified image, accepting or rejecting it, and explicitly confirming personal review. Character groups use declared identities only; automatic checks do not judge visual similarity. Rejected images require a media repair. New builds with images need this review before the final publication quality gate can pass. Existing image generation/import and declared silent audio fallback remain available.
- In the player's **More (更多)** view, choose **Read local experience records (读取本地体验记录)** to inspect quest, combat, travel, free-input, and repetition counts. Mainline duration is the wall-clock span between recorded progress events, including idle/offline time. Same-source/fingerprint counts are not semantic similarity scores. Unverifiable AI records are reported separately.
- Choose an issue category, describe the problem without source text or private information, and export a feedback file to your device. The form is not saved until exported; nothing is uploaded or automatically sent to the author. Feedback and telemetry do not sign a human playtest receipt.

Historical Salt Ridge browser evidence was not obtained in this development environment. Engineering and mock-provider checks do not replace independent real-model calibration, two human-played endings, actual image-quality review, or a real successor release and old-save retest.

## Current limits

The catalog still marks this product as a preview. Engineering checks, automated play, and a showcase do not replace real-service calibration, long sessions, or independent human acceptance. [Back up](/en/guides/backup-restore) important work.

Evidence: [Dedicated entry](https://github.com/yuanbw2025/storyforge/commit/541c9d04) · [Salt Ridge showcase](https://github.com/yuanbw2025/storyforge/commit/a4bc3f62).
