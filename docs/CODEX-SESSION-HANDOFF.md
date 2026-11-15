# 化墨 Codex Session 交接

（公開倉庫版本：本機路徑、未公開的手機預覽連結和私人備註已移除，原文留在本機 `out/CODEX-SESSION-HANDOFF.original.md`。）

工作區是倉庫根目錄。截至 2026-11-15，本輪已完成煙霧素材、免圖片的程式煙霧、斬霧與步行尾流、刀光與角色精修、踩草、連擊與敵人受擊，以及手機影片預覽。最後一次改動修正了命中時霧路徑突然偏移。以下是交給 Claude Code 整合及回歸檢查的現況。

## Git 和交付範圍

- 基底是 `main` 的 `5a2a50f`，與當時本地的 `origin/main` 一致。交接前沒有 staged changes。下列程式改動仍在工作樹，請先看 `git status --short`、`git diff --stat`、`git diff`，並檢查 untracked 檔案。
- 已修改 `README.md`、`build.mjs`、`src/boss.js`、`src/demos.js`、`src/figure.js`、`src/fog.js`、`src/main.js`、`src/player.js`、`src/stage.js`、`src/veil.js`、`src/veil.wgsl`、`src/world.js` 和 `tools/capture.mjs`。
- 新增的程式檔 `src/combat-fx.js`、`src/smoke-procedural.js`、`src/smoke-procedural.wgsl` 尚未入 Git，本交接檔亦是新增。另一個 checkout 只拉基底 revision 會缺這批檔案及修改。
- 12 張煙霧 PNG 與相片 atlas 已在 `a08d58e` 入 Git。相片 atlas 接進遊戲、原有四形態、巨相撲鬼、林道與 GPU solver 都有既有或平行工作。這輪在 `src/boss.js` 的新增改動只涉及用各連擊的命中時窗和角度判定巨人的手與腳。其他基底工作見 [原交接記錄](HANDOFF.md)。
- `dist/` 和 `out/` 都被 Git 忽略，包含 HTML、測試影片和 Cloudflare 部署包。repo 根目錄的 `index.html` 沒有用這輪新 build 覆蓋。

## 煙霧素材和程式生成

- 用內建 ImageGen 生成 [12 張煙霧 PNG](../assets/smoke/)。`puff_01` 至 `06` 是濃煙團、拉長煙團、直立柱及稀薄煙，`wisp_01` 至 `03` 是煙絲，`sheet_01` 至 `02` 是霧層，`detail_01` 是細節紋理。
- 全部 1024×1024、8-bit 灰階、無 alpha，共 2,019,953 bytes。九張煙團與煙絲四邊至少 82 px 純黑。三張全幅紋理做了邊緣柔化，並檢查 2×2 拼接。照原始規格由亮度表達煙量，沒有產生 normal map 或動畫幀。原圖總覽、拼接預覽及每張提示詞留在本機的 Codex 生成圖片目錄。
- 加入 `node build.mjs --procedural-smoke`。它輸出單一 HTML `dist/smoke-procedural.html`，程式在開場以 GPU 三維噪聲、密度和透光計算生成 atlas。打包沿用 esbuild，沒有新增 npm 依賴。已檢查程式版沒有嵌入 JPEG，實測載入時不請求煙霧圖片。原本 `node build.mjs` 輸出 `dist/index.html`，使用既有 `assets/smoke_atlas.jpg`。
- [生成器](../src/smoke-procedural.js)和 [WGSL](../src/smoke-procedural.wgsl)保留 4×3 atlas 排列，每格 384×384，把四個不同灰階變體放入 RGBA 四個通道。共 48 個基礎變體，含 24 個煙團、12 個煙絲、8 個霧層和 4 個細節。每片煙再按位置與 seed 選通道、混合、旋轉、擠壓及彎曲。相同參數兩次開場讀回的 atlas 位元組一致，`smokeWisps=0` 時四組煙絲都為零。
- 最後兩個 build 的 gzip 體積為相片版 **387,070 B**，程式版 **289,243 B**，節省約 25.3%。先前較早一版在本機 Chrome 720p 比較約 9.6 ms／幀。沒有把這個數當作最後整合版的效能數字。

