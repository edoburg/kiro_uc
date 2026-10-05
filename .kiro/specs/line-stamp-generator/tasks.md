# Implementation Plan: LINEスタンプジェネレーター

## Overview

Electron（メインプロセス）＋ React/TypeScript（レンダラ）＋ Python FastAPI（バックエンド子プロセス）のハイブリッド構成で実装する。
タスクは「プロジェクト基盤 → バックエンドサービス層 → フロントエンドコンポーネント層 → Electron統合 → E2E」の順に積み上げる。
テスト関連サブタスク（`*` 付き）は省略可能だが、必須サブタスクとセットで実行することを推奨する。

---

## Tasks

- [x] 1. プロジェクト構成と共有型定義のセットアップ
  - Electron + React/TypeScript のプロジェクトスキャフォールド（Vite + electron-builder）を作成する
  - Python FastAPI バックエンドのディレクトリ構造とパッケージ設定（`pyproject.toml` / `requirements.txt`）を作成する
  - フロントエンド用の共有型定義ファイル `src/types/index.ts` を作成し、`StampCount`・`GenerationRequest`・`GeneratedImage`・`StampSet`・`StampImage`・`ValidationResult`・`UploadResult`・`Config`・`PromptHistory`・`LogEntry` を定義する
  - Python バックエンド用の dataclass モジュール `backend/models.py` に `ProcessedImageSet`・`ValidationResult`・`GenerationProgress`・`UploadResult`・`LogEntry`・`LineCredentials` を定義する
  - Vitest + fast-check（フロントエンド）と pytest + Hypothesis（バックエンド）のテスト環境を構築する
  - _Requirements: 1.1, 2.7, 6.1_

- [x] 2. ConfigService（Python）の実装
  - [x] 2.1 `backend/services/config_service.py` を作成し、`load`・`save`・`export_sanitized`・`import_from_dict`・`save_credential`・`get_credential` を実装する
    - `export_sanitized` では `api_key`・`password` を含む認証情報フィールドを除外する
    - `import_from_dict` では Pydantic スキーマ検証後のみ既存 Config を上書きする
    - `save_credential`・`get_credential` は `python-keyring` で OS Keychain を使用する
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_

  - [x] 2.2 Property 13 のプロパティテストを Hypothesis で記述する
    - **Property 13: Config エクスポートのセンシティブフィールド除外**
    - **Validates: Requirements 6.5**

  - [x] 2.3 Property 14 のプロパティテストを Hypothesis で記述する
    - **Property 14: Config JSON ラウンドトリップ**
    - **Validates: Requirements 6.6**

  - [x] 2.4 Property 15 のプロパティテストを Hypothesis で記述する
    - **Property 15: 不正 Config インポート時のデータ保全**
    - **Validates: Requirements 6.7**

- [x] 3. LogService（Python）の実装
  - [x] 3.1 `backend/services/log_service.py` を作成し、`log`・`rotate_if_needed`・`get_entries` を実装する
    - ログエントリには ISO 8601 タイムスタンプ・ログレベル（INFO/WARN/ERROR）・モジュール名・メッセージを含める
    - `rotate_if_needed` はログファイル合計サイズが 100MB 超過時に最古ファイルから削除する
    - `get_entries` はレベル・日付範囲のフィルタリングと最大 1000 件の上限を実装する
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 3.2 Property 16 のプロパティテストを Hypothesis で記述する
    - **Property 16: ログエントリのフォーマット**
    - **Validates: Requirements 7.2**

  - [x] 3.3 Property 17 のプロパティテストを Hypothesis で記述する
    - **Property 17: ログローテーションの上限保証**
    - **Validates: Requirements 7.3**

  - [x] 3.4 Property 18 のプロパティテストを Hypothesis で記述する
    - **Property 18: ログ表示件数の上限**
    - **Validates: Requirements 7.4**

  - [x] 3.5 Property 19 のプロパティテストを Hypothesis で記述する
    - **Property 19: ログフィルタリングの正確性**
    - **Validates: Requirements 7.6**

