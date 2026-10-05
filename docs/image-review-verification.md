# 透過確認と拡大レビューの実装・検証

検証日：2026年10月5日（日本時間）。既存のインストーラー関連の未コミット変更は維持した。

## 操作

1. 生成一覧の「表示背景」で市松模様／白／黒／薄いグレー／任意色を選ぶ。任意色はカラーピッカーで指定する。背景は起動中の一覧・詳細・変換後プレビューで共有する。
2. 画像または「大きく表示」をクリックする。Tabでボタンを選びEnterでも開ける。
3. 詳細の「拡大」「縮小」「表示領域に収める」で画像全体と端を確認する。拡大時は画像表示領域を縦横にスクロールする。「前の画像」「次の画像」で移動する。
4. 詳細内で意味・表情・ポーズ・小物・追加指示・描き文字を編集し、「この内容で再生成」で対象1枚だけ生成する。編集だけではAPIを呼ばない。
5. 未確定の編集があると、閉じる・Escape・項目移動・フォームのキャンセル時に破棄確認が出る。確認をキャンセルすると編集を保持する。フォームのキャンセルを承認すると確定済み条件へ戻る。
6. 再生成中は旧成功画像を表示する。失敗後は次回用の編集済み条件を保持するので、そのまま再試行できる。表示画像の生成時条件と次回条件は別々に表示する。

## 主なファイル

- `src/components/PreviewImage.tsx`：画像画素を変更しないCSS背景の共通部品
- `src/components/PreviewBackgroundControls.tsx`、`src/stores/previewBackgroundStore.ts`：背景の選択と起動中の共有
- `src/components/ImageReviewDialog.tsx`：拡大・スクロール・前後移動・編集・破棄確認・フォーカス管理
- `src/components/ImagePreviewGrid.tsx`：項目IDで詳細を開き、既存の個別再生成へ接続
- `src/components/RegenerationEditor.tsx`：既存フォームのドラフト変更通知とモーダル向けフォーカス／Escape制御
- `src/components/StampSetEditor.tsx`：変換後のスタンプ・メイン・タブ画像へ共通背景を適用
- `src/App.tsx`、`src/types/index.ts`：画像に生成時の項目条件をコピーして記録
- `src/styles.css`：表示背景・モーダル・contain・狭い画面のスクロール
- `.kiro/specs/line-stamp-generator/{requirements,design,tasks}.md`：実装に合わせた仕様更新

## 検証結果

| 検証 | 結果 |
|---|---|
| 変更前TypeScript全テスト | 155件成功 |
| 最終TypeScript全テスト `npm run test:run` | 165件成功、23ファイル |
| Python全テスト `.venv/Scripts/python.exe -m pytest` | 127件成功、既存依存ライブラリの非推奨警告1件 |
| 型チェック `npx tsc --noEmit` | 成功 |
| `npm run lint` | 既存の `dist-backend` 内Playwright型定義で868件のエラー |
| `npm run lint -- --ignore-pattern 'dist-backend/**' --ignore-pattern 'build-backend/**'` | 成功（ソース・設定・追加検証コードを含む） |
| `npm run build` | 成功：Vite・Electron・Python同梱・Windows NSISインストーラー |
| 合成PNGの実ブラウザー検証 | 成功：透明部分のみ白／黒背景で変化、不透明な白と焼き込み格子は保持、画像URL不変 |
| 詳細レビューの実ブラウザー検証 | 成功：contain、拡大時の縦横スクロール、Enterで開く、前後移動、Escape、フォーカス復帰、390px幅 |
| App→IPCのモック検証 | 成功：対象1枚への文字・ポーズ変更、失敗時の元画像保持、再試行成功で一覧と詳細を更新、背景を要求に含めない |
| 変換後プレビュー | 成功：3種の背景共有、元のURLとファイルパスを保持、背景変更では変換・エクスポートを開始しない |

最初のサンドボックス内実行では、Vitest子プロセス起動とPython一時ディレクトリへのアクセスが拒否された。権限付きの再実行は成功した。今回の追加テストで見つかったクエリ・ラベル・検証用レイアウトの問題は修正済み。全体lintのエラーは生成済みの外部依存型定義に限られ、ソース側には残っていない。

合成PNGと画面検証は `.venv/Scripts/python.exe tests/browser/check_image_review.py` で再実行できる。外部サービスへ接続せず、ローカルViteとヘッドレスChromium（未インストールなら既存Edge）を使用する。結果画像は `.pytest_cache/image-review/`、ログは `.review-browser.log` に保存する。サーバーのポートは5198。

## 制約・未実施

- 背景切り替えは目視確認用。透過PNG形式でも全画素が不透明な場合があり、背景除去の成功を保証しない。白抜き処理・OCR・自動背景判定は追加していない。
- 背景設定は起動中だけ共有し、再起動すると市松模様へ戻る。
- 生成時の項目条件が記録されていない旧画像には「記録はありません」と表示する。
- 変換後画面からの再生成は提供していない。生成レビューで修正してからLINE規格へ変換する。入力画像差し替えは既存機能を使用する。
- 実際の有料画像API、LINEへの送信、実画像の文字・背景の目視確認、インストーラーを使ったインストール、macOS/Linuxのビルドは未実施。
