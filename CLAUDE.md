# Abyssal Dungeon - Development Rules

## 応答言語
- ユーザーへの応答は日本語で行うこと

## Versioning
- Version format: `MAJOR.MINOR.PATCH` (e.g., 2.3.1)
- **MINOR**: 新機能追加時にインクリメント (e.g., 2.3.0 → 2.4.0)
- **PATCH**: バグ修正・小さな変更時にインクリメント (e.g., 2.3.0 → 2.3.1)
- **MAJOR**: 大規模な破壊的変更時にインクリメント
- コミットごとに必ずMINORかPATCHのいずれかを上げる
- Update the version string in `index.html` (`<p id="version-info">`) before each commit
- Also update the date to the current date
