# Tower Dungeon

3D ダンジョンクローラーRPG（Three.js製）+ AI自動テストフレームワーク

[English version below](#english)

---

## スクリーンショット

ブラウザで `index.html` を開くだけでプレイ可能です。

## 遊び方

### 操作方法

| キー | 動作 |
|------|------|
| **WASD** | 移動 |
| **マウス** | 視点操作 |
| **クリック** | 攻撃（MP5消費） |
| **E** | インタラクト（ボス起動、祠使用、階段昇降、ドアを開ける） |
| **TAB** | インベントリを開く |
| **ESC** | マウスフォーカス解除 / インベントリを閉じる |

### ゲームの流れ

1. ダンジョンを探索して**ボスキー(🔑)**を見つける
2. ボス部屋に行き、**E**キーでボスを起動
3. ボスを倒すと**階段**が出現
4. 階段を使って次のフロアへ

### アイテム

TABキーでインベントリを開き、クリックで使用します。

| アイコン | 名前 | 効果 |
|----------|------|------|
| 🧪 | Potion | HP50回復 |
| 💧 | MP Potion | MP30回復 |
| 🛡️ | Shield | ATK永続+3 |
| ✨ | Charm | 15秒間被ダメージ50%減 |
| 🔥 | Torch | 60秒間視界を広げる |

### 松明システム

ダンジョンは非常に暗く、松明なしでは**1マス先**しか見えません。

- 各フロアに必ず1つ松明が配置されている
- TABでインベントリを開いて使用
- 60秒間有効（フロア移動しても継続）
- 松明を見つけて使うまでは慎重に探索しよう！

---

## 戦闘システム

### テレグラフ回避

ボスは**通常攻撃3回ごと**に強力な特殊攻撃をチャージします。

- ボスが**赤く点滅**し、画面に警告が表示される
- チャージ中に**距離6以上**離れると回避成功（「DODGE!」表示）
- 回避失敗で**通常の3倍ダメージ**

### バックスタブ

ボスの**背後（±60°）**から攻撃すると**ダメージ2倍**になります。

- 「BACKSTAB!」と黄色く表示
- ボスの旋回速度は制限されているため、横に回り込んで背後を狙える

### コンボシステム

**2秒以内**に連続攻撃を当てるとコンボが加算されます。

| コンボ数 | ダメージボーナス |
|----------|------------------|
| 1 | +0% |
| 2 | +15% |
| 3 | +30% |
| 4 | +45% |
| 5 | +75%（最大） |

### 祠（Shrine）

マップ上にある祠を**E**キーで使用すると、フロア中有効なバフを獲得できます。

- **ATK +5**
- **MaxHP +20**

ボス戦前に見つけると有利に戦えます。

---

## 敵の種類

### 通常モンスター

| タイプ | 特徴 |
|--------|------|
| **Skeleton** | 標準的な敵 |
| **Slime** | 死亡時に2体に分裂 |
| **Wraith** | 壁をすり抜ける、高攻撃力 |
| **Golem** | 高HP・高攻撃力、移動が遅い |

### ボス

| タイプ | 特殊攻撃 | 対策 |
|--------|----------|------|
| **Guardian** | 範囲スラム攻撃 | チャージ中に距離を取る |
| **Sorcerer** | 弾幕 + テレポート | 弾を横移動で回避 |
| **Berserker** | 突進攻撃（壁で2秒スタン）、HP30%以下で狂暴化 | スタン中にバックスタブ |

---

## 自動テスト

Puppeteerを使ったAI自動テストフレームワークが含まれています。

### セットアップ

```bash
npm install
```

### テスト実行

```bash
# ヘッドレスモード（デフォルト、3フロア）
npm test

# GUIモード（ブラウザ表示）
npm run test:gui

# クイックテスト（1フロア、60秒）
npm run test:quick
```

### テスト結果

テスト結果は `test-results/` に出力されます：
- `report.html` — HTMLレポート
- `results.json` — JSON形式の結果
- `screenshots/` — スクリーンショット

---

## 技術仕様

- **Three.js r128** — 3Dレンダリング
- **単一HTMLファイル** — 依存なしでブラウザで即プレイ可能
- **A*パスファインディング** — ボットAIの経路探索
- **壁隣接ペナルティ** — コーナースタック防止
- **フォグオブウォー** — 探索済みエリアのみ表示、未訪問エリアは記憶減衰

---

<a name="english"></a>

# Tower Dungeon (English)

3D Dungeon Crawler RPG built with Three.js + AI Auto-Testing Framework

---

## How to Play

Simply open `index.html` in your browser.

### Controls

| Key | Action |
|-----|--------|
| **WASD** | Move |
| **Mouse** | Look around |
| **Click** | Attack (costs 5 MP) |
| **E** | Interact (activate boss, use shrine, climb stairs, open doors) |
| **TAB** | Open inventory |
| **ESC** | Release mouse focus / Close inventory |

### Game Flow

1. Explore the dungeon and find the **Boss Key (🔑)**
2. Go to the boss room and press **E** to activate the boss
3. Defeat the boss to reveal the **stairs**
4. Use the stairs to ascend to the next floor

### Items

Press TAB to open inventory, click to use.

| Icon | Name | Effect |
|------|------|--------|
| 🧪 | Potion | Restore 50 HP |
| 💧 | MP Potion | Restore 30 MP |
| 🛡️ | Shield | Permanently +3 ATK |
| ✨ | Charm | 50% damage reduction for 15s |
| 🔥 | Torch | Expands vision for 60s |

### Torch System

The dungeon is very dark — without a torch, you can only see **1 tile ahead**.

- Each floor has at least one torch
- Open inventory with TAB to use
- Lasts 60 seconds (persists through floor changes)
- Find and light a torch before exploring!

---

## Combat System

### Telegraph Dodge

Bosses charge a powerful special attack **every 3 normal attacks**.

- Boss **flashes red** with an on-screen warning
- Move **6+ units away** during charge to dodge ("DODGE!" displayed)
- Getting hit deals **3x normal damage**

### Backstab

Attack from **behind the boss (±60°)** for **2x damage**.

- "BACKSTAB!" displayed in yellow
- Boss turn rate is limited, so circle around to get behind

### Combo System

Land consecutive hits **within 2 seconds** to build combo.

| Combo | Damage Bonus |
|-------|--------------|
| 1 | +0% |
| 2 | +15% |
| 3 | +30% |
| 4 | +45% |
| 5 | +75% (max) |

### Shrine

Use shrines with **E** key to gain floor-wide buffs:

- **ATK +5**
- **MaxHP +20**

Finding the shrine before the boss fight gives you an advantage.

---

## Enemy Types

### Regular Monsters

| Type | Trait |
|------|-------|
| **Skeleton** | Standard enemy |
| **Slime** | Splits into 2 on death |
| **Wraith** | Phases through walls, high attack |
| **Golem** | High HP/attack, slow movement |

### Bosses

| Type | Special Attack | Counter |
|------|----------------|---------|
| **Guardian** | Area slam | Keep distance during charge |
| **Sorcerer** | Projectiles + teleport | Strafe to dodge bullets |
| **Berserker** | Charge attack (2s stun on wall), enrages below 30% HP | Backstab during stun |

---

## Auto Testing

Includes a Puppeteer-based AI auto-testing framework.

### Setup

```bash
npm install
```

### Run Tests

```bash
# Headless mode (default, 3 floors)
npm test

# GUI mode (visible browser)
npm run test:gui

# Quick test (1 floor, 60 seconds)
npm run test:quick
```

### Test Results

Results are saved to `test-results/`:
- `report.html` — HTML report
- `results.json` — JSON results
- `screenshots/` — Screenshots

---

## Technical Specs

- **Three.js r128** — 3D rendering
- **Single HTML file** — No dependencies, plays instantly in browser
- **A* Pathfinding** — Bot AI navigation
- **Wall-adjacency penalty** — Prevents corner stacking
- **Fog of War** — Only explored areas visible, unvisited areas fade from memory

---

## License

MIT
