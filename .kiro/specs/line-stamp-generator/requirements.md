# Requirements Document

## Introduction

本ドキュメントは、「LINEスタンプジェネレーター」の機能要件を定義する。
本アプリは、ユーザーが自然言語で入力したテーマ・スタイル・キャラクターなどの条件をもとに、AIを活用してLINEスタンプ画像を自動生成し、LINE規格への準拠処理を経てLINE Creators Marketへのアップロードまでを一括で行うローカルアプリケーションである。
日本語ユーザーを主な対象とし、Webアプリまたはデスクトップアプリとしてローカル環境で動作する。

---

## Glossary

- **App（アプリ）**: 本LINEスタンプジェネレーターアプリケーション全体
- **User（ユーザー）**: アプリを操作する日本語話者のエンドユーザー
- **Prompt（プロンプト）**: ユーザーが自然言語で入力するスタンプ生成条件（テーマ・スタイル・キャラクターなど）
- **AI_Image_Generator（AI画像生成エンジン）**: Stable Diffusion、DALL-E、Midjourneyなどの画像生成AIサービスまたはローカルモデル
- **Generated_Image（生成画像）**: AI_Image_Generatorが出力した画像ファイル
- **Image_Processor（画像処理エンジン）**: LINE規格に合わせた画像リサイズ・フォーマット変換・トリミングを行うモジュール
- **Stamp_Set（スタンプセット）**: LINE Creators Marketへアップロードする1セット分のスタンプ画像群（タイトル・説明・メイン画像・サムネイル画像・個別スタンプ画像を含む）
- **LINE_Uploader（アップローダー）**: LINE Creators Market APIまたはブラウザ自動化によりStamp_Setをアップロードするモジュール
- **LINE_Creators_Market**: LINEスタンプをクリエイターが申請・販売できる公式プラットフォーム
- **Validation_Result（バリデーション結果）**: Image_Processorが行うLINE規格適合チェックの結果オブジェクト
- **Upload_Result（アップロード結果）**: LINE_UploaderがLINE Creators Marketへの送信後に返すステータスオブジェクト
- **Config（設定）**: APIキー・使用する画像生成エンジン・出力ディレクトリなどユーザーが保存するアプリ設定

---

## Requirements

### Requirement 1: 自然言語によるスタンプ条件の入力

**User Story:** 日本語ユーザーとして、自然言語でスタンプのテーマ・スタイル・キャラクターなどを入力したい。そうすることで、専門的な知識がなくてもスタンプ生成を開始できる。

#### Acceptance Criteria

1. THE App SHALL 日本語および英語によるテキスト入力フォームをユーザーに提供する
2. WHILE ユーザーがPromptを入力している, THE App SHALL 入力文字数を入力フォーム上にリアルタイムで表示し、1000文字を超えた場合は超過文字数を示すエラーメッセージを入力フォーム上に表示して送信ボタンを無効化する
3. WHEN ユーザーがPromptを送信する, THE App SHALL Promptが空文字でないことを検証し、空の場合は「条件を入力してください」というメッセージを表示する
4. THE App SHALL スタンプ生成枚数（8・16・24・32・40枚のいずれか）をユーザーが選択できるセレクタを提供し、デフォルト値は8枚とする
5. THE App SHALL 生成スタイル（かわいい・クール・ゆるい・リアル）の4種類をユーザーが選択できるオプションを提供し、いずれも未選択の状態でも送信可能とする
6. THE App SHALL 生成モードとして「一括生成モード」（全枚数を一括生成）と「プレビュー承認モード」（1枚目を生成してユーザー承認後に残りを生成）の2種類をユーザーが選択できるオプションを提供し、デフォルトは「一括生成モード」とする
7. WHEN ユーザーがPromptを送信する, THE App SHALL そのPromptテキストを履歴として保存し、最大20件まで新しい順で保持する（20件超過時は最古の1件を削除する）
8. WHEN ユーザーが履歴から特定のPromptを選択する, THE App SHALL 選択されたPromptのテキストをPrompt入力フォームに反映する

---