- [x] 4. Checkpoint — ConfigService・LogService の動作確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. ImageProcessorService（Python）の実装
  - [x] 5.1 `backend/services/image_processor_service.py` を作成し、`resize_to_stamp`・`center_crop_to_aspect`・`compress_to_limit`・`validate`・`process_image` を Pillow で実装する
    - スタンプ画像: W370×H320px 以内の透過 PNG
    - メイン画像: W240×H240px PNG
    - サムネイル画像: W96×H74px PNG
    - `compress_to_limit` は PNG 圧縮レベルを段階的に上げて 1MB 以下に収め、超過時は `file_size_exceeded=True` をセットする
    - バッチ変換では個別エラーを記録しつつ他画像の変換を継続する
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8_

  - [x] 5.2 Property 5 のプロパティテストを Hypothesis で記述する
    - **Property 5: LINE規格変換の出力サイズ保証**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 5.3 Property 6 のプロパティテストを Hypothesis で記述する
    - **Property 6: ファイルサイズ 1MB 以下保証**
    - **Validates: Requirements 3.3**

  - [x] 5.4 Property 7 のプロパティテストを Hypothesis で記述する
    - **Property 7: 中央クロップ後のアスペクト比**
    - **Validates: Requirements 3.5**

  - [x] 5.5 Property 8 のプロパティテストを Hypothesis で記述する
    - **Property 8: バッチ変換のエラー継続処理**
    - **Validates: Requirements 3.7**

  - [x] 5.6 `process_image` のユニットテストを pytest で記述する（具体的なサイズ入力例: 800×600px → 370×320px 以内）
    - _Requirements: 3.1, 3.2, 3.6_

- [x] 6. ImageGeneratorService（Python）の実装
  - [x] 6.1 `backend/services/image_generator_service.py` に `ImageGeneratorAdapter` 抽象クラスを定義し、`DALLEAdapter`・`StableDiffusionAdapter`・`MidjourneyAdapter` を実装する
    - 各アダプタは `generate` を async generator として実装し、180 秒タイムアウトを組み込む
    - `ImageGeneratorService.generate_batch` / `generate_single` を実装する
    - _Requirements: 2.1, 2.3, 2.7, 2.8, 2.10_

  - [x] 6.2 `DALLEAdapter`・`StableDiffusionAdapter`・`MidjourneyAdapter` のユニットテストを pytest + mock で記述する
    - タイムアウト・APIエラー時のエラー種別返却を確認する
    - _Requirements: 2.8, 2.10_

- [x] 7. UploaderService（Python）の実装
  - [x] 7.1 `backend/services/uploader_service.py` を作成し、`_login`・`_upload_images`・`_submit_for_review`・`upload` を Playwright で実装する
    - ネットワークエラー時は 5 秒間隔で最大 3 回自動リトライする
    - 認証エラー時はリトライなしで即時停止し `UploadResult` にエラー種別を記録する
    - 進捗コールバック `on_progress` を 1 秒以内の間隔で呼び出す
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

  - [x] 7.2 Property 11 のプロパティテストを Hypothesis で記述する
    - **Property 11: アップロードリトライロジック**
    - **Validates: Requirements 5.4, 5.7**

  - [x] 7.3 `UploaderService` のユニットテストを pytest + mock で記述する
    - 認証エラー即時停止・3回失敗後の `UploadResult` 構造を確認する
    - _Requirements: 5.4, 5.7_

- [x] 8. FastAPI ルーター・IPC ブリッジの実装
  - [x] 8.1 `backend/main.py` に FastAPI アプリを定義し、以下のエンドポイントを実装する
    - `POST /generate` — 画像生成（SSE ストリームで進捗配信）
    - `POST /process` — LINE規格変換
    - `POST /upload` — LINE Creators Market アップロード（SSE ストリームで進捗配信）
    - `GET/POST /config` — Config の読み書き・エクスポート・インポート・クレデンシャル管理
    - `GET /logs` — ログ取得・フィルタリング
    - _Requirements: 2.5, 5.2, 6.1, 6.4, 6.5, 6.6, 7.4, 7.6_

  - [x] 8.2 Electron メインプロセス (`electron/main.ts`) に Python FastAPI 子プロセスの起動・終了管理と IPC ブリッジを実装する
    - `ipcMain.handle` で各エンドポイントへの HTTP プロキシを実装する
    - _Requirements: 2.5, 5.2_

