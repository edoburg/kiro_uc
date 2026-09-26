# 技術スタック

## アーキテクチャ

Electronデスクトップアプリのハイブリッド構成: React/TypeScriptレンダラー + localhostの子プロセスとして動作するPython FastAPIバックエンド。

```
Electron（メインプロセス）
├── IPCブリッジ  ←→  Python FastAPI（子プロセス、localhost）
└── レンダラー（React/TypeScript）
```

## フロントエンド

| レイヤー | 技術 |
|---------|------|
| デスクトップシェル | Electron |
| UIフレームワーク | React + TypeScript |
| バンドラー | Vite + electron-builder |
| 状態管理 | Zustand または React Context |
| IPC | `ipcRenderer.invoke` / `ipcMain.handle`（`preload.ts` 経由） |

## バックエンド（Python）

| レイヤー | 技術 |
|---------|------|
| APIサーバー | Python FastAPI（localhostの子プロセス） |
| 画像処理 | Pillow |
| ブラウザ自動化 | Playwright（ヘッドレス、LINE Creators Marketへのアップロード用） |
| 認証情報の保存 | `python-keyring` → OSキーチェーン（macOS Keychain / Windows Credential Manager / Linux SecretService） |
| 設定の永続化 | JSONファイル（`~/.line-stamp-gen/config.json`） |
| パッケージ設定 | `pyproject.toml` + `requirements.txt` |

## AI画像生成（Adapterパターン）

- DALL-E（OpenAI API）
- Stable Diffusion（ローカルWebUIエンドポイント）
- Midjourney（API）

すべてのアダプタは共通の `ImageGeneratorAdapter` 抽象基底クラスを実装する。

## テスト

| 対象 | フレームワーク |
|------|--------------|
| TypeScriptユニット・プロパティテスト | Vitest + fast-check |
| Pythonユニット・プロパティテスト | pytest + Hypothesis |
| E2E・インテグレーション | Playwright Test |

- プロパティベーステストは**最低100イテレーション**で実行する
- 外部サービス（AI API・Playwright・OSキーチェーン）はすべてモックを使用する
- プロパティテストのタグコメント形式: `# Feature: line-stamp-generator, Property {N}: {概要}`

## よく使うコマンド

```bash
# フロントエンド
npm run dev          # Electron + Vite 開発サーバー起動
npm run build        # 本番ビルド
npm run test         # Vitest 実行（単発実行は --run を付ける）

# バックエンド
pip install -r requirements.txt   # Python依存関係インストール
uvicorn backend.main:app --reload  # FastAPI 開発サーバー起動
pytest                             # 全Pythonテスト実行
pytest --hypothesis-seed=0         # 固定シードでプロパティテスト実行
```

## LINEスタンプ規格の定数

| アセット | サイズ | フォーマット |
|---------|--------|------------|
| スタンプ画像 | 最大 370×320 px | 透過PNG、1MB以下 |
| メイン画像 | 240×240 px | PNG |
| サムネイル画像 | 96×74 px | PNG |

クロップ時のアスペクト比: **37:32**。入力画像がこの比率の範囲外の場合は中央クロップを使用する。

## セキュリティルール

- APIキーおよび認証情報はOSキーチェーンに保存する（Python: `python-keyring`、フロントエンド: `keytar`）
- `export_sanitized()` はエクスポート前に `api_key` および `password` を含む認証情報フィールドを除外する
- `config.json` やログファイルに認証情報を書き込まない