### Requirement 2: AIによるスタンプ画像の自動生成

**User Story:** 日本語ユーザーとして、入力した条件をもとにAIが複数枚のスタンプ画像を自動生成してほしい。そうすることで、デザインスキルがなくても独自のスタンプを作れる。

#### Acceptance Criteria

1. WHEN ユーザーが「一括生成モード」でPromptを送信する, THE AI_Image_Generator SHALL 指定された枚数分のGenerated_Imageを、選択されたスタイル（未選択の場合はデフォルトスタイル）を適用して一括生成する
2. WHEN ユーザーが「プレビュー承認モード」でPromptを送信する, THE AI_Image_Generator SHALL 最初の1枚のみGenerated_Imageを生成し、THE App SHALL 生成されたプレビュー画像とともに「このスタイルで残りを生成する」ボタンおよび「やり直す」ボタンをユーザーに表示する
3. WHEN ユーザーが「プレビュー承認モード」で「このスタイルで残りを生成する」ボタンを押す, THE AI_Image_Generator SHALL 残りの（指定枚数 − 1）枚のGenerated_Imageを同一のPromptとスタイル設定で生成する
4. WHEN ユーザーが「プレビュー承認モード」で「やり直す」ボタンを押す, THE App SHALL 生成済みの1枚を破棄し、Prompt入力フォームに戻る
5. WHEN AI_Image_Generator が画像生成を開始する, THE App SHALL 生成の進捗状況（生成済み枚数／全体枚数）を1秒以内の更新間隔でリアルタイムにユーザーへ表示する
6. WHEN AI_Image_Generator が全枚数の生成を完了する, THE App SHALL 生成された全Generated_Imageのプレビューをグリッド形式で表示する。IF プレビューの表示に失敗する, THEN THE App SHALL 生成プロセス自体が失敗したものとして扱い、エラーメッセージとともに生成の再実行を促すボタンをユーザーに表示する
7. THE App SHALL Stable Diffusion（ローカル）、DALL-E（API）、Midjourney（API）のうち少なくとも1つをAI_Image_Generatorとして設定できる機能をConfigに提供する
8. IF AI_Image_Generator との通信がタイムアウトまたはAPIエラーを返す, THEN THE App SHALL エラーの種別とエラーが発生した画像インデックスをユーザーに表示し、生成済みのGenerated_Imageは破棄せず保持し、ユーザーが生成を再試行または中断できるボタンを提供する
9. WHEN ユーザーがGenerated_Imageのプレビューを確認する, THE App SHALL 個別のGenerated_Imageを削除または単独で再生成できるボタンを各画像に提供する（再生成は元のPromptとスタイル設定を使用する）
10. IF AI_Image_Generator が1枚あたりの画像生成を開始してから180秒以内に結果を返さない, THEN THE App SHALL タイムアウトエラーとして処理し、該当画像の生成を停止してユーザーに通知する

---

### Requirement 3: LINE規格への画像自動調整

**User Story:** 日本語ユーザーとして、生成した画像をLINEスタンプの規格に自動で合わせてほしい。そうすることで、手動でリサイズや変換をする手間を省ける。

#### Acceptance Criteria

