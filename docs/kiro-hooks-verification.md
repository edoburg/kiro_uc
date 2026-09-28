# Kiro Hooks 動作検証

最終更新: 2026-09-29

## 対応した現行仕様

Kiro IDE 1.x／CLI 3.xのHook仕様に合わせ、`.kiro/hooks/*.json` を次の形式へ統一した。

- スキーマは `version: "v1"` と `hooks` 配列を使用する。
- triggerは `SessionStart`、`PreToolUse`、`PostFileSave`、`PostTaskExec` を使用する。
- `PreToolUse` のmatcherは現行の組み込みツールカテゴリ `write` を使用する。
- ファイルmatcherは正規表現 `\.(ts|tsx|py)$` を使用する。
- コマンドHookの `timeout` と `enabled` はHook直下に置く。
- コマンドはプロジェクトルートから起動され、イベントJSONをSTDINで受け取る。

参照した公式ドキュメント:

- [Hooks](https://kiro.dev/docs/hooks/)
- [Hook triggers](https://kiro.dev/docs/hooks/types/)
- [Hook actions](https://kiro.dev/docs/hooks/actions/)
- [CLI 3.0 migration guide](https://kiro.dev/docs/cli/v3/migration-guide/)

## Hook一覧

| ファイル | trigger | matcher | 処理 |
| --- | --- | --- | --- |
| `session-start-reminder.json` | `SessionStart` | なし | プロジェクト固有の実装ルールを会話へ追加する |
| `security-check-on-write.json` | `PreToolUse` | `write` | 平文の認証情報や秘密鍵を検出した書き込みを終了コード2でブロックする |
| `lint-on-save.json` | `PostFileSave` | `\.(ts\|tsx\|py)$` | TS/TSXではESLintと型チェック、Pythonでは仮想環境のPythonで構文チェックを行う |
| `run-tests-after-task.json` | `PostTaskExec` | なし | Vitestと仮想環境のpytestを実行する |

コマンド処理はWindowsで利用できない `/dev/stdin`、`tail`、Unix形式の `cd` に依存しない。Pythonは最初に `.venv/Scripts/python.exe` を使用する。

## 自動検証結果

2026-09-29にWindows上で次を確認した。

| 検証項目 | 結果 |
| --- | --- |
| 4つのJSONの構文、v1スキーマ、trigger、matcher、action、timeout位置 | 成功 |
| lint matcherがTS、TSX、Pythonに一致し、CSSに一致しないこと | 成功 |
| 通常の書き込み入力に対するセキュリティ検査 | 終了コード0 |
| ダミーのOpenAI形式キーを含む書き込み入力 | 終了コード2（ブロック） |
| 不正なSTDIN JSON | 終了コード1（失敗として通知） |
| TypeScript保存相当のESLintと `tsc --noEmit` | 成功 |
| Python保存相当の `py_compile` | 成功 |
| PostTaskExec相当のVitest | 16ファイル、134テスト成功 |
| PostTaskExec相当のpytest | 101テスト成功、既存のDeprecationWarning 1件 |

設定と成功・ブロック・失敗の基本動作は次のコマンドで再検証できる。

```powershell
node .kiro/hooks/scripts/verify-hooks.cjs
```

lint、型チェック、Vitest、pytestを含む完全検証は次のコマンドで行う。

```powershell
node .kiro/hooks/scripts/verify-hooks.cjs --full
```

## Kiro IDEでの発火確認手順

1. Kiro IDE 1.xでこのワークスペースを開き、Agent Hooksに4つのHookが有効状態で表示され、スキーマ警告がないことを確認する。
2. 新しいチャットセッションを開始する。`Session Start Reminder` が実行され、KiroのHookログに成功が記録されることを確認する。
3. KiroへTSまたはTSXファイルの安全な編集を依頼する。保存後に `Lint on Save` が発火し、ESLintと型チェックの成功メッセージが表示されることを確認する。
4. KiroへPythonファイルの安全な編集を依頼する。保存後に同じHookが発火し、Python構文チェックの成功メッセージが表示されることを確認する。
5. 通常の内容を書き込む操作で `Security Check on Write` が発火し、書き込みが継続されることを確認する。
6. `sk-` の後ろに半角英字 `a` を24文字連結した実在しないダミー値を、`api_key` へ直接代入するファイル作成を依頼する。Hookが終了コード2となり、ファイルが作成されないことを確認する。実際の認証情報は使用しない。
7. Kiro Specのテスト用タスクを完了状態へ進める。`Run Tests After Task` が発火し、Vitestとpytestが成功することを確認する。
8. 発火しない場合はKiroのOutputパネルでHookログを開き、Hookの有効状態、matcher、実行ディレクトリを確認する。

## IDE検証状況

設定ファイルと各コマンドの直接実行は確認済み。現在の自動操作環境からはKiro IDEウィンドウへ接続できず、`kiro-cli`もPATH上に存在しないため、上記7手順によるIDEイベントの実発火確認は未実施である。IDE確認が完了するまではTASKS.mdのT-032を未完了として扱う。
