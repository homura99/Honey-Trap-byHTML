# 天依わな育成シミュレーション

## プロジェクト概要

HTML・CSS・JavaScriptで開発する、天依わなを中心とした育成シミュレーションゲームです。ノベルゲーム形式の会話と、時間・スタミナ・好感度などを管理するゲーム進行を組み合わせることを目指しています。

ゲームの詳細な要件や開発上の制約は、開発指示書である [README.md](./README.md) を参照してください。

## 現在の状態

開発初期段階です。Vite上で動作する仮UIをゲームエンジンとFirebase Authentication / Cloud Firestoreへ接続しています。ゲーム内部の状態・時間・行動・イベント・エンディング判定を実装済みです。正式デザイン、シナリオ、バランス数値は開発中です。

### 実装済み

- Viteを使った開発サーバーと本番ビルド
- JavaScript ES Modulesによるエントリーポイント
- HTMLとCSSを分離した初期画面
- YAMLデータの実行時読み込み、構文・スキーマ・参照検証
- 52件の開発用ステージデータ、イベントとエンディングの検証用サンプル
- GameState、難易度固定、ゲーム時間、ステージ移行待ち
- YAML定義の行動、スタミナ不足補正、イベント進行、分岐、エンディング判定
- Firestoreの手動5枠・オート1枠クラウドセーブ、検証付きロード、JSONエクスポート
- 匿名認証での開始とGoogleアカウント連携
- エクスポート済みJSONの検証付きクラウドインポート
- ユーザーUID単位のエンディング回収記録とFirestore Security Rules
- Cloud Functionsからの認証成功Webhook通知（任意設定、個人情報・認証情報を含めない）
- GameEngineとFirestoreを接続した仮Home・Loading・Config・ノベルゲーム画面
- 背景とテキスト中心のサウンドノベル画面、話者/地の文、クリック・タップ・キーボード文章送り
- 行動選択・オンデマンドのステータス・バックログ・オート再生・既読スキップ
- 行動・イベント会話・選択肢・ステージ遷移・セーブ/ロード/JSON出力の画面操作
- エンディング結果・回収一覧と、開発用サンプルイベント解放操作
- シナリオ行ごとのCSS背景プリセット、任意のローカル背景画像、複数の配置可能なCSS/画像シルエット
- BGM/効果音用の演出イベント（`game:presentation`）を文章表示処理と分離

### これから実装する主な機能

- 正式版のステージ・行動・イベント・エンディング条件・シナリオデータと数値調整
- 正式版のHome/Loading/Config画面、背景・シルエット素材、シナリオ内容
- 既読情報・バックログのセーブデータ間永続化
- ゲーム内デバッグ機能

開発用のステージ日時、行動コスト、難易度補正、イベント、エンディング条件、シナリオは仮データです。正式なシナリオやバランス値として確定していません。

## ゲームデータ

ゲームデータはYAMLファイルを実行時に直接解析します。`stages.yaml` は52ステージの日付と共通の開始・終了時刻、`settings.yaml` はパラメータ・難易度補正・不足時ペナルティ・イベント選択重み、`actions.yaml` は各行動のカテゴリ・時間/スタミナコスト・効果を定義します。

イベント条件は `all`（AND）と `any`（OR）を使った入れ子形式で、葉条件は `parameter` または `flag`、`operator`、`value` で記述します。イベントのステージ、種別、繰り返し方、会話、選択肢、効果、分岐、関連エンディング、後回し後の再提示条件もYAMLに定義します。会話行は `text` を必須とし、`speaker` は省略可能です。行の `scene` でCSS背景プリセットを選択し、`backgroundImage` に同一オリジンのローカル背景画像、`silhouettes` に複数の画像/CSS仮シルエットと位置・サイズ・不透明度を設定できます。背景素材は `public/images/backgrounds/`、シルエット素材は `public/images/silhouettes/` に置き、YAMLから `/images/...` のURLパスで参照します。未指定の画像素材は表示しません。`bgm` と `soundEffects` のキューは `game:presentation` イベントで文章表示から分離して通知し、音声再生自体は後工程で接続します。エンディング一覧の `trigger` には `immediate` または `stageEnd` と条件を記述し、シナリオ本文は個別ファイルに分離します。