1. WHEN ユーザーがLINE規格への変換を指示する, THE Image_Processor SHALL 各Generated_ImageをW370px × H320px以内かつ透過PNGフォーマットにリサイズ・変換する
2. WHEN ユーザーがLINE規格への変換を指示する, THE Image_Processor SHALL メイン画像（W240px × H240px、PNG）およびサムネイル画像（W96px × H74px、PNG）を各Generated_Imageから生成する
3. WHEN Image_Processor が変換後の画像を生成する, THE Image_Processor SHALL 各画像のファイルサイズが1MB以下であることを検証し、超過する場合はPNG圧縮レベルを段階的に上げて1MB以下に収める
4. WHEN Image_Processor が変換を完了する, THE App SHALL Validation_Resultとして各画像のサイズ・フォーマット・ファイルサイズの適合状況をユーザーに表示する
5. IF Generated_ImageのアスペクトレシオがLINEスタンプ規格のアスペクト比（37:32）の範囲外である, THEN THE Image_Processor SHALL 元画像の中央を基点とした中央クロップにより37:32に最も近いアスペクト比に調整し、クロップ後の画像をリサイズに使用する
6. WHEN Image_Processor が1枚のGenerated_Imageに対してスタンプ画像・メイン画像・サムネイル画像の3種類を生成する, THE Image_Processor SHALL 3種類全ての生成を10秒以内に完了する
7. IF Image_Processor が変換中にファイル読み込みエラーまたは書き込みエラーを検出する, THEN THE App SHALL 他の画像の変換処理を継続しながら、エラーが発生した画像インデックスとエラー内容をエラー検出と同時に即時ユーザーに表示する
8. IF Image_Processor がPNG圧縮を最大レベルまで適用してもファイルサイズが1MB以下にならない, THEN THE App SHALL 該当画像のValidation_Resultに「ファイルサイズ超過（調整不可）」を記録し、ユーザーに差し替えを促すメッセージを表示する

---

### Requirement 4: スタンプセットの確認と編集

**User Story:** 日本語ユーザーとして、アップロード前にスタンプセットの内容を確認・編集したい。そうすることで、意図しない内容でアップロードされることを防げる。

#### Acceptance Criteria

1. WHEN Image_Processor が全画像の変換を完了する, THE App SHALL Stamp_Setのプレビュー画面を表示し、全スタンプ画像・メイン画像・サムネイル画像を一覧表示する
2. WHILE ユーザーがスタンプセットのタイトルを入力している, THE App SHALL 入力文字数を表示し、1文字未満または41文字以上になった場合にバリデーションエラーメッセージを表示する
3. WHILE ユーザーがスタンプセットの説明を入力している, THE App SHALL 入力文字数を表示し、161文字以上になった場合にバリデーションエラーメッセージを表示する
4. WHEN ユーザーがStamp_Set内の特定のスタンプ画像の差し替えを指示する, THE App SHALL ローカルファイルシステムからPNG形式の画像ファイルのみを選択できるファイル選択ダイアログを表示する
5. IF ユーザーがPNG以外の形式のファイルを選択する, THEN THE App SHALL 「PNG形式のファイルを選択してください」というエラーメッセージを表示し、差し替えを中断する
6. WHEN ユーザーがPNG形式のファイルを選択して差し替えを確定する, THE App SHALL 差し替えた画像に対してImage_Processorと同一のLINE規格変換処理を自動的に適用し、完了後にプレビューを更新する
7. WHEN ユーザーがStamp_Setのエクスポートを指示する, THE App SHALL タイトルが1文字以上40文字以内であることを検証し、バリデーションを通過した場合に限りエクスポート処理を開始する
8. WHEN エクスポートのバリデーションが通過する, THE App SHALL 全スタンプ画像・メイン画像・サムネイル画像をZIPファイルにまとめてユーザーが指定したローカルディスクの場所に保存する
9. IF ZIPファイルへの書き込みに失敗する, THEN THE App SHALL 「エクスポートに失敗しました」というエラーメッセージとエラー詳細をユーザーに表示し、Stamp_Setのデータは保持したまま処理を終了する

---

### Requirement 5: LINE Creators Marketへの自動アップロード

**User Story:** 日本語ユーザーとして、完成したスタンプセットをLINE Creators Marketへ自動でアップロードしたい。そうすることで、手動操作の手間を省いてスムーズに申請できる。

#### Acceptance Criteria