- [x] 9. Checkpoint — バックエンドサービス層の統合確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. PromptInput コンポーネント（TypeScript）の実装
  - [x] 10.1 `src/components/PromptInput.tsx` を作成し、`validatePrompt`・`validatePromptLength` 純粋関数を `src/utils/validation.ts` に実装する
    - リアルタイム文字数カウント・1000文字超過時のエラー表示・送信ボタン無効化を実装する
    - 空文字・空白のみの場合は「条件を入力してください」を表示する
    - スタンプ枚数セレクタ（8/16/24/32/40、デフォルト 8）・スタイル選択・生成モード選択を実装する
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 10.2 Property 1 のプロパティテストを fast-check で記述する
    - **Property 1: プロンプト文字数バリデーション**
    - **Validates: Requirements 1.2**

  - [x] 10.3 Property 2 のプロパティテストを fast-check で記述する
    - **Property 2: 空白・空文字プロンプトの拒否**
    - **Validates: Requirements 1.3**

- [x] 11. PromptHistory 管理ロジック（TypeScript）の実装
  - [x] 11.1 `src/stores/promptHistoryStore.ts` を作成し、履歴の追加・取得・選択ロジックを実装する
    - 最大 20 件・新しい順・21 件目追加時に最古 1 件を削除する
    - 履歴選択時にフォームへの反映コールバックを呼び出す
    - _Requirements: 1.7, 1.8_

  - [x] 11.2 Property 3 のプロパティテストを fast-check で記述する
    - **Property 3: プロンプト履歴の FIFO 管理**
    - **Validates: Requirements 1.7**

- [x] 12. ImagePreviewGrid コンポーネント（TypeScript）の実装
  - [x] 12.1 `src/components/ImagePreviewGrid.tsx` を作成し、生成画像のグリッド表示・個別削除・個別再生成ボタンを実装する
    - 生成進捗（完了枚数 / 全体枚数）を 1 秒以内の更新間隔でリアルタイム表示する
    - プレビュー承認モード用の「このスタイルで残りを生成する」「やり直す」ボタンを実装する
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.9_

  - [x] 12.2 Property 4 のプロパティテストを fast-check で記述する
    - **Property 4: プレビュー承認モードの残り枚数（n − 1）**
    - **Validates: Requirements 2.3**

  - [x] 12.3 `ImagePreviewGrid` のユニットテストを Vitest で記述する
    - 各ボタンの表示条件・進捗表示・エラー時の再試行ボタンを確認する
    - _Requirements: 2.6, 2.8_

- [x] 13. StampSetEditor コンポーネント（TypeScript）の実装
  - [x] 13.1 `src/components/StampSetEditor.tsx` を作成し、スタンプセットのプレビュー一覧・タイトル/説明入力・画像差し替え・エクスポートボタンを実装する
    - `validateTitle`・`validateDescription`・`validateFileType` を `src/utils/validation.ts` に追加し StampSetEditor から呼び出す
    - タイトル: 1〜40文字、説明: 0〜160文字のリアルタイムバリデーション
    - ファイル選択ダイアログは PNG のみ許可、PNG 以外は「PNG形式のファイルを選択してください」を表示する
    - エクスポート前にタイトルバリデーションを通過した場合のみ ZIP 書き出しを開始する
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 13.2 Property 9 のプロパティテストを fast-check で記述する
    - **Property 9: Stamp_Set メタデータバリデーション**
    - **Validates: Requirements 4.2, 4.3**

  - [x] 13.3 Property 10 のプロパティテストを fast-check で記述する
    - **Property 10: ファイル種別バリデーション**
    - **Validates: Requirements 4.5**

  - [x] 13.4 `StampSetEditor` のユニットテストを Vitest で記述する
    - バリデーションエラーメッセージ表示・エクスポートボタン活性状態を確認する
    - _Requirements: 4.2, 4.3, 4.7_

- [x] 14. UploadPanel コンポーネント（TypeScript）の実装
  - [x] 14.1 `src/components/UploadPanel.tsx` を作成し、アップロード進捗バー・Upload_Result 表示・認証情報未設定メッセージ・アップロードボタンの活性制御を実装する
    - `isValidForUpload == false` のときアップロードボタンを `disabled` にする
    - 認証情報未設定時はアップロードを開始せずエラーメッセージを表示する
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7, 5.8_

  - [x] 14.2 Property 12 のプロパティテストを fast-check で記述する
    - **Property 12: バリデーション状態とアップロードボタンの連動**
    - **Validates: Requirements 5.6**

  - [x] 14.3 `UploadPanel` のユニットテストを Vitest で記述する
    - 認証エラー・ネットワークエラー・成功時の各表示状態を確認する
    - _Requirements: 5.3, 5.4, 5.7, 5.8_