| URL 參數 | 預設 | 可調範圍與作用 |
|---|---:|---|
| `fogDensity` | 1.85 | 0.65–3，前景消光倍率。相片及程式版都可用。 |
| `smokeSeed` | 0 | 0–4294967295，程式煙形與分布的 seed。 |
| `smokeTurbulence` | 1 | 0.45–1.65，折疊、翻滾和碎邊。 |
| `smokeScale` | 1 | 0.65–1.2，煙團和煙絲大小。 |
| `smokeWisps` | 1 | 0–2，煙絲密度。 |

## 霧和刀光

- [主迴圈](../src/main.js)、[2D 霧層](../src/veil.js)及 [WGSL](../src/veil.wgsl)沿用 3D solver 底霧和十層 384×216 的 2D veils。把刀的世界座標按深度投影到霧層，沿刀路把煙密度及紋理向兩側搬移，略微壓密兩側並留下會衰減的切口標記。刀過後兩邊仍繼續走，空隙才合回。在獨立 GPU 測試，一個煙團的中央密度由 1.00 到 0.00，兩團在刀停止後仍持續分開。整合錄影亦能看到切口。
- [合成器](../src/fog.js)加厚近處霧層，疊霧光學覆蓋上限為 88%。用 scene pass 的單通道 MRT `subjectMask` 標記主角為 1，敵人為 .5，地上墨水為 .5 乘 opacity。主角揮刀後逐步露出斗笠、肩和上半身。敵人受擊、倒地和化墨時，遮罩只調低角色及墨跡上的霧量，遮擋仍按實際場景深度。
- [刀光](../src/stage.js)改為逐段記錄刀尖再插值。起手短而薄，發力段快速拉長及加厚，收勢會收窄、乾化成細墨絲，再衰減。挑斬和下劈使用不同弧面和光帶闊度。
- 人形步行尾流由當幀實際地面位移觸發，按速度把霧向身體兩側推，留下短暫走道。層內速度與紋理一起移動，停步後自然填回。比較相同 `fogwalk` 鏡頭的有無改動實機畫面，尾流與露身均可見。
- 最後修正命中時的跳動。原本投影刀和算霧用的是推近前的鏡頭，而渲染用的是推近後的 FOV。普通劍擊同時還發出放射氣浪，敵人後仰會拉動過多深度層，hit stop 中的密度擴散也原本沒按 `dt` 減少。現在霧和場景共用穩定鏡頭，短暫震動及推近在最終畫布一併做。普通命中取消額外放射脈衝，收窄敵人受擊的推霧範圍，擴散跟 `dt`。同一三連擊比較，右側固定樹木在三個命中幀的橫向跳幅約由 8、9、28 px 降到 1、0、7 px。第三刀仍可見局部翻捲。

## 角色 踩草和戰鬥

- [主角模型](../src/figure.js)以 Three.js 做一輪造型精修，包含編織斗笠、交領與披肩、袍褶、紅腰帶、綁腿、臉部與刀形。修正過近鏡可見的衣領穿插。保留既有骨架與布條模擬，並追蹤實際刀尖。正背面實機渲染在 `out/hero-turnaround.png`。
- [踩草](../src/stage.js)由人形兩隻腳實際著地位置壓低、推開附近草叢。草叢會逐步回彈。WebGPU 測試於 1.6 秒讀到 41 個草叢接觸。抽出的同一批受壓草叢到 3.0 秒只剩約 1.9% 初始合計壓力。影片測試暫時關霧以便觀察。
- [三段連擊](../src/player.js)是橫斬、快速挑斬、較重的下劈。長度分別為 .36、.30、.49 秒。再按左鍵或 `F` 可預存下一刀，短暫接招窗口約 .22 秒。一直按住只觸發一刀，閃避及變身清掉排隊。每段有獨立姿勢、刀光、命中時點和推霧軌跡。
- [林中空地](../src/world.js)在第一個墨影的位置。地徑在這裏擴成半徑 4.6 m 的對決場，調整草叢、灌木和松樹的分布。正常路線可走到，`?arena` 則直接到入口並保留玩家控制。`?demo=combo` 是針對真實敵人與命中邏輯的重播，不是預渲染角色動畫。
- [受擊回饋](../src/combat-fx.js)及 [敵人狀態](../src/player.js)按命中、重擊、受擊、格擋、彈刀等使用不同強度的停頓、濺墨、亮屑及震動。墨影零血會先倒地，再化為貼地、擴散並逐步褪去的墨水。落地後著地墨水與下一個墨影的出現時間各自運作。
- 用實際鍵盤在 `?arena` 連按三次 `F` 驗證命中，另讓敵人打中主角，確認 HP 5→4 及 hit stop。最後修正版在 Chrome WebGPU 跑同一重播，三次命中處於幀 67、90、120，敵人 HP 3→2→1→0，各停 4、4、8 幀。倒地、化墨及下一個敵人亦經過實機驗證。

