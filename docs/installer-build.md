# インストーラーのビルド

配布版では Python のインストールや PATH 設定は不要です。バックエンドを
PyInstaller の `onedir` 形式でビルドし、Electron の `extraResources` で
フォルダー全体（exe と `_internal` の依存ファイル）を同梱します。

## Windows のビルド環境

Python 3.11 と Node.js を用意し、プロジェクトルートで実行します。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-build.txt
npm ci
npm run build
```

`npm run build:backend` でバックエンドのみを再ビルドできます。
ビルドには `.venv` 内の Python を使用し、失敗した場合はインストーラー作成も停止します。
macOS / Linux 向けも対象 OS 上で `.venv` を作成してビルドしてください。
PyInstaller は別 OS 向けのクロスコンパイルを行いません。

## 配布ファイルと起動

```text
dist-backend/line-stamp-backend/
  line-stamp-backend.exe
  _internal/...

インストール先/resources/backend/
  line-stamp-backend.exe
  _internal/...
```

Electron は `app.isPackaged` の場合、
`process.resourcesPath/backend/line-stamp-backend.exe` の絶対パスを
`shell: false`、`windowsHide: true` で起動します。
開発時の `npm run dev` は `.venv` の Python を優先して
`-m backend.run_server` を実行し、仮想環境がなければ PATH 上の Python を使用します。
どちらも `127.0.0.1:8765/health` の応答を待ってからウィンドウを表示します。
起動失敗時はエラーダイアログを表示してアプリを終了します。

設定・ログは既存のユーザーホーム配下に保存され、インストール先への書き込みは不要です。
Playwright のモジュールとドライバーは同梱しますが、Chromium ブラウザー本体は
このビルドでは同梱しません。LINE アップロード機能には、従来どおり
Playwright 1.44.0 に対応する Chromium の用意が別途必要です。

## 確認

- `npm run test:run -- electron/backend.test.ts`
- `npm run build`
- `.\.venv\Scripts\python.exe scripts/smoke-backend.py dist/win-unpacked/resources/backend/line-stamp-backend.exe`
  （Windows 用。Python を PATH から外した子プロセスで health・設定・Keyring・画像変換を確認）
- `dist/win-unpacked/resources/backend` に exe と `_internal` が存在すること
- Python が PATH にない環境で配布アプリを起動し、設定画面が開くこと
- アプリ終了時にバックエンドのプロセスが終了すること

参考: [PyInstaller の onedir オプション](https://pyinstaller.org/en/stable/usage.html)、
[electron-builder のファイル同梱設定](https://www.electron.build/contents/)。