- [x] 15. ConfigPanel・SetupWizard コンポーネント（TypeScript）の実装
  - [x] 15.1 `src/components/ConfigPanel.tsx` を作成し、AIエンジン選択・APIキー入力・出力ディレクトリ設定・Config エクスポート/インポートを実装する
    - 保存成功時に「設定を保存しました」を表示する
    - _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7_

  - [x] 15.2 `src/components/SetupWizard.tsx` を作成し、起動時に Config 未設定または APIキー未設定の場合に初回セットアップウィザードを表示する
    - _Requirements: 6.3_

  - [x] 15.3 `ConfigPanel` のユニットテストを Vitest で記述する
    - エクスポート後に APIキーが含まれないことを確認する
    - _Requirements: 6.5_

- [x] 16. LogViewer コンポーネント（TypeScript）の実装
  - [x] 16.1 `src/components/LogViewer.tsx` を作成し、ログエントリの一覧表示・レベルフィルタ・日付範囲フィルタを実装する
    - 最大 1000 件表示
    - _Requirements: 7.4, 7.6_

  - [x] 16.2 `LogViewer` のユニットテストを Vitest で記述する
    - フィルタリング後の件数上限と表示内容を確認する
    - _Requirements: 7.4, 7.6_

- [x] 17. Checkpoint — フロントエンドコンポーネント層の統合確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. App ルーティングとコンポーネントの統合（TypeScript）
  - [x] 18.1 `src/App.tsx` に全コンポーネントを組み込み、生成フロー（PromptInput → ImagePreviewGrid → StampSetEditor → UploadPanel）の状態管理を実装する
    - グローバル状態管理（Zustand または React Context）で `GenerationRequest`・`GeneratedImage[]`・`StampSet`・`UploadResult` を共有する
    - エラー発生時の日本語エラーメッセージ表示ロジックを実装する
    - _Requirements: 2.6, 3.4, 3.7, 7.1_

  - [x] 18.2 Electron の `preload.ts` に IPC API（`window.api`）を定義し、レンダラから `ipcRenderer.invoke` 経由でバックエンドを呼び出せるようにする
    - _Requirements: 2.5, 5.2_

- [x] 19. 最終 Checkpoint — 全テスト通過と統合動作確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. AI画像生成エンジンを DALL-E から OpenAI gpt-image-2.5 へ移行
  - 既存タスク 6.1 / 6.2 で実装した `DALLEAdapter`（DALL·E 3）を OpenAI gpt-image-2.5 へ置き換える変更対応。既存タスクの完了履歴は保持し、本タスク群で差分を追跡する。
  - [x] 20.1 バックエンド: `backend/services/image_generator_service.py` の `DALLEAdapter` を `OpenAIImageAdapter` にリネームし、`POST /v1/images/generations` を gpt-image-2.5 で呼び出すよう実装する
    - モデルは Config の `openai_model`（`gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`、デフォルト `gpt-image-2.5-flare`）で切り替える
    - `background="transparent"`・`output_format="png"` を指定して透過PNGを取得する（`transparent` 使用時は `output_format` を png/webp にする必要がある）
    - `size` は `1024x1024` を要求し、LINE規格変換は従来どおり ImageProcessorService に委ねる
    - APIキーは OS Keychain の `openai_api_key` から取得し、ログ・例外・Config ファイルに含めない
    - `engine_name` を `"openai"` に、`DEFAULT_MODEL` を `"gpt-image-2.5-flare"` に更新する
    - _Requirements: 2.1, 2.7, 2.8, 2.10 / 担当: backend-dev_

  - [x] 20.2 バックエンド: データモデルとルーターのエンジン識別子・モデル名を更新する
    - `backend/models.py` / `backend/services/config_service.py`: `dalle_model`（既定 `dall-e-3`）を `openai_model`（既定 `gpt-image-2.5-flare`）へ、`ai_engine` の既定 `"dalle"` を `"openai"` へ変更する
    - `backend/main.py`: `_ADAPTER_BY_ENGINE` の `"dalle"` を `"openai"` に、フォールバックとリクエストモデルの既定値を更新する
    - _Requirements: 6.1 / 担当: backend-dev_

  - [x] 20.3 フロントエンド: `Config` 型と ConfigPanel を更新する
    - `src/types/index.ts`: `aiEngine` の `"dalle"` を `"openai"` に、`dalleModel: string` を `openaiModel: "gpt-image-2.5-flare" | "gpt-image-2.5-sunburst"` に変更する
    - `src/components/ConfigPanel.tsx`: エンジン選択肢を「OpenAI (gpt-image-2.5)」に、モデル選択UI（flare / sunburst）を提供する（UIテキストは日本語）
    - _Requirements: 6.1 / 担当: frontend-dev_

  - [x] 20.4 テスト更新: 移行に伴う既存テストの改修と新規検証を行う
    - Python: `DALLEAdapter` 向けテストを `OpenAIImageAdapter` 用に書き換え、gpt-image-2.5 のパラメータ（`background=transparent`・`output_format=png`・モデル切替）をモックで検証する。`test_models.py` の `dalle_model`/`ai_engine` 既定値アサーションを更新する
    - TS: `configPanel.test.tsx` などの `dalleModel`/`"dalle"` を `openaiModel`/`"openai"` に更新する
    - 外部 API はすべてモックする。APIキーがテスト出力・Config に現れないことを確認する
    - _Requirements: 2.8, 2.10, 6.1, 6.5 / 担当: backend-dev, frontend-dev_