## 影片和手機預覽

| 內容 | 手機版 | 工作區原片或參考 |
|---|---|---|
| 30 秒煙霧示範 | 手機預覽頁（未公開） | `out/smoke-split-30s.mp4`，720p、30 fps、900 幀。手機壓縮版 `out/smoke-split-mobile.mp4` 約 2.86 MB。 |
| 原始斬霧關鍵畫面 | 首段約 0:02.5–0:03.4 和 0:22.5–0:23.4 | `out/smoke-split-contact.png` |
| 刀光、主角和草 | 手機預覽頁的精修頁 | 斬霧 7.5 秒和踩草 4 秒。原片 `out/huamo-mobile-slash.mp4` 和 `out/huamo-mobile-grass.mp4`。 |
| 最新連擊與步行 | 手機預覽頁的實戰頁 | 最新連擊 5.2 秒 `out/fog-impact-after.mp4`，步行 5 秒 `out/huamo-combat-walk.mp4`。 |
| 命中跳動前後比較 | 實戰頁目前播放修正版 `duel-aligned.mp4` | 舊片 `out/huamo-combat-duel.mp4`，逐格對照 `out/fog-impact-comparison.png`。 |

- 手機版影片最後改由 Cloudflare 頁面交付。
- 一個獨立的 Cloudflare Pages 專案只部署錄影片及圖片。打包目錄是 `out/cloudflare-smoke-preview/`。站點可免登入觀看並帶 `noindex`。影片路徑經 `_routes.json` 交給 `_worker.js`，回傳 iPhone 播放所需的 MP4 byte ranges。已用 HTTP 206 驗證，並在 Chrome 手機視窗測試播放及拖動進度。Cloudflare 上的遊戲畫面是錄影。目前可玩的 WebGPU HTML 在本機 `dist/`。

## 重現和整合檢查

```bash
npm install
node build.mjs
node build.mjs --procedural-smoke
node tools/capture.mjs '?demo=combo' out/combo-check --file=dist/smoke-procedural.html --video-only --skip=26 --frames=156 --every=2 --size=960x540 --set='{"hud":false}'
node tools/capture.mjs '?demo=fogwalk' out/fogwalk-check --file=dist/smoke-procedural.html --video-only --skip=78 --frames=150 --every=2 --size=960x540 --set='{"hud":false}'
```

遊戲用桌面版 Chrome 或 Edge 的 WebGPU 打開 `dist/smoke-procedural.html`。另有 `?demo=smokecut` 看單刀切霧，`?demo=reeds` 看踩草，`?arena` 直接進第一場對決。錄影工具依賴 macOS 的 Chrome 安裝路徑及 FFmpeg。`--video-only` 直接串流畫面給 FFmpeg。Puppeteer 手動步進時，相同輸入可重現遊戲狀態。濺墨粒子仍有 `Math.random()`，兩次拍攝的飛墨不一定逐像素一致。

工作區另保留 `out/smoke-variant-qa.png`、`out/trail-polish-qa.png`、`out/combat-death-flow.png`、`out/combat-player-hit.png` 和 `out/fogwalk-before-qa.png`／`out/fogwalk-after-qa.png`，可逐格檢查煙形、刀光、受擊與行路尾流。

優先保留並審查完整工作樹，重建兩種產物。若最後要更新可部署的遊戲入口，需選定相片版或程式版，並處理 repo 根 `index.html` 與輸出 HTML 的版本差異。變更 `PROCEDURAL_SMOKE`、霧層的 `transportCount`／uniform packing、`subjectMask` 及三段刀的 `swordMove`／`trailPhase` 時，要同步檢查兩端的讀寫及使用點。

最後版已做 build、`git diff --check`、定點 Chrome WebGPU 重播、鍵盤受擊及影片播放驗證。`npm test` 目前是佔位。建議最後整合後跑 `tools/check-spar.mjs`、`tools/check-boss.mjs` 和 `tools/bench.mjs`，補測守勢、閃避、四形態、林道到巨人完整流程，以及一般移動和快速轉鏡時霧層位置。霧層跨幀對位仍用各層中心平移的近似。最後一輪沒有重新量完整 720p／1080p 效能或驗證實體手機上的 WebGPU 遊戲。