1. WHEN ユーザーがアップロードを指示する, THE LINE_Uploader SHALL Stamp_SetをLINE Creators Marketへ送信する
2. WHEN LINE_Uploader がアップロードを開始する, THE App SHALL アップロードの進捗状況をプログレスバーで1秒以内の更新間隔でユーザーに表示する
3. WHEN LINE_Uploader がアップロードを完了する, THE App SHALL Upload_ResultとしてLINE Creators Marketから返された申請ID・ステータスをユーザーに表示する
4. IF LINE_Uploader がアップロード中にネットワークエラー（接続断・タイムアウト・サーバーエラーを含む）を検出する, THEN THE LINE_Uploader SHALL 5秒間隔で最大3回まで自動リトライし、3回全て失敗した場合はUpload_Resultにエラーの種別・発生回数・最終エラー内容を記録してユーザーに通知する
5. WHEN ユーザーがLINE Creators Marketの認証情報（メールアドレス・パスワードまたはアクセストークン）を保存する, THE App SHALL 認証情報をConfigに暗号化した形式で保存する
6. WHILE Stamp_SetがLINE規格バリデーション（画像サイズ・ファイル形式・枚数の全チェック）を未通過の状態である, THE App SHALL アップロードボタンを無効化する
7. IF LINE_Uploader が認証エラー（認証情報の不正・期限切れを含む）を検出する, THEN THE LINE_Uploader SHALL 自動リトライを行わずに即時停止し、認証エラーである旨をUpload_Resultに記録してユーザーに通知する
8. IF ユーザーがアップロードを指示した時点でConfigに認証情報が未設定である, THEN THE App SHALL アップロードを開始せず、認証情報の未設定を示すメッセージをユーザーに表示する

---

### Requirement 6: アプリ設定の管理

**User Story:** 日本語ユーザーとして、APIキーや使用するAIエンジンなどの設定を保存・管理したい。そうすることで、毎回設定を入力する手間を省ける。

#### Acceptance Criteria

1. THE App SHALL APIキー（AI_Image_Generator用・LINE Creators Market用）、選択中のAI_Image_Generatorの種別、画像出力先ディレクトリをConfigとして永続化する設定画面を提供する
2. WHEN ユーザーがAPIキーまたはアカウント認証情報を保存する, THE App SHALL それらをOSのキーチェーン（macOS Keychain、Windows Credential Manager、Linux SecretService）に保存する
3. IF 起動時にConfigが存在しない、またはAPIキーが未設定である, THEN THE App SHALL 初回セットアップウィザードを表示してユーザーをConfigの初期設定へ誘導する
4. WHEN ユーザーがConfigを変更して保存する, THE App SHALL 変更内容をConfigファイルに書き込み、「設定を保存しました」というメッセージをユーザーに表示する
5. WHEN ユーザーがConfigのエクスポートを指示する, THE App SHALL APIキーおよびアカウント認証情報を除いた設定内容をJSON形式でエクスポートする
6. WHEN ユーザーがConfigのインポートを指示する, THE App SHALL 指定されたJSONファイルを読み込み、スキーマ検証を行い、バリデーション通過後に既存Configを上書きする
7. IF ConfigのインポートファイルのJSON形式が不正またはスキーマ検証に失敗する, THEN THE App SHALL エラー内容をユーザーに表示し、既存Configを変更せずに処理を終了する

---

### Requirement 7: エラーハンドリングとログ管理

**User Story:** 日本語ユーザーとして、エラーが発生したときに分かりやすいメッセージと対処方法を知りたい。そうすることで、問題が起きても自分で解決できる。

#### Acceptance Criteria

1. WHEN App内で予期しないエラーが発生する, THE App SHALL ユーザーに分かりやすい日本語のエラーメッセージと推奨される対処方法を表示する
2. WHEN App内で操作イベント・エラー・外部API呼び出しが発生する, THE App SHALL その結果をISO 8601形式のタイムスタンプ・ログレベル・モジュール名・メッセージを含むログエントリとしてローカルディスクのログファイルに記録する
3. WHEN ログファイルの合計サイズが100MBを超える, THE App SHALL 最も古いログファイルから順に削除して合計サイズを100MB以下に収める
4. WHEN ユーザーがログファイルの表示を要求する, THE App SHALL 直近のログエントリを最大1000件まで画面内に表示する
5. IF ログファイルへの書き込みに失敗する, THEN THE App SHALL アプリの主要機能を継続させ、ログ書き込みエラーのみをUIに通知する
6. WHEN ユーザーがログのフィルタリングを行う, THE App SHALL ログレベル（INFO・WARN・ERROR）および日付範囲でログエントリを絞り込んで表示できる機能を提供する
