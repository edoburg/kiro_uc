# プロジェクト構成

## ルートレイアウト

```
line-stamp-generator/
├── electron/               # Electronメインプロセス
│   ├── main.ts             # アプリエントリー、Python子プロセス管理
│   └── preload.ts          # レンダラーに公開するIPC API（window.api）
├── src/                    # React/TypeScriptレンダラー
│   ├── components/         # UIコンポーネント（1コンポーネント1ファイル）
│   │   ├── PromptInput.tsx
│   │   ├── GenerationProgress.tsx
│   │   ├── ImagePreviewGrid.tsx
│   │   ├── StampSetEditor.tsx
│   │   ├── UploadPanel.tsx
│   │   ├── ConfigPanel.tsx
│   │   ├── LogViewer.tsx
│   │   └── SetupWizard.tsx
│   ├── stores/             # グローバル状態（Zustand または React Context）
│   │   └── promptHistoryStore.ts
│   ├── types/              # TypeScript型定義（共有）
│   │   └── index.ts        # 全ドメイン型: StampSet, GenerationRequest など
│   ├── utils/              # 純粋なユーティリティ関数（バリデーションなど）
│   │   └── validation.ts   # validatePrompt, validateTitle, validateFileType など
│   └── App.tsx             # ルートコンポーネント、ルーティング、グローバル状態の接続
├── backend/                # Python FastAPIバックエンド
│   ├── main.py             # FastAPIアプリ、ルート定義
│   ├── models.py           # Pythonデータクラス: ProcessedImageSet, ValidationResult など
│   └── services/
│       ├── config_service.py
│       ├── log_service.py
│       ├── image_processor_service.py
│       ├── image_generator_service.py  # Adapterパターン + DALLEAdapter, SDAdapter, MJAdapter
│       └── uploader_service.py         # Playwrightブラウザ自動化
├── tests/                  # Pythonテスト
│   └── services/           # backend/services/ と同じ構造
├── src/__tests__/          # TypeScriptテスト（Vitest）
├── pyproject.toml          # Pythonパッケージ設定
├── requirements.txt        # Python依存関係
├── package.json            # Node依存関係
└── vite.config.ts          # Vite/Electronビルド設定
```

## 主な規約

- **型は一箇所に集約する**: TypeScriptのドメイン型はすべて `src/types/index.ts` に定義する。PythonのデータクラスはすべてT `backend/models.py` に定義する。
- **バリデーションは純粋関数でテスト対象とする**: バリデーションロジックは `src/utils/validation.ts`（TS）またはサービスメソッド内（Python）に記述する。副作用のない純粋関数とし、プロパティベーステストの対象とする。
- **1コンポーネント1ファイル**: 各UIコンポーネントは `src/components/` 配下に独立した `.tsx` ファイルとして配置する。
- **サービスはステートレスとする**: 各Pythonサービスクラスは1回インスタンス化して注入する。サービス内にグローバルなミュータブル状態を持たない。
- **IPCの境界を守る**: レンダラーはPythonを直接呼び出さない。バックエンドへの呼び出しはすべて `window.api`（`preload.ts` で定義）→ `ipcMain.handle` → FastAPI localhost のルートを通る。
- **設定ファイルの場所**: `~/.line-stamp-gen/config.json`。認証情報はここに書かず、OSキーチェーンのみに保存する。
- **ログの場所**: `~/.line-stamp-gen/logs/` 配下のローテーションログファイル。合計サイズの上限は100MB。

## スペックファイル

機能スペックは `.kiro/specs/line-stamp-generator/` に配置し、要件・設計・実装タスクの唯一の情報源とする。