ゲームロジックは `src/game/` 以下の状態、時間、条件、行動、イベント、エンディング各モジュールで構成しています。セーブ処理は `src/storage/` のリポジトリに分離し、ゲームエンジンへ自動保存コールバックを注入します。

Cloud Firestoreは `users/{uid}/slots/{slotId}` と `users/{uid}/profile/endings` を使用します。手動5枠・オート1枠をアカウント単位で管理し、エンディング記録は全セーブ枠共通です。保存形式・状態スキーマのバージョンを検査し、破損・未対応データを自動初期化・上書きしません。JSONのエクスポートと、エクスポート済みスロットのクラウドインポートに対応します。匿名アカウントをGoogleと連携すると同じUIDのクラウドデータを維持します。既存Googleアカウントへ切り替える場合、別UID間のデータは自動統合しません。

`FirestoreSaveRepository` を `GameEngine` の `autoSave` オプションに接続し、行動終了時と確認済みステージ移行時に自動保存します。クラウド障害時はローカルへ切り替えず、保存・ロードの失敗を画面に表示します。Firebase Web設定は `.env.local` に置き、Firestore Rulesで各ユーザーのUID境界を強制します。

## 技術構成

- Vite
- HTML
- CSS
- JavaScript（ES Modules）
- ゲームシナリオ・設定データ形式：YAML
- 認証・クラウドセーブ：Firebase Authentication、Cloud Firestore

UIフレームワークは使用しません。

## 開発方法

Node.jsとnpmを用意し、リポジトリのルートで以下を実行します。

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Firebase ConsoleでAuthenticationの匿名認証とGoogleプロバイダーを有効化し、Cloud Firestoreを作成してください。.env.localへFirebase Webアプリ設定値を設定します。設定値がない場合は明示エラーを表示し、ローカル保存へは切り替えません。

FirebaseへのデプロイにはFirebase CLIが必要です。Functions依存関係を復元し、Firestore Rules・Cloud Functions・Hostingをデプロイします。

```powershell
npm --prefix functions install
firebase use --add
npm run build
firebase deploy --only hosting,firestore:rules
firebase functions:secrets:set LOGIN_WEBHOOK_URL
firebase deploy
```

通知を有効にするには `.env.local` の `VITE_AUTH_WEBHOOK_ENABLED=true` にしてから再ビルド・再デプロイします。Webhook本文は認証成功と時刻のみで、メールアドレス、UID、パスワード、認証トークンは含まれません。

本番ビルドは次のコマンドで確認できます。

```sh
npm run build
```

YAMLデータの検証と自動テストは次のコマンドで実行します。

```sh
npm run validate:data
npm test
```

生成されたビルドをローカルで確認する場合は、ビルド後に次を実行します。

```sh
npm run preview
```

## ディレクトリ構成

```text
.
├── data/
│   ├── settings.yaml
│   ├── actions.yaml
│   ├── stages.yaml
│   ├── events.yaml
│   └── endings/
│       ├── index.yaml
│       └── scenarios/
├── scripts/
│   └── validate-data.js
├── functions/
│   └── index.js
├── firestore.rules
├── firebase.json
├── index.html
├── src/
│   ├── main.js
│   ├── style.css
│   ├── firebase/
│   │   └── client.js
│   ├── ui/
│   │   ├── app.js
│   │   └── views.js
│   ├── data/
│   │   ├── runtime-data.js
│   │   └── validate.js
│   ├── storage/
│   │   ├── firestore-save-repository.js
│   │   ├── indexeddb-save-repository.js
│   │   └── save-export.js
│   └── game/
│       ├── state.js
│       ├── save-state.js
│       ├── time.js
│       ├── conditions.js
│       ├── effects.js
│       ├── actions.js
│       ├── events.js
│       ├── endings.js
│       └── engine.js
├── tests/
│   ├── data-validation.test.js
│   ├── game-engine.test.js
│   ├── save-storage.test.js
│   └── ui-view.test.js
├── package.json
├── package-lock.json
├── README.md
└── PROJECT_OVERVIEW.md
```

機能の実装に応じて、データ、ゲームロジック、保存処理などを責務ごとに分けて追加する予定です。