---

## Notes

- `*` 付きサブタスクは省略可能（MVP を早期リリースしたい場合はスキップ可）
- 各タスクは前のタスクの成果物を前提として積み上げる構成になっている
- 外部サービス（AI API・Playwright・OS Keychain）は全てモックを使用してテストする
- PBT（プロパティベーステスト）は最低 100 イテレーションで実行すること
- エラーメッセージは全て日本語で記述する（Design の方針に従う）

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "3.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3", "3.4", "3.5", "5.1"] },
    { "id": 2, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "6.1"] },
    { "id": 3, "tasks": ["6.2", "7.1"] },
    { "id": 4, "tasks": ["7.2", "7.3", "8.1"] },
    { "id": 5, "tasks": ["8.2", "10.1", "11.1"] },
    { "id": 6, "tasks": ["10.2", "10.3", "11.2", "12.1"] },
    { "id": 7, "tasks": ["12.2", "12.3", "13.1"] },
    { "id": 8, "tasks": ["13.2", "13.3", "13.4", "14.1"] },
    { "id": 9, "tasks": ["14.2", "14.3", "15.1", "15.2"] },
    { "id": 10, "tasks": ["15.3", "16.1"] },
    { "id": 11, "tasks": ["16.2", "18.1"] },
    { "id": 12, "tasks": ["18.2"] }
  ]
}
```
# 項目別スタンプ企画の追加タスク

- [x] 両テーマ各40件の定型データと企画検証、共通設定・企画編集画面を追加
- [x] 企画全件をフロントエンドからElectronとFastAPIへ渡し、対象項目ごとのプロンプトを生成
- [x] 全体生成、プレビュー承認、個別再生成で絶対位置と確定済み企画を使用
- [x] プレビューに企画ラベルと削除後の未生成位置を表示
- [x] 企画データ、編集、バックエンド検証、部分生成のモックテストを追加
- [ ] 有料画像APIを使った実画像8枚の目視確認（ユーザーが実行）

## レビュー時の再生成条件編集

- [x] 成功画像カードに対象画像を見ながら編集できるフォームとキャンセル操作を追加
- [x] 対象項目の条件だけを更新し、同じ更新済み要求を部分生成とイベント対応に使用
- [x] 追加指示の型、camelCase API 検証、個別プロンプト節を追加
- [x] 失敗時の元画像と最新条件の保持、再試行、生成中の競合操作抑制を検証
- [x] フォーム、App→IPC、Python サービスのモックテストを追加

## 画像ごとの描き文字

- [x] 新規true/null、旧項目false/null、厳格API契約、コピー・IPCスナップショットを実装
- [x] 意味への追従、任意文字、オフ時保持、意味へ戻す、空欄・100文字上限検証を実装
- [x] 企画・再生成フォーム、優先順位と目視確認の案内を追加
- [x] 文字あり／なしでプロンプトを分岐し、既存の追加指示を維持
- [x] 生成画像に文字設定を記録し、再生成失敗時の旧画像との対応を保持
- [x] 新規・旧契約、フォーム、混在生成、承認・絶対位置再生成をモックテストで検証
- [ ] 文字あり・意味使用／任意文字／文字なしを混ぜた8枚の実画像をユーザーが目視確認

## 透過確認と拡大レビュー

- [x] 起動中に共有する表示専用背景設定、任意色、CSS市松模様と共通画像部品を追加
- [x] 生成一覧・詳細・変換後のスタンプ／メイン／タブのプレビューへ共通背景を適用
- [x] IDで対象を保持する詳細モーダル、contain、ズーム、前後移動、フォーカス管理を追加
- [x] 既存フォームと単独再生成経路を接続し、ドラフト破棄確認と未承認・生成中の操作制御を追加
- [x] 生成時の項目条件を画像に記録し、元画像と次回用条件を区別する表示を追加
- [x] 詳細の操作・背景変更・再生成成功／失敗／再試行のモックテストを追加
- [x] 合成した透明／不透明白／焼き込み市松PNGで実ブラウザーの画素・ズーム・狭い画面・キーボード操作を検証
- [ ] 実際のAI生成画像で背景と描き文字を目視確認（有料APIは自動テストで使わない）

## 生成設定の保存と読み込み

- [x] v1保存形式・許可項目のスナップショット・下書き用構造検証・旧文字設定互換を追加
- [x] Electron userDataのUUIDファイル、原子的書込、限定IPC、破損設定を分離する一覧を追加
- [x] 名前付き保存・上書き・別名保存・削除・確認・busyと失敗表示を追加
- [x] 別名保存をアプリ内入力に変更し、空欄・キャンセル・保存失敗時の入力保持と再試行を検証
- [x] 共通入力と企画ドラフトを同期し、レビューの確定済み条件を保存対象にする
- [x] 単一状態遷移による読込、旧画像と要求の解除、作業モデル・品質、生成競合防止を追加
- [x] 永続化・JSON往復・故障注入・破損／未知スキーマ・UI・App→IPCのモックテストを追加
- [x] 実ファイル保存と検証サーバー再起動、新しい画面からの復元、モデル品質・狭い画面をブラウザーで検証
- [x] sourceTemplateIdの保存と生成APIへの非送信、将来のスキーマ拡張方法を文書化
- [ ] インストール済みElectronアプリを再起動した実機確認（画像APIは自動検証では使わない）

## メイン画像・トークルームタブ画像の元画像選択

- [x] `StampImage.id` と `StampSet.mainImageId`／`tabImageId` を追加し、生成項目IDからの付与と新規・旧データ正規化（未指定時のみ先頭の正常画像）を実装
- [x] 共通の選択解決・検証（未選択／セット外／変換中・失敗／出力なし）を `validateStampSet`、画面、要求生成で共有
- [x] 画像単位の差し替え・再変換・失敗をIDで反映し、選択・削除アクションと削除時の選択解除・確認を追加
- [x] 編集画面に選択ボタン、選択状態、現在のメイン／タブ派生画像とクロップ確認の案内を追加（元画像へフォールバックしない）
- [x] IPC・FastAPI契約に画像IDと選択IDを追加し、ZIPとアップロードで `resolve_representative_images` を共有（旧要求のみ先頭画像、PNG・サイズ・容量検証、照合用パス不一致は400）
- [x] 3枚目／5枚目の選択でZIPのmain.png・tab.pngのバイト列とアップロード要求パスが一致すること、初期値・差し替え・再変換・削除・不正ID・変換失敗、Property 20をモックテストで検証
- [x] 合成PNGを実際の画像処理で変換し、実ブラウザーで選択・派生画像表示・削除を操作、画面の要求を実FastAPI `/export` に渡してZIPのバイト列を検証（`tests/browser/check_representative_selection.py`）
- [ ] 実際のAI生成画像で、選択したメイン画像の中央クロップによる文字・顔の切れをユーザーが目視確認
- [ ] LINE Creators Market への実送信での確認（アップロード機能は現在無効。自動テストではLINEへ送信しない）
